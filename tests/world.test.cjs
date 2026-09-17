'use strict';
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  vm = require('vm');
for (const n of ['math', 'weather', 'field', 'physics', 'agents', 'observer', 'state', 'evaluation'])
  require('../src/' + n + '.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8'));
const results = [],
  measurements = {};
function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, pass: false, error: e.stack });
    console.error('FAIL', name, e.message);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, pass: false, error: e.stack });
    console.error('FAIL', name, e.message);
  }
}
function world(seed = 451, mode = 'duel') {
  const w = new TP.World({ seed, mode });
  w.brains = [new TBrain.Brain(2718), new TBrain.Brain(7147)];
  w.observer = new TObserver();
  w.observer.world = w;
  return w;
}
function step(w, seconds) {
  for (let i = 0; i < Math.round(seconds / TP.DT); i++) w.step();
}
const copy = TState.plain;
(async () => {
  test('Weather is reproducible from its own seed', () => {
    const a = new TWeather(9),
      b = new TWeather(9);
    for (let i = 0; i < 3000; i++) {
      a.step(0.1);
      b.step(0.1);
    }
    assert.deepEqual(a.save(), b.save());
  });
  test('Atmospheric forcing differs across independent seeds', () => {
    const a = new TWeather(9),
      b = new TWeather(19);
    for (let i = 0; i < 1600; i++) {
      a.step(0.1);
      b.step(0.1);
    }
    assert.notEqual(a.cloud, b.cloud);
  });
  test('A full simulated day advances the persistent clock', () => {
    const w = new TWeather(4);
    w.configure({ dayLength: 180 });
    const start = w.clock;
    for (let i = 0; i < 1800; i++) w.step(0.1);
    assert.equal(w.day, 2);
    assert(Math.abs(w.clock - start) < 1e-10);
  });
  test('Weather interventions change gradually, not instantaneously', () => {
    const w = new TWeather(4),
      before = w.rain;
    w.configure({ mode: 'rain' });
    w.step(TP.DT);
    assert(w.rain - before < 0.001);
    for (let i = 0; i < 900; i++) w.step(0.1);
    assert(w.rain > 0.7);
  });
  test('Weather rain reaches the actual moisture grid', () => {
    const w = world();
    w.weather.configure({ mode: 'rain' });
    step(w, 80);
    assert(w.field.visual().wetMean > 0.2);
  });
  test('Canopy shelter receives less rainfall than exposed turf', () => {
    const w = world();
    w.weather.configure({ mode: 'rain' });
    w.weather.cloud = 0.96;
    w.weather.humidity = 0.94;
    w.weather.rain = 0.9;
    for (let i = 0; i < 200; i++) {
      w.weather.step(0.1);
      w.field.step(0.1, w.weather);
    }
    assert(w.field.sample(0, -26).wet < w.field.sample(0, 10).wet * 0.6);
  });
  test('Clear skies do not instantly erase a wet surface', () => {
    const w = world();
    w.field.wet.fill(0.6);
    w.weather.configure({ mode: 'clear' });
    step(w, 1);
    assert(w.field.sample(0, 10).wet > 0.55);
  });
  test('Exposed daytime turf dries faster than night turf', () => {
    const a = world(),
      b = world();
    a.field.wet.fill(0.6);
    b.field.wet.fill(0.6);
    a.weather.configure({ hour: 12, mode: 'clear' });
    b.weather.configure({ hour: 0, mode: 'clear' });
    for (let i = 0; i < 400; i++) {
      a.field.step(0.1, a.weather);
      b.field.step(0.1, b.weather);
    }
    assert(a.field.sample(0, 10).wet < b.field.sample(0, 10).wet);
  });
  test('Night changes sunlight, not the agents exact state access', () => {
    const w = world();
    w.weather.configure({ hour: 0 });
    assert.equal(w.weather.sun, 0);
    assert(w.brains[0].candidates(w, w.cars[0]).length > 10);
  });
  test('Goals do not reset weather, surface or resource history', () => {
    const w = world();
    w.field.wet.fill(0.55);
    w.cars[0].heat = 0.7;
    w.cars[0].boost = 12;
    w.pads[0].charge = 0.2;
    const clock = w.weather.clock;
    w.resetPositions();
    assert.equal(w.weather.clock, clock);
    assert(Math.abs(w.field.wet[0] - 0.55) < 1e-6);
    assert.equal(w.cars[0].heat, 0.7);
    assert.equal(w.cars[0].boost, 12);
    assert.equal(w.pads[0].charge, 0.2);
  });
  test('Physical pause between goals still cools a hot engine', () => {
    const w = world();
    w.cars[0].heat = 0.8;
    w.goalPause = 1;
    step(w, 0.4);
    assert(w.cars[0].heat < 0.8);
    assert(w.weather.elapsed > 0.39);
  });
  test('Heat slows finite boost-pad regeneration', () => {
    const a = world(),
      b = world();
    a.pads[0].charge = b.pads[0].charge = 0;
    b.field.heat.fill(0.9);
    step(a, 0.5);
    step(b, 0.5);
    assert(a.pads[0].charge > b.pads[0].charge * 1.5);
  });
  test('Partly charged resources transfer only their available energy', () => {
    const w = world(),
      c = w.cars[0],
      p = w.pads[0];
    c.x = p.x;
    c.z = p.z;
    c.y = TP.CLEAR;
    c.boost = 0;
    p.charge = 0.35;
    w.drive(c, TP.DT);
    assert(Math.abs(c.boost - 35) < 0.1);
    assert(p.charge < 0.001);
  });
  test('Crosswind changes airborne ball trajectories', () => {
    const a = world(),
      b = world();
    a.weather.windX = a.weather.windZ = 0;
    b.weather.windX = 6;
    b.weather.windZ = 0;
    a.ball = TP.sphere(0, 10, 0);
    b.ball = TP.sphere(0, 10, 0);
    for (let i = 0; i < 60; i++) {
      a.ballIntegrate(a.ball, TP.DT);
      b.ballIntegrate(b.ball, TP.DT);
    }
    assert(b.ball.x > a.ball.x + 0.08);
  });
  test('Heavy props accelerate less under the same wind', () => {
    const w = world();
    w.weather.windX = 6;
    w.weather.windZ = 0;
    const a = TP.sphere(0, 10, 0, 1.25, 30),
      b = TP.sphere(0, 10, 0, 1.25, 100);
    w.ballIntegrate(a, 0.1, false);
    w.ballIntegrate(b, 0.1, false);
    assert(a.vx > b.vx * 2);
  });
  test('Every candidate carries 64 finite, action-specific features', () => {
    const w = world();
    w.field.wet.fill(0.6);
    const plans = w.brains[0].candidates(w, w.cars[0]);
    assert(plans.every(p => p.features.length === 64 && [...p.features].every(Number.isFinite)));
    const contact = plans.filter(p => p.kind === 'contact');
    assert(new Set(contact.map(p => p.variant)).size === 3);
    assert.notEqual(contact[0].features[30], contact[1].features[30]);
  });
  test('Changing a learned weather coefficient changes relative plan values', () => {
    const w = world();
    w.field.wet.fill(0.6);
    const b = w.brains[0],
      p = b.candidates(w, w.cars[0]).filter(p => p.kind === 'contact');
    const d = b.value(p[0]) - b.value(p[1]);
    b.w[31] = 1;
    assert(Math.abs(b.value(p[0]) - b.value(p[1]) - d) > 0.05);
  });
  test('Plans include actual braking, wet-route, wind and pad estimates', () => {
    const w = world();
    const p = w.brains[0].candidates(w, w.cars[0]);
    assert(
      p.every(p =>
        Number.isFinite(
          p.environment.brakingDistance + p.environment.wet + p.environment.crossWind + p.environment.padCharge
        )
      )
    );
  });
  test('A frozen archived opponent does not learn while its peer does', () => {
    const w = world();
    w.frozen[1] = true;
    const initial = w.brains[1].save();
    step(w, 15);
    assert.deepEqual(w.brains[1].w, Float64Array.from(initial.w));
    assert.equal(w.brains[1].updates, 0);
    assert(w.brains[0].updates > 10);
  });
  test('Legacy 26-weight policies migrate without erasing old weights', () => {
    const w = world(),
      d = w.brains[0].save();
    d.w = Array.from({ length: 26 }, (_, i) => i * 0.01);
    const b = new TBrain.Brain(1, d);
    assert.deepEqual([...b.w].slice(0, 26), d.w);
    assert([...b.w].slice(26).every(x => x === 0));
  });
  test('Ecological tire damage is separate from pure Conway rules', () => {
    const f = world().field,
      i = f.index(0, 0);
    f.life[i] = 1;
    f.living = true;
    f.lifeMode = 'conway';
    f.disturb(0, 0);
    assert.equal(f.life[i], 1);
    f.lifeMode = 'ecology';
    f.disturb(0, 0);
    assert.equal(f.life[i], 0);
  });
  test('Hot, dry conditions suppress ecological growth', () => {
    const f = world().field;
    f.life.fill(1);
    f.lifeMode = 'ecology';
    f.heat.fill(0.8);
    f.tickLife();
    assert.equal(
      f.life.reduce((s, v) => s + v, 0),
      0
    );
  });
  test('Ecological growth changes the same grip sample used by physics', () => {
    const f = world().field;
    f.living = true;
    f.lifeMode = 'ecology';
    f.life.fill(1);
    assert(f.sample(0, 0).grip < 1);
  });
  const trained = world(27);
  step(trained, 60);
  const capture = TState.capture(trained);
  measurements.saveBytes = JSON.stringify(capture).length;
  test('Full snapshots contain the clock, RNG, fields, traces and replays', () => {
    assert(capture.weather && capture.field && capture.rng);
    assert(capture.brains.every(b => b.trace.length === 64));
    assert(capture.observer.codec.frames.length > 0);
    assert(capture.observer.samples.length === 2);
  });
  test('Full restore continues exact physical state over 20 seconds', () => {
    const a = TState.restore(copy(capture)),
      b = TState.restore(copy(capture));
    step(a, 20);
    step(b, 20);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(
      a.brains.map(b => b.saveSession()),
      b.brains.map(b => b.saveSession())
    );
  });
  test('A saved live world and its restored copy stay bit-identical', () => {
    const a = world(34);
    step(a, 18);
    a.intervene('wet', 3, 4);
    const b = TState.restore(copy(TState.capture(a)));
    step(a, 15);
    step(b, 15);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(
      a.brains.map(b => [...b.w]),
      b.brains.map(b => [...b.w])
    );
  });
  test('Saved Conway/ecological clocks and RNG resume exactly', () => {
    const a = world(3);
    a.field.living = true;
    a.field.lifeMode = 'ecology';
    a.field.wet.fill(0.6);
    step(a, 2.17);
    const b = TState.restore(copy(TState.capture(a)));
    step(a, 8);
    step(b, 8);
    assert.deepEqual(a.field.save(), b.field.save());
  });
  test('Full import preserves the entire learner session immediately', () => {
    const before = TState.capture(trained),
      after = TState.capture(TState.restore(before));
    assert.deepEqual(before.brains, after.brains);
  });
  test('Restored worlds cannot mutate their source file object', () => {
    const before = TState.capture(trained),
      original = JSON.stringify(before),
      w = TState.restore(before);
    step(w, 5);
    assert(JSON.stringify(before) === original, 'Restoration shared references with the saved file');
  });
  test('Journal replay clips survive export and import', () => {
    const w = TState.restore(copy(capture));
    assert(w.observer.patterns.some(p => p.clip.length > 5));
    const f = w.observer.patterns.find(p => p.clip.length > 5).clip[0];
    assert(f.weather && f.surface && f.cars.length === 2);
  });
  test('Observer records unsuccessful attempts, not only highlights', () => {
    assert(trained.observer.patterns.some(p => p.misses > 0));
    assert(trained.observer.opportunities.some(o => !o.positive));
  });
  test('Novelty uses a 24-value temporal embedding independent of outcome', () => {
    assert(trained.observer.patterns.every(p => p.embedding.length === 24));
    assert(trained.observer.patterns.some(p => p.count > 1));
  });
  test('Single sightings cannot satisfy recurrence or learning thresholds', () => {
    for (const p of trained.observer.patterns) if (p.count === 1) assert.equal(p.stage, 0);
  });
  test('Wilson intervals keep sparse observations uncertain', () => {
    const a = TWilson(1, 1);
    assert(a[0] < 0.25 && a[1] > 0.99);
    const b = TWilson(0, 0);
    assert.deepEqual(b, [0, 1]);
  });
  test('Learning-associated label needs peer evidence and preference change', () => {
    const o = new TObserver(),
      p = {
        id: 1,
        agent: 0,
        context: 'x',
        count: 20,
        positive: 20,
        rounds: [1, 2, 3],
        shift: 0.1,
        updated: 100,
        firstUpdate: 0
      };
    o.evidence(p);
    assert(p.stage < 2);
    o.opportunities = Array.from({ length: 20 }, () => ({ id: 2, agent: 0, context: 'x', positive: false }));
    o.evidence(p);
    assert.equal(p.stage, 2);
    p.shift = 0;
    o.evidence(p);
    assert(p.stage < 2);
  });
  test('Malformed full-world physics is rejected before application', () => {
    const d = copy(capture);
    d.dynamics.ball.x = Infinity;
    assert.throws(() => TState.restore(d));
  });
  test('Malformed field dimensions are rejected', () => {
    const d = copy(capture);
    d.field.wet = [1, 2];
    assert.throws(() => TState.restore(d));
  });
  test('Prototype-bearing JSON keys are rejected', () => {
    assert.throws(() => TState.safe(JSON.parse('{"__proto__":{"polluted":true}}')));
    assert.equal({}.polluted, undefined);
  });
  const sent = [],
    rt = createRuntime(m => sent.push(m));
  rt.stop();
  let id = 1;
  function call(type, args = {}) {
    const n = id++;
    rt.receive({ type, ...args, id: n });
    const m = sent.find(m => m.id === n);
    if (m.type === 'error') throw Error(m.message);
    return m.result;
  }
  test('Runtime exposes a versioned full-world file', () => {
    const d = call('export');
    assert.equal(d.format, 'touchline-world-v11');
    assert(d.universe.weather && d.universe.brains);
  });
  test('Runtime pause does not alter weather state', () => {
    call('pause', { value: true });
    const a = copy(rt.world.weather.save());
    call('diagnostic');
    assert.deepEqual(rt.world.weather.save(), a);
  });
  test('Invalid import leaves the current world untouched', () => {
    const t = rt.world.time;
    assert.throws(() => call('import', { data: { format: 'bad' } }));
    assert.equal(rt.world.time, t);
  });
  test('Historical sparring preserves the live opponent policy', () => {
    step(rt.world, 8);
    const before = rt.world.brains[1].save();
    call('spar', { value: '1' });
    assert(rt.world.frozen[1]);
    step(rt.world, 4);
    call('spar', { value: 'live' });
    assert.deepEqual(rt.world.brains[1].save().w, before.w);
    assert.equal(rt.world.brains[1].updates, before.updates);
  });
  test('Manual moment capture does not reset the live world', () => {
    const before = rt.world.snapshot();
    call('mark');
    assert.deepEqual(rt.world.snapshot(), before);
    assert(call('branchData', { variant: 'wet' }).anchor);
  });
  test('Switching modes preserves atmosphere and field history', () => {
    rt.world.field.wet.fill(0.4);
    const weather = rt.world.weather.save();
    call('mode', { value: 'coop' });
    assert.deepEqual(rt.world.weather.save(), weather);
    assert(Math.abs(rt.world.field.wet[0] - 0.4) < 1e-6);
    call('mode', { value: 'duel' });
  });
  test('Resetting learners does not reset the physical world', () => {
    const weather = rt.world.weather.save(),
      time = rt.world.time;
    call('reset');
    assert.equal(rt.world.time, time);
    assert.deepEqual(rt.world.weather.save(), weather);
    assert(rt.world.brains.every(b => b.updates === 0));
  });
  await testAsync('Frozen evaluation reproduces identical policy comparisons', async () => {
    const p = world().brains.map(b => b.save()),
      copyBefore = JSON.stringify(p);
    const r = await TEvaluation.evaluate({ current: p, baseline: p, archiveId: 1, seconds: 12 });
    assert(r.agents.every(a => a.goalDifferenceChange === 0 && a.touchDifference === 0));
    assert.equal(r.rows.length, 8);
    assert.equal(JSON.stringify(p), copyBefore);
    measurements.identicalPolicyEvaluation = r;
  });
  await testAsync('Counterfactual branches do not modify the saved anchor', async () => {
    const data = { anchor: capture, variant: 'wet' },
      before = JSON.stringify(data.anchor),
      r = await TEvaluation.branch(data);
    assert(JSON.stringify(data.anchor) === before, 'Counterfactual changed its saved input');
    assert.equal(r.cases.length, 2);
    assert(r.cases.every(c => c.frames.length > 60));
    assert.notDeepEqual(r.cases[0].frames.at(-1).ball, r.cases[1].frames.at(-1).ball);
    measurements.branch = { variant: r.variant, cases: r.cases.map(({ frames, ...x }) => x) };
  });
  rt.stop();
  fs.mkdirSync(path.join(__dirname, '../reports'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, '../reports/world-tests.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        passed: results.filter(x => x.pass).length,
        failed: results.filter(x => !x.pass).length,
        results,
        measurements
      },
      null,
      2
    )
  );
  if (results.some(x => !x.pass)) process.exitCode = 1;
})();
