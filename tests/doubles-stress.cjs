'use strict';
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
for (const n of ['math', 'weather', 'field', 'physics', 'agents', 'observer', 'state', 'evaluation'])
  require('../src/' + n + '.js');
const rows = [],
  results = [],
  started = Date.now(),
  seconds = 180;
for (let run = 0; run < 8; run++) {
  const seed = 1211 + run * 173,
    w = new TP.World({ seed, mode: 'doubles' });
  w.brains = w.cars.map((c, i) => new TBrain.Brain(seed + 419 * i));
  w.observer = new TObserver(4);
  w.observer.world = w;
  const condition = ['fair', 'rain', 'wind', 'ecology'][run % 4];
  w.weather.configure({
    dayLength: 180,
    mode: condition === 'ecology' ? 'rain' : condition === 'fair' ? 'clear' : condition,
    hour: run % 2 ? 21 : 10
  });
  if (condition === 'ecology') {
    w.field.living = true;
    w.field.lifeMode = 'ecology';
    w.intervene('sphere', 8, 3);
  }
  const touches = [0, 0, 0, 0],
    roles = Array.from({ length: 4 }, () => ({}));
  let bad = 0,
    maxSpeed = 0,
    maxBallSpeed = 0;
  w.listeners.push(e => {
    if (e.type === 'touch') touches[e.id]++;
  });
  for (let i = 0; i < seconds * 120; i++) {
    w.step();
    if (i % 120 === 0) {
      for (const c of w.cars) {
        const r = c.plan?.role || 'none';
        roles[c.id][r] = (roles[c.id][r] || 0) + 1;
        maxSpeed = Math.max(maxSpeed, Math.hypot(c.vx, c.vz));
      }
      maxBallSpeed = Math.max(maxBallSpeed, Math.hypot(w.ball.vx, w.ball.vy, w.ball.vz));
      if (![...w.cars, w.ball, ...w.props].every(c => [c.x, c.y, c.z, c.vx, c.vy, c.vz, ...c.q].every(Number.isFinite)))
        bad++;
      if (!w.brains.every(b => [...b.w, ...b.trace].every(Number.isFinite))) bad++;
    }
  }
  const row = {
    seed,
    seconds,
    condition,
    score: w.score,
    stats: w.stats,
    updates: w.brains.map(b => b.updates),
    norms: w.brains.map(b => b.norm()),
    touches,
    roles,
    nonFiniteSamples: bad,
    maxSpeed,
    maxBallSpeed
  };
  rows.push(row);
  const checks = [
    ['finite physical and learning state', bad === 0],
    ['no emergency resets', w.stats.safetyResets === 0],
    [
      'all four agents update independently',
      row.updates.every(n => n > 100) && new Set(w.brains.map(b => JSON.stringify([...b.w]))).size === 4
    ],
    ['all four players make physical contacts', touches.every(n => n > 0)]
  ];
  for (const [name, pass] of checks) results.push({ name: condition + ' / ' + seed + ' / ' + name, pass });
  console.log(JSON.stringify({ ...row, roles: undefined }));
}
const report = {
  date: new Date().toISOString(),
  seedCount: rows.length,
  simulatedMinutes: (seconds * rows.length) / 60,
  passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass).length,
  wallSeconds: (Date.now() - started) / 1000,
  sourceSha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '../src/agents.js')))
    .digest('hex'),
  rows,
  results,
  limitations: [
    'Stability and observed-play test; not evidence of learned teamwork or increased win rate.',
    'Physics and policies simulated locally in Node, not a rendering benchmark.'
  ]
};
fs.writeFileSync(path.join(__dirname, '../reports/doubles-stress.json'), JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
