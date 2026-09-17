/* TOUCHLINE 03. Fixed 120 Hz, oriented contacts, traction and airborne rotation.
   Arcade scale. Driving constants informed by RLBot measurements, not a replica. */
(function (root) {
  'use strict';
  const { clamp, lerp, wrap, V, Q, RNG } = TM;
  const X = 44,
    Z = 28,
    HEIGHT = 22,
    GOAL = 8.5,
    TOP = 6.8,
    BR = 1.25,
    DT = 1 / 120,
    CLEAR = 0.53;
  const speed = c => Math.hypot(c.vx, c.vy, c.vz),
    flat = c => Math.hypot(c.vx, c.vz);
  function boundary(x, z, y = 0) {
    const mouth = Math.abs(z) < GOAL && y < TOP;
    let nx = 0,
      nz = -Math.sign(z || 1),
      d = Z - Math.abs(z);
    const dx = (mouth ? X + 6 : X) - Math.abs(x);
    if (dx < d) {
      d = dx;
      nx = -Math.sign(x || 1);
      nz = 0;
    }
    const cx = Math.max(0, Math.abs(x) - (X - 8)),
      cz = Math.max(0, Math.abs(z) - (Z - 8));
    if (cx > 0 && cz > 0) {
      const l = Math.hypot(cx, cz),
        cd = 8 - l;
      if (cd < d) {
        d = cd;
        nx = (-Math.sign(x) * cx) / l;
        nz = (-Math.sign(z) * cz) / l;
      }
    }
    return { d, n: [nx, 0, nz] };
  }
  function surface(x, y, z) {
    const b = boundary(x, z, y);
    let d = y,
      n = [0, 1, 0];
    if (b.d < 5 && y < 5) {
      const u = 5 - b.d,
        dy = y - 5,
        r = Math.hypot(u, dy) || 1;
      d = 5 - r;
      n = [(b.n[0] * u) / r, -dy / r, (b.n[2] * u) / r];
    } else if (b.d < d) {
      d = b.d;
      n = b.n;
    }
    if (HEIGHT - y < d) {
      d = HEIGHT - y;
      n = [0, -1, 0];
    }
    return { d, n };
  }
  function curvature(s) {
    const v = Math.abs(s) * 50;
    let k =
      v < 500
        ? 0.0069 - 0.00000584 * v
        : v < 1000
          ? 0.00561 - 0.00000326 * v
          : v < 1500
            ? 0.0043 - 0.00000195 * v
            : v < 1750
              ? 0.003025 - 0.0000011 * v
              : 0.0018 - 0.0000004 * v;
    return Math.max(0.0008, k) * 50;
  }
  function car(id, side = 1) {
    return {
      id,
      side,
      x: side * -24,
      y: CLEAR,
      z: id ? 4.6 : -4.6,
      vx: 0,
      vy: 0,
      vz: 0,
      q: Q.axis([0, 1, 0], side > 0 ? 0 : -Math.PI),
      omega: [0, 0, 0],
      ground: true,
      normal: [0, 1, 0],
      heading: side > 0 ? 0 : Math.PI,
      boost: 65,
      heat: 0,
      boosting: false,
      steer: 0,
      throttle: 0,
      drift: false,
      jump: false,
      jumpWas: false,
      jumpTime: 10,
      jumps: 0,
      jumpHold: 0,
      jumpNormal: [0, 1, 0],
      flipTime: 0,
      flipAxis: [0, 0, 1],
      lastTouch: -100,
      touches: 0,
      airTouches: 0,
      reward: 0,
      plan: null,
      planAge: 10,
      decisionAt: 0,
      controller: { steer: 0, throttle: 0, boost: false, jump: false, pitch: 0, yaw: 0, roll: 0, drift: false },
      target: { x: 0, z: 0 },
      wheelSpin: 0,
      slip: 0,
      landing: 0,
      stuck: 0,
      grip: 1,
      speed: 0,
      distance: 0,
      lastX: 0,
      lastZ: 0
    };
  }
  function sphere(x = 0, y = BR, z = 0, r = BR, mass = 30) {
    return {
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      r,
      mass,
      q: Q.id(),
      w: [0, 0, 0],
      last: -1,
      lastTime: -100,
      wallTime: -100,
      prevTouch: null
    };
  }
  const count = mode => (mode === 'doubles' ? 4 : 2),
    sideFor = (id, mode) => (mode === 'coop' ? 1 : id % 2 === 0 ? 1 : -1);
  class World {
    constructor(o = {}) {
      this.rng = new RNG(o.seed || 118602);
      this.time = 0;
      this.matchTime = 0;
      this.round = 1;
      this.score = [0, 0];
      this.mode = o.mode || 'duel';
      this.learning = true;
      this.human = -1;
      this.manual = {};
      this.gravity = 13;
      this.grip = 1;
      this.bounce = 0.64;
      this.weather = new TWeather((o.seed || 118602) ^ 0x426e);
      this.field = new TField(this.rng);
      this.frozen = Array(count(this.mode)).fill(false);
      this.teamState = {};
      this.teamClock = 0;
      this.visualCache = null;
      this.visualAt = -1;
      this.events = [];
      this.listeners = [];
      this.props = [];
      this.goalPause = 0;
      this.kickoffTime = 1.2;
      this.roundTime = 0;
      this.stats = {
        touches: 0,
        goals: 0,
        air: 0,
        saves: 0,
        passes: 0,
        bumps: 0,
        dodges: 0,
        wallTouches: 0,
        safetyResets: 0,
        assists: 0,
        teamBumps: 0
      };
      this.cars = Array.from({ length: count(this.mode) }, (_, i) => car(i, sideFor(i, this.mode)));
      this.ball = sphere();
      this.pads = [];
      for (const x of [-34, 0, 34]) for (const z of [-20, 20]) this.pads.push({ x, z, big: true, timer: 0, charge: 1 });
      for (const x of [-24, -12, 0, 12, 24])
        for (const z of [-10, 10]) this.pads.push({ x, z, big: false, timer: 0, charge: 1 });
      this.brains = [];
      this.lastBump = -100;
      this.observer = null;
      this.resetPositions(false);
    }
    emit(type, id, data = {}) {
      const e = { type, id, time: this.time, round: this.round, ...data };
      this.events.push(e);
      if (this.events.length > 160) this.events.shift();
      for (const f of this.listeners) f(e);
      return e;
    }
    resetPositions(increment = true) {
      if (increment) this.round++;
      this.roundTime = 0;
      this.goalPause = 0;
      this.kickoffTime = 1.0;
      const z = this.rng.range(-0.5, 0.5);
      this.ball = sphere(0, BR + 0.02, z);
      this.cars.length = count(this.mode);
      this.teamState = {};
      this.teamClock = 0;
      for (let i = 0; i < count(this.mode); i++) {
        const side = sideFor(i, this.mode),
          c = car(i, side);
        if (this.mode === 'doubles') {
          const lead = i >> 1 === this.round % 2;
          c.x = -side * (lead ? 24 : 34);
          c.z = side * (lead ? -8 : 10);
          c.q = Q.axis([0, 1, 0], -Math.atan2(-c.z, -c.x));
          c.heading = Math.atan2(-c.z, -c.x);
        } else if (this.mode === 'coop') {
          c.x = -25 + i * 8;
          c.z = i ? 7 : -7;
        } else {
          c.z = (i ? 1 : -1) * (this.round % 2 ? 4.6 : 10.0);
          c.q = Q.axis([0, 1, 0], -Math.atan2(-c.z, -c.x));
          c.heading = Math.atan2(-c.z, -c.x);
        }
        const prev = this.cars[i];
        if (prev) {
          c.boost = prev.boost;
          c.heat = prev.heat;
          c.distance = prev.distance;
          c.touches = prev.touches;
          c.airTouches = prev.airTouches;
        }
        this.cars[i] = c;
        if (this.brains[i]) this.brains[i].clear();
      }
      /* Resource charge, surface state and engine heat survive kickoffs. */ this.observer?.resetSegment();
      this.emit('kickoff', -1);
    }
    ballIntegrate(b, dt, record = true) {
      b.vy -= this.gravity * dt;
      const wind = this.weather,
        air = clamp((b.y - b.r) / 2, 0, 1),
        coupling = ((0.18 * 30) / b.mass) * air;
      if (wind) {
        b.vx += wind.windX * coupling * dt;
        b.vz += wind.windZ * coupling * dt;
      }
      const drag = Math.exp(-0.031 * dt);
      b.vx *= drag;
      b.vy *= drag;
      b.vz *= drag;
      const magnus = V.mul(V.cross(b.w, [b.vx, b.vy, b.vz]), 0.003 * dt);
      b.vx += magnus[0];
      b.vy += magnus[1];
      b.vz += magnus[2];
      const sp = speed(b);
      if (sp > 62) {
        b.vx *= 62 / sp;
        b.vy *= 62 / sp;
        b.vz *= 62 / sp;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      let s = surface(b.x, b.y, b.z);
      if (s.d < b.r) {
        const p = b.r - s.d;
        b.x += s.n[0] * p;
        b.y += s.n[1] * p;
        b.z += s.n[2] * p;
        const vn = b.vx * s.n[0] + b.vy * s.n[1] + b.vz * s.n[2];
        if (vn < 0) {
          const rest = Math.abs(vn) < 0.6 && s.n[1] > 0.95 ? 0 : this.bounce;
          b.vx -= (1 + rest) * vn * s.n[0];
          b.vy -= (1 + rest) * vn * s.n[1];
          b.vz -= (1 + rest) * vn * s.n[2];
          if (record && b === this.ball && Math.abs(s.n[1]) < 0.88 && this.time - b.wallTime > 0.18) {
            b.wallTime = this.time;
            this.emit('wall', b.last, { x: b.x, y: b.y, z: b.z });
          }
        }
        if (s.n[1] > 0.94) {
          const d = Math.exp(-0.18 * dt * (1 - 0.5 * this.field.sample(b.x, b.z).wet));
          b.vx *= d;
          b.vz *= d;
          b.w[0] = lerp(b.w[0], b.vz / b.r, dt * 3);
          b.w[2] = lerp(b.w[2], -b.vx / b.r, dt * 3);
        }
      }
      // The recessed goal has real side/back/roof contacts, not an invisible scoring trigger.
      if (Math.abs(b.x) > X - 0.2) {
        if (Math.abs(b.z) > GOAL - b.r && Math.abs(b.z) < GOAL + 2 && b.y < TOP) {
          const nx = Math.abs(b.x) < X ? -Math.sign(b.x) : 0,
            nz = Math.abs(b.x) >= X ? -Math.sign(b.z) : 0;
          this.capsule(b, Math.sign(b.x) * X, clamp(b.y, 0, TOP), Math.sign(b.z) * GOAL, 0.12);
        }
        for (const sz of [-1, 1]) this.capsule(b, Math.sign(b.x) * X, clamp(b.y, 0, TOP), sz * GOAL, 0.14);
        this.capsule(b, Math.sign(b.x) * X, TOP, clamp(b.z, -GOAL, GOAL), 0.14);
        if (Math.abs(b.x) > X + 0.2 && Math.abs(b.z) < GOAL) {
          if (Math.abs(b.z) > GOAL - b.r) {
            b.z = Math.sign(b.z) * (GOAL - b.r);
            b.vz *= -this.bounce;
          }
          if (b.y > TOP - b.r) {
            b.y = TOP - b.r;
            b.vy = -Math.abs(b.vy) * this.bounce;
          }
        }
      }
      const ws = Math.hypot(...b.w);
      if (ws > 0) b.q = Q.norm(Q.mul(Q.axis(V.mul(b.w, 1 / ws), ws * dt), b.q));
      b.w = b.w.map(v => v * Math.exp(-0.12 * dt));
    }
    capsule(b, x, y, z, r) {
      let d = [b.x - x, b.y - y, b.z - z],
        l = Math.hypot(...d),
        sum = b.r + r;
      if (l >= sum || l < 0.0001) return;
      d = V.mul(d, 1 / l);
      const p = sum - l;
      b.x += d[0] * p;
      b.y += d[1] * p;
      b.z += d[2] * p;
      const vn = V.dot([b.vx, b.vy, b.vz], d);
      if (vn < 0) {
        b.vx -= 1.64 * vn * d[0];
        b.vy -= 1.64 * vn * d[1];
        b.vz -= 1.64 * vn * d[2];
      }
    }
    drive(c, dt) {
      const ctl =
        c.id === this.human
          ? {
              throttle: (this.manual.forward ? 1 : 0) - (this.manual.reverse ? 1 : 0),
              steer: (this.manual.right ? 1 : 0) - (this.manual.left ? 1 : 0),
              boost: !!this.manual.boost,
              jump: !!this.manual.jump,
              pitch: (this.manual.reverse ? 1 : 0) - (this.manual.forward ? 1 : 0),
              yaw: (this.manual.right ? 1 : 0) - (this.manual.left ? 1 : 0),
              roll: (this.manual.rollRight ? 1 : 0) - (this.manual.rollLeft ? 1 : 0),
              drift: !!this.manual.drift
            }
          : c.controller;
      c.applied = ctl;
      c.drift = !!ctl.drift;
      c.steer = lerp(c.steer, ctl.steer, 1 - Math.exp(-dt * 14));
      c.throttle = ctl.throttle;
      c.landing *= Math.exp(-12 * dt);
      const mat = this.field.sample(c.x, c.z);
      c.grip = mat.grip * this.grip;
      const oldGround = c.ground;
      let F = Q.v(c.q, [1, 0, 0]),
        U = Q.v(c.q, [0, 1, 0]),
        R = Q.v(c.q, [0, 0, 1]);
      let surf = surface(c.x, c.y, c.z),
        vel = [c.vx, c.vy, c.vz];
      const vn = V.dot(vel, surf.n);
      c.ground = surf.d < CLEAR + 0.16 && V.dot(U, surf.n) > 0.5 && vn < 2.0 && c.jumpTime > 0.2;
      c.jumpTime += dt;
      if (c.ground) {
        c.normal = surf.n;
        const adj = CLEAR - surf.d;
        c.x += surf.n[0] * adj;
        c.y += surf.n[1] * adj;
        c.z += surf.n[2] * adj;
        F = V.norm(V.sub(F, V.mul(surf.n, V.dot(F, surf.n))));
        let vf = V.dot(vel, F);
        const yaw = c.steer * vf * curvature(vf) * clamp(c.grip, 0.55, 1.15) * (ctl.drift ? 1.4 : 1);
        F = Q.v(Q.axis(surf.n, -yaw * dt), F);
        c.q = Q.basis(F, surf.n);
        R = V.norm(V.cross(F, surf.n));
        U = surf.n;
        vf = V.dot(vel, F);
        let lat = V.dot(vel, R);
        c.slip = lat;
        const tire = ctl.drift ? 2.0 : 18 * c.grip;
        lat *= Math.exp(-tire * dt);
        let throttle = ctl.boost && c.boost > 0 ? 1 : ctl.throttle;
        let acceleration = 0;
        if (vf * throttle < -0.15) acceleration = 70 * throttle;
        else if (Math.abs(throttle) > 0.02) {
          const av = Math.abs(vf),
            max = throttle < 0 ? 22 : 28.2;
          acceleration =
            av >= max
              ? 0
              : (av < 28 ? 32 - 1.029 * av : (3.2 * (28.2 - av)) / 0.2) * throttle * clamp(c.grip, 0.7, 1.1);
        } else {
          acceleration = -Math.sign(vf) * Math.min(Math.abs(vf) / dt, 10.5);
        }
        vf += acceleration * dt;
        vel = V.add(V.mul(F, vf), V.mul(R, lat));
        c.jumps = 0;
        c.omega = [0, 0, 0];
        if (!oldGround) {
          c.landing = clamp(Math.abs(vn) / 15, 0.08, 0.45);
          if (Math.abs(vn) > 3) this.emit('land', c.id, { x: c.x, y: c.y, z: c.z, speed: Math.abs(vn) });
        }
      }
      const pressed = ctl.jump && !c.jumpWas;
      if (pressed) {
        if (c.ground) {
          vel = V.add(vel, V.mul(U, 5.84));
          c.ground = false;
          c.jumps = 1;
          c.jumpTime = 0;
          c.jumpHold = 0;
          c.jumpNormal = U.slice();
          c.y += 0.04;
          this.emit('jump', c.id);
        } else if (c.jumps === 1 && c.jumpTime < 1.45) {
          const directional = Math.hypot(ctl.pitch || 0, ctl.steer || 0) > 0.3;
          c.jumps = 2;
          if (directional) {
            const dx = -(ctl.pitch || 0),
              dz = ctl.steer || 0,
              d = V.norm([dx, 0, dz]);
            vel = V.add(vel, V.mul(Q.v(c.q, d), 10.5));
            c.flipAxis = V.norm([d[2], 0, -d[0]]);
            c.flipTime = 0.58;
            c.omega = V.mul(c.flipAxis, 10.8);
            this.stats.dodges++;
            this.emit('dodge', c.id, { x: c.x, y: c.y, z: c.z });
          } else vel = V.add(vel, V.mul(U, 5.84));
        }
      }
      c.jumpWas = !!ctl.jump;
      if (!c.ground && c.jumps === 1 && c.jumpTime < 0.2 && (ctl.jump || c.jumpTime < 0.025)) {
        vel = V.add(vel, V.mul(c.jumpNormal, 29.2 * dt));
        c.jumpHold += dt;
      }
      c.boosting = !!ctl.boost && c.boost > 0;
      c.boost = clamp(c.boost - (c.boosting ? 33.3 * dt : 0), 0, 100);
      c.heat = clamp(
        c.heat +
          dt *
            ((c.boosting ? 0.25 : 0) -
              0.074 -
              0.15 * mat.wet -
              0.002 * flat(c) -
              0.0018 * (26 - this.weather.temperature)),
        0,
        1
      );
      if (c.boosting) {
        vel = V.add(vel, V.mul(F, (c.ground ? 19.83 : 21.17) * (1 - 0.28 * c.heat * c.heat) * dt));
        if (this.time % 0.08 < dt) this.field.paint(c.x - F[0] * 1.8, c.z - F[2] * 1.8, 'heat', 0.045, 2);
      }
      if (c.ground && flat(c) > 2) this.field.disturb(c.x, c.z);
      if (!c.ground) {
        vel[0] += this.weather.windX * 0.023 * dt;
        vel[2] += this.weather.windZ * 0.023 * dt;
        if (c.flipTime > 0) {
          c.flipTime -= dt;
          if (c.flipTime < 0.03) c.omega = c.omega.map(v => v * 0.85);
        } else {
          const target = [(ctl.roll || 0) * 4.5, -(ctl.yaw || ctl.steer || 0) * 3.5, (ctl.pitch || 0) * 4.2];
          c.omega = c.omega.map((v, i) => lerp(v, target[i], 1 - Math.exp(-dt * 5)));
        }
        const om = Math.hypot(...c.omega);
        if (om > 1e-6) c.q = Q.norm(Q.mul(c.q, Q.axis(V.mul(c.omega, 1 / om), om * dt)));
        vel = V.add(vel, V.mul(F, 1.333 * ctl.throttle * dt));
      }
      const gravity = [0, -this.gravity, 0];
      vel = V.add(vel, V.mul(c.ground ? V.sub(gravity, V.mul(U, V.dot(gravity, U))) : gravity, dt));
      const sp = Math.hypot(...vel);
      if (sp > 46) vel = V.mul(vel, 46 / sp);
      c.vx = vel[0];
      c.vy = vel[1];
      c.vz = vel[2];
      c.lastX = c.x;
      c.lastZ = c.z;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      surf = surface(c.x, c.y, c.z);
      U = Q.v(c.q, [0, 1, 0]);
      F = Q.v(c.q, [1, 0, 0]);
      R = Q.v(c.q, [0, 0, 1]);
      const extent = c.ground
        ? CLEAR
        : Math.abs(V.dot(F, surf.n)) * 1.6 + Math.abs(V.dot(U, surf.n)) * 0.43 + Math.abs(V.dot(R, surf.n)) * 0.92;
      if (surf.d < extent) {
        const pen = Math.min(2, extent - surf.d);
        c.x += surf.n[0] * pen;
        c.y += surf.n[1] * pen;
        c.z += surf.n[2] * pen;
        const vn2 = V.dot([c.vx, c.vy, c.vz], surf.n);
        if (vn2 < 0) {
          const rest = c.ground ? 1 : 1.12;
          c.vx -= vn2 * surf.n[0] * rest;
          c.vy -= vn2 * surf.n[1] * rest;
          c.vz -= vn2 * surf.n[2] * rest;
        }
      }
      if (Math.abs(c.x) > X - 0.4 && Math.abs(c.z) < GOAL + 1.5) {
        for (const zz of [-GOAL, GOAL]) {
          const dx = c.x - Math.sign(c.x) * X,
            dz = c.z - zz,
            d = Math.hypot(dx, dz);
          if (d < 1.2 && c.y < TOP && d > 0.001) {
            c.x += (dx / d) * (1.2 - d);
            c.z += (dz / d) * (1.2 - d);
          }
        }
        if (Math.abs(c.x) > X + 0.5 && c.y > TOP - 0.6) {
          c.y = TOP - 0.6;
          c.vy = -Math.abs(c.vy) * 0.1;
        }
      }
      const f = Q.v(c.q, [1, 0, 0]);
      c.heading = Math.atan2(f[2], f[0]);
      c.speed = speed(c);
      c.distance += c.speed * dt;
      c.wheelSpin += (V.dot([c.vx, c.vy, c.vz], f) * dt) / 0.43;
      c.drift = ctl.drift;
      for (const p of this.pads)
        if (
          p.charge >= (p.big ? 0.18 : 0.4) &&
          c.boost < 99 &&
          c.y < 1.7 &&
          Math.hypot(c.x - p.x, c.z - p.z) < (p.big ? 1.9 : 1.15)
        ) {
          const cap = p.big ? 100 : 12,
            gained = Math.min(100 - c.boost, cap * p.charge);
          c.boost += gained;
          p.charge = clamp(p.charge - gained / cap, 0, 1);
          p.timer = (1 - p.charge) * (p.big ? 10 : 4);
          this.emit('pad', c.id, { x: p.x, z: p.z, big: p.big, gained });
        }
    }
    hit(c, b) {
      const worldD = [b.x - c.x, b.y - c.y, b.z - c.z],
        local = Q.v(Q.inv(c.q), worldD),
        half = [1.66, 0.45, 0.94],
        p = local.map((v, i) => clamp(v, -half[i], half[i]));
      let n = V.sub(local, p),
        len = Math.hypot(...n);
      if (len >= b.r) return;
      if (len < 1e-5) {
        let ax = 0,
          gap = Infinity;
        for (let i = 0; i < 3; i++)
          if (half[i] - Math.abs(local[i]) < gap) {
            gap = half[i] - Math.abs(local[i]);
            ax = i;
          }
        n = [0, 0, 0];
        n[ax] = Math.sign(local[ax]) || 1;
        len = -gap;
      } else n = V.mul(n, 1 / len);
      n = Q.v(c.q, n);
      const pen = b.r - len;
      b.x += n[0] * pen * 0.87;
      b.y += n[1] * pen * 0.87;
      b.z += n[2] * pen * 0.87;
      c.x -= n[0] * pen * 0.13;
      c.y -= n[1] * pen * 0.13;
      c.z -= n[2] * pen * 0.13;
      const rv = [b.vx - c.vx, b.vy - c.vy, b.vz - c.vz],
        vn = V.dot(rv, n);
      if (vn >= -0.1) return;
      const before = [b.vx, b.vy, b.vz];
      const impulse = (-(1 + 0.7) * vn) / (1 / 180 + 1 / b.mass);
      b.vx += (impulse * n[0]) / b.mass;
      b.vy += (impulse * n[1]) / b.mass;
      b.vz += (impulse * n[2]) / b.mass;
      c.vx -= (impulse * n[0]) / 180;
      c.vy -= (impulse * n[1]) / 180;
      c.vz -= (impulse * n[2]) / 180;
      const tang = V.sub(rv, V.mul(n, vn));
      b.vx -= tang[0] * 0.11;
      b.vy -= tang[1] * 0.11;
      b.vz -= tang[2] * 0.11;
      b.w = V.add(b.w, V.mul(V.cross(n, tang), -0.16 / b.r));
      if (b === this.ball && this.time - c.lastTouch > 0.23) {
        const old = b.last,
          oldTime = b.lastTime,
          oldTouch = b.prevTouch;
        c.lastTouch = this.time;
        c.touches++;
        this.stats.touches++;
        b.last = c.id;
        b.lastTime = this.time;
        const air = !c.ground && c.y > 1.2,
          wall = c.y > 2.5 && Math.abs(c.normal[1]) < 0.85;
        if (air) {
          c.airTouches++;
          this.stats.air++;
        }
        if (wall) this.stats.wallTouches++;
        const ownIncoming = before[0] * c.side < -4 && c.side * b.x < -X * 0.55,
          save = ownIncoming && b.vx * c.side > 2;
        if (save) this.stats.saves++;
        const pass =
          old >= 0 &&
          old !== c.id &&
          this.cars[old]?.side === c.side &&
          this.time - oldTime < 6 &&
          oldTouch &&
          Math.hypot(b.x - oldTouch.x, b.z - oldTouch.z) > 6;
        if (pass) {
          this.stats.passes++;
          b.assist = { id: old, receiver: c.id, side: c.side, time: this.time };
        } else if (old >= 0 && this.cars[old]?.side !== c.side) b.assist = null;
        const quality = clamp((c.side * (b.vx - before[0])) / 30, -1, 1);
        if (this.mode === 'doubles') {
          const mates = this.cars.filter(a => a.side === c.side);
          for (const a of mates) a.reward += (0.14 + 0.2 * quality) / mates.length;
        } else c.reward += 0.14 + 0.2 * quality;
        /* Passing is observed, not given a separate reward. */ const e = this.emit('touch', c.id, {
          x: b.x,
          y: b.y,
          z: b.z,
          air,
          wall,
          save,
          pass,
          team: c.side > 0 ? 0 : 1,
          passer: pass ? old : -1,
          previous: old,
          before,
          after: [b.vx, b.vy, b.vz],
          speed: speed(b),
          quality
        });
        b.prevTouch = { x: b.x, z: b.z };
        this.observer?.outcome(e);
        for (const cc of this.cars) if (cc.planAge > 0.18) cc.planAge = 10;
      }
    }
    carPair(a = this.cars[0], b = this.cars[1]) {
      if (Math.abs(a.y - b.y) > 1.1) return;
      const dx = b.x - a.x,
        dz = b.z - a.z;
      let pen = Infinity,
        n = null;
      for (const c of [a, b])
        for (const u of [
          [1, 0, 0],
          [0, 0, 1]
        ]) {
          const ax = Q.v(c.q, u),
            l = Math.hypot(ax[0], ax[2]) || 1,
            nx = ax[0] / l,
            nz = ax[2] / l;
          const projected = c0 => {
            const f = Q.v(c0.q, [1, 0, 0]),
              r = Q.v(c0.q, [0, 0, 1]);
            return Math.abs(f[0] * nx + f[2] * nz) * 1.65 + Math.abs(r[0] * nx + r[2] * nz) * 0.93;
          };
          const d = dx * nx + dz * nz,
            over = projected(a) + projected(b) - Math.abs(d);
          if (over <= 0) return;
          if (over < pen) {
            pen = over;
            n = [nx * Math.sign(d || 1), nz * Math.sign(d || 1)];
          }
        }
      if (!n) return;
      a.x -= n[0] * pen * 0.5;
      a.z -= n[1] * pen * 0.5;
      b.x += n[0] * pen * 0.5;
      b.z += n[1] * pen * 0.5;
      const vn = (b.vx - a.vx) * n[0] + (b.vz - a.vz) * n[1];
      if (vn < 0) {
        const j = -vn * 0.68;
        a.vx -= j * n[0];
        a.vz -= j * n[1];
        b.vx += j * n[0];
        b.vz += j * n[1];
        if (this.time - this.lastBump > 0.35) {
          this.lastBump = this.time;
          this.stats.bumps++;
          if (a.side === b.side) this.stats.teamBumps++;
          this.emit('bump', -1, {
            players: [a.id, b.id],
            friendly: a.side === b.side,
            ...{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, speed: -vn }
          });
        }
      }
    }
    spherePair(a, b) {
      let n = [b.x - a.x, b.y - a.y, b.z - a.z],
        l = Math.hypot(...n),
        sum = a.r + b.r;
      if (l >= sum) return;
      n = l > 0.0001 ? V.mul(n, 1 / l) : [1, 0, 0];
      const inv = 1 / a.mass + 1 / b.mass,
        p = (sum - l) / inv;
      for (let i = 0; i < 3; i++) {
        const k = ['x', 'y', 'z'][i];
        a[k] -= (n[i] * p) / a.mass;
        b[k] += (n[i] * p) / b.mass;
      }
      const vn = V.dot([b.vx - a.vx, b.vy - a.vy, b.vz - a.vz], n);
      if (vn < 0) {
        const j = (-1.64 * vn) / inv;
        for (let i = 0; i < 3; i++) {
          const k = ['vx', 'vy', 'vz'][i];
          a[k] -= (j * n[i]) / a.mass;
          b[k] += (j * n[i]) / b.mass;
        }
      }
    }
    goal(side) {
      if (this.goalPause > 0) return;
      const team = side > 0 ? 0 : 1;
      this.score[team]++;
      this.stats.goals++;
      this.goalPause = 2.5;
      for (const c of this.cars) c.reward += side * c.side > 0 ? 6 : -6;
      for (let i = 0; i < this.cars.length; i++) this.brains[i]?.terminal(this, this.cars[i]);
      const assist =
        this.ball.assist &&
        this.ball.assist.side === side &&
        this.time - this.ball.assist.time < 8 &&
        this.cars[this.ball.last]?.side === side
          ? this.ball.assist.id
          : -1;
      if (assist >= 0) this.stats.assists++;
      const e = this.emit('goal', this.ball.last, {
        side,
        assist,
        x: this.ball.x,
        y: this.ball.y,
        z: this.ball.z,
        bank: this.ball.wallTime > this.ball.lastTime
      });
      this.observer?.outcome(e);
    }
    predictBall(duration = 2.2, step = 0.06) {
      const key = [
        this.time,
        duration,
        step,
        this.ball.x,
        this.ball.y,
        this.ball.z,
        this.ball.vx,
        this.ball.vy,
        this.ball.vz
      ].join(':');
      if (this._forecastKey === key) return this._forecast;
      const b = { ...this.ball, w: this.ball.w.slice(), q: this.ball.q.slice() },
        arr = [];
      for (let t = 0; t <= duration; t += step) {
        arr.push({ x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, t });
        this.ballIntegrate(b, step, false);
      }
      this._forecastKey = key;
      this._forecast = arr;
      return arr;
    }
    step(dt = DT) {
      this.time += dt;
      this.weather.step(dt);
      this.field.step(dt, this.weather);
      for (const p of this.pads) {
        const heat = this.field.sample(p.x, p.z).heat;
        p.charge = clamp(p.charge + (dt / (p.big ? 10 : 4)) * (1 - 0.72 * heat), 0, 1);
        p.timer = ((1 - p.charge) * (p.big ? 10 : 4)) / Math.max(0.28, 1 - 0.72 * heat);
      }
      if (this.goalPause > 0 || this.kickoffTime > 0)
        for (const c of this.cars) {
          const m = this.field.sample(c.x, c.z);
          c.heat = clamp(c.heat - dt * (0.074 + 0.15 * m.wet + 0.0018 * (26 - this.weather.temperature)), 0, 1);
        }
      if (this.goalPause > 0) {
        this.goalPause -= dt;
        this.ballIntegrate(this.ball, dt);
        for (const p of this.props) this.ballIntegrate(p, dt);
        if (this.goalPause <= 0) this.resetPositions();
        return;
      }
      if (this.kickoffTime > 0) {
        this.kickoffTime -= dt;
        return;
      }
      this.matchTime += dt;
      this.roundTime += dt;
      if (this.mode === 'doubles') root.TTeam?.update(this);
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        c.planAge += dt;
        if (c.id !== this.human) this.brains[i]?.step(this, c, dt);
        this.drive(c, dt);
      }
      this.ballIntegrate(this.ball, dt);
      for (const p of this.props) this.ballIntegrate(p, dt);
      for (let i = 0; i < this.cars.length; i++)
        for (let j = i + 1; j < this.cars.length; j++) this.carPair(this.cars[i], this.cars[j]);
      for (const c of this.cars) {
        this.hit(c, this.ball);
        for (const p of this.props) this.hit(c, p);
      }
      for (const p of this.props) this.spherePair(this.ball, p);
      for (let i = 0; i < this.props.length; i++)
        for (let j = i + 1; j < this.props.length; j++) this.spherePair(this.props[i], this.props[j]);
      const b = this.ball;
      if (Math.abs(b.x) > X + BR && Math.abs(b.z) < GOAL - BR && b.y < TOP - BR) this.goal(Math.sign(b.x));
      this.observer?.step(this, dt);
      if (
        !Number.isFinite(b.x + b.y + b.z) ||
        this.cars.some(c => !Number.isFinite(c.x + c.y + c.z + c.q.reduce((a, b) => a + b, 0)))
      ) {
        this.stats.safetyResets++;
        this.emit('safety', -1);
        this.resetPositions();
      }
      // No invisible ball nudges, scheduled tricks or forced goals. Period boundaries only.
      if (this.roundTime > 120) {
        for (let i = 0; i < this.cars.length; i++) this.brains[i]?.terminal(this, this.cars[i]);
        this.emit('period', -1);
        this.resetPositions();
      }
    }
    intervene(type, x = 0, z = 0) {
      x = clamp(x, -X + 5, X - 5);
      z = clamp(z, -Z + 5, Z - 5);
      if (type === 'wet' || type === 'heat') this.field.paint(x, z, type);
      if (type === 'sphere') {
        if (this.props.length >= 4) this.props.shift();
        this.props.push(sphere(x, 5, z, 1.4, 100));
      }
      if (type === 'impulse') {
        const dx = this.ball.x - x,
          dz = this.ball.z - z,
          d = Math.hypot(dx, dz) || 1;
        this.ball.vx += (dx / d) * 12;
        this.ball.vz += (dz / d) * 12;
        this.ball.vy += 6;
      }
      this.emit('intervention', -1, { kind: type, x, z });
    }
    snapshot() {
      if (!this.visualCache || this.field.revision !== this.visualAt) {
        this.visualCache = this.field.visual();
        this.visualAt = this.field.revision;
      }
      return {
        mode: this.mode,
        weather: this.weather.snapshot(),
        surface: this.visualCache,
        time: this.time,
        round: this.round,
        score: this.score.slice(),
        ball: {
          x: this.ball.x,
          y: this.ball.y,
          z: this.ball.z,
          q: this.ball.q.slice(),
          vx: this.ball.vx,
          vy: this.ball.vy,
          vz: this.ball.vz
        },
        cars: this.cars.map(c => ({
          id: c.id,
          side: c.side,
          x: c.x,
          y: c.y,
          z: c.z,
          q: c.q.slice(),
          vx: c.vx,
          vy: c.vy,
          vz: c.vz,
          heading: c.heading,
          ground: c.ground,
          heat: c.heat,
          wet: this.field.sample(c.x, c.z).wet,
          grip: c.grip,
          boost: c.boost,
          boosting: c.boosting,
          steer: c.steer,
          wheelSpin: c.wheelSpin,
          speed: c.speed,
          slip: c.slip,
          landing: c.landing,
          target: { ...c.target }
        })),
        pads: this.pads.map(p => ({ ...p })),
        props: this.props.map(p => ({ ...p, q: p.q.slice() }))
      };
    }
  }
  root.TP = {
    World,
    X,
    Z,
    HEIGHT,
    GOAL,
    TOP,
    BR,
    DT,
    CLEAR,
    curvature,
    surface,
    boundary,
    car,
    sphere,
    speed,
    flat,
    count,
    sideFor
  };
  if (typeof module !== 'undefined') module.exports = root.TP;
})(globalThis);
