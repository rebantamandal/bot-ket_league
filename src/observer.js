/* Read-only sequence observer. Includes misses, groups pre-outcome trajectories,
   compares matched-context opportunities and reports uncertainty. No gameplay writes. */
(function (root) {
  'use strict';
  const { clamp, Q } = TM;
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const MOTION = {
    turn: 'Turn',
    brake: 'Brake',
    boost: 'Boost',
    cover: 'Cover',
    air: 'Rise',
    wall: 'Wall',
    recover: 'Rotate',
    direct: 'Approach',
    slide: 'Slide'
  };
  const WORDS = {
    turn: 'Turning approach',
    brake: 'Braking approach',
    boost: 'Boosted approach',
    cover: 'Goal-side coverage',
    air: 'Elevated approach',
    wall: 'Wall approach',
    recover: 'Recovery arc',
    direct: 'Direct approach',
    slide: 'Powerslide approach'
  };
  function wilson(k, n) {
    if (!n) return [0, 1];
    const z = 1.96,
      p = k / n,
      a = 1 + (z * z) / n,
      c = (p + (z * z) / (2 * n)) / a,
      h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / a;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  class Observer {
    constructor(n = 2) {
      this.frames = [];
      this.samples = Array.from({ length: n }, () => []);
      this.patterns = [];
      this.pending = [];
      this.serial = 0;
      this.sampleAt = 0;
      this.lastNotice = -100;
      this.listeners = [];
      this.totalWindows = 0;
      this.notes = [];
      this.watching = Array(n).fill(null);
      this.lastWindow = Array(n).fill(-100);
      this.opportunities = [];
    }
    resetSegment() {
      const n = this.world?.cars.length || this.samples.length;
      this.samples = Array.from({ length: n }, () => []);
      this.watching = Array(n).fill(null);
      this.lastWindow = Array(n).fill(-100);
    }
    subscribe(fn) {
      this.listeners.push(fn);
    }
    notify(type, p, w) {
      for (const f of this.listeners) f({ type, pattern: p, time: w.time });
    }
    step(w, dt) {
      this.sampleAt += dt;
      if (this.sampleAt < 0.1) return;
      this.sampleAt -= 0.1;
      this.frames.push(w.snapshot());
      while (this.frames.length && this.frames[0].time < w.time - 9) this.frames.shift();
      for (const c of w.cars) {
        const b = w.ball,
          db = Math.hypot(b.x - c.x, b.z - c.z),
          br = w.brains[c.id];
        let phase = 'direct';
        if (!c.ground && c.y > 1.4) phase = 'air';
        else if (Math.abs(c.normal[1]) < 0.8 && c.y > 2) phase = 'wall';
        else if (c.side * (b.x - c.x) < -2) phase = 'recover';
        else if (c.side * c.x < -23 && db > 8) phase = 'cover';
        else if (c.drift && Math.abs(c.slip) > 2) phase = 'slide';
        else if (c.throttle < -0.2 && c.speed > 6) phase = 'brake';
        else if (Math.abs(c.steer) > 0.65) phase = 'turn';
        else if (c.boosting) phase = 'boost';
        const a = this.samples[c.id] || (this.samples[c.id] = []),
          mat = w.field.sample(c.x, c.z);
        a.push({
          t: w.time,
          speed: c.speed,
          boost: c.boosting ? 1 : 0,
          y: c.y,
          turn: Math.abs(c.steer),
          brake: c.throttle < -0.2 ? 1 : 0,
          goalSide: clamp((c.side * (b.x - c.x)) / 20, -1, 1),
          wide: clamp((b.z - c.z) / 28, -1, 1),
          db: clamp(db / 40, 0, 1),
          phase,
          wet: mat.wet,
          heat: c.heat,
          air: !c.ground ? 1 : 0,
          threat: c.side * b.vx < -3 && c.side * b.x < 0 ? 1 : 0,
          features: c.plan ? Array.from(c.plan.features) : null,
          reference: br?.referenceFeatures ? Array.from(br.referenceFeatures) : null,
          probe: br?.policyProbe || 0,
          plan: c.plan?.variant || 'balanced'
        });
        while (a.length && a[0].t < w.time - 4.4) a.shift();
        if (w.human === c.id) {
          this.watching[c.id] = null;
          continue;
        }
        if (!this.watching[c.id] && db < 20 && c.plan?.kind === 'contact') this.watching[c.id] = { start: w.time };
        const watch = this.watching[c.id];
        if (watch && w.time - watch.start > 3.5) {
          this.outcome({ type: 'attempt', id: c.id, time: w.time, round: w.round, quality: 0, miss: true });
          this.watching[c.id] = null;
        }
      }
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const t = this.pending[i];
        if (w.time < t.until) continue;
        this.pending.splice(i, 1);
        const side = w.cars[t.agent].side,
          team = side > 0 ? 0 : 1,
          gd = w.score[team] - t.score[team] - (w.score[1 - team] - t.score[1 - team]);
        const progress = w.round === t.round ? clamp((side * (w.ball.x - t.bx)) / 24, -1, 1) : 0;
        const utility = gd ? clamp(gd, -1, 1) : clamp(t.quality * 0.48 + progress * 0.52, -1, 1);
        this.register(w, t, utility, gd);
      }
    }
    outcome(e) {
      const w = this.world;
      if (
        !w ||
        e.id < 0 ||
        !this.samples[e.id] ||
        w.human === e.id ||
        e.type === 'goal' ||
        e.time - this.lastWindow[e.id] < 3
      )
        return;
      const a = this.samples[e.id].filter(s => s.t < e.time && s.t > e.time - 3.2);
      if (a.length < 8) return;
      this.watching[e.id] = null;
      this.lastWindow[e.id] = e.time;
      const counts = {};
      for (const s of a) counts[s.phase] = (counts[s.phase] || 0) + 1;
      const lead = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0] || 'direct',
        wet = mean(a.map(s => s.wet)),
        threat = mean(a.map(s => s.threat)) > 0.35,
        air = mean(a.map(s => s.air)) > 0.28,
        context =
          (w.mode || 'duel') +
          ':' +
          (wet > 0.45 ? 'wet' : wet > 0.15 ? 'damp' : 'dry') +
          ':' +
          (threat ? 'threat' : 'open') +
          ':' +
          (air ? 'air' : 'ground');
      const embedding = [],
        sequence = [];
      for (let bin = 0; bin < 3; bin++) {
        const part = a.slice(Math.floor((bin * a.length) / 3), Math.floor(((bin + 1) * a.length) / 3));
        const phases = {};
        for (const sample of part) phases[sample.phase] = (phases[sample.phase] || 0) + 1;
        const dominant = Object.keys(phases).sort((x, y) => phases[y] - phases[x])[0] || 'direct';
        if (sequence.at(-1) !== dominant) sequence.push(dominant);
        for (const k of ['speed', 'turn', 'boost', 'brake', 'goalSide', 'wide', 'db', 'y'])
          embedding.push(mean(part.map(s => s[k])) / (k === 'speed' ? 46 : k === 'y' ? 8 : 1));
      }
      const sample = a.find(s => s.features) || a[0],
        features = sample.features || Array(TBrain.NF).fill(0),
        reference = sample.reference || Array(TBrain.NF).fill(0);
      this.pending.push({
        agent: e.id,
        start: a[0].t,
        eventTime: e.time,
        until: e.time + 2,
        round: e.round,
        score: w.score.slice(),
        bx: w.ball.x,
        quality: e.quality || 0,
        miss: !!e.miss,
        air: !!e.air,
        save: !!e.save,
        pass: !!e.pass,
        wall: !!e.wall,
        lead,
        context,
        wet,
        embedding,
        features,
        reference,
        sequence,
        braking: mean(a.map(s => s.brake)),
        speed: mean(a.map(s => s.speed))
      });
      if (this.pending.length > 12) this.pending.shift();
    }
    register(w, t, utility, goalDelta) {
      const br = w.brains[t.agent],
        positive = utility > 0.12 && !t.miss;
      let p = null,
        best = Infinity;
      for (const q of this.patterns) {
        if (q.agent !== t.agent || q.context !== t.context || q.embedding.length !== 24) continue;
        const d = Math.sqrt(q.embedding.reduce((s, v, i) => s + (v - t.embedding[i]) ** 2, 0) / 24);
        if (d < best) {
          p = q;
          best = d;
        }
      }
      const isNew = !p || best > 0.19;
      if (isNew) {
        const contrast = t.features.map((v, i) => v - (t.reference[i] || 0)),
          condition = t.wet > 0.45 ? 'wet turf' : t.wet > 0.15 ? 'damp turf' : 'dry turf';
        p = {
          id: ++this.serial,
          agent: t.agent,
          title:
            ((t.sequence || []).length > 1
              ? t.sequence.map(x => MOTION[x] || 'Approach').join(' / ')
              : WORDS[t.lead] || 'Approach') +
            ' / ' +
            condition,
          lead: t.lead,
          result: 'opportunity',
          context: t.context,
          embedding: t.embedding.slice(),
          features: contrast,
          featurePair: [t.features.slice(), t.reference.slice()],
          sequence: (t.sequence || [t.lead]).slice(),
          first: t.eventTime,
          last: t.eventTime,
          count: 0,
          positive: 0,
          misses: 0,
          rounds: [],
          outcomes: [],
          stage: 0,
          firstPreference: br.correction
            ? br.correction({ features: t.features }) - br.correction({ features: t.reference })
            : contrast.reduce((s, v, i) => s + v * br.w[i], 0),
          shift: 0,
          firstUpdate: br.updates,
          updated: br.updates,
          utilitySum: 0,
          braking: 0,
          approachSpeed: 0,
          clip: [],
          human: false
        };
        this.patterns.push(p);
        if (this.patterns.length > 40) {
          const victim = this.patterns
            .filter(q => q.id !== p.id)
            .sort((a, b) => a.stage - b.stage || a.last - b.last)[0];
          this.patterns.splice(this.patterns.indexOf(victim), 1);
        }
      }
      this.totalWindows++;
      p.count++;
      p.positive += positive ? 1 : 0;
      p.misses += t.miss ? 1 : 0;
      p.last = t.eventTime;
      p.updated = br.updates;
      p.utilitySum += utility;
      p.braking += (t.braking - p.braking) / p.count;
      p.approachSpeed += (t.speed - p.approachSpeed) / p.count;
      if (!p.rounds.includes(t.round)) p.rounds.push(t.round);
      p.outcomes.push({ time: t.eventTime, positive, quality: utility, round: t.round, miss: t.miss });
      if (p.outcomes.length > 30) p.outcomes.shift();
      p.embedding = p.embedding.map((v, i) => v + (t.embedding[i] - v) / p.count);
      p.shift =
        (p.featurePair && br.correction
          ? br.correction({ features: p.featurePair[0] }) - br.correction({ features: p.featurePair[1] })
          : p.features.reduce((s, v, i) => s + v * br.w[i], 0)) - p.firstPreference;
      p.result =
        goalDelta > 0
          ? 'a goal'
          : goalDelta < 0
            ? 'a conceded goal'
            : t.miss
              ? 'a missed opportunity'
              : t.save
                ? 'a clearance'
                : t.pass
                  ? 'a received pass'
                  : t.wall
                    ? 'a wall contact'
                    : t.air
                      ? 'an aerial contact'
                      : positive
                        ? 'forward progress'
                        : 'no measured advantage';
      this.opportunities.push({ id: p.id, agent: t.agent, context: t.context, positive, utility, time: t.eventTime });
      if (this.opportunities.length > 600) this.opportunities.shift();
      p.clip = this.frames.filter(f => f.time >= t.start && f.time <= t.until).slice();
      const old = p.stage;
      this.evidence(p, w);
      if (isNew) this.notify('new', p, w);
      else if (p.stage > old) this.notify('developing', p, w);
    }
    evidence(p, w) {
      const peers = this.opportunities.filter(o => o.id !== p.id && o.agent === p.agent && o.context === p.context),
        n = peers.length,
        k = peers.filter(o => o.positive).length,
        ci = wilson(p.positive, p.count),
        base = wilson(k, n);
      p.comparison = { n, positive: k, interval: ci, baselineInterval: base, context: p.context };
      let stage = p.count >= 4 && p.rounds.length >= 2 ? 1 : 0;
      if (
        p.count >= 10 &&
        p.rounds.length >= 3 &&
        n >= 12 &&
        ci[0] > base[1] &&
        p.shift > 0.025 &&
        p.updated > p.firstUpdate + 20
      )
        stage = 2;
      p.stage = stage;
      p.caveat =
        stage === 2
          ? 'Matched-context association, not causal proof or generalisation.'
          : n < 12
            ? 'Too few comparable alternative attempts.'
            : 'Outcome intervals still overlap, or learning evidence is insufficient.';
      return p.comparison;
    }
    save() {
      return {
        schema: 2,
        playerCount: this.samples.length,
        serial: this.serial,
        totalWindows: this.totalWindows,
        opportunities: this.opportunities.slice(-600),
        patterns: this.patterns.map(({ clip, ...p }) => p)
      };
    }
    saveSession() {
      return {
        ...this.save(),
        frames: this.frames,
        samples: this.samples,
        pending: this.pending,
        watching: this.watching,
        lastWindow: this.lastWindow,
        sampleAt: this.sampleAt,
        clips: this.patterns.map(p => ({ id: p.id, frames: p.clip }))
      };
    }
    load(d) {
      if (!d || !Array.isArray(d.patterns) || d.patterns.length > 60) throw Error('Invalid observation journal.');
      const n = d.playerCount === 4 ? 4 : 2;
      this.samples = Array.from({ length: n }, () => []);
      this.watching = Array(n).fill(null);
      this.lastWindow = Array(n).fill(-100);
      this.serial = d.serial || 0;
      this.totalWindows = d.totalWindows || 0;
      this.opportunities = (d.opportunities || []).slice(-600);
      this.patterns = d.patterns
        .filter(p => Number.isInteger(p.agent) && p.agent >= 0 && p.agent < (d.playerCount || 2))
        .map(p => {
          p = JSON.parse(JSON.stringify(p));
          if (p.featurePair)
            for (let i = 0; i < 2; i++)
              if (Array.isArray(p.featurePair[i]) && [26, 52].includes(p.featurePair[i].length))
                p.featurePair[i] = p.featurePair[i].concat(Array(TBrain.NF - p.featurePair[i].length).fill(0));
          if (
            !Array.isArray(p.embedding) ||
            ![12, 24].includes(p.embedding.length) ||
            p.embedding.some(x => !Number.isFinite(x)) ||
            !Array.isArray(p.features) ||
            ![26, 52, TBrain.NF].includes(p.features.length) ||
            p.features.some(x => !Number.isFinite(x)) ||
            !Number.isSafeInteger(p.count) ||
            p.count < 1 ||
            !Array.isArray(p.rounds) ||
            p.rounds.some(x => !Number.isSafeInteger(x) || x < 0) ||
            !Number.isFinite(p.positive) ||
            p.positive < 0 ||
            p.positive > p.count
          )
            throw Error('Invalid observation geometry.');
          if (
            p.featurePair &&
            (!Array.isArray(p.featurePair) ||
              p.featurePair.length !== 2 ||
              p.featurePair.some(
                a => !Array.isArray(a) || a.length !== TBrain.NF || a.some(v => !Number.isFinite(v) || Math.abs(v) > 20)
              ))
          )
            throw Error('Invalid pattern comparison.');
          const legacy = p.embedding.length === 12,
            features = Array(TBrain.NF).fill(0);
          p.features.forEach((v, i) => (features[i] = v));
          return {
            ...p,
            features,
            title: String(p.title).slice(0, 120),
            stage: legacy ? 0 : clamp(p.stage || 0, 0, 2),
            legacy,
            context: p.context || 'legacy',
            misses: p.misses || 0,
            utilitySum: p.utilitySum || 0,
            braking: p.braking || 0,
            approachSpeed: p.approachSpeed || 0,
            caveat: legacy ? 'Legacy contact-only record; not comparable to new attempt evidence.' : p.caveat,
            clip: []
          };
        });
    }
    loadSession(d) {
      d = JSON.parse(JSON.stringify(d));
      this.load(d);
      this.frames = d.frames || [];
      this.samples = d.samples || [[], []];
      this.pending = d.pending || [];
      this.watching = d.watching || [null, null];
      this.lastWindow = d.lastWindow || [-100, -100];
      this.sampleAt = d.sampleAt || 0;
      for (const p of this.patterns) p.clip = (d.clips || []).find(c => c.id === p.id)?.frames || [];
    }
  }
  root.TObserver = Observer;
  root.TWilson = wilson;
  if (typeof module !== 'undefined') module.exports = Observer;
})(globalThis);
