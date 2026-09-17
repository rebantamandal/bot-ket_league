# 11 - Doubles

- Added optional 2v2: Mica + Slate vs Ember + Sienna, with independent learner state.
- Added team-side scoring, four terminal reward transitions and all six collision pairs.
- Added reach-time coordination, separate support/cover choices and physical pass candidates; expanded residual features from 52 to 64 while preserving old coefficients.
- Added observed teammate receptions and assists; no pass-count reward bonus.
- Extended renderer meshes, cameras, picking, engine audio, Fieldnotes, clips, frozen comparisons, historical opponents and world saves to four players.
- Preserved weather, surfaces, props and finite resources across format changes.
- Fixed Canvas follow-background clipping and replay trail arrays that assumed two players.
- Preserved the v10 Atelier visual design and the default two-car duel.
- Added dedicated team engine, browser and seeded live-play stress tests. See VERIFICATION.md for measured results and explicit coverage gaps.
