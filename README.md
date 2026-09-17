# Bot-ket League

An offline, systemic car-soccer world where self-playing cars learn in changing weather. (Formerly Touchline.) Version 11 adds optional four-car 2v2 while retaining the minimal Atelier interface, the two-car duel, the legacy cooperative exercise, and the persistent systemic world.

## Start

Open `index.html` in a modern desktop browser. Nothing is fetched from a network; there are no assets, accounts, libraries or font downloads. The whole site is that single file.

Use the **1v1 / 2v2** switch at the upper right of the arena. A fresh document begins in 1v1; the saved world, when available, restores its own mode.

- Blue: **Mica** (ID 0) and **Slate** (ID 2).
- Orange: **Ember** (ID 1) and **Sienna** (ID 3).

All four cars have their own controls, contact history, policy weights, eligibility traces, exploration state and updates. Select a car or its Fieldnotes tab to inspect it. Camera chapters include both added players; keys 5 and 6 follow Slate and Sienna. Manual control still takes over Mica only; the other three can continue learning.

Switching formats starts a new score and kickoff, not a resumable separate physical match. Each format retains its own learned policies and journal metadata. The same weather clock, surface moisture/heat, props and resource charge continue across changes. Existing cars retain engine heat and boost; newly introduced cars begin with their initial physical parameters. A full active-world export includes all four cars, physical state, replay clips, learning traces, mode policy banks and history.

## Team play: authored capabilities, online preferences

The predictive planner estimates arrival times, obstacle/opponent lanes and goal danger. Every 0.12 simulated seconds a deterministic reach-time coordinator nominates one challenger per side, with hysteresis. The teammate evaluates separated support/cover positions. Assignments change as the play changes. Close duplicate challenges are excluded by an authored safety rule.

A challenger can select an ordinary contact aimed toward a reachable teammate. Pass candidates compete with shots, clearances and resource decisions. No pass teleports the ball, adds a scripted impulse or compels a goal. Teammates are solid physical bodies and can bump each other.

Each learner adapts **64 bounded plan-scoring coefficients** during active play. The original 52 features retain their meanings; 12 additional features describe pass lanes, teammate separation, assignment, double-commitment risk and coverage. The 12 additions are zero in 1v1. Goals and useful touch rewards are shared within each team. Merely accumulating passes earns no extra bonus.

This is not end-to-end neural control or proof that coordination was invented from scratch. Driving, interception, team assignment, support and pass candidates are authored capabilities. Learned preferences can change, but a rise in update count is not evidence of improved strength.

## What the observer actually records

A received pass requires two different same-team physical contacts, under six seconds apart and more than six world units apart. An opponent contact breaks the chain. A recent reception followed by a same-team goal can yield an assist. These are observational definitions; an incidental teammate reception can meet them without a deliberate pass plan.

Fieldnotes shows current team assignment and the actual selected plan. Pass/assist counters are aggregate counts for the current mode, not individual-player statistics. The observer still labels patterns as candidate, recurring or learning-associated. It is read-only and never modifies controls, positions or rewards. Historical motion replays explicitly hide unsaved decision estimates.

## The persistent world

Day/night cycles, gradual rain and wind fronts, moisture-dependent grip and cooling, boost heat, evaporation, finite temperature-sensitive boost resources, physical props and interventions remain active. Goals do not reset the environmental fields. Conway and the separate ecological surface remain available. Ordinary physics remains fixed at 120 Hz in the worker.

## History, saves and migration

A full save uses `touchline-world-v11`. Version-7 full-world files (World 07 through Atelier 10) and earlier supported policy files can be imported. Old 26/52-feature coefficients are padded with zeros, not retrained or fabricated. Physical state is retained when the older file contains it, but future decisions can differ under the new planner. Older releases do not understand the new four-player save. Import deliberately releases held keys and returns manual control to the AI; it does not restore stuck key presses.

Historical comparisons in 2v2 evaluate the current **team** against its archived counterpart across matched seeds, dry/wet conditions and swapped sides. The 16 games are a small descriptive sample, not a general skill certificate. Historical sparring freezes both orange policies while the two blue learners can continue. Returning to live play restores the two orange policies that were kept aside. Saved-moment branches simulate all four agents without altering the live world.

Autosave depends on browser support and permissions. Portable world-file export/import is the reliable explicit backup. The test browser blocks ordinary file/HTTP navigation, so non-opaque-origin autosave/reload could not be verified here.

## Performance and graphics

Automatic rendering retains the existing depth-lit WebGL2 path and cached Canvas fallback. Both have four player models. Shared ball-trajectory queries are cached within each simulation step. Rendering quality never changes the physics timestep or learned state. Follow cameras now cache the entire static arena before transforming it, preventing clipped edges in the lightweight path. Actual measured samples and limitations are in `VERIFICATION.md`.

## Development

Requirements: Node.js 18+ and Python 3. The built `index.html` itself needs nothing.

```sh
npm install          # Prettier only
npm run dev          # rebuild index.html whenever src/ changes; reload the page to see it
npm run build        # one-off build (python build.py)
npm run format       # Prettier over src/, tests/ and tools/
```

### Source layout

| File | Runs in | Role |
|---|---|---|
| `math.js` | both | vectors, quaternions, seeded RNG |
| `weather.js`, `field.js` | worker | day/night and weather fronts; moisture/heat/life grid |
| `physics.js` | worker | `World`: arena, cars, ball, collisions, rewards, events |
| `agents.js` | worker | `Brain` plan scoring + learning, driving controller, 2v2 coordinator |
| `observer.js` | worker | read-only pattern journal and replay clips |
| `state.js`, `evaluation.js`, `runtime.js` | worker | saves, frozen comparisons, the worker message loop |
| `renderer.js`, `renderer-atelier.js` | main | Canvas and WebGL2 renderers (presentation only) |
| `app.js` | main | `App`: worker bridge, UI, input, audio |

`build.py` pastes the worker modules into a `text/plain` script that `App` starts as a Blob Web Worker.

### Tests

```sh
npm test                 # Node engine suites
npm run test:build       # deterministic rebuild + syntax audit
npm run fingerprint      # hash of 90 s of seeded play; compare before/after refactors
```

Browser suites need Playwright in a local virtual environment:

```sh
python -m venv .venv
.venv/Scripts/python -m pip install playwright     # .venv/bin/python on macOS/Linux
.venv/Scripts/python -m playwright install chromium
.venv/Scripts/python tests/doubles-browser.test.py # likewise fieldunit-, world-browser
```

They use Playwright's bundled Chromium unless `CHROMIUM_PATH` is set. Pages are injected rather than navigated. An unavailable WebGL context is reported as skipped, not passed. Suites rewrite their JSON files in `reports/`.

This is an original car-soccer experiment, not Rocket League or an endorsed Rocket League product.
