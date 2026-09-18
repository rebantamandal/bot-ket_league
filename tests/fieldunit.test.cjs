/* 09-specific correctness and adversarial-input tests. These test constraints,
   not whether every football decision wins. Benchmarks report all game outcomes. */
'use strict';
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  vm = require('vm'),
  crypto = require('crypto');
for (const n of ['math', 'weather', 'field', 'physics', 'agents', 'observer', 'state', 'evaluation'])
  require('../src/' + n + '.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8'));
const rows = [];
function test(name, fn) {
  try {
    fn();
    rows.push({ name, pass: true });
    console.log('PASS', name);
  } catch (e) {
    rows.push({ name, pass: false, error: e.stack });
    console.error('FAIL', name, e.message);
  }
}
function W(seed = 97) {
  const w = new TP.World({ seed });
  w.brains = [new TBrain.Brain(2718), new TBrain.Brain(7147)];
  w.observer = new TObserver();
  w.observer.world = w;
  return w;
}
const cp = TState.plain,
  advance = (w, t) => {
    for (let i = 0; i < t * 120; i++) w.step();
  };
function place(c, x, z, heading = 0) {
  c.x = x;
  c.z = z;
  c.heading = heading;
  c.q = TM.Q.axis([0, 1, 0], -heading);
  c.vx = c.vy = c.vz = 0;
  c.plan = null;
}
const w = W();
advance(w, 18);
const snapshot = TState.capture(w);
test('11 controller extends the existing schema with twelve team features', () => {
  assert.equal(TBrain.NF, 64);
  assert.equal(w.brains[0].save().controllerVersion, 11);
});
test('Arrival estimate penalises turning away from the interception', () => {
  const q = W(),
    c = q.cars[0],
    b = q.brains[0];
  place(c, 0, 0, 0);
  const forward = b.travel(c, 20, 0);
  c.heading = Math.PI;
  assert(b.travel(c, 20, 0) > forward + 0.4);
});
test('Arrival estimate increases for a farther point on the same route', () => {
  const q = W(),
    c = q.cars[0],
    b = q.brains[0];
  place(c, 0, 0);
  assert(b.travel(c, 30, 0) > b.travel(c, 10, 0));
});
test('Wet grip changes travel and braking estimates', () => {
  const q = W(),
    c = q.cars[0],
    b = q.brains[0];
  place(c, 0, 0);
  c.grip = 1;
  const dry = b.travel(c, 20, 0);
  c.grip = 0.58;
  assert(b.travel(c, 20, 0) > dry);
  q.field.wet.fill(0.9);
  assert(b.candidates(q, c).some(p => p.environment.wet > 0.8));
});
test('A defender in the shot lane is detected geometrically', () => {
  const q = W(),
    c = q.cars[0],
    b = q.brains[0];
  place(q.cars[1], 22, 0);
  assert(b.lane(q, c, { x: 0, z: 0 }, 44, 0).blocked > 0.9);
  place(q.cars[1], 22, 15);
  assert.equal(b.lane(q, c, { x: 0, z: 0 }, 44, 0).blocked, 0);
});
test('Heavy physical props also obstruct a shot lane', () => {
  const q = W();
  place(q.cars[1], 22, 20);
  q.props.push(TP.sphere(20, 2, 0, 2, 100));
  assert(q.brains[0].lane(q, q.cars[0], { x: 0, z: 0 }, 44, 0).blocked > 0.9);
});
test('Teammates are not treated as enemy defenders in cooperative play', () => {
  const q = W();
  q.mode = 'coop';
  place(q.cars[1], 22, 0);
  assert.equal(q.brains[0].lane(q, q.cars[0], { x: 0, z: 0 }, 44, 0).blocked, 0);
});
test('Predicted imminent goals raise urgency and suppress resource detours', () => {
  const q = W();
  q.ball = TP.sphere(-30, TP.BR, 0);
  q.ball.vx = -20;
  q.cars[0].boost = 0;
  const b = q.brains[0],
    ps = b.candidates(q, q.cars[0]);
  assert(b.situation.deadline < 1.5);
  assert(b.situation.urgency > 0.8);
  assert(!ps.some(p => p.kind === 'resource'));
  assert(ps.some(p => p.role === 'clear'));
});
test('Emergency defence does not add random exploration noise', () => {
  const q = W();
  q.ball = TP.sphere(-30, TP.BR, 0);
  q.ball.vx = -20;
  const b = q.brains[0],
    rng = b.rng.s;
  b.choose(q, q.cars[0]);
  assert.equal(b.rng.s, rng);
});
test('Learned residual stays bounded even at maximal imported weights', () => {
  const q = W(),
    b = q.brains[0];
  b.w.fill(1.8);
  for (const p of b.candidates(q, q.cars[0])) assert(Math.abs(b.correction(p)) <= 0.7200001);
  b.w.fill(-1.8);
  for (const p of b.candidates(q, q.cars[0])) assert(Math.abs(b.value(p) - p.prior) <= 0.7200001);
});
test('TD update differentiates through the bounded residual', () => {
  const b = new TBrain.Brain(2),
    features = Float64Array.from({ length: TBrain.NF }, (_, i) => (i === 0 ? 1 : 0));
  b.w[0] = 0.4;
  b.prev = { prior: 0, features };
  const before = b.w[0],
    value = 0.72 * Math.tanh(before / 0.72),
    td = 1 - value,
    gradient = 1 - Math.tanh(before / 0.72) ** 2;
  b.learn(1, 0);
  assert(Math.abs(b.w[0] - (before + (0.032 * td * gradient) / 2)) < 1e-12);
});
test('A selected forecast remains the driving target, not raw ball chasing', () => {
  const q = W(),
    b = q.brains[0],
    c = q.cars[0];
  place(c, -22, 0);
  q.ball = TP.sphere(0, TP.BR, 0);
  q.ball.vz = 10;
  b.choose(q, c);
  b.control(q, c, TP.DT);
  assert(c.plan.ball && Number.isFinite(c.target.z));
  assert(Math.abs(c.target.z - q.ball.z) > 1);
});
test('A sudden ball-velocity change causes replanning, after a human reaction delay', () => {
  const q = W(),
    b = q.brains[0],
    c = q.cars[0];
  b.choose(q, c);
  c.planAge = 0.11;
  q.ball.vz += 20;
  const before = b.planCount;
  // The car sees the deflection but does not act on the same frame it happens.
  b.step(q, c, TP.DT);
  assert.equal(b.planCount, before);
  // It does act once its reaction time has passed, which is under a quarter of a second.
  let frames = 1;
  while (b.planCount === before && frames < 40) {
    b.step(q, c, TP.DT);
    frames++;
  }
  assert.equal(b.planCount, before + 1);
  assert(frames * TP.DT < 0.25, 'reaction took ' + (frames * TP.DT).toFixed(3) + ' s');
});
test('Blocked-motion recovery applies controls without teleporting', () => {
  const q = W(),
    b = q.brains[0],
    c = q.cars[0];
  place(c, -25, 0);
  b.choose(q, c);
  b.blockedFor = 1.2;
  const pos = [c.x, c.y, c.z],
    ball = cp(q.ball);
  b.control(q, c, TP.DT);
  assert(b.recoveries > 0);
  assert(c.controller.throttle < 0);
  assert.deepEqual([c.x, c.y, c.z], pos);
  assert.deepEqual(q.ball, ball);
});
test('Recovering ahead of a stationary ball does not repeat the old own-goal route', () => {
  const q = W();
  q.learning = false;
  q.kickoffTime = 0;
  place(q.cars[0], 15, 0, Math.PI);
  place(q.cars[1], 30, 23, 0);
  q.frozen[1] = true;
  q.brains[1].step = () => {
    q.cars[1].controller = { throttle: 0, steer: 0 };
  };
  q.ball = TP.sphere(0, TP.BR, 0);
  advance(q, 10);
  assert.equal(q.score[1], 0);
  assert.equal(q.stats.safetyResets, 0);
});
test('Candidate and actual control values stay finite across 192 condition/state cases', () => {
  let n = 0;
  for (const rain of [0, 0.8])
    for (const heat of [0, 0.9])
      for (const ballY of [TP.BR, 5, 12])
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
          for (const x of [-35, -12, 12, 35]) {
            const q = W(++n),
              c = q.cars[0],
              b = q.brains[0];
            q.field.wet.fill(rain);
            q.weather.windX = 6;
            q.weather.windZ = -3;
            place(c, x, 7, heading);
            c.heat = heat;
            q.ball = TP.sphere(0, ballY, -3);
            q.ball.vx = -8;
            q.ball.vz = 5;
            const ps = b.candidates(q, c);
            assert(ps.length > 0);
            assert(
              ps.every(
                p => p.features.length === TBrain.NF && [...p.features, p.score, p.x, p.z].every(Number.isFinite)
              )
            );
            b.choose(q, c);
            b.control(q, c, TP.DT);
            for (const key of ['steer', 'throttle', 'pitch', 'yaw', 'roll'])
              assert(Number.isFinite(c.controller[key]) && Math.abs(c.controller[key]) <= 1);
          }
  assert.equal(n, 192);
});
test('The two online learners have independent weights and traces', () => {
  const q = W();
  advance(q, 12);
  assert.notDeepEqual([...q.brains[0].w], [...q.brains[1].w]);
  assert(q.brains.every(b => b.updates > 10));
  const v = q.brains[1].w[0];
  q.brains[0].w[0] = 1;
  assert.equal(q.brains[1].w[0], v);
});
test('Human control excludes that agent from online updates', () => {
  const q = W();
  q.human = 0;
  advance(q, 8);
  assert.equal(q.brains[0].updates, 0);
  // The point is that the other car keeps learning; the exact count moves with plan commitment.
  assert(q.brains[1].updates > 4);
});
test('A full 11 snapshot retains planner metadata and resumes exactly', () => {
  assert.equal(snapshot.plannerVersion, 11);
  const a = TState.restore(snapshot),
    b = TState.restore(snapshot);
  advance(a, 6);
  advance(b, 6);
  assert.deepEqual(TState.capture(a), TState.capture(b));
});
test('Actual 08 full-world fixture preserves physical state and learned weights', () => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/world-08.json'))),
    q = TState.restore(old.universe);
  const expected = cp(old.universe.dynamics);
  expected.teamState = {};
  expected.teamClock = 0;
  expected.stats = { assists: 0, teamBumps: 0, ...expected.stats };
  for (const c of expected.cars)
    if (c.plan) c.plan.features = c.plan.features.concat(Array(TBrain.NF - c.plan.features.length).fill(0));
  assert.deepEqual(TState.capture(q).dynamics, expected);
  assert.deepEqual(
    q.brains.map(b => [...b.w]),
    old.universe.brains.map(b => b.w.concat(Array(TBrain.NF - b.w.length).fill(0)))
  );
  advance(q, 2);
  assert(q.cars.every(c => Number.isFinite(c.x + c.y + c.z)));
});
const mutations = [
  ['zero sphere mass', d => (d.dynamics.ball.mass = 0)],
  ['negative sphere radius', d => (d.dynamics.ball.r = -1)],
  ['engine heat outside physical range', d => (d.dynamics.cars[0].heat = 5)],
  ['unbounded steering', d => (d.dynamics.cars[0].controller.steer = 3)],
  ['invalid trace length', d => (d.brains[0].trace = [1])],
  ['learner method shadowing', d => (d.brains[0].value = 'not a function')],
  ['weather method shadowing', d => (d.weather.step = 'not a function')],
  ['malformed observer samples', d => (d.observer.samples = [null, null])],
  ['missing frozen flags', d => delete d.dynamics.frozen],
  [
    'corrupt planned action',
    d => {
      d.dynamics.cars[0].plan = { kind: 'contact', x: 0, z: 0, prior: 1, features: [NaN] };
    }
  ],
  ['impossible atmospheric fraction', d => (d.weather.cloud = 20)]
];
for (const [name, change] of mutations)
  test('Import rejects ' + name, () => {
    const d = cp(snapshot);
    change(d);
    assert.throws(() => TState.restore(d));
  });
const sent = [],
  rt = createRuntime(m => sent.push(m));
rt.stop();
let seq = 0;
function call(type, args = {}) {
  const id = ++seq;
  rt.receive({ type, ...args, id });
  const m = sent.find(m => m.id === id);
  if (m?.type === 'error') throw Error(m.message);
  return m?.result;
}
test('Runtime exports the 11 edition with a versioned full-world schema', () => {
  const d = call('export');
  assert.equal(d.plannerVersion, 11);
  assert.equal(d.format, 'touchline-world-v11');
  assert.equal(d.edition, 'Doubles 11');
});
test('Every malformed import is atomic: the running world is left intact', () => {
  const before = TState.capture(rt.world);
  for (const [, change] of mutations) {
    const d = call('export');
    change(d.universe);
    assert.throws(() => call('import', { data: d }));
    assert.deepEqual(TState.capture(rt.world), before);
  }
});
test('08 migration explicitly warns that future decisions can differ', () => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/world-08.json')));
  call('import', { data: old });
  assert(sent.some(m => m.type === 'warning' && m.message.includes('future decisions can differ')));
});
rt.stop();
test('Sequence observer never commands or changes a live physical body', () => {
  const q = W();
  advance(q, 15);
  const before = cp({ cars: q.cars, ball: q.ball, score: q.score }),
    weights = q.brains.map(b => [...b.w]);
  q.observer.step(q, 0.11);
  assert.deepEqual(cp({ cars: q.cars, ball: q.ball, score: q.score }), before);
  assert.deepEqual(
    q.brains.map(b => [...b.w]),
    weights
  );
});
test('Recorded patterns carry ordered actual motion and bounded feature contrasts', () => {
  const q = W(271);
  advance(q, 70);
  const ps = q.observer.patterns;
  assert(ps.length > 3);
  assert(ps.every(p => p.sequence.length >= 1 && p.sequence.length <= 3 && p.featurePair.length === 2));
  assert(ps.some(p => p.sequence.length > 1));
  for (const p of ps) {
    const b = q.brains[p.agent],
      f = p.featurePair,
      expected = b.correction({ features: f[0] }) - b.correction({ features: f[1] });
    assert(Number.isFinite(expected) && Math.abs(expected) <= 1.44);
    assert(p.stage < 2 || p.count >= 10);
  }
});
const report = {
  date: new Date().toISOString(),
  passed: rows.filter(r => r.pass).length,
  failed: rows.filter(r => !r.pass).length,
  sourceSha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '../src/agents.js')))
    .digest('hex'),
  results: rows
};
fs.writeFileSync(path.join(__dirname, '../reports/fieldunit-tests.json'), JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
