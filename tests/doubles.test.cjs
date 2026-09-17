'use strict';
const fs = require('fs'),
  assert = require('assert/strict'),
  vm = require('vm');
for (const n of ['math', 'weather', 'field', 'physics', 'agents', 'observer', 'state', 'evaluation'])
  require('../src/' + n + '.js');
vm.runInThisContext(fs.readFileSync(__dirname + '/../src/runtime.js', 'utf8'));
const results = [],
  measurements = {};
const test = (name, fn) => {
  try {
    fn();
    results.push({ name, pass: true });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, pass: false, error: e.stack });
    console.error('FAIL', name, e.message);
  }
};
const make = (seed = 2718, mode = 'doubles') => {
    const w = new TP.World({ seed, mode });
    w.brains = w.cars.map((c, i) => new TBrain.Brain(seed + 419 * i));
    w.observer = new TObserver(w.cars.length);
    w.observer.world = w;
    return w;
  },
  run = (w, t) => {
    for (let i = 0; i < Math.round(t / TP.DT); i++) w.step();
  },
  plain = TState.plain;
const pose = (c, x, z, side = c.side) => {
  c.x = x;
  c.y = TP.CLEAR;
  c.z = z;
  c.vx = c.vy = c.vz = 0;
  c.heading = side > 0 ? 0 : Math.PI;
  c.q = TM.Q.axis([0, 1, 0], side > 0 ? 0 : -Math.PI);
  c.plan = null;
  c.planAge = 10;
};
test('2v2 creates four unique cars, two on each opposing side', () => {
  const w = make();
  assert.equal(w.cars.length, 4);
  assert.deepEqual(
    w.cars.map(c => c.id),
    [0, 1, 2, 3]
  );
  assert.deepEqual(
    w.cars.map(c => c.side),
    [1, -1, 1, -1]
  );
  assert.equal(w.frozen.length, 4);
});
test('Duel and legacy co-op retain exactly two cars', () => {
  assert.equal(make(1, 'duel').cars.length, 2);
  assert.deepEqual(
    make(1, 'coop').cars.map(c => c.side),
    [1, 1]
  );
});
test('Kickoffs mirror team positions and keep all cars separated', () => {
  const w = make();
  for (let i = 0; i < 5; i++) {
    w.resetPositions();
    for (const a of w.cars) for (const b of w.cars) if (a.id !== b.id) assert(Math.hypot(a.x - b.x, a.z - b.z) > 8);
    assert.equal(w.cars[0].x, -w.cars[1].x);
    assert.equal(w.cars[2].z, -w.cars[3].z);
  }
});
test('Kickoff alternates the closer player within each team', () => {
  const w = make(),
    a = w.cars[0].x;
  w.resetPositions();
  assert.notEqual(w.cars[0].x, a);
});
test('Goals award the team, not the last player ID', () => {
  const w = make();
  w.ball.last = 2;
  w.goal(1);
  assert.deepEqual(w.score, [1, 0]);
  w.goalPause = 0;
  w.ball.last = 3;
  w.goal(-1);
  assert.deepEqual(w.score, [1, 1]);
});
test('All four terminal learning transitions are processed at a goal', () => {
  const w = make();
  run(w, 8);
  const before = w.brains.map(b => b.updates);
  w.goalPause = 0;
  w.goal(1);
  assert(w.brains.every((b, i) => b.updates === before[i] + 1));
  assert(w.brains.every(b => b.prev === null));
});
test('Weather, field, heat and resource charge survive four-player kickoffs', () => {
  const w = make();
  w.field.wet.fill(0.6);
  w.cars.forEach((c, i) => {
    c.heat = 0.2 + i * 0.1;
    c.boost = 33 + i;
  });
  w.pads[0].charge = 0.18;
  const a = w.weather.save();
  w.resetPositions();
  assert.deepEqual(w.weather.save(), a);
  assert.equal(w.field.wet[0], Math.fround(0.6));
  assert.deepEqual(
    w.cars.map(c => c.boost),
    [33, 34, 35, 36]
  );
  assert.equal(w.cars[3].heat, 0.5);
  assert.equal(w.pads[0].charge, 0.18);
});
test('Every unordered car pair is processed (all six pairs)', () => {
  const w = make(),
    seen = [];
  w.kickoffTime = 0;
  w.carPair = (a, b) => seen.push([a.id, b.id]);
  w.step();
  assert.deepEqual(seen, [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3]
  ]);
});
test('Teammates physically collide; they are not ghost cars', () => {
  const w = make(),
    a = w.cars[0],
    b = w.cars[2];
  pose(a, 0, 0);
  pose(b, 2.2, 0);
  a.vx = 8;
  b.vx = -3;
  w.carPair(a, b);
  assert(b.x - a.x >= 3.29);
  assert(a.vx < 8);
  assert.equal(w.stats.teamBumps, 1);
});
test('Orange secondary car contacts the ball with its own ID', () => {
  const w = make(),
    c = w.cars[3];
  pose(c, 5, 0);
  c.vx = -12;
  w.ball = TP.sphere(2.3, TP.BR, 0);
  w.hit(c, w.ball);
  assert.equal(w.ball.last, 3);
  assert(w.ball.vx < 0);
});
function reception(previous = 0) {
  const w = make(),
    c = w.cars[2];
  w.time = 10;
  pose(c, 0, 0);
  c.vx = 12;
  w.ball = TP.sphere(2.7, TP.BR, 0);
  Object.assign(w.ball, { last: previous, lastTime: 8, prevTouch: { x: -10, z: 0 } });
  w.hit(c, w.ball);
  return w;
}
test('A received teammate pass requires real separated same-team contacts', () => {
  const w = reception();
  assert.equal(w.stats.passes, 1);
  assert.equal(w.events.at(-1).passer, 0);
  assert.equal(w.ball.last, 2);
});
test('An intercepted opposition touch never becomes a teammate pass', () => {
  const w = reception(1);
  assert.equal(w.stats.passes, 0);
  assert.equal(w.ball.assist, null);
});
test('An immediate near-ball tap is not a counted pass', () => {
  const w = make(),
    c = w.cars[2];
  w.time = 10;
  pose(c, 0, 0);
  c.vx = 12;
  w.ball = TP.sphere(2.7, TP.BR, 0);
  Object.assign(w.ball, { last: 0, lastTime: 9, prevTouch: { x: 1, z: 0 } });
  w.hit(c, w.ball);
  assert.equal(w.stats.passes, 0);
});
test('A stale same-team touch is not a counted pass', () => {
  const w = make(),
    c = w.cars[2];
  w.time = 10;
  pose(c, 0, 0);
  c.vx = 12;
  w.ball = TP.sphere(2.7, TP.BR, 0);
  Object.assign(w.ball, { last: 0, lastTime: 1, prevTouch: { x: -10, z: 0 } });
  w.hit(c, w.ball);
  assert.equal(w.stats.passes, 0);
});
test('Recent same-team reception can produce an observed assist', () => {
  const w = reception();
  w.goal(1);
  assert.equal(w.stats.assists, 1);
  assert.equal(w.events.at(-1).assist, 0);
});
test('An own goal cannot award the opposing passer an assist', () => {
  const w = reception();
  w.goal(-1);
  assert.equal(w.stats.assists, 0);
  assert.equal(w.events.at(-1).assist, -1);
});
test('Shared touch reward is identical for both teammates', () => {
  const w = reception();
  assert.equal(w.cars[0].reward, w.cars[2].reward);
  assert.equal(w.cars[1].reward, 0);
});
test('Reception itself has no extra reward over the identical physical touch', () => {
  const a = reception(),
    b = reception(-1);
  assert.equal(a.cars[0].reward, b.cars[0].reward);
  assert.equal(a.cars[2].reward, b.cars[2].reward);
});
test('Both agents on a team see the same first-challenger assignment', () => {
  const w = make();
  TTeam.update(w);
  for (const side of [1, -1]) {
    const team = w.cars.filter(c => c.side === side),
      ctx = team.map(c => w.brains[c.id].teamContext(w, c));
    assert.equal(ctx.filter(t => t.primary).length, 1);
    assert.equal(ctx[0].assignment, ctx[1].assignment);
  }
});
test('Assignment rotates when the other teammate becomes more reachable', () => {
  const w = make();
  pose(w.cars[0], -5, 0);
  pose(w.cars[2], -32, 15);
  TTeam.update(w);
  assert.equal(w.teamState[1].challenger, 0);
  pose(w.cars[0], -35, 15);
  pose(w.cars[2], -5, 0);
  w.time += 0.2;
  TTeam.update(w);
  assert.equal(w.teamState[1].challenger, 2);
});
test('Off-ball player has support and cover alternatives', () => {
  const w = make();
  TTeam.update(w);
  const id = w.teamState[1].cover;
  assert(w.brains[id].candidates(w, w.cars[id]).some(p => p.kind === 'support'));
});
test('Near-ball teammate commitment prevents a second close challenge', () => {
  const w = make();
  pose(w.cars[0], -4, 0);
  pose(w.cars[2], -12, 0);
  TTeam.update(w);
  const p = w.brains[2].candidates(w, w.cars[2]);
  assert(p.filter(p => p.kind === 'contact').every(p => !p.safe));
});
test('Pass candidates explicitly target a teammate, not an opponent', () => {
  const w = make();
  pose(w.cars[0], -8, 0);
  pose(w.cars[2], 7, 12);
  pose(w.cars[1], 26, -15);
  pose(w.cars[3], 32, 0);
  TTeam.update(w);
  const p = w.brains[0].candidates(w, w.cars[0]).filter(p => p.role === 'pass');
  assert(p.length > 0);
  assert(p.every(p => p.passTo === 2 && p.kind === 'contact' && p.features.length === 64));
});
test('The second defender participates in shot-lane blocking', () => {
  const w = make(),
    c = w.cars[0];
  pose(w.cars[1], 20, 22);
  pose(w.cars[3], 20, 0);
  const a = w.brains[0].lane(w, c, w.ball, 44, 0).blocked;
  pose(w.cars[3], 20, 22);
  const b = w.brains[0].lane(w, c, w.ball, 44, 0).blocked;
  assert(a > b + 0.5);
});
test('All four learners change separate weights during live play', () => {
  const w = make();
  run(w, 30);
  assert(w.brains.every(b => b.updates > 30 && b.norm() > 0));
  assert.equal(new Set(w.brains.map(b => JSON.stringify(Array.from(b.w)))).size, 4);
});
test('Human control freezes Mica only; all three other cars still learn', () => {
  const w = make();
  run(w, 5);
  w.human = 0;
  w.brains[0].clear();
  const before = w.brains.map(b => b.updates),
    weights = Array.from(w.brains[0].w);
  run(w, 10);
  assert.deepEqual(Array.from(w.brains[0].w), weights);
  assert(w.brains.slice(1).every((b, i) => b.updates > before[i + 1]));
});
test('Freeze-learning applies to the full four-car roster', () => {
  const w = make();
  run(w, 6);
  w.learning = false;
  const before = w.brains.map(b => Array.from(b.w));
  run(w, 6);
  assert.deepEqual(
    w.brains.map(b => Array.from(b.w)),
    before
  );
});
test('Duel team features are zero, preserving their original feature meanings', () => {
  const w = make(1, 'duel');
  const p = w.brains[0].candidates(w, w.cars[0]);
  assert(p.every(p => p.features.slice(52).every(x => x === 0)));
});
test('Older 52-feature policies migrate losslessly with zero team coefficients', () => {
  const w = make(),
    p = w.brains[0].save();
  p.w = Array.from({ length: 52 }, (_, i) => i / 100);
  const b = new TBrain.Brain(1, p);
  assert.deepEqual(Array.from(b.w.slice(0, 52)), p.w);
  assert(b.w.slice(52).every(x => x === 0));
});
let snapshot;
test('Full 2v2 state resumes identical physics and learner updates', () => {
  const w = make();
  run(w, 25);
  snapshot = TState.capture(w);
  const r = TState.restore(snapshot);
  run(w, 6);
  run(r, 6);
  assert.deepEqual(TState.capture(w, { journal: false }), TState.capture(r, { journal: false }));
});
test('Replays retain four players, team identity and match format', () => {
  const w = TState.restore(snapshot);
  assert(w.observer.frames.every(f => f.cars.length === 4 && f.mode === 'doubles'));
  assert(w.observer.frames.every(f => f.cars[2].side === 1 && f.cars[3].side === -1));
});
test('Observer records all four identities, not just the original two', () => {
  const w = make(318);
  run(w, 120);
  assert.deepEqual([...new Set(w.observer.patterns.map(p => p.agent))].sort(), [0, 1, 2, 3]);
  assert(w.observer.patterns.every(p => p.features.length === 64));
});
test('Four-car observation remains read-only', () => {
  const a = make(),
    b = make();
  b.observer = null;
  run(a, 20);
  run(b, 20);
  assert.deepEqual(
    a.cars.map(c => [c.x, c.y, c.z]),
    b.cars.map(c => [c.x, c.y, c.z])
  );
  assert.deepEqual(
    a.brains.map(x => x.save()),
    b.brains.map(x => x.save())
  );
});
for (const [name, mutate] of [
  ['missing player', d => d.dynamics.cars.pop()],
  ['mismatched policy count', d => d.brains.pop()],
  ['duplicate player ID', d => (d.dynamics.cars[3].id = 2)],
  ['wrong team assignment', d => (d.dynamics.cars[2].side = -1)],
  ['invalid frozen roster', d => (d.dynamics.frozen = [false, false])],
  ['invalid coordinator player', d => (d.dynamics.teamState[1].challenger = 3)],
  ['corrupt learned input', d => (d.dynamics.cars[2].plan.features[0] = Infinity)]
])
  test('2v2 import rejects ' + name, () => {
    const d = plain(snapshot);
    mutate(d);
    assert.throws(() => TState.restore(d));
  });
const out = [],
  rt = createRuntime(m => out.push(m));
rt.stop();
let serial = 0;
function call(type, args = {}) {
  const id = ++serial;
  rt.receive({ type, id, ...args });
  const m = out.findLast(x => x.id === id);
  if (m.type === 'error') throw Error(m.message);
  return m.result;
}
call('pause', { value: true });
test('Runtime format switch creates four brains and four observer slots', () => {
  call('mode', { value: 'doubles' });
  assert.equal(rt.world.cars.length, 4);
  assert.equal(rt.world.brains.length, 4);
  assert.equal(rt.world.observer.samples.length, 4);
});
test('Mode changes preserve weather, field and elapsed world time', () => {
  rt.world.field.wet.fill(0.3);
  const a = rt.world.weather.save(),
    t = rt.world.time;
  call('mode', { value: 'duel' });
  call('mode', { value: 'doubles' });
  assert.equal(rt.world.time, t);
  assert.deepEqual(rt.world.weather.save(), a);
  assert.equal(rt.world.field.wet[0], Math.fround(0.3));
});
test('1v1 and 2v2 maintain separate learned-policy banks', () => {
  call('testAdvance', { testing: true, steps: 1200 });
  const a = rt.world.brains.map(b => b.save());
  call('mode', { value: 'duel' });
  call('testAdvance', { testing: true, steps: 1200 });
  const b = rt.world.brains.map(b => b.save());
  call('mode', { value: 'doubles' });
  assert.deepEqual(
    rt.world.brains.map(b => b.save()),
    a
  );
  call('mode', { value: 'duel' });
  assert.deepEqual(
    rt.world.brains.map(b => b.save()),
    b
  );
  call('mode', { value: 'doubles' });
});
test('Mode-local observed pass statistics do not leak into a duel', () => {
  rt.world.stats.passes = 7;
  call('mode', { value: 'duel' });
  assert.equal(rt.world.stats.passes, 0);
  call('mode', { value: 'doubles' });
  assert.equal(rt.world.stats.passes, 7);
});
test('Historical sparring freezes both orange players, not their blue rivals', () => {
  const id = call('archive').id;
  call('spar', { value: id });
  assert.deepEqual(rt.world.frozen, [false, true, false, true]);
  const before = rt.world.brains.map(b => b.updates);
  call('testAdvance', { testing: true, steps: 1200 });
  assert.equal(rt.world.brains[1].updates, before[1]);
  assert.equal(rt.world.brains[3].updates, before[3]);
  assert(rt.world.brains[0].updates > before[0] && rt.world.brains[2].updates > before[2]);
});
test('Historical team exports and resumes without losing live policies', () => {
  const a = call('export');
  call('import', { data: a });
  assert.deepEqual(rt.world.frozen, [false, true, false, true]);
  call('spar', { value: 'live' });
  assert.deepEqual(rt.world.frozen, [false, false, false, false]);
  assert.equal(rt.world.brains[3].updates, a.bench.policies[3].updates);
});
test('Reset affects all four live learners without resetting weather', () => {
  const a = rt.world.weather.save();
  call('reset');
  assert(rt.world.brains.every(b => b.updates === 0 && b.norm() === 0));
  assert.equal(rt.world.observer.samples.length, 4);
  assert.deepEqual(rt.world.weather.save(), a);
});
test('Malformed four-player import leaves the running world intact', () => {
  const a = call('export'),
    b = plain(a);
  b.universe.dynamics.cars[2].id = 9;
  assert.throws(() => call('import', { data: b }));
  assert.deepEqual(call('export').universe, a.universe);
});
test('A saved 2v2 moment includes all four physical agents and their learners', () => {
  call('mark');
  const d = call('branchData', { variant: 'wet' });
  assert.equal(d.anchor.dynamics.cars.length, 4);
  assert.equal(d.anchor.brains.length, 4);
});
test('Existing full two-car file can migrate, then switch to 2v2', () => {
  const old = JSON.parse(fs.readFileSync(__dirname + '/fixtures/world-08.json', 'utf8'));
  call('import', { data: old });
  assert.equal(rt.world.cars.length, 2);
  assert(rt.world.brains.every(b => b.w.length === 64));
  call('mode', { value: 'doubles' });
  assert.equal(rt.world.cars.length, 4);
});
(async () => {
  try {
    const p = make().brains.map(b => b.save()),
      r = await TEvaluation.evaluate({ mode: 'doubles', current: p, baseline: p, seconds: 3, archiveId: 1 });
    test('Identical frozen teams tie every paired evaluation from matched seeds', () => {
      assert.equal(r.gameCount, 16);
      assert.equal(r.mode, 'doubles');
      assert(r.rows.every(x => x.delta === 0));
    });
    measurements.evaluation = r;
    const a = make();
    run(a, 8);
    const d = TState.capture(a, { journal: false }),
      before = JSON.stringify(d),
      b = await TEvaluation.branch({ anchor: d, variant: 'wet' });
    test('Both saved-moment branches simulate four players without altering the anchor', () => {
      assert.equal(JSON.stringify(d), before);
      assert(b.cases.every(c => c.frames.every(f => f.cars.length === 4)));
    });
  } catch (e) {
    results.push({ name: 'Asynchronous team evaluations', pass: false, error: e.stack });
  }
  const report = {
    passed: results.filter(r => r.pass).length,
    failed: results.filter(r => !r.pass).length,
    results,
    measurements
  };
  fs.mkdirSync(__dirname + '/../reports', { recursive: true });
  fs.writeFileSync(__dirname + '/../reports/doubles-engine-tests.json', JSON.stringify(report, null, 2));
  console.log('SUMMARY', report.passed, report.failed);
  process.exitCode = report.failed ? 1 : 0;
})();
