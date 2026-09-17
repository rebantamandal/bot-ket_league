'use strict';
// Behaviour fingerprint: run seeded worlds headless for 90 simulated seconds and hash the full captured state.
// Use it around refactors that must not change behaviour:
//   npm run fingerprint > before.json   ...refactor...   npm run fingerprint | diff before.json -
const fs = require('fs'),
  vm = require('vm'),
  crypto = require('crypto'),
  path = require('path');
const src = path.resolve(__dirname, '..', 'src');
for (const n of ['math', 'weather', 'field', 'physics', 'agents', 'observer', 'state', 'evaluation'])
  require(path.join(src, n + '.js'));
vm.runInThisContext(fs.readFileSync(path.join(src, 'runtime.js'), 'utf8'));

const out = {};
for (const [mode, seed] of [
  ['duel', 2718],
  ['doubles', 9001],
  ['coop', 77]
]) {
  const w = new TP.World({ seed, mode });
  w.brains = w.cars.map((c, i) => new TBrain.Brain(seed + 419 * i));
  w.observer = new TObserver(w.cars.length);
  w.observer.world = w;
  if (mode === 'doubles') {
    // Exercise the systemic paths too: rain, living turf and a physical prop.
    w.weather.configure({ mode: 'rain' });
    w.field.living = true;
    w.intervene('sphere', 10, 5);
  }
  for (let i = 0; i < 120 * 90; i++) w.step();
  const json = JSON.stringify(TState.capture(w));
  out[mode] = {
    hash: crypto.createHash('sha256').update(json).digest('hex').slice(0, 16),
    score: w.score,
    touches: w.stats.touches,
    updates: w.brains.map(b => b.updates)
  };
}
console.log(JSON.stringify(out, null, 2));
