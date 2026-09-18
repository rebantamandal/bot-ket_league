/* Exact physical/learner continuation, plus compact, quantised visual replay storage.
   Replay rounding never touches physics, RNG, field values or learned coefficients. */
(function (root) {
  'use strict';
  const KEYS = [
    'time',
    'matchTime',
    'round',
    'score',
    'mode',
    'learning',
    'human',
    'manual',
    'frozen',
    'gravity',
    'grip',
    'bounce',
    'goalPause',
    'kickoffTime',
    'roundTime',
    'periodTime',
    'stats',
    'props',
    'cars',
    'ball',
    'pads',
    'lastBump',
    'events',
    'teamState',
    'teamClock',
    'ends'
  ];
  const plain = x => JSON.parse(JSON.stringify(x, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
  function safe(data) {
    let nodes = 0;
    function visit(v, depth = 0) {
      if (++nodes > 2500000 || depth > 40) throw Error('Save is too complex.');
      if (typeof v === 'number' && !Number.isFinite(v)) throw Error('Save contains a non-finite number.');
      if (typeof v === 'string' && v.length > 2000000) throw Error('Save text is too long.');
      if (v && typeof v === 'object')
        for (const k of Object.keys(v)) {
          if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('Invalid saved object key.');
          visit(v[k], depth + 1);
        }
    }
    visit(data);
  }
  const r = v => Math.round((Number(v) || 0) * 1000) / 1000;
  function packJournal(o) {
    const d = o.saveSession(),
      frames = [],
      surfaces = [],
      seen = new Map(),
      seenSurface = new Map(),
      geometry = (d.frames[0]?.pads || []).map(p => [p.x, p.z, p.big ? 1 : 0]);
    function frame(f) {
      const key = f.time + ':' + f.round;
      if (seen.has(key)) return seen.get(key);
      let surface = -1;
      if (f.surface) {
        const key = JSON.stringify(f.surface);
        if (seenSurface.has(key)) surface = seenSurface.get(key);
        else {
          surface = surfaces.length;
          surfaces.push(f.surface);
          seenSurface.set(key, surface);
        }
      }
      const b = f.ball,
        car = c =>
          [
            c.id,
            c.x,
            c.y,
            c.z,
            ...c.q,
            c.vx,
            c.vy,
            c.vz,
            c.heading,
            c.ground ? 1 : 0,
            c.boost,
            c.boosting ? 1 : 0,
            c.steer,
            c.wheelSpin,
            c.speed,
            c.slip,
            c.landing,
            c.target?.x || 0,
            c.target?.z || 0,
            c.heat || 0,
            c.wet || 0,
            c.grip || 1,
            c.side || (c.id % 2 ? -1 : 1)
          ].map(r);
      const value = [
        f.time,
        f.round,
        f.score,
        [b.x, b.y, b.z, b.vx, b.vy, b.vz, ...b.q].map(r),
        f.cars.map(car),
        f.pads.map(p => r(p.charge ?? (p.timer ? 0 : 1))),
        f.props,
        f.weather,
        surface,
        f.mode
      ];
      const index = frames.length;
      frames.push(value);
      seen.set(key, index);
      return index;
    }
    const ring = d.frames.map(frame),
      clips = d.clips.map(c => ({ id: c.id, frames: c.frames.map(frame) }));
    return { ...d, frames: ring, clips, codec: { version: 1, geometry, frames, surfaces } };
  }
  function unpackJournal(d) {
    if (!d.codec) return d;
    const { geometry, frames, surfaces } = d.codec;
    if (!Array.isArray(frames) || frames.length > 6000 || !Array.isArray(surfaces) || surfaces.length > 6000)
      throw Error('Replay archive is too large.');
    const decoded = frames.map(f => {
      const b = f[3],
        cars = f[4].map(c => ({
          id: c[0],
          x: c[1],
          y: c[2],
          z: c[3],
          q: c.slice(4, 8),
          vx: c[8],
          vy: c[9],
          vz: c[10],
          heading: c[11],
          ground: !!c[12],
          boost: c[13],
          boosting: !!c[14],
          steer: c[15],
          wheelSpin: c[16],
          speed: c[17],
          slip: c[18],
          landing: c[19],
          target: { x: c[20], z: c[21] },
          heat: c[22],
          wet: c[23],
          grip: c[24],
          side: c[25] || (c[0] % 2 ? -1 : 1)
        }));
      return {
        mode: f[9] || (cars.length === 4 ? 'doubles' : 'duel'),
        time: f[0],
        round: f[1],
        score: f[2],
        ball: { x: b[0], y: b[1], z: b[2], vx: b[3], vy: b[4], vz: b[5], q: b.slice(6, 10) },
        cars,
        pads: geometry.map((p, i) => ({
          x: p[0],
          z: p[1],
          big: !!p[2],
          charge: f[5][i],
          timer: (1 - f[5][i]) * (p[2] ? 10 : 4)
        })),
        props: f[6],
        weather: f[7],
        surface: surfaces[f[8]]
      };
    });
    const resolve = i => {
      if (!Number.isInteger(i) || !decoded[i]) throw Error('Invalid replay index.');
      return decoded[i];
    };
    return {
      ...d,
      frames: d.frames.map(resolve),
      clips: d.clips.map(c => ({ id: c.id, frames: c.frames.map(resolve) }))
    };
  }
  function capture(w, { journal = true } = {}) {
    const dynamics = {};
    for (const k of KEYS) dynamics[k] = w[k];
    return plain({
      schema: 1,
      plannerVersion: 11,
      dynamics,
      rng: w.rng.s,
      weather: w.weather.save(),
      field: w.field.save(),
      brains: w.brains.map(b => b.saveSession()),
      observer: journal && w.observer ? packJournal(w.observer) : null
    });
  }
  function restore(d) {
    safe(d);
    d = plain(d);
    // Zero-pad older residual features. Existing coefficients retain their meaning.
    const pad = a =>
      Array.isArray(a) && [26, 52].includes(a.length) ? a.concat(Array(TBrain.NF - a.length).fill(0)) : a;
    if (d?.dynamics?.cars) for (const c of d.dynamics.cars) if (c.plan) c.plan.features = pad(c.plan.features);
    if (d?.observer) {
      for (const a of d.observer.samples || [])
        for (const v of a) {
          v.features = pad(v.features);
          v.reference = pad(v.reference);
        }
      for (const v of d.observer.pending || []) {
        v.features = pad(v.features);
        v.reference = pad(v.reference);
      }
    }
    const n = TP.count(d?.dynamics?.mode);
    if (d?.schema !== 1 || !d.dynamics || !Array.isArray(d.brains) || d.brains.length !== n)
      throw Error('Unsupported full-world save.');
    const p = d.dynamics;
    if (
      !['duel', 'coop', 'doubles'].includes(p.mode) ||
      !Array.isArray(p.cars) ||
      p.cars.length !== n ||
      !Array.isArray(p.pads) ||
      p.pads.length !== 16 ||
      !Array.isArray(p.props) ||
      p.props.length > 4 ||
      !Array.isArray(p.score) ||
      p.score.length !== 2
    )
      throw Error('Invalid world layout.');
    if (
      !Number.isFinite(p.time) ||
      p.time < 0 ||
      p.gravity < 8 ||
      p.gravity > 20 ||
      p.grip < 0.6 ||
      p.grip > 1.15 ||
      !Number.isSafeInteger(p.round) ||
      p.round < 1
    )
      throw Error('Invalid world settings.');
    for (const c of [...p.cars, p.ball, ...p.props]) {
      if (
        !c ||
        ['x', 'y', 'z', 'vx', 'vy', 'vz'].some(k => !Number.isFinite(c[k]) || Math.abs(c[k]) > 1000) ||
        !Array.isArray(c.q) ||
        c.q.length !== 4 ||
        c.q.some(v => !Number.isFinite(v)) ||
        Math.hypot(...c.q) < 0.5
      )
        throw Error('Invalid saved physical body.');
    }
    for (const pad of p.pads)
      if (!Number.isFinite(pad.charge) || pad.charge < 0 || pad.charge > 1) throw Error('Invalid boost resource.');
    const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
    if (
      (p.ends !== undefined && p.ends !== 1 && p.ends !== -1) ||
      !finite(p.bounce, 0.35, 0.9) ||
      !finite(p.roundTime, 0, 121) ||
      (p.periodTime !== undefined && !finite(p.periodTime, 0, 121)) ||
      !finite(p.matchTime, 0, 1e12) ||
      !finite(p.goalPause, -0.1, 3) ||
      !finite(p.kickoffTime, -0.1, 2) ||
      p.score.some(v => !Number.isSafeInteger(v) || v < 0) ||
      !Array.isArray(p.frozen) ||
      p.frozen.length !== n ||
      p.frozen.some(v => typeof v !== 'boolean')
    )
      throw Error('Invalid persistent match state.');
    for (let i = 0; i < n; i++) {
      const c = p.cars[i];
      if (
        c.id !== i ||
        c.side !== TP.sideFor(i, p.mode) ||
        !finite(c.boost, 0, 100) ||
        !finite(c.heat, 0, 1) ||
        !Array.isArray(c.omega) ||
        c.omega.length !== 3 ||
        c.omega.some(v => !finite(v, -100, 100)) ||
        typeof c.ground !== 'boolean'
      )
        throw Error('Invalid car parameters.');
      if (!c.controller || typeof c.controller !== 'object') throw Error('Invalid driving controls.');
      for (const k of ['steer', 'throttle', 'pitch', 'yaw', 'roll'])
        if (c.controller[k] !== undefined && !finite(c.controller[k], -1.000001, 1.000001))
          throw Error('Out-of-range driving control.');
      if (
        c.plan &&
        (!['contact', 'space', 'resource', 'support'].includes(c.plan.kind) ||
          !finite(c.plan.x, -100, 100) ||
          !finite(c.plan.z, -100, 100) ||
          !Array.isArray(c.plan.features) ||
          c.plan.features.length !== TBrain.NF ||
          c.plan.features.some(v => !finite(v, -20, 20)) ||
          !finite(c.plan.prior, -100, 100))
      )
        throw Error('Invalid planned action.');
    }
    for (const body of [p.ball, ...p.props])
      if (
        !finite(body.r, 0.1, 4) ||
        !finite(body.mass, 1, 1000) ||
        !Array.isArray(body.w) ||
        body.w.length !== 3 ||
        body.w.some(v => !finite(v, -1000, 1000))
      )
        throw Error('Invalid sphere parameters.');
    for (const pad of p.pads)
      if (!finite(pad.x, -TP.X, TP.X) || !finite(pad.z, -TP.Z, TP.Z) || typeof pad.big !== 'boolean')
        throw Error('Invalid resource geometry.');
    // Validate module data before constructing the replacement world. Imported JSON
    // cannot shadow prototype methods such as Weather.step or Brain.value.
    const weatherKeys = new Set(Object.keys(new TWeather().save()));
    if (!d.weather || Object.keys(d.weather).some(k => !weatherKeys.has(k))) throw Error('Unsupported weather state.');
    for (const k of ['cloud', 'humidity', 'cloudTarget', 'humidityTarget'])
      if (!finite(d.weather[k], 0, 1)) throw Error('Invalid atmospheric fraction.');
    if (
      !finite(d.weather.elapsed, 0, 1e12) ||
      !Number.isSafeInteger(d.weather.day) ||
      d.weather.day < 1 ||
      !finite(d.weather.frontIn, -1, 200) ||
      !finite(d.weather.targetX, -20, 20) ||
      !finite(d.weather.targetZ, -20, 20)
    )
      throw Error('Invalid atmospheric clock.');
    if (d.observer) {
      const o = d.observer;
      if (
        !Array.isArray(o.samples) ||
        o.samples.length !== n ||
        o.samples.some(a => !Array.isArray(a) || a.length > 60) ||
        !Array.isArray(o.pending) ||
        o.pending.length > 12 ||
        !Array.isArray(o.watching) ||
        o.watching.length !== n ||
        !Array.isArray(o.lastWindow) ||
        o.lastWindow.length !== n
      )
        throw Error('Invalid observation state.');
      for (const a of o.samples)
        for (const v of a)
          if (
            !v ||
            !finite(v.t, 0, 1e12) ||
            !finite(v.speed, 0, 100) ||
            typeof v.phase !== 'string' ||
            (v.features && (!Array.isArray(v.features) || v.features.length !== TBrain.NF))
          )
            throw Error('Invalid observation sample.');
      for (const t of o.pending)
        if (
          !t ||
          !(Number.isInteger(t.agent) && t.agent >= 0 && t.agent < n) ||
          !finite(t.until, 0, 1e12) ||
          !Array.isArray(t.embedding) ||
          t.embedding.length !== 24 ||
          !Array.isArray(t.features) ||
          t.features.length !== TBrain.NF ||
          !Array.isArray(t.reference) ||
          t.reference.length !== TBrain.NF
        )
          throw Error('Invalid pending observation.');
    }
    if (p.teamState) {
      for (const k of Object.keys(p.teamState)) {
        const t = p.teamState[k];
        if (
          !['1', '-1'].includes(k) ||
          !t ||
          !Number.isInteger(t.challenger) ||
          !p.cars[t.challenger] ||
          p.cars[t.challenger].side !== +k ||
          !finite(t.assignedAt, 0, p.time) ||
          !finite(t.urgency, 0, 1)
        )
          throw Error('Invalid team assignment.');
      }
    }
    if (p.teamClock !== undefined && !finite(p.teamClock, 0, p.time + 0.2)) throw Error('Invalid team planning clock.');
    const w = new TP.World({ seed: 19, mode: p.mode });
    for (const k of KEYS) if (p[k] !== undefined) w[k] = plain(p[k]);
    if (p.ends === undefined) w.ends = 1;
    if (p.periodTime === undefined) w.periodTime = 0;
    w.stats = { assists: 0, teamBumps: 0, ...w.stats };
    w.rng = new TM.RNG(d.rng);
    w.weather.load(d.weather);
    w.field.load(d.field);
    w.brains = d.brains.map((b, i) => {
      const a = new TBrain.Brain(i + 13);
      a.loadSession(b);
      return a;
    });
    w.observer = new TObserver(n);
    if (d.observer) w.observer.loadSession(unpackJournal(d.observer));
    w.observer.world = w;
    w.listeners = [];
    w.visualCache = null;
    w.visualAt = -1;
    return w;
  }
  root.TState = { capture, restore, plain, safe, packJournal, unpackJournal };
  if (typeof module !== 'undefined') module.exports = root.TState;
})(globalThis);
