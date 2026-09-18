'use strict';
// Head-to-head AI benchmark: the working-tree planner (src/agents.js) against a baseline read from git.
//   npm run ai:bench                      # baseline = HEAD, 1v1 and 2v2
//   node tools/ai-benchmark.cjs --ref fb707e4 --games 60 --seconds 90 --mode duel
// Learning is frozen and weights start at zero, so this measures the authored planner and controller.
// Every seed is played twice with sides swapped, so neither version gets a kickoff or side advantage.
const fs = require('fs'),
  vm = require('vm'),
  path = require('path'),
  { execSync } = require('child_process');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ref = arg('ref', 'HEAD'),
  games = +arg('games', 40),
  seconds = +arg('seconds', 90),
  modes = arg('mode', 'duel,doubles').split(','),
  seedBase = +arg('seedbase', 5000),
  root = path.resolve(__dirname, '..');

for (const n of ['math', 'weather', 'field', 'physics']) require(path.join(root, 'src', n + '.js'));
// Load the baseline first under a different global name, then the current planner.
const baselineSource = execSync(`git show ${ref}:src/agents.js`, { cwd: root, encoding: 'utf8' })
  .replace(/root\.TBrain\s*=/g, 'root.TBrainBaseline =')
  .replace(/root\.TTeam\s*=/g, 'root.TTeamBaseline =')
  .replace(/module\.exports\s*=\s*root\.TBrain\b/g, 'void 0');
vm.runInThisContext(baselineSource, { filename: 'baseline-agents.js' });
require(path.join(root, 'src', 'agents.js'));
const Current = globalThis.TBrain.Brain,
  Baseline = globalThis.TBrainBaseline.Brain,
  CurrentTeam = globalThis.TTeam,
  BaselineTeam = globalThis.TTeamBaseline;

function play(mode, seed, currentSide, length = seconds) {
  const w = new TP.World({ seed, mode });
  w.learning = false;
  w.observer = null;
  w.brains = w.cars.map((c, i) => (c.side === currentSide ? new Current(seed + 17 * i) : new Baseline(seed + 17 * i)));
  // Each side keeps its own team coordinator in 2v2.
  if (mode === 'doubles')
    // Each side keeps its own coordinator. Both share the world's 120 ms clock, so rewind it between calls.
    globalThis.TTeam = {
      update(world) {
        const clock = world.teamClock;
        CurrentTeam.update(world);
        const current = world.teamState?.[currentSide],
          after = world.teamClock;
        world.teamClock = clock;
        BaselineTeam.update(world);
        if (current) world.teamState[currentSide] = current;
        world.teamClock = after;
      }
    };
  const stats = { ownGoals: [0, 0], touches: [0, 0], kickoffs: [0, 0] };
  let kickoffOpen = true;
  const teamOf = side => (side === currentSide ? 0 : 1);
  w.listeners.push(e => {
    if (e.type === 'kickoff') kickoffOpen = true;
    if (e.type === 'touch') {
      const side = w.cars[e.id].side;
      stats.touches[teamOf(side)]++;
      if (kickoffOpen) {
        kickoffOpen = false;
        // Kickoff "won" when that touch sends the ball toward the opponent's half.
        if (Math.sign(e.after[0]) === side) stats.kickoffs[teamOf(side)]++;
      }
    }
    if (e.type === 'goal' && e.id >= 0 && w.cars[e.id].side !== e.side) stats.ownGoals[teamOf(w.cars[e.id].side)]++;
  });
  for (let i = 0, n = Math.round(length / TP.DT); i < n; i++) w.step();
  const blue = w.score[0],
    orange = w.score[1],
    currentGoals = currentSide > 0 ? blue : orange,
    baselineGoals = currentSide > 0 ? orange : blue;
  return { currentGoals, baselineGoals, ...stats };
}

function matchSet({ mode, games, seconds: length = seconds, seedBase = 5000 }) {
  const total = {
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      ownFor: 0,
      ownAgainst: 0,
      touches: [0, 0],
      kick: [0, 0]
    },
    diffs = [];
  for (let g = 0; g < games / 2; g++) {
    const seed = seedBase + g * 97;
    for (const side of [1, -1]) {
      const r = play(mode, seed, side, length);
      total.games++;
      total.gf += r.currentGoals;
      total.ga += r.baselineGoals;
      diffs.push(r.currentGoals - r.baselineGoals);
      if (r.currentGoals > r.baselineGoals) total.wins++;
      else if (r.currentGoals < r.baselineGoals) total.losses++;
      else total.draws++;
      total.ownFor += r.ownGoals[0];
      total.ownAgainst += r.ownGoals[1];
      total.touches[0] += r.touches[0];
      total.touches[1] += r.touches[1];
      total.kick[0] += r.kickoffs[0];
      total.kick[1] += r.kickoffs[1];
    }
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length,
    sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1)),
    se = sd / Math.sqrt(diffs.length);
  return { total, mean, se };
}

module.exports = { matchSet };

if (require.main === module)
  for (const mode of modes) {
    const started = Date.now(),
      { total, mean, se } = matchSet({ mode, games, seedBase });
    console.log(
      JSON.stringify({
        mode,
        baseline: ref,
        games: total.games,
        secondsPerGame: seconds,
        record: `${total.wins}W ${total.draws}D ${total.losses}L`,
        goals: `${total.gf} - ${total.ga}`,
        goalDiffPerGame: +mean.toFixed(2),
        ci95: [+(mean - 1.96 * se).toFixed(2), +(mean + 1.96 * se).toFixed(2)],
        ownGoals: { current: total.ownFor, baseline: total.ownAgainst },
        touches: { current: total.touches[0], baseline: total.touches[1] },
        kickoffsWon: { current: total.kick[0], baseline: total.kick[1] },
        wallSeconds: +((Date.now() - started) / 1000).toFixed(1)
      })
    );
  }
