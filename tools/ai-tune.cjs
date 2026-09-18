'use strict';
// Searches the authored AI constants (AI_DEFAULTS in src/agents.js) by self-play against a frozen baseline.
//   node tools/ai-tune.cjs --iterations 60 --games 40 --mode duel
// Hill climbing with a guard against lucky results: a candidate that beats the current best on the search
// seeds must also beat it on a second, independent seed set before it is accepted.
// Prints the best constants as JSON; copy the ones you trust into AI_DEFAULTS and re-run npm run ai:bench.
const path = require('path');
const { matchSet } = require('./ai-benchmark.cjs');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const iterations = +arg('iterations', 60),
  games = +arg('games', 40),
  mode = arg('mode', 'duel'),
  rngSeed = +arg('seed', 7);

let state = rngSeed >>> 0 || 1;
const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());

require(path.join(__dirname, '..', 'src', 'agents.js'));
const defaults = { ...globalThis.TBrain.AI_DEFAULTS };
const keys = Object.keys(defaults);

function score(params, seedBase) {
  globalThis.BOTKET_AI_TUNE = params;
  const r = matchSet({ mode, games, seedBase });
  globalThis.BOTKET_AI_TUNE = null;
  return r.mean;
}

let best = { ...defaults },
  bestSearch = score(best, 5000),
  bestCheck = score(best, 90000);
console.log(JSON.stringify({ iteration: 0, search: bestSearch, check: bestCheck }));
for (let it = 1; it <= iterations; it++) {
  const candidate = { ...best };
  const count = 1 + Math.floor(random() * 3);
  for (let k = 0; k < count; k++) {
    const key = keys[Math.floor(random() * keys.length)];
    candidate[key] = +(best[key] * Math.exp(gaussian() * 0.3)).toFixed(4);
  }
  const search = score(candidate, 5000);
  let accepted = false,
    check = null;
  if (search > bestSearch + 0.05) {
    check = score(candidate, 90000);
    if (check > bestCheck) {
      best = candidate;
      bestSearch = search;
      bestCheck = check;
      accepted = true;
    }
  }
  const changed = keys.filter(k => candidate[k] !== best[k] || (accepted && candidate[k] !== defaults[k]));
  console.log(JSON.stringify({ iteration: it, search: +search.toFixed(3), check, accepted, changed }));
}
console.log('BEST ' + JSON.stringify({ search: bestSearch, check: bestCheck, params: best }));
