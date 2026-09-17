/* Original Touchline math. Right-handed world; x = goal axis, y = up. */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp = (a, b, t) => a + (b - a) * t;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const V = {
    add: (a, b) => a.map((v, i) => v + b[i]),
    sub: (a, b) => a.map((v, i) => v - b[i]),
    mul: (a, s) => a.map(x => x * s),
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: a => {
      const n = Math.hypot(...a) || 1;
      return a.map(v => v / n);
    }
  };
  const Q = {
    id: () => [0, 0, 0, 1],
    norm: q => {
      const n = Math.hypot(...q) || 1;
      return q.map(v => v / n);
    },
    mul: (a, b) => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ],
    axis: (v, a) => {
      const s = Math.sin(a / 2);
      return [v[0] * s, v[1] * s, v[2] * s, Math.cos(a / 2)];
    },
    inv: q => [-q[0], -q[1], -q[2], q[3]],
    v: (q, v) => {
      const t = V.mul(V.cross(q, v), 2);
      return V.add(v, V.add(V.mul(t, q[3]), V.cross(q, t)));
    },
    mix: (a, b, t) => {
      const dot = a.reduce((s, v, i) => s + v * b[i], 0);
      return Q.norm(a.map((v, i) => lerp(v, b[i] * (dot < 0 ? -1 : 1), t)));
    },
    basis: (f, u) => {
      f = V.norm(f);
      const r = V.norm(V.cross(f, u));
      u = V.cross(r, f);
      const m00 = f[0],
        m11 = u[1],
        m22 = r[2],
        tr = m00 + m11 + m22;
      let q;
      if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        q = [(u[2] - r[1]) / s, (r[0] - f[2]) / s, (f[1] - u[0]) / s, 0.25 * s];
      } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        q = [0.25 * s, (u[0] + f[1]) / s, (r[0] + f[2]) / s, (u[2] - r[1]) / s];
      } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        q = [(u[0] + f[1]) / s, 0.25 * s, (r[1] + u[2]) / s, (r[0] - f[2]) / s];
      } else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        q = [(r[0] + f[2]) / s, (r[1] + u[2]) / s, 0.25 * s, (f[1] - u[0]) / s];
      }
      return Q.norm(q);
    }
  };
  class RNG {
    constructor(s = 71829) {
      this.s = s >>> 0 || 1;
    }
    next() {
      let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    normal() {
      return Math.sqrt(-2 * Math.log(Math.max(1e-8, this.next()))) * Math.cos(6.2831853 * this.next());
    }
    range(a, b) {
      return lerp(a, b, this.next());
    }
  }
  root.TM = { clamp, lerp, wrap, V, Q, RNG };
  if (typeof module !== 'undefined') module.exports = root.TM;
})(globalThis);
