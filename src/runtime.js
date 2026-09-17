/* Live simulation owner: 120 Hz fixed steps, bounded catch-up, 30 Hz presentation.
   Atmosphere, observations and learning use simulation time, never display frames. */
function createRuntime(send) {
  'use strict';
  let world = new TP.World(),
    paused = false,
    hidden = false,
    replaying = false,
    speed = 1,
    last = performance.now(),
    acc = 0,
    sendAt = 0,
    detailAt = 0,
    saveAt = last,
    inspecting = false,
    modes = {},
    events = [],
    notices = [],
    dropped = 0,
    tickCost = 0,
    pace = 1,
    paceAt = last,
    paceWorld = 0,
    timer = null,
    archives = [],
    archiveSerial = 0,
    evaluations = [],
    anchor = null,
    bench = null;
  const seeds = [2718, 7147, 16381, 39827],
    brains = (mode, policies) =>
      Array.from({ length: TP.count(mode) }, (_, i) => new TBrain.Brain(seeds[i], policies?.[i] || null));
  world.brains = brains(world.mode);
  world.observer = new TObserver();
  function summary(p) {
    const { clip, features, embedding, outcomes, ...o } = p;
    return { ...o, clipAvailable: !!clip?.length };
  }
  function attach() {
    world.observer.world = world;
    world.observer.listeners = [];
    world.observer.subscribe(e => {
      notices.push({ type: e.type, time: e.time, pattern: summary(e.pattern) });
      if (notices.length > 24) notices.shift();
    });
    world.listeners = [
      e => {
        events.push(e);
        if (events.length > 48) events.shift();
      }
    ];
  }
  function pack() {
    return { policies: world.brains.map(b => b.save()), journal: world.observer.save(), stats: { ...world.stats } };
  }
  function archive(label = 'Automatic snapshot') {
    if (bench) throw Error('Return to live self-play before archiving both learners.');
    const a = {
      id: ++archiveSerial,
      label,
      mode: world.mode,
      time: world.time,
      updates: world.brains.map(b => b.updates),
      policies: world.brains.map(b => b.save())
    };
    archives.push(a);
    if (archives.length > 8) archives.splice(1, 1);
    return a;
  }
  attach();
  archive('Starting policies');
  function checkpoint() {
    return {
      format: 'touchline-world-v11',
      version: 11,
      edition: 'Doubles 11',
      plannerVersion: 11,
      createdAt: new Date().toISOString(),
      mode: world.mode,
      ...pack(),
      universe: TState.capture(world),
      modes,
      archives,
      archiveSerial,
      evaluations: evaluations.slice(-8),
      bench,
      anchor: anchor ? { label: anchor.label, time: anchor.time, data: anchor.data } : null,
      notice:
        'Exact live state and learning continuation; visual replays are compacted to 0.001 world units. Learning is over authored plans and driving controls.'
    };
  }
  function apply(data) {
    TState.safe(data);
    let next,
      cache = data?.modes || {},
      nextArchives = [],
      nextBench = null;
    if (['touchline-world-v7', 'touchline-world-v11'].includes(data?.format)) {
      next = TState.restore(data.universe);
      if (data.mode !== next.mode) throw Error('Mode does not match the saved world.');
      if (!Array.isArray(data.archives) || data.archives.length > 8) throw Error('Invalid historical policy archive.');
      for (const a of data.archives) {
        if (
          !['duel', 'coop', 'doubles'].includes(a.mode) ||
          !Array.isArray(a.policies) ||
          a.policies.length !== TP.count(a.mode)
        )
          throw Error('Invalid archived opponent.');
        a.policies.forEach((p, i) => new TBrain.Brain(i + 1, p));
      }
      nextArchives = data.archives;
      nextBench = data.bench || null;
      if (nextBench) {
        const saved = nextBench.policies || { 1: nextBench.policy };
        for (const k of Object.keys(saved)) {
          if (!next.cars[+k] || next.cars[+k].side !== -1) throw Error('Invalid archived team slot.');
          new TBrain.Brain(13, saved[k]);
        }
        if (next.mode === 'doubles' && (!saved[1] || !saved[3])) throw Error('Incomplete historical team.');
      }
      if (data.anchor?.data) TState.restore(data.anchor.data);
    } else {
      if (
        !data ||
        !['touchline-pixel-v4', 'touchline-studio-v3'].includes(data.format) ||
        !['duel', 'coop'].includes(data.mode) ||
        !Array.isArray(data.policies) ||
        data.policies.length !== 2
      )
        throw Error('Not a compatible Touchline save.');
      next = new TP.World({ mode: data.mode });
      next.brains = data.policies.map((d, i) => new TBrain.Brain(i + 21, d));
      next.observer = new TObserver();
      next.observer.load(data.journal);
      next.grip = TM.clamp(Number(data.world?.grip) || 1, 0.6, 1.15);
      next.gravity = TM.clamp(Number(data.world?.gravity) || 13, 8, 20);
      next.field.living = !!data.world?.lifeEnabled;
      send({
        type: 'warning',
        message:
          'Legacy weights imported. Weather features start at zero; legacy saves do not contain a resumable physical world.'
      });
    }
    for (const m of ['duel', 'coop', 'doubles'])
      if (cache[m]) {
        if (!Array.isArray(cache[m].policies) || cache[m].policies.length !== TP.count(m))
          throw Error('Invalid mode cache.');
        cache[m].policies.forEach((p, i) => new TBrain.Brain(i + 31, p));
        const o = new TObserver();
        o.load(cache[m].journal);
      }
    if (data?.universe && data.universe.plannerVersion !== 11)
      send({
        type: 'warning',
        message:
          'World restored with the team-aware 11 planner. Physical state and weights are retained; future decisions can differ from older editions.'
      });
    world = next;
    modes = cache;
    archives = nextArchives;
    archiveSerial = Math.max(data.archiveSerial || 0, ...archives.map(a => a.id || 0));
    bench = nextBench;
    evaluations = (data.evaluations || []).slice(-8);
    anchor = ['touchline-world-v7', 'touchline-world-v11'].includes(data.format) ? data.anchor || null : null;
    attach();
    if (!archives.length && !bench) archive('Imported policies');
    acc = 0;
    notices = [];
    events = [];
    world.human = -1;
    world.manual = {};
    replaying = false;
    paceAt = performance.now();
    paceWorld = world.time;
  }
  function telemetry() {
    return {
      learning: world.learning,
      mode: world.mode,
      playerCount: world.cars.length,
      teams: world.teamState,
      human: world.human,
      matchTime: world.matchTime,
      roundTime: world.roundTime,
      kickoff: world.kickoffTime,
      goalPause: world.goalPause,
      paused,
      hidden,
      replaying,
      speed,
      stats: { ...world.stats },
      updates: world.brains.map(b => b.updates),
      norms: world.brains.map(b => b.norm()),
      agents: world.brains.map((b, i) => ({
        id: i,
        team: world.cars[i].side > 0 ? 0 : 1,
        intent: b.lastIntent,
        reason: b.lastReason,
        exploring: b.exploring,
        updates: b.updates,
        motion: b.weightMotion,
        preference: b.policyProbe,
        norm: b.norm(),
        controls: world.cars[i].applied || {},
        boost: world.cars[i].boost,
        speed: world.cars[i].speed,
        heat: world.cars[i].heat,
        grip: world.cars[i].grip,
        plan: b.planEvidence || null,
        frozen: !!world.frozen[i]
      })),
      patternCount: world.observer.patterns.length,
      pace,
      tickMs: tickCost,
      dropped,
      life: world.field.living,
      lifeMode: world.field.lifeMode,
      generation: world.field.generation,
      grip: world.grip,
      gravity: world.gravity,
      bounce: world.bounce,
      weather: world.weather.snapshot(),
      surface: world.visualCache || world.field.visual(),
      bench: bench ? { id: bench.id, label: bench.label } : null,
      anchor: anchor ? { time: anchor.time, label: anchor.label } : null
    };
  }
  function detail() {
    send({
      type: 'detail',
      patterns: world.observer.patterns.map(summary),
      agents: world.brains.map(b => ({
        weights: Array.from(b.w),
        history: b.history.slice(-50),
        alternatives: b.alternatives,
        lastTD: b.lastTD,
        lastReward: b.lastReward
      })),
      field: {
        wet: Array.from(world.field.wet),
        heat: Array.from(world.field.heat),
        life: world.field.living ? Array.from(world.field.life) : null,
        revision: world.field.revision
      },
      archives: archives.map(({ policies, ...a }) => a),
      evaluations: evaluations.slice(-4)
    });
  }
  function state() {
    send({
      type: 'state',
      state: world.snapshot(),
      telemetry: telemetry(),
      events: events.splice(0),
      notices: notices.splice(0)
    });
  }
  function tick() {
    const now = performance.now(),
      begin = now,
      real = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!paused && !hidden && !replaying) {
      acc += real * speed;
      let n = 0;
      while (acc >= TP.DT && n < 24) {
        world.step(TP.DT);
        acc -= TP.DT;
        n++;
        if (n % 4 === 0 && performance.now() - begin > 10) break;
      }
      if (acc > 0.15) {
        dropped += acc - 0.15;
        acc = 0.15;
      }
    } else acc = 0;
    tickCost = tickCost * 0.95 + (performance.now() - begin) * 0.05;
    if (now - paceAt > 1200) {
      pace = (world.time - paceWorld) / ((now - paceAt) / 1000);
      paceAt = now;
      paceWorld = world.time;
    }
    if (!hidden && now - sendAt >= 32) {
      sendAt = now;
      state();
    }
    if (!hidden && now - detailAt >= (inspecting ? 900 : 2200)) {
      detailAt = now;
      detail();
    }
    const lastArchive = archives.filter(a => a.mode === world.mode).at(-1);
    if (!bench && world.time - (lastArchive?.time || 0) >= 240) {
      archive();
      detail();
    }
    if (!hidden && now - saveAt > 30000) {
      saveAt = now;
      send({ type: 'save', json: JSON.stringify(checkpoint()) });
    }
    timer = setTimeout(tick, hidden ? 200 : 8);
  }
  function ack(id, result) {
    if (id) send({ type: 'response', id, result });
  }
  function receive(m) {
    try {
      let result = true;
      switch (m.type) {
        case 'init':
          if (m.data) {
            try {
              apply(m.data);
            } catch (e) {
              send({ type: 'warning', message: 'Saved progress could not load: ' + e.message });
            }
          }
          state();
          detail();
          send({ type: 'ready' });
          break;
        case 'pause':
          paused = !!m.value;
          acc = 0;
          break;
        case 'hidden':
          hidden = !!m.value;
          last = performance.now();
          acc = 0;
          world.manual = {};
          break;
        case 'speed':
          if (![0.5, 1, 2, 4].includes(m.value)) throw Error('Invalid playback speed.');
          speed = m.value;
          acc = 0;
          break;
        case 'inspect':
          inspecting = !!m.value;
          if (inspecting) detail();
          break;
        case 'learning':
          world.learning = !!m.value;
          world.brains.forEach(b => b.clear());
          break;
        case 'human':
          world.human = m.value ? 0 : -1;
          world.manual = {};
          world.brains[0].clear();
          world.cars[0].planAge = 10;
          break;
        case 'keys':
          world.manual = m.value || {};
          break;
        case 'weather': {
          const next = new TWeather(1);
          next.load(world.weather.save());
          next.configure(m.value || {});
          world.weather = next;
          world.emit('intervention', -1, { kind: 'weather', change: m.value });
          detail();
          break;
        }
        case 'intervene':
          if (!['wet', 'heat', 'sphere', 'impulse'].includes(m.kind) || !Number.isFinite(m.x + m.z))
            throw Error('Invalid intervention.');
          world.intervene(m.kind, m.x, m.z);
          detail();
          break;
        case 'life':
          world.field.living = !!m.value;
          world.field.revision++;
          detail();
          break;
        case 'lifeMode':
          if (!['conway', 'ecology'].includes(m.value)) throw Error('Invalid cellular model.');
          world.field.lifeMode = m.value;
          world.field.lifeTimer = 0;
          world.field.revision++;
          detail();
          break;
        case 'world':
          if (m.grip !== undefined) world.grip = TM.clamp(Number(m.grip) || 1, 0.6, 1.15);
          if (m.gravity !== undefined) world.gravity = TM.clamp(Number(m.gravity) || 13, 8, 20);
          if (m.bounce !== undefined) world.bounce = TM.clamp(Number(m.bounce) || 0.64, 0.35, 0.9);
          break;
        case 'clearWorld':
          world.props = [];
          world.field.wet.fill(0);
          world.field.heat.fill(0);
          world.field.living = false;
          world.field.lifeTimer = 0;
          world.field.revision++;
          world.grip = 1;
          world.gravity = 13;
          world.bounce = 0.64;
          world.emit('intervention', -1, { kind: 'clear-surface' });
          detail();
          break;
        case 'mode': {
          if (!['duel', 'coop', 'doubles'].includes(m.value)) throw Error('Invalid mode.');
          if (world.mode === m.value) break;
          if (bench) throw Error('Return to live self-play before switching modes.');
          modes[world.mode] = pack();
          const p = modes[m.value];
          world.mode = m.value;
          world.brains = brains(world.mode, p?.policies);
          world.stats = p?.stats ? { ...p.stats } : Object.fromEntries(Object.keys(world.stats).map(k => [k, 0]));
          world.frozen = Array(TP.count(world.mode)).fill(false);
          world.observer = new TObserver(TP.count(world.mode));
          if (p) world.observer.load(p.journal);
          attach();
          world.round = Math.max(1, ...world.observer.patterns.flatMap(p => p.rounds)) + 1;
          world.score = [0, 0];
          world.matchTime = 0;
          world.human = -1;
          world.manual = {};
          world.resetPositions(false);
          events = [];
          notices = [];
          replaying = false;
          acc = 0;
          if (!archives.some(a => a.mode === world.mode)) archive('Mode starting policies');
          detail();
          break;
        }
        case 'archive':
          result = archive('Saved by you');
          detail();
          break;
        case 'spar': {
          const ids = world.mode === 'doubles' ? [1, 3] : [1];
          if (m.value === 'live') {
            if (bench) {
              const saved = bench.policies || { 1: bench.policy };
              for (const id of ids) {
                world.brains[id] = new TBrain.Brain(seeds[id], saved[id]);
                world.frozen[id] = false;
              }
              bench = null;
            }
          } else {
            const a = archives.find(a => a.id === Number(m.value) && a.mode === world.mode);
            if (!a) throw Error('Choose a historical opponent from this mode.');
            if (!bench) bench = { policies: Object.fromEntries(ids.map(id => [id, world.brains[id].save()])) };
            bench.id = a.id;
            bench.label = a.label;
            for (const id of ids) {
              world.brains[id] = new TBrain.Brain(seeds[id], a.policies[id]);
              world.frozen[id] = true;
            }
          }
          world.brains.forEach(b => b.clear());
          world.cars.forEach(c => {
            c.plan = null;
            c.planAge = 10;
          });
          world.emit('intervention', -1, { kind: 'opponent', archived: !!bench });
          detail();
          break;
        }
        case 'evaluationData': {
          if (!['duel', 'doubles'].includes(world.mode))
            throw Error('Use 1v1 or 2v2 for historical performance comparisons.');
          if (bench) throw Error('Return to live self-play before comparing both learners.');
          const a = archives.find(a => a.id === Number(m.archiveId) && a.mode === world.mode);
          if (!a) throw Error('No compatible baseline.');
          result = {
            mode: world.mode,
            current: world.brains.map(b => b.save()),
            baseline: a.policies,
            archiveId: a.id
          };
          break;
        }
        case 'evaluationResult':
          if (!m.result || m.result.kind !== 'paired-evaluation') throw Error('Invalid evaluation result.');
          evaluations.push(m.result);
          evaluations = evaluations.slice(-8);
          detail();
          break;
        case 'mark':
          anchor = { label: 'Saved moment', time: world.time, data: TState.capture(world, { journal: false }) };
          result = { time: anchor.time };
          detail();
          break;
        case 'branchData':
          if (!anchor) throw Error('Save a moment first.');
          result = { anchor: anchor.data, variant: m.variant };
          break;
        case 'externalReplay':
          replaying = true;
          acc = 0;
          break;
        case 'replay': {
          const p = world.observer.patterns.find(p => p.id === m.idValue);
          if (!p?.clip?.length) throw Error('No recorded sequence is available for this observation.');
          replaying = true;
          acc = 0;
          result = { frames: p.clip, pattern: summary(p) };
          break;
        }
        case 'live':
          replaying = false;
          acc = 0;
          break;
        case 'export':
          result = checkpoint();
          break;
        case 'import':
          apply(m.data);
          detail();
          send({ type: 'save', json: JSON.stringify(checkpoint()) });
          break;
        case 'reset':
          if (bench) throw Error('Return to live self-play before resetting learners.');
          world.brains = brains(world.mode);
          world.observer = new TObserver(TP.count(world.mode));
          attach();
          world.learning = true;
          world.cars.forEach(c => {
            c.plan = null;
            c.planAge = 10;
            c.reward = 0;
          });
          detail();
          send({ type: 'save', json: JSON.stringify(checkpoint()) });
          break;
        case 'diagnostic':
          result = { telemetry: telemetry(), checkpoint: checkpoint(), state: world.snapshot() };
          break;
        case 'testAdvance': {
          if (!m.testing) throw Error('Test flag missing.');
          const steps = Math.min(72000, Math.max(0, m.steps | 0));
          for (let i = 0; i < steps; i++) world.step();
          result = { telemetry: telemetry(), state: world.snapshot() };
          detail();
          break;
        }
        default:
          throw Error('Unknown simulation message.');
      }
      state();
      ack(m.id, result);
    } catch (e) {
      send({ type: 'error', id: m.id, message: e.message });
    }
  }
  timer = setTimeout(tick, 8);
  return {
    receive,
    stop() {
      clearTimeout(timer);
    },
    get world() {
      return world;
    }
  };
}
