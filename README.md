# Bo-ket League

Four cars teach themselves car-soccer in a world that keeps changing around them: a day/night clock, weather fronts, and turf that wears into mud where they drive.

**[Play it in the browser →](https://rebantamandal.github.io/bot-ket_league/)**

![Live 2v2 play](docs/play.gif)

It is one HTML file. Nothing is fetched, installed or signed into — open the link above, or clone the repo and open `index.html`.

```sh
git clone https://github.com/rebantamandal/bot-ket_league.git
cd bot-ket_league
npm install && npm run dev      # rebuilds index.html whenever src/ changes
```

## The world

Physics run at a fixed 120 Hz inside a Web Worker, so nothing on screen changes what happens on the pitch.

|                                    |                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ![Night rain](docs/night-rain.png) | **Weather.** The sun tracks the world clock: shadows swing round, dusk turns warm, floodlights take over. Rain slants with the wind, cloud shadows drift, flags stream. |
| ![Worn turf](docs/turf-wear.png)   | **Turf wear.** Tyres and boost scuff the grass under both wheel tracks. Nothing places the paths — they appear where the cars drive, and grass regrows in sun and moisture. |
| ![Mud](docs/turf-mud.png)          | **Mud.** Rain turns worn ground to mud, and mud costs grip. The planner weighs grip along its route, so the cars start avoiding the lanes they wore out. |

Underneath that: moisture and heat spread across a 64×40 grid, boost pads recharge slower on hot ground, props get shoved around, and an optional cellular life layer reacts to moisture and tyres.

## The cars

![Fieldnotes](docs/fieldnotes.png)

Each car looks a few hundred milliseconds ahead. It predicts the ball's path, lists candidate plans — strike, clear, shadow the goal, refuel, support, pass — scores them, and drives the winner with a hand-written controller. A small online learner (TD(λ) over 64 features) nudges those scores from experience as it plays.

- **Shots** aim at the part of the goal no defender can cover, using where the defenders will be when the ball arrives.
- **Aerials**: with boost in the tank, a car commits early to a high ball and flies to the intercept.
- **Temperament**: every car carries a fixed bias for aggression, patience, boost appetite and flair, so the four never play alike. It is saved with the policy.
- **Momentum**: a team two goals down commits more, a team two up holds shape, and each round has a mood of its own.
- **2v2**: whoever reaches the ball first challenges, the other covers — and keeps trickling round its post rather than parking, since a stopped car has to build speed before it can even turn.
- **Reactions**: a car sees a deflection and acts on it about a fifth of a second later, not on the same frame. Patient cars watch a beat longer.

Driving, interception and rotation are authored. Learning shifts preference between those plans within bounded limits; it does not invent new skills.

## Watching and poking

![World tab](docs/world-panel.png)

- **Cameras** — overview, per-car, ball cam, free orbit, and a director that cuts to goals and hands the view back.
- **Tools** — drop water, heat, a heavy ball, an impulse or a wind gust anywhere on the pitch; force a storm; scrub the time of day.
- **Fieldnotes** — what each car intends and why, the plans it passed over, its learned weights, and a journal of approaches it keeps repeating.
- **History** — policy snapshots, head-to-head runs over matched seeds, and what-ifs branched from any moment, all in a second worker so live play never stalls.
- **Saves** — the whole world, learners included, exports to a JSON file and restores exactly.

## Controls

| Input                              | Action                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `P` / `Space`                      | Pause and resume                                                                   |
| `1`–`6`                            | Cameras: arena, Mica, Ember, ball, Slate, Sienna                                   |
| `[` `]`                            | Simulation speed, 0.5× to 4×                                                       |
| `I` · `H` · `F`                    | Fieldnotes · focus view · fullscreen                                               |
| Drag the arena                     | Orbit the camera                                                                   |
| WASD / arrows · Shift · Space · Ctrl · Q/E | Drive Mica: steer · boost · jump · powerslide · air roll                   |
| Gamepad                            | Start takes control; stick steers, triggers drive, A jumps, B boosts, X powerslides |

## How it is built

`build.py` inlines `src/` into a single `index.html`: one worker script for the simulation, one page script for the renderers and interface. No assets, no bundler.

| File                                              | Role                                                       |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `src/physics.js`                                  | Arena, cars, ball, collisions, rewards, events              |
| `src/agents.js`                                   | Plans, scoring, learning, driving controller, 2v2 coordinator |
| `src/field.js`, `src/weather.js`                  | Surface moisture, heat, wear and life; clock and weather fronts |
| `src/observer.js`                                 | Read-only pattern journal and replay clips                  |
| `src/state.js`, `src/evaluation.js`, `src/runtime.js` | Saves, frozen comparisons, the worker loop              |
| `src/renderer-atelier.js`                         | WebGL2 scene with a cached Canvas fallback                  |
| `src/app.js`                                      | Worker bridge, interface, input, audio                      |

## Measuring the AI

`npm run ai:bench` plays the current planner against the one in git — every seed twice, sides swapped, learning frozen — and reports goal difference with a 95% interval. Identical planners score exactly level, so a result inside the interval means no measured change.

```sh
npm run ai:bench -- --games 400        # goal difference with a 95% interval
npm run ai:tune                        # search the authored constants against that baseline
```

The last round of work went into how the cars drive rather than how well they score: they hold speed through corners (mean 7.7 → 10.3 m/s while turning), back out of a dead end instead of grinding round it, flip forward on a long run, take a contested ball off-centre rather than meeting nose to nose, and wait a human fifth of a second before reacting to a deflection. Measured against the previous planner over 200 games per mode, that is **+0.04 goals per game in 1v1** (CI −0.18 to 0.26) and **−0.01 in 2v2** (−0.24 to 0.22) — level, which is the point: it costs nothing to watch something that moves like a player.

Earlier ideas fared worse. A full-boost kickoff rush won 204 of 213 kickoffs and *lost* 0.63 goals a game. Back-post rotation and a round of constant tuning measured flat or worse. All three were dropped.

## Development

Node.js 18+ and Python 3, standard library only. The built page needs neither.

```sh
npm run build            # build index.html
npm run format           # Prettier over src/, tests/ and tools/
npm test                 # 52 engine tests
npm run test:build       # deterministic rebuild and syntax audit
npm run fingerprint      # hash 90 s of seeded play; compare before and after a refactor
```

Browser tests drive the built page through Playwright — the real worker, renderer and controls, 186 checks across three suites, including WebGL rendering and recovery from a lost GPU context where a GPU is available.

```sh
python -m venv .venv
.venv/Scripts/python -m pip install playwright        # .venv/bin/python on macOS and Linux
.venv/Scripts/python -m playwright install chromium
.venv/Scripts/python tests/doubles-browser.test.py    # likewise fieldunit- and world-browser
```

## Limits

- The learner only reweights authored plans. This is not end-to-end neural control, and a rising update count is not a stronger car.
- The observer's journal reports matched-context intervals; self-play attempts are not independent experiments.
- Replays store quantised visual samples. Physics, random state and learned values never use that quantisation.
- Autosave depends on browser storage; the exported world file is the reliable backup.

An original car-soccer experiment. Not Rocket League, and not a trained Rocket League bot.
