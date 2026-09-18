/* Independent online action-value learners over geometric, receding-horizon plans.
   09: opponent-aware interception, lane tests, guarded online residual learning.
   Authored planning prior + learned residual. Motor skills are provided, not claimed
   as invented. Exploration is coherent at plan scale, never random steering jitter. */
(function (root) {
  'use strict';
  const { clamp, wrap, lerp, V, Q, RNG } = TM,
    { X, Z, BR, curvature, flat } = TP;
  // Authored planner and controller constants. tools/ai-tune.cjs searches these by playing the frozen
  // baseline; a page never sets BOTKET_AI_TUNE, so live play always uses AI_DEFAULTS.
  const AI_DEFAULTS = Object.freeze({
    contactBase: 2.95,
    contactMissed: 1.6,
    contactAngle: 0.22,
    contactReady: 0.55,
    contactBlocked: 0.65,
    contactUrgency: 0.65,
    contactDeadline: 1.15,
    clearBase: 1.2,
    clearUrgency: 2.75,
    shadowBase: 0.4,
    shadowUrgency: 1.65,
    shadowGoalSide: 0.7,
    refuelNeed: 1,
    refuelUrgent: 0.8,
    backMin: 1.8,
    backMax: 5.5,
    placement: 0.4,
    strikeSpeed: 22,
    approachCap: 29,
    boostDesired: 28,
    boostAngle: 0.15,
    turnSpeed: 31,
    commitScale: 1
  });
  const tune = () => root.BOTKET_AI_TUNE || AI_DEFAULTS;
  const NF = 64,
    enemy = (w, c) =>
      w.cars.filter(a => a.side !== c.side).sort((a, b) => distance(a, w.ball) - distance(b, w.ball))[0] ||
      w.cars.find(a => a.id !== c.id) ||
      c,
    mate = (w, c) => w.cars.find(a => a.id !== c.id && a.side === c.side),
    // Which goal this car attacks. Team identity is c.side and never changes; the direction flips
    // when the teams change ends, so every geometric use of a side goes through here.
    dir = (w, c) => c.side * (w.ends || 1),
    dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  class Brain {
    constructor(seed = 2718, data = null) {
      this.controllerVersion = 11;
      this.rng = new RNG(seed);
      this.w = new Float64Array(NF);
      this.trace = new Float64Array(NF);
      this.updates = 0;
      this.rewardSum = 0;
      this.lastReward = 0;
      this.lastTD = 0;
      this.weightMotion = 0;
      this.prev = null;
      this.lastPhi = 0;
      this.alternatives = [];
      this.history = [];
      this.lastIntent = 'Approaching the kickoff';
      this.lastReason = 'Finding the earliest reachable contact.';
      this.exploring = false;
      this.planCount = 0;
      this.lastControl = { steer: 0, throttle: 0 };
      this.jumpSchedule = 0;
      this.dodgeReleased = false;
      this.reactWait = null;
      this.flipWait = 0;
      this.flipping = 0;
      this.policyProbe = 0;
      this.migrated = false;
      // Temperament: a small, fixed bias drawn from this car's own seed, so the four cars do not
      // play identically and a match does not settle into one rhythm. Bounded, and the learner
      // adapts on top of it.
      this.temper = data?.temper || {
        aggression: +(0.75 + this.rng.next() * 0.55).toFixed(3),
        patience: +(0.75 + this.rng.next() * 0.55).toFixed(3),
        boostHunger: +(0.7 + this.rng.next() * 0.7).toFixed(3),
        flair: +(0.6 + this.rng.next() * 0.9).toFixed(3)
      };
      if (data) this.load(data);
    }
    clear() {
      this.prev = null;
      this.trace.fill(0);
      this.jumpSchedule = 0;
      this.dodgeReleased = false;
    }
    potential(w, c) {
      const b = w.ball;
      return w.mode === 'doubles'
        ? 0.036 * dir(w, c) * b.x -
            0.012 * Math.min(...w.cars.filter(a => a.side === c.side).map(a => distance(a, b))) +
            0.002 * c.boost
        : 0.036 * dir(w, c) * b.x - 0.012 * distance(c, b) + 0.002 * c.boost;
    }
    value(p) {
      return p.prior + this.correction(p);
    }
    correction(p) {
      return 0.72 * Math.tanh(dot(this.w, p.features) / 0.72);
    }
    travel(c, x, z) {
      const dx = x - c.x,
        dz = z - c.z,
        d = Math.hypot(dx, dz),
        a = Math.abs(wrap(Math.atan2(dz, dx) - c.heading));
      const v = Math.max(0, (c.vx * dx + c.vz * dz) / (d || 1)),
        fast = c.boost > 12 && c.heat < 0.92,
        cap = fast ? 38 : 27,
        accel = (fast ? 22 : 13) * clamp(c.grip || 1, 0.55, 1.1),
        v0 = Math.min(cap, v),
        ad = (cap * cap - v0 * v0) / (2 * accel);
      const t = d < ad ? (Math.sqrt(v0 * v0 + 2 * accel * d) - v0) / accel : (cap - v0) / accel + (d - ad) / cap;
      return t + 0.15 * a + 0.095 * a * a;
    }
    threat(w, c, pred) {
      const b = w.ball,
        o = enemy(w, c),
        s = dir(w, c);
      let deadline = 9,
        crossZ = 0;
      for (const q of pred)
        if (s * q.x < -(X - 0.8) && Math.abs(q.z) < TP.GOAL + 1 && q.y < TP.TOP + 0.6) {
          deadline = q.t;
          crossZ = q.z;
          break;
        }
      const incoming = clamp((-s * b.vx) / 18, 0, 1),
        depth = clamp((-s * b.x + 8) / 48, 0, 1),
        behind = o.side * (w.ends || 1) * (b.x - o.x) > -2;
      const press = w.mode === 'coop' ? 0 : clamp(1 - distance(o, b) / 18, 0, 1) * (behind ? 1 : 0.3) * depth;
      return {
        urgency:
          deadline < 4 ? clamp(1.35 - deadline * 0.15, 0.65, 1) : clamp(incoming * depth * 0.6 + press * 0.65, 0, 0.9),
        deadline,
        crossZ,
        press
      };
    }
    lane(w, c, bp, gx, gz) {
      const dx = gx - bp.x,
        dz = gz - bp.z,
        l = Math.hypot(dx, dz) || 1,
        nx = dx / l,
        nz = dz / l,
        o = enemy(w, c);
      let blocked = 0;
      const bodies = [...(w.mode === 'coop' ? [] : w.cars.filter(a => a.side !== c.side)), ...w.props];
      for (const body of bodies) {
        const along = (body.x - bp.x) * nx + (body.z - bp.z) * nz;
        if (along < 0 || along > l) continue;
        const t = clamp(along / 34, 0, 1.0),
          px = body.x + (body.vx || 0) * t * 0.48,
          pz = body.z + (body.vz || 0) * t * 0.48;
        const perpendicular = Math.abs((px - bp.x) * nz - (pz - bp.z) * nx),
          r = body.id !== undefined ? 3.0 + Math.min(4, t * 5) : body.r + TP.BR;
        blocked = Math.max(blocked, clamp(1 - perpendicular / r, 0, 1));
      }
      return { blocked, nx, nz, length: l };
    }
    learn(reward, next, terminal = false) {
      if (!this.prev) return;
      const p = this.prev,
        td = clamp(reward + (terminal ? 0 : 0.985 * next) - this.value(p), -4, 4),
        norm = 1 + dot(p.features, p.features),
        gradient = 1 - Math.tanh(dot(this.w, p.features) / 0.72) ** 2;
      let motion = 0;
      for (let i = 0; i < NF; i++) {
        this.trace[i] = 0.985 * 0.45 * this.trace[i] + p.features[i] * gradient;
        const old = this.w[i];
        this.w[i] = clamp(this.w[i] + (0.032 * td * this.trace[i]) / norm, -1.8, 1.8);
        motion += Math.abs(this.w[i] - old);
      }
      this.weightMotion += motion;
      this.updates++;
      this.lastTD = td;
      this.lastReward = reward;
      this.rewardSum += reward;
      if (this.updates % 12 === 0) {
        this.history.push({ updates: this.updates, norm: this.norm(), reward: this.rewardSum });
        if (this.history.length > 80) this.history.shift();
      }
      if (terminal) this.clear();
    }
    terminal(w, c) {
      if (w.learning && w.human !== c.id && !w.frozen?.[c.id] && this.prev)
        this.learn(c.reward - this.lastPhi, 0, true);
      else this.clear();
      c.reward = 0;
    }
    norm() {
      return Math.hypot(...this.w);
    }
    environment(w, c, p) {
      const b = w.ball,
        dx = p.x - c.x,
        dz = p.z - c.z,
        d = Math.hypot(dx, dz) || 1;
      let wet = 0,
        heat = 0,
        grip = 0,
        growth = 0,
        minGrip = 1;
      for (let i = 1; i <= 5; i++) {
        const m = w.field.sample(c.x + (dx * i) / 5, c.z + (dz * i) / 5);
        wet += m.wet;
        heat += m.heat;
        grip += m.grip;
        growth += m.growth || 0;
        minGrip = Math.min(minGrip, m.grip);
      }
      const v = flat(c),
        angle = Math.abs(wrap(Math.atan2(dz, dx) - c.heading)),
        braking = (v * v) / (2 * 70 * Math.max(0.45, minGrip * w.grip)),
        crossWind = (-dz * w.weather.windX + dx * w.weather.windZ) / d / 8,
        alongWind = (dx * w.weather.windX + dz * w.weather.windZ) / d / 8;
      return {
        wet: wet / 5,
        heat: heat / 5,
        grip: grip / 5,
        minGrip,
        growth: growth / 5,
        localWet: w.field.sample(c.x, c.z).wet,
        angle,
        brakingDistance: braking,
        brakeRisk: clamp((braking - d * 0.55) / 12, 0, 1),
        crossWind,
        alongWind,
        travel: d / Math.max(10, v * 0.5 + 14),
        windUncertainty: Math.abs(crossWind) * (p.t || 0) * clamp((p.interceptHeight || 0) / 8, 0, 1),
        padCharge: p.padIndex === undefined ? 0 : w.pads[p.padIndex].charge
      };
    }
    features(w, c, p) {
      const b = w.ball,
        o = enemy(w, c),
        d = distance(c, b),
        od = distance(o, b),
        s = dir(w, c),
        angle = wrap(Math.atan2(p.z - c.z, p.x - c.x) - c.heading),
        threat = clamp((-b.vx * s) / 25, 0, 1) * clamp((-b.x * s + 5) / X, 0, 1),
        e = p.environment,
        pace = p.pace || 1,
        brake = p.brakeBias ?? 0.55,
        offset = p.contactOffset || 0,
        commit = p.commitTime || 0.62,
        effort = p.boostBudget || 0.8;
      return Float64Array.from([
        1,
        p.kind === 'contact' ? 1 : 0,
        p.kind === 'space' ? 1 : 0,
        p.kind === 'resource' ? 1 : 0,
        p.kind === 'support' ? 1 : 0,
        clamp(d / 65, 0, 1),
        clamp((od - d) / 30, -1, 1),
        c.boost / 100,
        1 - c.boost / 100,
        Math.abs(angle) / Math.PI,
        Math.sin(angle),
        (s * b.x) / X,
        b.z / Z,
        (s * b.vx) / 40,
        b.vz / 40,
        clamp(b.y / 8, 0, 1),
        p.aim || 0,
        p.power || 0,
        p.wide || 0,
        p.safety || 0,
        p.t || 0,
        threat,
        c.grip,
        p.kind === 'resource' ? 1 - c.boost / 100 : 0,
        p.kind === 'space' ? threat : 0,
        p.kind === 'contact' ? clamp((od - d) / 20, -1, 1) : 0,
        (pace - 1) * 3,
        (brake - 0.55) * 2,
        offset,
        (commit - 0.62) * 3,
        e.wet * pace,
        e.wet * brake,
        (e.wet * Math.abs(angle)) / Math.PI,
        e.wet * (p.kind === 'contact' ? pace : 0),
        e.heat * effort,
        c.heat * effort,
        e.crossWind * (p.t || 0) * clamp((p.interceptHeight || 0) / 8, 0, 1),
        e.alongWind * (p.power || 0),
        e.minGrip * clamp(p.desired / 35, 0, 1),
        e.brakeRisk * brake,
        e.padCharge * (1 - c.boost / 100),
        e.wet - e.localWet,
        (e.heat - 0.1) * (p.kind === 'contact' ? 1 : 0),
        w.weather.rain * effort,
        ((w.weather.temperature - 20) / 15) * effort,
        threat * brake,
        clamp((od - d) / 25, -1, 1) * pace,
        clamp((p.interceptHeight || 0) / 8, 0, 1) * pace,
        e.wet * offset,
        c.grip * (commit - 0.62) * 3,
        (p.wide || 0) * e.wet,
        e.growth * pace,
        ...this.teamFeatures(w, c, p)
      ]);
    }
    teamFeatures(w, c, p) {
      if (w.mode !== 'doubles') return Array(12).fill(0);
      const m = mate(w, c),
        ctx = p.team || this.teamContext(w, c),
        contact = p.kind === 'contact',
        support = p.kind === 'support' || p.kind === 'space',
        pass = p.role === 'pass';
      return [
        pass ? 1 : 0,
        p.role === 'support' ? 1 : 0,
        p.role === 'cover' ? 1 : 0,
        contact * (ctx.primary ? 1 : -1),
        contact * ctx.doubleRisk,
        support * clamp(distance(c, m) / 24, 0, 1),
        pass ? 1 - (p.blocked || 0) : 0,
        pass ? clamp((dir(w, c) * ((p.shotX || 0) - w.ball.x)) / 24, -1, 1) : 0,
        pass ? clamp(p.receiveMargin || 0, -1, 1) : 0,
        support * ctx.urgency,
        contact * (ctx.lastMan ? 1 : 0),
        p.kind === 'resource' ? 1 - m.boost / 100 : 0
      ];
    }
    teamContext(w, c) {
      const m = mate(w, c),
        team = w.teamState?.[c.side] || {},
        primary =
          team.challenger === undefined
            ? this.travel(c, w.ball.x, w.ball.z) <= this.travel(m, w.ball.x, w.ball.z)
            : team.challenger === c.id;
      return {
        mate: m.id,
        primary,
        assignment: team.challenger ?? c.id,
        urgency: team.urgency || 0,
        mateETA: this.travel(m, w.ball.x, w.ball.z),
        doubleRisk: clamp((16 - distance(m, w.ball)) / 14, 0, 1),
        lastMan: dir(w, c) * c.x < dir(w, c) * m.x,
        role: primary ? 'challenge' : team.urgency > 0.3 ? 'cover' : 'support'
      };
    }
    // Aggression from temperament and the scoreboard: a team two goals down commits more, a team
    // two up holds shape. It keeps long sessions from settling into one pattern.
    // Widening this response to a heavier scoreline was tried twice and neither direction survived
    // measurement. Chasing harder from further behind made blowouts clearly worse (3:1-or-worse 2v2
    // sessions went 2/30 -> 7/30): a desperate side concedes faster than it scores. Easing the
    // leader off further was flat over 60 sessions a side (mean goal gap -0.19 +/- 0.80). The band
    // stays where it is.
    drive(w, c) {
      const team = c.side > 0 ? 0 : 1,
        margin = clamp(w.score[team] - w.score[1 - team], -3, 3),
        // A mood for this round, derived from the round number and car rather than drawn, so it
        // varies round to round without disturbing the learner's own random stream.
        seed = Math.sin(w.round * 12.9898 + c.id * 78.233) * 43758.5453,
        mood = 0.85 + 0.32 * (seed - Math.floor(seed));
      return clamp(this.temper.aggression * mood * (1 - margin * 0.09), 0.62, 1.45);
    }
    candidates(w, c) {
      const K = tune(),
        drive = this.drive(w, c),
        temper = this.temper;
      const b = w.ball,
        o = enemy(w, c),
        d = distance(c, b),
        s = dir(w, c),
        pred = w.predictBall(3.0, 0.12),
        plans = [],
        th = this.threat(w, c, pred),
        coop = w.mode === 'coop';
      this.situation = {
        ...th,
        opponentETA: this.travel(o, b.x, b.z),
        ownETA: this.travel(c, b.x, b.z),
        ballSpeed: flat(b)
      };
      const choices = [];
      for (let i = 1; i < pred.length; i++) {
        const q = pred[i];
        if (q.y > 7.6 || Math.abs(q.x) > X + 1.5) continue;
        const eta = this.travel(c, q.x, q.z),
          delay = Math.abs(eta - q.t);
        choices.push({ q, eta, delay, cost: delay + 0.04 * q.t + Math.max(0, q.y - 2.5) * 0.13 });
      }
      choices.sort((a, b) => a.cost - b.cost);
      const samples = choices.slice(0, 4);
      if (!samples.length) samples.push({ q: { ...b, t: 0.3 }, eta: d / 15, delay: 1 });
      // Every opponent between the ball and their goal can cover a shot, so placement scores the
      // worst gap, not just the deepest defender's.
      const defenders = w.cars.filter(a => a.side !== c.side);
      for (const { q, eta } of samples)
        for (const aim of [-1, -0.55, 0, 0.55, 1]) {
          const gx = s * (X + 1.5),
            gz = aim * 6.4,
            ln = this.lane(w, c, q, gx, gz),
            along = (q.x - c.x) * ln.nx + (q.z - c.z) * ln.nz,
            cross = -(q.x - c.x) * ln.nz + (q.z - c.z) * ln.nx,
            alignment = along / (distance(c, q) || 1),
            angle = Math.abs(wrap(Math.atan2(q.z - c.z, q.x - c.x) - c.heading));
          const tx = q.x - ln.nx * 3,
            tz = q.z - ln.nz * 3,
            arrival = alignment > 0.85 ? eta : this.travel(c, tx, tz) + 0.12,
            missed = Math.max(0, arrival - q.t),
            early = Math.max(0, q.t - arrival),
            oppETA = this.travel(o, q.x, q.z),
            contest = clamp((arrival - oppETA) / 1.1, -1, 1),
            ready = clamp((alignment + 0.1) / 1.05, 0, 1),
            safety = clamp((s * (b.x - c.x) + 5) / 12, 0, 1);
          // Shot placement: a corner the keeper cannot cover beats a shot straight at them.
          let placement = 0;
          if (defenders.length) {
            const flight = clamp(Math.hypot(gx - q.x, gz - q.z) / 30, 0.15, 1.2),
              reach = 3.4 + 12 * flight,
              onTarget = clamp((s * (gx - q.x)) / 30, 0, 1);
            let worst = Infinity;
            for (const a of defenders) {
              // Only defenders goal-side of the ball can cut the shot off.
              if (s * (a.x - q.x) < -2) continue;
              worst = Math.min(worst, Math.abs(gz - (a.z + a.vz * flight)));
            }
            if (worst < Infinity) placement = clamp((worst - reach) / 7, -1, 1) * onTarget;
          }
          let prior =
            K.contactBase -
            K.contactMissed * missed -
            0.24 * early -
            K.contactAngle * angle -
            K.contactReady * (1 - ready) -
            K.contactBlocked * ln.blocked -
            0.035 * q.t -
            0.01 * d;
          prior -= Math.max(0, q.y - 2.2) * 0.13 + Math.max(0, contest) * 0.25;
          prior += K.placement * placement * temper.flair;
          prior += (drive - 1) * 0.55;
          prior -= th.urgency * (1 - safety) * K.contactUrgency;
          if (coop && distance(o, b) + 4 < d) prior -= 1.0;
          if (th.deadline < 2.2) prior -= K.contactDeadline;
          if (along < 0) prior -= 0.28;
          plans.push({
            kind: 'contact',
            role: alignment > 0.72 ? 'attack' : 'setup',
            x: tx,
            z: tz,
            ball: { ...q },
            t: q.t,
            aim,
            power: 0.9,
            wide: Math.abs(aim) * 0.4,
            angle: Math.atan2(ln.nz, ln.nx),
            safety,
            prior,
            arrival,
            interceptHeight: q.y,
            desired: 32,
            signature: 'contact:' + aim + ':' + (q.y > 3.4 ? 'air' : 'ground'),
            shotX: gx,
            shotZ: gz,
            blocked: ln.blocked,
            alignment,
            opponentETA: oppETA,
            feasibility: Math.max(0, 1 - missed),
            urgency: th.urgency
          });
        }
      // Active last-man coverage: compare reachable points on the *predicted* threat.
      if (!coop && th.urgency > 0.28) {
        for (const { q, eta } of samples) {
          if (s * q.x > 12) continue;
          const laneSide = b.z >= 0 ? 1 : -1,
            clearX = clamp(q.x + s * 19, -X + 4, X - 4),
            clearZ = laneSide * (Z - 5),
            ln = this.lane(w, c, q, clearX, clearZ),
            alignment = ((q.x - c.x) * ln.nx + (q.z - c.z) * ln.nz) / (distance(c, q) || 1),
            lateness = Math.max(0, eta - q.t);
          const prior =
            K.clearBase +
            K.clearUrgency * th.urgency -
            1.4 * lateness -
            0.18 * Math.max(0, q.y - 2.2) -
            0.4 * Math.max(0, -alignment);
          plans.push({
            kind: 'contact',
            role: 'clear',
            direct: th.deadline < 2.4,
            x: q.x,
            z: q.z,
            ball: { ...q },
            t: q.t,
            aim: laneSide,
            power: 0.82,
            wide: 0.7,
            safety: 1,
            prior,
            arrival: eta,
            interceptHeight: q.y,
            desired: 34,
            signature: 'clear:' + laneSide,
            shotX: clearX,
            shotZ: clearZ,
            blocked: ln.blocked,
            alignment,
            opponentETA: this.travel(o, q.x, q.z),
            urgency: th.urgency,
            feasibility: Math.max(0, 1 - lateness)
          });
        }
      }
      const shadowX = -s * (X - 2.5),
        lineZ = th.deadline < 4 ? th.crossZ : clamp(b.z * 0.43, -TP.GOAL + 1, TP.GOAL - 1);
      for (const alpha of [0, 0.24, 0.48]) {
        const tx = lerp(shadowX, b.x, alpha),
          tz = lerp(lineZ, b.z, alpha),
          cost = distance(c, { x: tx, z: tz }),
          goalSide = clamp((s * (b.x - c.x) + 4) / 13, 0, 1),
          lostRace = clamp((this.travel(c, b.x, b.z) - this.travel(o, b.x, b.z)) / 0.9, 0, 1),
          ownHalf = clamp((-s * b.x + 10) / 30, 0, 1);
        let prior =
          K.shadowBase * temper.patience +
          th.urgency * K.shadowUrgency * temper.patience -
          (drive - 1) * 0.45 +
          lostRace * 0.3 +
          (1 - goalSide) * K.shadowGoalSide +
          ownHalf * 0.2 -
          0.01 * cost -
          alpha * 0.12;
        if (th.deadline < 3) prior += 0.18 - 0.2 * alpha;
        if (coop) prior -= 1;
        plans.push({
          kind: 'space',
          role: 'shadow',
          x: tx,
          z: tz,
          t: 0.7,
          aim: 0,
          power: 0.1,
          wide: Math.abs(tz) / Z,
          safety: 1,
          prior,
          desired: clamp(cost * 2.0, 0, 35),
          signature: 'space:' + alpha,
          urgency: th.urgency
        });
      }
      for (let i = 0; i < w.pads.length; i++) {
        const pad = w.pads[i];
        if (pad.charge < 0.25 || c.boost > 80) continue;
        const desperate = c.boost < 22;
        const cost = distance(c, pad),
          detour = cost + distance(pad, b) - d,
          need = 1 - c.boost / 100,
          goalSide = s * (b.x - pad.x) > 0,
          prior =
            0.3 +
            (pad.big ? 2.3 : 1.3) * need * pad.charge * K.refuelNeed * temper.boostHunger -
            0.027 * cost -
            0.035 * detour -
            th.urgency * (goalSide ? 1.5 : 3) +
            (desperate && pad.big ? K.refuelUrgent : 0);
        if (th.deadline < (desperate && goalSide ? 2 : 3)) continue;
        plans.push({
          kind: 'resource',
          role: 'refuel',
          x: pad.x,
          z: pad.z,
          aim: 0,
          power: 0.2,
          wide: Math.abs(pad.z) / Z,
          safety: goalSide ? 0.8 : 0.2,
          prior,
          desired: 29,
          t: 0.65,
          padIndex: i,
          signature: 'resource:' + i,
          urgency: th.urgency
        });
      }
      if (coop)
        for (const side of [-1, 1]) {
          const tx = clamp(b.x + s * 8, -X + 8, X - 8),
            tz = clamp(b.z + side * 12, -Z + 7, Z - 7);
          plans.push({
            kind: 'support',
            role: 'support',
            x: tx,
            z: tz,
            aim: side,
            power: 0.3,
            wide: 0.8,
            safety: 0.5,
            prior: 1.6 + (distance(o, b) < d ? 0.65 : 0) - 0.012 * distance(c, { x: tx, z: tz }),
            desired: 23,
            t: 1,
            signature: 'support:' + side
          });
        }
      // Doubles: one coordinated challenge and an independent off-ball choice.
      // Assignments are authored geometry, not a claimed learned strategy.
      if (w.mode === 'doubles') {
        const ctx = this.teamContext(w, c),
          m = mate(w, c);
        for (const p of plans) {
          p.team = ctx;
          p.assignment = ctx.assignment;
          if (!ctx.primary && p.kind === 'contact') p.prior -= 2.15 + ctx.doubleRisk * 0.65;
          if (ctx.primary && p.kind === 'space') p.prior -= 0.6;
          if (p.kind === 'resource' && !ctx.primary) p.prior -= ctx.urgency * 1.2;
        }
        if (!ctx.primary) {
          const defending = th.urgency > 0.3 || s * b.x < -15 || s * b.vx < -12;
          for (const flank of [-1, 1]) {
            const tx = clamp(b.x + s * (defending ? -13 : 6), -X + 5, X - 9),
              tz = clamp(b.z * 0.45 + flank * (defending ? 8 : 14), -Z + 5, Z - 5),
              sep = distance(m, { x: tx, z: tz }),
              ln = this.lane(w, c, b, tx, tz);
            const prior =
              3.2 +
              0.55 * th.urgency -
              0.012 * distance(c, { x: tx, z: tz }) -
              0.65 * clamp((11 - sep) / 11, 0, 1) -
              (defending ? 0 : 0.28 * ln.blocked);
            plans.push({
              kind: 'support',
              role: defending ? 'cover' : 'support',
              x: tx,
              z: tz,
              t: 0.65,
              aim: flank,
              power: 0.3,
              wide: Math.abs(tz) / Z,
              safety: defending ? 1 : 0.6,
              prior,
              desired: 28,
              signature: 'team:' + flank + ':' + (defending ? 'cover' : 'receive'),
              team: ctx,
              assignment: ctx.assignment,
              urgency: th.urgency
            });
          }
        }
        if (ctx.primary && th.deadline > 2.4) {
          const q = samples[0].q,
            tx = clamp(m.x + m.vx * 0.35, -X + 4, X - 4),
            tz = clamp(m.z + m.vz * 0.35, -Z + 4, Z - 4),
            len = distance(q, { x: tx, z: tz }),
            progress = s * (tx - q.x),
            ln = this.lane(w, c, q, tx, tz),
            receiverETA = this.travel(m, tx, tz),
            flight = len / 27,
            opposition = Math.min(...w.cars.filter(a => a.side !== c.side).map(a => this.travel(a, tx, tz))),
            receiveMargin = clamp(opposition - receiverETA, -1, 1),
            alignment = ((q.x - c.x) * ln.nx + (q.z - c.z) * ln.nz) / (distance(c, q) || 1),
            shot = this.lane(w, c, q, s * (X + 1), 0);
          if (len > 7 && len < 38 && progress > -4 && progress < 27 && ln.blocked < 0.72 && receiveMargin > -0.15) {
            const arrival = this.travel(c, q.x, q.z),
              prior =
                2.9 +
                0.48 * shot.blocked +
                0.3 * receiveMargin +
                0.008 * progress -
                0.7 * ln.blocked -
                1.5 * Math.max(0, arrival - q.t) -
                0.4 * Math.max(0, 0.75 - alignment) -
                0.2 * th.urgency;
            plans.push({
              kind: 'contact',
              role: 'pass',
              x: q.x - ln.nx * 3,
              z: q.z - ln.nz * 3,
              ball: { ...q },
              t: q.t,
              aim: Math.sign(tz - q.z),
              power: 0.6,
              wide: 0.7,
              safety: 0.6,
              prior,
              arrival,
              desired: 28,
              signature: 'pass:' + m.id,
              shotX: tx,
              shotZ: tz,
              passTo: m.id,
              receiveMargin,
              blocked: ln.blocked,
              alignment,
              opponentETA: opposition,
              interceptHeight: q.y,
              team: ctx,
              assignment: ctx.assignment,
              urgency: th.urgency
            });
          }
        }
      }
      const expanded = [];
      for (const p of plans) {
        p.x = clamp(p.x, -X + 1.4, X - 1.4);
        p.z = clamp(p.z, -Z + 1.4, Z - 1.4);
        p.environment = this.environment(w, c, p);
        const profiles =
          p.kind === 'contact'
            ? [
                {
                  variant: 'patient',
                  pace: 0.88,
                  brakeBias: 0.84,
                  contactOffset: -0.2,
                  commitTime: 0.34,
                  boostBudget: 0.65
                },
                {
                  variant: 'balanced',
                  pace: 1,
                  brakeBias: 0.55,
                  contactOffset: 0,
                  commitTime: 0.38,
                  boostBudget: 0.88
                },
                {
                  variant: 'committed',
                  pace: 1.1,
                  brakeBias: 0.3,
                  contactOffset: 0.2,
                  commitTime: 0.46,
                  boostBudget: 1
                }
              ]
            : [{ variant: 'balanced', pace: 1, brakeBias: 0.6, contactOffset: 0, commitTime: 0.45, boostBudget: 0.8 }];
        for (const profile of profiles) {
          const q = {
            ...p,
            ...profile,
            signature: p.signature + ':' + profile.variant,
            prior:
              p.prior - 0.045 * Math.abs(profile.pace - 1) - 0.17 * p.environment.brakeRisk * (1 - profile.brakeBias)
          };
          // A geometric safety constraint, not a learned trick. Aerial plans too late for a
          // forecast goal and refuelling while the goal is imminently open cannot be selected.
          q.safe = !(th.deadline < 1.5 && q.kind === 'resource');
          if (w.mode === 'doubles' && !q.team?.primary && q.kind === 'contact' && q.team.doubleRisk > 0.55)
            q.safe = false;
          q.features = this.features(w, c, q);
          q.score = this.value(q);
          expanded.push(q);
        }
      }
      return expanded;
    }
    choose(w, c) {
      let candidates = this.candidates(w, c).filter(p => p.safe !== false);
      candidates.sort((a, b) => b.score - a.score);
      if (!candidates.length) {
        c.plan = null;
        c.controller = { steer: 0, throttle: 0, boost: false, jump: false };
        return;
      }
      const phi = this.potential(w, c),
        reward = c.reward + 0.985 * phi - this.lastPhi;
      c.reward = 0;
      if (w.learning && w.human !== c.id && !w.frozen?.[c.id] && this.prev) this.learn(reward, candidates[0].score);
      else if (!w.learning || w.human === c.id || w.frozen?.[c.id]) this.clear();
      this.lastPhi = phi;
      const explore = w.learning && w.human !== c.id && !w.frozen?.[c.id] && (this.situation?.deadline || 9) > 1.6,
        // Bolder cars try a wider spread of alternatives while learning.
        noise = Float64Array.from({ length: NF }, () =>
          explore ? this.rng.normal() * 0.042 * (0.7 + 0.6 * this.temper.flair) : 0
        );
      for (const p of candidates) p.score = this.value(p);
      const top = candidates.reduce((a, b) => (a.score > b.score ? a : b)),
        shortlist = candidates.filter(p => p.score > top.score - 0.5);
      for (const p of shortlist)
        p.sample = p.score + dot(noise, p.features) + (c.plan?.signature === p.signature ? 0.075 : 0);
      shortlist.sort((a, b) => b.sample - a.sample);
      const best = shortlist[0];
      this.exploring = best.signature !== top.signature;
      c.plan = best;
      c.planAge = 0;
      c.decisionAt = w.time;
      this.planCount++;
      this.prev =
        w.learning && w.human !== c.id && !w.frozen?.[c.id] ? { ...best, features: best.features.slice() } : null;
      const seen = new Set();
      this.alternatives = [];
      for (const p of candidates.sort((a, b) => b.score - a.score)) {
        const k = p.kind + ':' + (p.role || '') + ':' + p.aim + ':' + p.variant;
        if (seen.has(k)) continue;
        seen.add(k);
        this.alternatives.push({
          kind: p.kind,
          role: p.role,
          score: p.score,
          prior: p.prior,
          correction: this.correction(p),
          x: p.x,
          z: p.z,
          t: p.t,
          aim: p.aim,
          variant: p.variant,
          pace: p.pace,
          brakeBias: p.brakeBias,
          commitTime: p.commitTime,
          environment: p.environment,
          blocked: p.blocked,
          arrival: p.arrival,
          opponentETA: p.opponentETA,
          feasibility: p.feasibility,
          urgency: p.urgency
        });
        if (this.alternatives.length === 4) break;
      }
      this.referenceFeatures = Array.from(
        candidates.find(p => p.signature !== best.signature)?.features || best.features
      );
      this.policyProbe = this.correction(best);
      this.planEvidence = {
        team: best.team || null,
        passTo: best.passTo,
        receiveMargin: best.receiveMargin,
        role: best.role,
        variant: best.variant,
        pace: best.pace,
        brakeBias: best.brakeBias,
        commitTime: best.commitTime,
        environment: best.environment,
        prior: best.prior,
        learned: this.policyProbe,
        blocked: best.blocked,
        arrival: best.arrival,
        opponentETA: best.opponentETA,
        threat: this.situation?.urgency || 0
      };
      this.ballAtPlan = { x: w.ball.x, z: w.ball.z, vx: w.ball.vx, vz: w.ball.vz, time: w.time };
      this.describe(w, c);
    }
    describe(w, c) {
      const p = c.plan;
      if (!p) return;
      if (this.recoverUntil > w.time) {
        this.lastIntent = 'Backing out of a blocked approach';
        this.lastReason = 'Low movement under throttle triggered a short recovery. No position reset.';
        return;
      }
      if (p.role === 'pass') {
        this.lastIntent = 'Playing toward the teammate';
        this.lastReason =
          'A reachable teammate offers a clearer lane. The pass still has to survive physical contact and interception.';
      } else if (p.role === 'cover') {
        this.lastIntent = 'Covering behind the challenge';
        this.lastReason = 'The teammate takes first contact. Hold a separated, goal-side position for the next threat.';
      } else if (p.role === 'clear') {
        this.lastIntent = 'Closing the dangerous lane';
        this.lastReason = 'The predicted return threatens this goal. Clear wide rather than turn across its face.';
      } else if (p.kind === 'resource') {
        this.lastIntent = 'Refuelling without abandoning the play';
        this.lastReason =
          Math.round(c.boost) + ' boost left; this route balances available charge, detour and goal coverage.';
      } else if (p.kind === 'space') {
        this.lastIntent = 'Staying between ball and goal';
        this.lastReason = 'A direct challenge loses the race. The projected goal-side lane is the safer option.';
      } else if (p.kind === 'support') {
        this.lastIntent = 'Leaving a receiving lane open';
        this.lastReason = 'The teammate reaches the ball first. Keep separation rather than double-commit.';
      } else if (p.role === 'setup') {
        this.lastIntent = 'Getting behind the next touch';
        this.lastReason = 'The current angle is poor. Reposition before applying power.';
      } else if (p.interceptHeight > 3.4) {
        this.lastIntent = 'Meeting the ball in the air';
        this.lastReason =
          'Testing a ' +
          p.interceptHeight.toFixed(1) +
          ' m interception, forecast in ' +
          p.t.toFixed(1) +
          ' s. Reach is estimated, not guaranteed.';
      } else {
        this.lastIntent = p.aim ? 'Aiming beyond the defender' : 'Taking the open shot';
        this.lastReason =
          'Contact in ' +
          p.t.toFixed(1) +
          ' s. ' +
          ((p.blocked || 0) > 0.45 ? 'The defender can contest this lane.' : 'This goal lane has more clearance.') +
          (p.environment.wet > 0.2 ? ' Braking accounts for wet turf.' : '');
      }
    }
    control(w, c, dt) {
      const K = tune(),
        b = w.ball,
        p = c.plan;
      if (!p) return;
      const sp = flat(c),
        s = dir(w, c),
        other = enemy(w, c);
      let tx = p.x,
        tz = p.z,
        desired = p.desired,
        steer = 0,
        throttle = 1,
        boost = false,
        jump = false,
        pitch = 0,
        yaw = 0,
        roll = 0,
        drift = false;
      const d = distance(c, b);
      if (p.kind === 'contact') {
        const remaining = Math.max(0.04, p.t - c.planAge),
          lead = clamp(Math.min(remaining, d / Math.max(16, sp + 6)), 0.03, 0.7);
        // Short prediction follows current momentum; long interception stays anchored to
        // the bounded physics forecast. Contacts and large velocity changes replan early.
        let bx = p.ball.x,
          bz = p.ball.z;
        if (remaining < 0.55 || d < 9) {
          bx = clamp(b.x + b.vx * lead, -X + 0.8, X - 0.8);
          bz = clamp(b.z + b.vz * lead, -Z + 0.8, Z - 0.8);
        }
        const goalAngle = Math.atan2((p.shotZ ?? p.aim * 5.5) - bz, (p.shotX ?? s * X) - bx),
          gx = Math.cos(goalAngle),
          gz = Math.sin(goalAngle),
          dx = bx - c.x,
          dz = bz - c.z,
          along = dx * gx + dz * gz,
          cross = -dx * gz + dz * gx,
          alignment = along / (Math.hypot(dx, dz) || 1),
          back = clamp(d * 0.22, K.backMin, K.backMax) + (p.contactOffset || 0);
        // Two cars arriving at one ball from opposite sides meet nose to nose and both stop dead.
        // No player accepts that trade: they take the ball a little off its centre, so the contact is
        // off the nose and the ball leaves to one side. The offset is perpendicular to our own
        // approach, so two cars closing head-on always part on opposite shoulders.
        let contest = 0;
        if (other) {
          const mineLen = Math.hypot(dx, dz) || 1,
            theirX = b.x - other.x,
            theirZ = b.z - other.z,
            theirLen = Math.hypot(theirX, theirZ) || 1,
            facing = (dx * theirX + dz * theirZ) / (mineLen * theirLen),
            mine = mineLen / Math.max(8, sp + 4),
            them = theirLen / Math.max(8, Math.hypot(other.vx, other.vz) + 4);
          if (facing < -0.7 && Math.abs(mine - them) < 0.3 && mineLen < 30)
            contest =
              (1.3 + 0.5 * this.temper.flair) * clamp(1 - Math.abs(mine - them) / 0.3, 0.35, 1) * (d < 5 ? d / 5 : 1);
        }
        if (p.direct && p.role === 'clear') {
          tx = bx;
          tz = bz;
          desired = 35;
          // Arriving from the goal-facing side would push the ball into our own net. Strike its inner
          // face instead, deflecting it toward the nearest sideline.
          const push = [bx - c.x, bz - c.z],
            pushLength = Math.hypot(push[0], push[1]) || 1;
          if ((s * push[0]) / pushLength < -0.25 && s * bx < -X * 0.45) tz = bz - (Math.sign(bz) || 1) * 2.2;
        } else if (along < 0.2) {
          const sign = cross >= 0 ? -1 : 1;
          if (Math.abs(cross) < 5.3) {
            const forward = Math.max(1.2, -along * 0.3);
            tx = bx + gx * forward - gz * sign * 7.2;
            tz = bz + gz * forward + gx * sign * 7.2;
          } else {
            tx = bx - gx * 5.5 - gz * sign * 5.5;
            tz = bz - gz * 5.5 + gx * sign * 5.5;
          }
          desired = 21;
        } else if (alignment > 0.89 && Math.abs(cross) < 3.0) {
          tx = bx + gx * 2;
          tz = bz + gz * 2;
          desired = clamp(K.strikeSpeed + p.power * 13, K.strikeSpeed, K.strikeSpeed + 14);
        } else {
          tx = bx - gx * back;
          tz = bz - gz * back;
          desired = clamp(13 + along * 0.85, 11, K.approachCap);
        }
        if (contest && !(p.direct && p.role === 'clear')) {
          const len = Math.hypot(dx, dz) || 1;
          tx += (-dz / len) * contest;
          tz += (dx / len) * contest;
        }
        tx = clamp(tx, -X + 0.9, X - 0.9);
        tz = clamp(tz, -Z + 0.9, Z - 0.9);
        const approach = wrap(Math.atan2(bz - c.z, bx - c.x) - c.heading),
          arrival = clamp((d - 2.7) / Math.max(9, sp), 0.04, 0.7),
          futureHeight = Math.max(BR, b.y + b.vy * arrival - 0.5 * w.gravity * arrival * arrival);
        // Jump for a high ball. A short hop covers a bouncing ball nearby; with boost in the tank the
        // car commits earlier and higher and flies to the intercept, the way a player takes an aerial.
        const aerialBall = p.interceptHeight || futureHeight,
          committed =
            aerialBall > 3.2 && aerialBall < 9 && c.boost > 30 && d < 20 && alignment > 0.78 - 0.08 * this.temper.flair,
          hop = futureHeight > 2.25 && futureHeight < 6.5 && d < 10 && d > 3 && arrival < 0.46 && alignment > 0.5;
        if (c.ground && c.jumps === 0 && Math.abs(approach) < (committed ? 0.3 : 0.25) && (hop || committed)) {
          this.jumpSchedule = committed ? 0.26 : 0.18;
          this.dodgeReleased = false;
        }
        if (!c.ground) {
          const aim = [b.x + b.vx * 0.15 - c.x, b.y + b.vy * 0.15 - c.y, b.z + b.vz * 0.15 - c.z],
            local = Q.v(Q.inv(c.q), aim);
          pitch = clamp(Math.atan2(local[1], Math.max(0.1, local[0])) * 2.1, -1, 1);
          yaw = clamp(Math.atan2(local[2], Math.max(0.1, local[0])) * 2, -1, 1);
          const U = Q.v(c.q, [0, 1, 0]);
          roll = clamp(-U[2] * 1.8, -1, 1);
          boost = Math.abs(yaw) < 0.26 && Math.abs(pitch) < 0.55 && d < 22 && b.y > 2.2 && c.boost > 5;
          if (
            c.jumps === 1 &&
            c.jumpTime > 0.24 &&
            d < 3.5 &&
            Math.abs(approach) < 0.2 &&
            b.y < c.y + 1.6 &&
            this.dodgeReleased &&
            alignment > 0.6
          ) {
            jump = true;
            pitch = -1;
            this.dodgeReleased = false;
          }
        }
      } else if (p.kind === 'support' || p.kind === 'space') {
        // A covering player does not park on a spot and sit there facing nowhere. Once in position it
        // keeps trickling around it, staying pointed at the play, so it is already rolling the moment
        // it is needed — a stopped car has to build speed before it can even turn.
        if (Math.hypot(p.x - c.x, p.z - c.z) < 4.5) {
          const face = Math.atan2(b.z - p.z, b.x - p.x);
          tx = p.x + Math.cos(face) * 2.4;
          tz = p.z + Math.sin(face) * 2.4;
        }
      }
      // Do not drive through the ball toward our own goal while rotating back.
      // The route bends around its real collision volume; physics is not modified.
      if (s * (b.x - c.x) < -1.2 && d < 19 && b.y < 3.5) {
        const rx = tx - c.x,
          rz = tz - c.z,
          len2 = rx * rx + rz * rz,
          u = ((b.x - c.x) * rx + (b.z - c.z) * rz) / (len2 || 1),
          nearest = Math.hypot(c.x + rx * u - b.x, c.z + rz * u - b.z);
        if (u > 0 && u < 1.1 && nearest < 4.5) {
          const side = Math.abs(c.z - b.z) > 0.5 ? Math.sign(c.z - b.z) : c.id ? 1 : -1;
          tx = b.x + s * 4;
          tz = clamp(b.z + side * 7, -Z + 2, Z - 2);
          desired = Math.min(desired, 18);
        }
      }
      // Local obstacle deflection. Do not swerve away from an intentional last-second block.
      if (!(p.role === 'clear' && p.direct) && (d > 6 || (w.mode === 'doubles' && p.kind !== 'contact'))) {
        const route = V.norm([tx - c.x, 0, tz - c.z]);
        for (const obstacle of [...w.cars.filter(a => a.id !== c.id), ...w.props]) {
          if (Math.abs(c.y - obstacle.y) > 2) continue;
          const ox = obstacle.x - c.x,
            oz = obstacle.z - c.z,
            front = ox * route[0] + oz * route[2],
            lat = -ox * route[2] + oz * route[0],
            radius = obstacle.id !== undefined ? (obstacle.side === c.side ? 4.3 : 3.2) : obstacle.r + 1.4;
          if (front > 0 && front < 9 && Math.abs(lat) < radius) {
            const away = lat >= 0 ? -1 : 1,
              offset = (1 - front / 9) * (1 - Math.abs(lat) / radius) * 5.0 * away;
            tx -= route[2] * offset;
            tz += route[0] * offset;
          }
        }
      }
      const localTarget = Q.v(Q.inv(c.q), [tx - c.x, TP.CLEAR - c.y, tz - c.z]),
        angle = c.ground
          ? Math.atan2(localTarget[2], localTarget[0])
          : wrap(Math.atan2(tz - c.z, tx - c.x) - c.heading),
        toTarget = Math.hypot(tx - c.x, tz - c.z),
        vf = V.dot([c.vx, c.vy, c.vz], Q.v(c.q, [1, 0, 0]));
      let reverse = false;
      // A target behind the car is reached faster by backing out of it than by swinging a long slow
      // arc, so the reversing envelope is wide and the reverse itself is committed.
      if (Math.abs(angle) > 2.3 && toTarget < 12) {
        reverse = true;
        steer = clamp(-wrap(angle + Math.PI) * 2.5, -1, 1);
        desired = -Math.min(17, toTarget * 3.2);
      } else {
        // Lateral velocity feedback is subordinate to the heading error, avoiding oscillation.
        steer = clamp(angle * 2.65 - c.slip * 0.035, -1, 1);
        // Yaw rate is the product of speed and the curvature table, so it peaks around 14-24 m/s and
        // collapses below 10: crawling into a turn rotates the car more slowly, not faster. Hold the
        // band where the nose comes round quickest and use the handbrake for the tight ones.
        const turnSpeed = clamp(K.turnSpeed / (1 + Math.abs(angle) * 1.6), 13, 35);
        if (Math.abs(angle) > 0.17) desired = Math.min(desired, turnSpeed);
        drift = Math.abs(angle) > 0.95 && sp > 11 && c.ground;
      }
      desired *= p.pace || 1;
      if (Math.abs(angle) > 0.22) desired *= 1 - (1 - clamp(c.grip, 0, 1)) * (p.brakeBias || 0.55) * 0.55;
      if (p.kind === 'space' || p.kind === 'support')
        desired = Math.min(desired, Math.sqrt(2 * 28 * Math.max(0, toTarget - 0.3)));
      if ((p.kind === 'space' || p.kind === 'support') && toTarget < 1.8) desired = Math.max(desired, 4.5);
      // A stopped car cannot turn at all: the nose only comes round while the wheels are moving. So
      // never ask for a standstill with the target off to one side, and keep enough roll through the
      // corner to carry the turn, whichever way the car is pointing.
      if (Math.abs(angle) > 0.45 && toTarget > 2.5) {
        if (reverse) desired = Math.min(desired, -9);
        else desired = Math.max(desired, 9);
      }
      const delta = desired - vf;
      throttle = delta > 1 ? 1 : delta < -1.3 ? -1 : clamp(delta / 2, -0.7, 0.7);
      if (reverse) throttle = vf > desired + 0.8 ? -1 : clamp(delta / 1.2, -1, 0.1);
      if (c.ground)
        boost =
          desired > K.boostDesired &&
          Math.abs(angle) < K.boostAngle &&
          toTarget > 6 &&
          vf > 10 &&
          vf < 41 &&
          c.boost > 5 &&
          p.kind !== 'resource' &&
          c.heat < (p.boostBudget || 0.88) + 0.1;
      // Nobody crosses an empty pitch sitting at throttle. With the road ahead straight and boost
      // worth saving, a player flips forward to carry speed, which is where the loping rhythm of
      // real play comes from. The flip costs half a second of control, so it stays far from the ball.
      if (
        c.ground &&
        c.jumps === 0 &&
        !boost &&
        this.jumpSchedule <= 0 &&
        this.flipWait <= 0 &&
        p.kind !== 'contact' &&
        toTarget > 26 &&
        d > 14 &&
        Math.abs(angle) < 0.1 &&
        vf > 16 &&
        vf < 27 &&
        c.boost < 34
      ) {
        this.jumpSchedule = 0.09;
        this.dodgeReleased = false;
        this.flipWait = 1.3;
        this.flipping = 0.6;
      }
      this.flipWait = Math.max(0, (this.flipWait || 0) - dt);
      this.flipping = Math.max(0, (this.flipping || 0) - dt);
      if (this.jumpSchedule > 0) {
        this.jumpSchedule -= dt;
        jump = true;
      } else if (c.jumps === 1 && c.jumpTime > 0.2) this.dodgeReleased = true;
      if (!c.ground && (p.kind !== 'contact' || b.y < 2 || d > 13)) {
        const F = Q.v(c.q, [1, 0, 0]),
          U = Q.v(c.q, [0, 1, 0]),
          R = Q.v(c.q, [0, 0, 1]);
        pitch = clamp(-F[1] * 2.8, -1, 1);
        roll = clamp(R[1] * 2.8, -1, 1);
        boost = false;
        if (U[1] < 0) roll = R[1] >= 0 ? 1 : -1;
      }
      // Second half of the flip: once the jump has released, throw the nose forward for the speed.
      if (!c.ground && c.jumps === 1 && this.flipping > 0 && this.dodgeReleased && c.jumpTime > 0.16) {
        jump = true;
        pitch = -1;
        roll = 0;
        this.dodgeReleased = false;
        this.flipping = 0;
      }
      // Detect genuine blocked motion. Recover with controls only; never nudge the world.
      if (c.ground && sp < 1.5 && toTarget > 4 && Math.abs(throttle) > 0.6)
        this.blockedFor = (this.blockedFor || 0) + dt;
      else this.blockedFor = 0;
      if (this.blockedFor > 1.1) {
        this.recoverUntil = w.time + 0.65;
        this.recoverDirection = angle >= 0 ? -1 : 1;
        this.blockedFor = 0;
        this.recoveries = (this.recoveries || 0) + 1;
      }
      if (this.recoverUntil > w.time) {
        throttle = -0.8;
        steer = this.recoverDirection;
        boost = false;
        jump = false;
      }
      c.target = { x: tx, z: tz };
      c.controller = { steer, throttle, boost, jump, pitch, yaw, roll, drift };
      if (!this.describeAt || w.time - this.describeAt > 0.25) {
        this.describe(w, c);
        this.describeAt = w.time;
      }
    }
    step(w, c, dt) {
      const v = this.ballAtPlan,
        surprise = v && c.planAge > 0.1 && Math.hypot(w.ball.vx - v.vx, w.ball.vz - v.vz) > 7;
      // A player sees a deflection, then acts on it: about a fifth of a second, not the same frame.
      // Patient cars watch a beat longer. The delay is what makes a scramble look like people
      // reacting rather than instruments, and it costs the car the moment it was already committed.
      const reaction = 0.08 + 0.09 * clamp((this.temper.patience - 0.75) / 0.55, 0, 1);
      let unexpected = false;
      if (surprise) {
        if (this.reactWait === null || this.reactWait === undefined) this.reactWait = reaction;
        this.reactWait -= dt;
        if (this.reactWait <= 0) {
          unexpected = true;
          this.reactWait = null;
        }
      } else this.reactWait = null;
      const expired = c.plan?.kind === 'contact' && c.planAge > Math.max(0.12, c.plan.t * 0.8);
      const rotated =
        w.mode === 'doubles' && c.plan?.assignment !== w.teamState?.[c.side]?.challenger && c.planAge > 0.12;
      if (!c.plan || c.planAge > (c.plan.commitTime || 0.4) * tune().commitScale || unexpected || expired || rotated)
        this.choose(w, c);
      this.control(w, c, dt);
    }
    save() {
      return {
        schema: 2,
        temper: this.temper,
        controllerVersion: 11,
        w: Array.from(this.w),
        updates: this.updates,
        rewardSum: this.rewardSum,
        weightMotion: this.weightMotion,
        planCount: this.planCount,
        rng: this.rng.s,
        history: this.history.slice(-60)
      };
    }
    load(d) {
      if (
        !d ||
        !Array.isArray(d.w) ||
        ![26, 52, NF].includes(d.w.length) ||
        d.w.some(x => !Number.isFinite(x) || Math.abs(x) > 2) ||
        !Number.isSafeInteger(d.updates) ||
        d.updates < 0
      )
        throw Error('Invalid learned policy');
      this.w.fill(0);
      this.w.set(d.w);
      this.migrated = d.w.length !== NF;
      this.updates = d.updates;
      if (d.temper && ['aggression', 'patience', 'boostHunger', 'flair'].every(k => Number.isFinite(d.temper[k])))
        this.temper = { ...d.temper };
      this.rewardSum = Number.isFinite(d.rewardSum) ? d.rewardSum : 0;
      this.weightMotion = d.weightMotion || 0;
      this.planCount = d.planCount || 0;
      this.rng.s = d.rng >>> 0 || 17;
      this.history = (d.history || []).filter(h => Number.isFinite(h.norm)).slice(-60);
      this.clear();
    }
    saveSession() {
      const { rng, w, trace, ...rest } = this;
      return { ...rest, w: Array.from(w), trace: Array.from(trace), rng: rng.s };
    }
    loadSession(d) {
      if (!d || typeof d !== 'object') throw Error('Invalid learner session.');
      d = JSON.parse(JSON.stringify(d));
      for (const key of ['w', 'trace', 'referenceFeatures'])
        if (Array.isArray(d[key]) && [26, 52].includes(d[key].length))
          d[key] = d[key].concat(Array(NF - d[key].length).fill(0));
      if (d.prev?.features && [26, 52].includes(d.prev.features.length))
        d.prev.features = d.prev.features.concat(Array(NF - d.prev.features.length).fill(0));
      const allowed = new Set([
        ...Object.keys(this),
        'referenceFeatures',
        'planEvidence',
        'describeAt',
        'situation',
        'ballAtPlan',
        'recoverUntil',
        'recoverDirection',
        'blockedFor',
        'recoveries'
      ]);
      for (const k of Object.keys(d)) if (!allowed.has(k)) throw Error('Unsupported learner state: ' + k);
      if (
        !Array.isArray(d.trace) ||
        d.trace.length !== NF ||
        d.trace.some(v => !Number.isFinite(v) || Math.abs(v) > 100)
      )
        throw Error('Invalid learning trace.');
      for (const k of [
        'lastPhi',
        'lastReward',
        'lastTD',
        'weightMotion',
        'rewardSum',
        'planCount',
        'jumpSchedule',
        'policyProbe'
      ])
        if (d[k] !== undefined && !Number.isFinite(d[k])) throw Error('Invalid learner value: ' + k);
      if (
        d.prev &&
        (!Array.isArray(d.prev.features) ||
          d.prev.features.length !== NF ||
          d.prev.features.some(v => !Number.isFinite(v) || Math.abs(v) > 20) ||
          !Number.isFinite(d.prev.prior))
      )
        throw Error('Invalid pending learning transition.');
      if (
        d.referenceFeatures &&
        (!Array.isArray(d.referenceFeatures) ||
          d.referenceFeatures.length !== NF ||
          d.referenceFeatures.some(v => !Number.isFinite(v)))
      )
        throw Error('Invalid contrast features.');
      if (
        !Array.isArray(d.alternatives) ||
        d.alternatives.length > 100 ||
        typeof d.lastIntent !== 'string' ||
        typeof d.lastReason !== 'string'
      )
        throw Error('Invalid planner display state.');
      d = JSON.parse(JSON.stringify(d));
      this.load(d);
      const { w, trace, rng, ...rest } = d;
      Object.assign(this, rest);
      this.controllerVersion = 11;
      this.w = Float64Array.from(w);
      this.trace = Float64Array.from(trace);
      this.rng = new RNG(rng);
      if (this.prev?.features) this.prev.features = Float64Array.from(this.prev.features);
    }
  }
  // Shared assignment is derived from observed state every 120 ms with hysteresis.
  // Both learners receive the same assignment; their own tactical scores remain independent.
  root.TTeam = {
    update(w) {
      if (w.time < (w.teamClock || 0)) return;
      w.teamClock = w.time + 0.12;
      const pred = w.predictBall(3, 0.12);
      w.teamState = w.teamState || {};
      for (const side of [1, -1]) {
        const cars = w.cars.filter(c => c.side === side),
          brain = w.brains[cars[0].id];
        if (!brain) continue;
        const th = brain.threat(w, cars[0], pred),
          q =
            th.deadline < 2.5
              ? pred.find(p => p.t >= Math.max(0.12, th.deadline - 0.3)) || pred[0]
              : pred[Math.min(3, pred.length - 1)];
        const ranked = cars
          .map(c => ({
            id: c.id,
            eta:
              brain.travel(c, q.x, q.z) +
              (side * (w.ends || 1) * (w.ball.x - c.x) < -2 ? 0.24 : 0) -
              (w.ball.last === c.id && distance(c, w.ball) < 7 ? 0.16 : 0)
          }))
          .sort((a, b) => a.eta - b.eta || a.id - b.id);
        const old = w.teamState[side],
          incumbent = ranked.find(r => r.id === old?.challenger);
        let chosen = ranked[0];
        if (incumbent && incumbent.eta < chosen.eta + 0.22) chosen = incumbent;
        w.teamState[side] = {
          challenger: chosen.id,
          cover: cars.find(c => c.id !== chosen.id).id,
          urgency: th.urgency,
          deadline: th.deadline,
          assignedAt: old?.challenger === chosen.id ? old.assignedAt : w.time,
          eta: chosen.eta
        };
      }
    }
  };
  root.TBrain = { Brain, NF, AI_DEFAULTS };
  if (typeof module !== 'undefined') module.exports = root.TBrain;
})(globalThis);
