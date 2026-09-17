# Touchline / 11 - Doubles: verification

Release date: 2026-09-17. Single-file size: **295,661 bytes** (295.7 kB decimal).
HTML SHA-256: `7e075814a84c016feb9f90a09cc14ef1dcd7e6a52e3ce82ae82efe6f8d36d11c`.

## Final results

**387 gameplay, browser and stability checks passed; zero failed.** A further 18 build/source checks passed. These counts refer to the final successful runs, not all development attempts. One optional graphics coverage group (actual WebGL rendering and GPU-context loss) was unavailable on this test host and is explicitly not counted as passed.

| Suite | Passed | Failed |
|---|---:|---:|
| Core mechanics | 34 | 0 |
| Systemic world and saves | 47 | 0 |
| Planner and migration regression | 36 | 0 |
| 2v2 engine and runtime | 52 | 0 |
| 2v2 seeded stability | 32 | 0 |
| General UI and recovery | 49 | 0 |
| 2v2 browser workflows | 71 | 0 |
| Systemic browser workflows | 66 | 0 |

Build checks cover deterministic rebuilding, script syntax, expanded source placeholders and bundled dependencies. Individual assertions and measured data are in the corresponding JSON files in `reports/`.

## What changed and was verified

- Real four-car physics: two cars per side, all six unordered car collision pairs, individual car-ball contacts, team scoring and all four terminal learning transitions.
- Separate policy/trace state for every player; independent updates during ordinary live browser play and deterministic engine runs. Manual Mica control does not stop the other three learners. Freeze and reset apply across the active roster.
- Reach-time coordination, support/cover alternatives, pass candidates aimed toward a teammate, and both opposing defenders in lane tests.
- Pass and assist detection from physical contact histories, with stale touches, very short exchanges, interceptions and own-goal cases tested. Pass counts do not add reward bonuses.
- Mode switching retains the active world environment and each mode's learned policy bank. Separate camera, inspector and journal identities exist for Slate and Sienna.
- Complete four-car save/restore, four-player visual replays, team history sparring, matched frozen-team comparisons and independent four-car counterfactual branches.
- Malformed imports leave the current world unchanged. The actual prior v7 fixture imports with old coefficients preserved and twelve zero-valued additions.
- Mobile/landscape layouts, keyboard focus, manual controls, portable file downloads/imports, procedural audio, frame-limit settings, hidden-document pausing and deliberate worker-failure recovery were exercised.

The `math.js`, `weather.js` and `field.js` modules are **byte-identical to version 10**. Physics, learning, observation, saving, runtime and rendering modules were intentionally extended for the roster. This is not a claim that all source modules or subsequent 1v1 decisions are identical to version 10.

## Seeded 2v2 stress run

Eight fresh zero-weight worlds, three simulated minutes each: **24 aggregate simulated minutes**. Seeds: 1211, 1384, 1557, 1730, 1903, 2076, 2249, 2422. Conditions include clear weather, rain, wind, and rain with the ecological surface plus a heavy physical sphere. Day length was set to three simulated minutes to exercise the cycle.

Observed totals: **764 physical touches, 50 received teammate exchanges, 5 assists and 43 goals**. All four players touched the ball and updated independent policy values in every run. There were **zero sampled non-finite states and zero emergency physics resets**. Numerical snapshots were checked once per simulated second; the engine's emergency-reset counter covers the intervening physics steps.

These are observed events and stability measurements. A received teammate exchange can be incidental; it does not establish intentional passing or independently learned teamwork. No win-rate improvement over a competitive 2v2 baseline is claimed. Frozen identical-policy evaluation in the engine suite tests reproducibility and team routing, not playing strength.

## Ordinary browser playback

Headless Chromium, 1440 x 900 CSS viewport, device scale factor 1, actual **Canvas / Atelier** renderer and separate simulation worker. Each sample follows a two-second settling period and runs seven seconds at normal playback speed with four online learners. No concurrent comparison, benchmark or stress job was running.

| 2v2 sample | Presented fps | Simulation/wall-time pace | Updates: Mica, Ember, Slate, Sienna |
|---|---:|---:|---|
| daylight overview | 59.0 | 1.001x | 23, 26, 22, 22 |
| rainy night overview | 59.3 | 0.997x | 20, 19, 19, 20 |
| rainy night follow Slate | 34.1 | 0.998x | 18, 20, 24, 18 |

The overview samples were near 59 fps. Rainy follow view remained materially heavier at about 34 fps on this software-rendering host. All four learners continued updating at near real-time simulation pace. These short measurements are not guarantees for a user's machine, and they are not native gaming-GPU benchmarks. Low-power 30-fps presentation remains available without changing the physical timestep.

## Coverage limits

**Actual WebGL rendering is unverified in this environment.** A bare WebGL2 context returned null, including explicit SwiftShader settings. The optional native-rendering/context-loss group is recorded under `skipped` in the browser report. We did verify that requesting unavailable WebGL safely selects the lightweight four-car renderer, and that explicitly switching to that renderer leaves physical and learned state intact. Shader-array/body counts were updated in source, but source inspection is not a GPU execution test.

Managed-browser policy blocks normal file/HTTP navigation. Browser tests inject the actual built document and execute its real Blob worker, controls and renderer. Portable JSON downloads and imports were exercised. Non-opaque-origin IndexedDB autosave/reload and unrestricted fullscreen could not be verified here. A prior real saved payload was used when testing deliberately injected worker failure; that test does not prove immunity from crashes.

Replays store quantised visual samples; the physics, random states and policy/trace values do not use that quantisation. Exact continuation tests compare actual physical and learned state, not bit-identical rendered pixels. Import deliberately releases manual keys and returns control to the AI.

## Development issues found and fixed

The first four-player replay check exposed trail arrays that still assumed two players. Those reset paths now retain all four slots and defensively initialise each trail. Follow-camera captures also exposed incomplete static-cache coverage at the field boundary; the cache now contains the full arena before it is transformed for the follow view. Final browser runs completed without page exceptions.

## Reproduce

```sh
python3 build.py
npm test
npm run test:browser
npm run test:stress
npm run test:performance
python3 tests/build-audit.py
npm run previews
```

Tests use Node.js or Python Playwright with Chromium, but the built game itself has no installation requirements or network dependencies. See README.md for the learning scope and controls.
