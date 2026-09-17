'use strict';
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict');
for (const n of ['math', 'weather', 'field', 'physics', 'agents', 'observer'])
  require(path.join(__dirname, '../src/' + n + '.js'));
const { V, Q } = TM;
const results = [];
function test(name, f) {
  try {
    f();
    results.push({ name, pass: true });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.error('FAIL', name, e.stack);
  }
}
const world = (seed = 2718, mode = 'duel') => {
  const w = new TP.World({ seed, mode });
  w.brains = [new TBrain.Brain(seed), new TBrain.Brain(seed + 291)];
  w.observer = new TObserver();
  w.observer.world = w;
  return w;
};
const step = (w, t) => {
  for (let i = 0; i < Math.round(t / TP.DT); i++) w.step();
};
const drive = (w, c, t, ctl) => {
  c.controller = { steer: 0, throttle: 0, boost: false, jump: false, pitch: 0, yaw: 0, roll: 0, drift: false, ...ctl };
  for (let i = 0; i < Math.round(t / TP.DT); i++) {
    w.time += TP.DT;
    w.drive(c, TP.DT);
  }
};
test('Quaternion basis preserves the intended forward axis', () => {
  for (let i = 0; i < 20; i++) {
    const a = i * 0.31,
      f = [Math.cos(a), 0, Math.sin(a)],
      r = Q.v(Q.basis(f, [0, 1, 0]), [1, 0, 0]);
    assert(Math.hypot(...V.sub(r, f)) < 1e-10);
  }
});
test('Cars cannot pivot in place', () => {
  const w = world(),
    c = TP.car(0);
  const q = c.q.slice();
  drive(w, c, 1, { steer: 1 });
  assert.deepEqual(c.q, q);
});
test('Full steering is not suppressed by orientation smoothing', () => {
  const w = world(),
    c = TP.car(0);
  c.x = 0;
  c.z = 0;
  c.vx = 10;
  drive(w, c, 0.5, { throttle: 0.35, steer: 1 });
  assert(c.heading > 0.65);
  assert(c.z > 1);
});
test('Turning curvature decreases with speed', () => {
  assert(TP.curvature(5) > TP.curvature(15));
  assert(TP.curvature(15) > TP.curvature(30));
});
test('Throttle accelerates smoothly and remains bounded', () => {
  const w = world(),
    c = TP.car(0);
  c.x = -30;
  drive(w, c, 0.5, { throttle: 1 });
  assert(c.vx > 10 && c.vx < 17);
  assert(c.speed < 46.01);
});
test('Brakes reduce forward speed before reversing', () => {
  const w = world(),
    c = TP.car(0);
  c.x = 0;
  c.vx = 20;
  drive(w, c, 0.2, { throttle: -1 });
  assert(c.vx > 0 && c.vx < 10);
});
test('Boost consumes a finite resource and increases speed', () => {
  const w = world(),
    c = TP.car(0);
  c.x = -35;
  c.vx = 12;
  c.boost = 80;
  drive(w, c, 0.4, { throttle: 1, boost: true });
  assert(c.boost < 67);
  assert(c.speed > 22);
});
test('The absolute car speed cap is enforced', () => {
  const w = world(),
    c = TP.car(0);
  c.x = 0;
  c.vx = 90;
  drive(w, c, TP.DT, { throttle: 1, boost: true });
  assert(c.speed <= 46.001);
});
test('Jump is an impulse, not a teleport', () => {
  const w = world(),
    c = TP.car(0);
  const y = c.y;
  drive(w, c, TP.DT, { jump: true });
  assert(c.y > y && c.y < y + 0.2);
  assert(c.vy > 5);
  assert(!c.ground);
});
test('Holding jump produces more height than tapping', () => {
  let heights = [];
  for (const hold of [false, true]) {
    const w = world(),
      c = TP.car(0);
    drive(w, c, TP.DT, { jump: true });
    drive(w, c, 0.18, { jump: hold });
    heights.push(c.y);
  }
  assert(heights[1] > heights[0] + 0.3);
});
test('Double-jump dodge changes physical momentum and rotation', () => {
  const w = world(),
    c = TP.car(0);
  drive(w, c, 0.08, { jump: true });
  drive(w, c, 0.18, { jump: false });
  const vx = c.vx;
  drive(w, c, TP.DT, { jump: true, pitch: -1 });
  assert.equal(c.jumps, 2);
  assert(c.vx > vx + 8);
  assert.equal(w.stats.dodges, 1);
});
test('Gravity returns a released jumping car toward the floor', () => {
  const w = world(),
    c = TP.car(0);
  drive(w, c, 0.18, { jump: true });
  drive(w, c, 2, { jump: false });
  assert(c.y < 1.0);
  assert(c.ground);
});
test('Wet turf lowers grip', () => {
  const w = world();
  w.field.paint(0, 0, 'wet', 1, 7);
  assert(w.field.sample(0, 0).grip < 0.6);
  assert(w.field.sample(20, 20).grip === 1);
});
test('Heat accelerates moisture loss', () => {
  const a = world().field,
    b = world().field;
  a.paint(0, 0, 'wet');
  b.paint(0, 0, 'wet');
  b.paint(0, 0, 'heat');
  for (let i = 0; i < 200; i++) {
    a.step(0.02);
    b.step(0.02);
  }
  assert(b.sample(0, 0).wet < a.sample(0, 0).wet);
});
test('Conway B3/S23 blinker oscillates correctly', () => {
  const f = world().field;
  f.life.fill(0);
  let k = 20 * 64 + 32;
  f.life[k - 1] = f.life[k] = f.life[k + 1] = 1;
  f.tickLife();
  assert.equal(f.life[k - 64], 1);
  assert.equal(f.life[k + 64], 1);
  assert.equal(f.life[k - 1], 0);
  f.tickLife();
  assert.equal(f.life[k - 1], 1);
  assert.equal(f.life[k + 1], 1);
});
test('Living cells feed the actual moisture field', () => {
  const f = world().field;
  f.life.fill(0);
  f.life[20 * 64 + 32] = 1;
  f.living = true;
  f.step(0.15);
  assert(f.wet[20 * 64 + 32] > 0);
});
test('Ball-floor restitution preserves finite, positive separation', () => {
  const w = world(),
    b = TP.sphere(0, 1.251, 0);
  b.vy = -10;
  w.ballIntegrate(b, TP.DT);
  assert(b.y >= TP.BR - 0.001);
  assert(b.vy > 0 && b.vy < 10);
});
test('Physical contact transfers car momentum into the ball', () => {
  const w = world(),
    c = TP.car(0),
    b = TP.sphere(2.6, 1.25, 0);
  c.x = 0;
  c.z = 0;
  c.vx = 20;
  w.ball = b;
  w.hit(c, b);
  assert(b.vx > 10);
  assert(c.vx < 20);
});
test('An oriented side hit transfers momentum in its actual direction', () => {
  const w = world(),
    c = TP.car(0),
    b = TP.sphere(0, 1.25, 2.6);
  c.x = c.z = 0;
  c.q = Q.axis([0, 1, 0], -Math.PI / 2);
  c.vz = 20;
  w.ball = b;
  w.hit(c, b);
  assert(b.vz > 10);
  assert(Math.abs(b.vx) < 0.01);
});
test('Predictive ball rollout is read-only', () => {
  const w = world();
  w.ball.vx = 12;
  const before = JSON.stringify(w.ball),
    events = w.events.length,
    field = w.field.revision;
  w.predictBall();
  assert.equal(JSON.stringify(w.ball), before);
  assert.equal(w.events.length, events);
  assert.equal(w.field.revision, field);
});
test('Crossing the real goal mouth scores once', () => {
  const w = world();
  w.kickoffTime = 0;
  w.brains = [];
  w.observer = null;
  w.ball = TP.sphere(45.4, 1.25, 0);
  w.step();
  assert.equal(w.score[0], 1);
  step(w, 0.5);
  assert.equal(w.score[0], 1);
});
test('Out-of-mouth contacts do not create a goal', () => {
  const w = world();
  w.kickoffTime = 0;
  w.brains = [];
  w.observer = null;
  w.ball = TP.sphere(43.9, 9, 14);
  w.ball.vx = 20;
  step(w, 0.5);
  assert.equal(w.stats.goals, 0);
});
test('Real-time experience updates both independent policies', () => {
  const w = world();
  step(w, 12);
  assert(w.brains.every(b => b.updates > 8 && b.weightMotion > 0));
  assert.notDeepEqual([...w.brains[0].w], [...w.brains[1].w]);
});
test('Freezing learning leaves model weights bit-for-bit unchanged', () => {
  const w = world();
  step(w, 6);
  w.learning = false;
  const q = w.brains.map(b => Array.from(b.w));
  step(w, 6);
  assert.deepEqual(
    w.brains.map(b => Array.from(b.w)),
    q
  );
});
test('Human control suspends only the controlled learner', () => {
  const w = world();
  step(w, 3);
  w.human = 0;
  const u = w.brains.map(b => b.updates);
  w.manual = { forward: true };
  step(w, 5);
  assert.equal(w.brains[0].updates, u[0]);
  assert(w.brains[1].updates > u[1]);
});
test('Policy save/load preserves every learned coefficient', () => {
  const w = world();
  step(w, 6);
  const b = new TBrain.Brain(1, JSON.parse(JSON.stringify(w.brains[0].save())));
  assert.deepEqual([...b.w], [...w.brains[0].w]);
  assert.equal(b.updates, w.brains[0].updates);
});
test('Malformed policy data is rejected', () => {
  const d = world().brains[0].save();
  d.w[2] = Infinity;
  assert.throws(() => new TBrain.Brain(1, d));
});
test('The observer never changes simulation or learning outcomes', () => {
  const a = world(721),
    b = world(721);
  b.observer = null;
  step(a, 16);
  step(b, 16);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(
    a.brains.map(b => b.save()),
    b.brains.map(b => b.save())
  );
});
test('Discoveries contain real recorded frames rather than animations', () => {
  const w = world(82);
  step(w, 25);
  assert(w.observer.patterns.length > 0);
  const p = w.observer.patterns.find(p => p.clip.length > 4);
  assert(p);
  assert(p.clip.every(f => f.cars.length === 2 && Number.isFinite(f.ball.x)));
  assert(p.clip[0].time <= p.first || p.count > 1);
});
test('One observation cannot be promoted to a learned strategy', () => {
  const w = world();
  step(w, 6);
  for (const p of w.observer.patterns) if (p.count === 1) assert.equal(p.stage, 0);
});
test('Duel mode never claims teammate passes', () => {
  const w = world();
  step(w, 30);
  assert.equal(w.stats.passes, 0);
  assert(!w.observer.patterns.some(p => p.result.includes('pass')));
});
test('Interventions use the actual momentum and moisture systems', () => {
  const w = world();
  w.intervene('sphere', 8, 0);
  assert.equal(w.props.length, 1);
  assert(w.props[0].mass > w.ball.mass);
  w.intervene('impulse', -5, 0);
  assert(w.ball.vx > 5);
  w.intervene('wet', 0, 0);
  assert(w.field.sample(0, 0).wet > 0.9);
});
test('Local field paint matches a full-grid reference', () => {
  const w = world();
  for (const [x, z, r] of [
    [0, 0, 2],
    [42, 27, 7],
    [-39, -26, 2],
    [7.17, -12.34, 4]
  ]) {
    w.field.wet.fill(0);
    w.field.paint(x, z, 'wet', 0.045, r);
    for (let j = 0; j < 40; j++)
      for (let i = 0; i < 64; i++) {
        const d = Math.hypot(-44 + ((i + 0.5) * 88) / 64 - x, -28 + ((j + 0.5) * 56) / 40 - z) / r;
        const expected = d > 1 ? 0 : (1 - d * d) * 0.045;
        assert(Math.abs(w.field.wet[j * 64 + i] - expected) < 1e-7);
      }
  }
});
// Real long-run audit. These counts are measurements, not an improvement claim.
const audit = [];
for (const seed of [82, 171, 234]) {
  const w = world(seed);
  let maxSpeed = 0,
    maxGap = 0,
    lastTouch = 0;
  for (let i = 0; i < 120 * 240; i++) {
    w.step();
    for (const c of w.cars) maxSpeed = Math.max(maxSpeed, c.speed);
    if (w.stats.touches && w.ball.lastTime >= 0) lastTouch = Math.max(lastTouch, w.ball.lastTime);
    maxGap = Math.max(maxGap, w.time - lastTouch);
  }
  const row = {
    seed,
    simulatedSeconds: w.time,
    score: w.score,
    stats: w.stats,
    updates: w.brains.map(b => b.updates),
    learnedL2: w.brains.map(b => b.norm()),
    patterns: w.observer.patterns.length,
    stages: [0, 1, 2].map(s => w.observer.patterns.filter(p => p.stage === s).length),
    maxCarSpeed: maxSpeed,
    maxSecondsWithoutTouch: maxGap
  };
  audit.push(row);
  console.log('AUDIT', JSON.stringify(row));
}
test('Twelve aggregate simulated minutes remain finite and bounded', () => {
  for (const a of audit) {
    assert.equal(a.stats.safetyResets, 0);
    assert(a.maxCarSpeed < 47);
    assert(a.stats.touches > 30);
    assert(a.updates.every(x => x > 250));
  }
});
fs.mkdirSync(path.join(__dirname, '../reports'), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, '../reports/engine-tests.json'),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      results,
      passed: results.filter(r => r.pass).length,
      failed: results.filter(r => !r.pass).length,
      audit
    },
    null,
    2
  )
);
if (results.some(r => !r.pass)) process.exitCode = 1;
