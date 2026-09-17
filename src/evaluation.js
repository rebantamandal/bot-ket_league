/* Frozen, deterministic paired trials. This runs in a second Worker. It never owns
   live policies. Small chunks leave room for the visible game and cancellation. */
(function (root) {
  'use strict';
  const delay = () => new Promise(r => setTimeout(r, 0));
  function make(policies, seed, condition) {
    const w = new TP.World({ seed, mode: policies.length === 4 ? 'doubles' : 'duel' });
    w.brains = policies.map((p, i) => new TBrain.Brain(i + 31, p));
    w.observer = null;
    w.learning = false;
    w.frozen = w.cars.map(() => true);
    w.weather.configure({ mode: condition === 'wet' ? 'rain' : 'clear', windScale: condition === 'wet' ? 1.1 : 0.6 });
    if (condition === 'wet') {
      w.field.wet.fill(0.65);
      w.weather.cloud = 0.94;
      w.weather.humidity = 0.9;
      w.weather.rain = 0.82;
      w.weather.windX = 4;
      w.weather.windZ = 2;
    }
    w.weather.updateDerived();
    return w;
  }
  async function play(w, seconds, { frames = false, progress = null } = {}) {
    const n = Math.round(seconds / TP.DT),
      clip = [];
    let quality = w.cars.map(() => 0),
      contacts = w.cars.map(() => 0);
    w.listeners.push(e => {
      if (e.type === 'touch') {
        quality[e.id] += e.quality;
        contacts[e.id]++;
      }
    });
    let i = 0;
    while (i < n) {
      const end = performance.now() + 5;
      do {
        w.step();
        if (frames && i % 24 === 0) clip.push(w.snapshot());
        i++;
      } while (i < n && performance.now() < end);
      if (progress) progress(i / n);
      await delay();
    }
    return {
      score: w.score.slice(),
      touches: contacts,
      quality,
      stats: { ...w.stats },
      frames: clip,
      seconds,
      weather: w.weather.snapshot()
    };
  }
  async function evaluate(data, report = () => {}) {
    if (data.mode === 'doubles') return evaluateTeams(data, report);
    const rows = [],
      total = 16,
      seconds = data.seconds || 35;
    let done = 0;
    for (let agent = 0; agent < 2; agent++)
      for (const condition of ['dry', 'wet'])
        for (let side = 0; side < 2; side++) {
          const seed = 771 + agent * 13 + (condition === 'wet' ? 47 : 0) + side * 3,
            op = 1 - agent;
          const cases = [];
          for (const current of [false, true]) {
            const target = current ? data.current[agent] : data.baseline[agent],
              opponent = data.baseline[op],
              policies = side === 0 ? [target, opponent] : [opponent, target];
            const w = make(policies, seed, condition),
              r = await play(w, seconds);
            cases.push({
              scoreFor: r.score[side],
              scoreAgainst: r.score[1 - side],
              touches: r.touches[side],
              forwardImpulse: r.quality[side]
            });
            done++;
            report({ done, total, message: 'Frozen comparison ' + done + ' / ' + total });
          }
          rows.push({
            agent,
            condition,
            side,
            seed,
            baseline: cases[0],
            current: cases[1],
            delta: cases[1].scoreFor - cases[1].scoreAgainst - (cases[0].scoreFor - cases[0].scoreAgainst)
          });
        }
    const agents = [0, 1].map(agent => {
      const r = rows.filter(x => x.agent === agent),
        d = r.reduce((s, x) => s + x.delta, 0),
        deltas = r.map(x => x.delta),
        avg = d / r.length,
        variance = deltas.reduce((s, x) => s + (x - avg) ** 2, 0) / (r.length - 1),
        se = Math.sqrt(variance / r.length);
      return {
        agent,
        trials: r.length,
        goalDifferenceChange: d,
        mean: avg,
        interval: [avg - 3.182 * se, avg + 3.182 * se],
        touchDifference: r.reduce((s, x) => s + x.current.touches - x.baseline.touches, 0),
        allTied: r.every(x => x.delta === 0)
      };
    });
    return {
      kind: 'paired-evaluation',
      date: new Date().toISOString(),
      archiveId: data.archiveId,
      secondsPerGame: seconds,
      gameCount: total,
      frozen: true,
      agents,
      rows,
      limitation:
        'Four paired starts per agent, two weather conditions, one archived opponent policy. Descriptive small-sample evidence, not proof of general improvement.'
    };
  }
  async function evaluateTeams(data, report = () => {}) {
    const rows = [],
      seconds = data.seconds || 35;
    let done = 0;
    for (let agent = 0; agent < 2; agent++)
      for (const condition of ['dry', 'wet'])
        for (let side = 0; side < 2; side++) {
          const seed = 1771 + agent * 13 + (condition === 'wet' ? 47 : 0) + side * 3,
            cases = [];
          for (const current of [false, true]) {
            const source = current ? data.current : data.baseline,
              policies = Array(4);
            for (let slot = 0; slot < 2; slot++) {
              policies[side + slot * 2] = source[agent + slot * 2];
              policies[1 - side + slot * 2] = data.baseline[1 - agent + slot * 2];
            }
            const r = await play(make(policies, seed, condition), seconds);
            cases.push({
              scoreFor: r.score[side],
              scoreAgainst: r.score[1 - side],
              touches: r.touches[side] + r.touches[side + 2],
              forwardImpulse: r.quality[side] + r.quality[side + 2]
            });
            report({ done: ++done, total: 16, message: 'Frozen team comparison ' + done + ' / 16' });
          }
          rows.push({
            agent,
            condition,
            side,
            seed,
            baseline: cases[0],
            current: cases[1],
            delta: cases[1].scoreFor - cases[1].scoreAgainst - (cases[0].scoreFor - cases[0].scoreAgainst)
          });
        }
    const agents = [0, 1].map(agent => {
      const r = rows.filter(x => x.agent === agent),
        d = r.reduce((s, x) => s + x.delta, 0),
        avg = d / 4,
        se = Math.sqrt(r.reduce((s, x) => s + (x.delta - avg) ** 2, 0) / 3 / 4);
      return {
        agent,
        trials: 4,
        goalDifferenceChange: d,
        mean: avg,
        interval: [avg - 3.182 * se, avg + 3.182 * se],
        touchDifference: r.reduce((s, x) => s + x.current.touches - x.baseline.touches, 0),
        allTied: r.every(x => x.delta === 0)
      };
    });
    return {
      kind: 'paired-evaluation',
      mode: 'doubles',
      date: new Date().toISOString(),
      archiveId: data.archiveId,
      secondsPerGame: seconds,
      gameCount: 16,
      frozen: true,
      agents,
      rows,
      limitation:
        'Four paired starts per team, dry/wet surfaces and swapped sides against one historical team. Descriptive small-sample evidence, not proof of improved teamwork.'
    };
  }
  async function branch(data, report = () => {}) {
    const out = [];
    for (const variant of ['recorded', data.variant || 'dry']) {
      const w = TState.restore(data.anchor);
      w.observer = null;
      w.learning = false;
      w.frozen = w.cars.map(() => true);
      w.human = -1;
      w.manual = {};
      if (variant === 'dry') {
        w.field.wet.fill(0);
        w.field.revision++;
      } else if (variant === 'wet') {
        w.field.wet.fill(0.65);
        w.field.revision++;
      } else if (variant === 'calm') {
        w.weather.windX = w.weather.windZ = 0;
        w.weather.configure({ windScale: 0 });
      }
      w.weather.updateDerived();
      const before = w.score.slice(),
        r = await play(w, 18, { frames: true });
      out.push({ variant, ...r, scoreDelta: r.score.map((n, i) => n - before[i]) });
      report({ done: out.length, total: 2, message: 'Moment comparison ' + out.length + ' / 2' });
    }
    return {
      kind: 'branch-comparison',
      anchorTime: data.anchor.dynamics.time,
      variant: data.variant,
      cases: out,
      limitation:
        'A paired simulation from one saved state with frozen policies. This is not a real-world causal claim.'
    };
  }
  root.TEvaluation = { make, play, evaluate, branch };
  if (typeof module !== 'undefined') module.exports = root.TEvaluation;
})(globalThis);
