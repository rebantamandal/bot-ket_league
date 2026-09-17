/* Coupled moisture, heat and optional life. Two explicitly different cell models:
   Conway B3/S23 (unmodified) or an ecological, weather/tire-sensitive automaton. */
(function (root) {
  'use strict';
  const { clamp, RNG } = TM;
  class Field {
    constructor(rng) {
      this.nx = 64;
      this.nz = 40;
      this.N = 2560;
      this.wet = new Float32Array(this.N);
      this.heat = new Float32Array(this.N);
      this.life = new Uint8Array(this.N);
      this.w2 = new Float32Array(this.N);
      this.h2 = new Float32Array(this.N);
      this.l2 = new Uint8Array(this.N);
      this.exposure = new Float32Array(this.N);
      this.rain = 0;
      this.living = false;
      this.lifeMode = 'conway';
      this.timer = 0;
      this.lifeTimer = 0;
      this.generation = 0;
      this.revision = 0;
      this.rng = new RNG((rng.s ^ 0x7ac519) >>> 0);
      for (let z = 0; z < 40; z++)
        for (let x = 0; x < 64; x++) {
          const i = z * 64 + x;
          this.life[i] = rng.next() < 0.18 ? 1 : 0;
          this.exposure[i] = z < 4 ? 0.27 : z < 7 ? 0.65 : 1;
        }
    }
    index(x, z) {
      return clamp(Math.floor(((z + 28) / 56) * 40), 0, 39) * 64 + clamp(Math.floor(((x + 44) / 88) * 64), 0, 63);
    }
    sample(x, z) {
      const i = this.index(x, z),
        w = this.wet[i],
        growth = this.living && this.lifeMode === 'ecology' && this.life[i] ? 1 : 0;
      return {
        wet: w,
        heat: this.heat[i],
        grip: (1 - 0.55 * w) * (1 - 0.06 * growth),
        exposure: this.exposure[i],
        growth
      };
    }
    paint(x, z, type, amount = 1, r = 7) {
      const x0 = clamp(Math.floor(((x - r + 44) / 88) * 64), 0, 63),
        x1 = clamp(Math.floor(((x + r + 44) / 88) * 64), 0, 63),
        z0 = clamp(Math.floor(((z - r + 28) / 56) * 40), 0, 39),
        z1 = clamp(Math.floor(((z + r + 28) / 56) * 40), 0, 39),
        layer = this[type === 'wet' ? 'wet' : 'heat'],
        rr = r * r;
      for (let j = z0; j <= z1; j++)
        for (let i = x0; i <= x1; i++) {
          const dx = -44 + ((i + 0.5) * 88) / 64 - x,
            dz = -28 + ((j + 0.5) * 56) / 40 - z,
            d2 = (dx * dx + dz * dz) / rr;
          if (d2 > 1) continue;
          const k = j * 64 + i;
          layer[k] = clamp(layer[k] + (1 - d2) * amount, 0, 1);
        }
      this.revision++;
    }
    disturb(x, z) {
      if (!this.living || this.lifeMode !== 'ecology') return;
      const i = this.index(x, z);
      if (this.life[i]) {
        this.life[i] = 0;
        this.revision++;
      }
    }
    tickLife() {
      for (let z = 0; z < 40; z++)
        for (let x = 0; x < 64; x++) {
          let n = 0;
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++)
              if (dx || dz) n += this.life[((z + dz + 40) % 40) * 64 + ((x + dx + 64) % 64)];
          const k = z * 64 + x;
          if (this.lifeMode === 'ecology') {
            const viable = this.wet[k] > 0.12 && this.heat[k] < 0.62;
            this.l2[k] = viable
              ? this.life[k]
                ? n < 7
                  ? 1
                  : 0
                : n >= 1 && n <= 5 && this.rng.next() < 0.08
                  ? 1
                  : 0
              : 0;
          } else this.l2[k] = n === 3 || (n === 2 && this.life[k]) ? 1 : 0;
        }
      const t = this.life;
      this.life = this.l2;
      this.l2 = t;
      this.generation++;
    }
    step(dt, weather = null) {
      this.timer += dt;
      this.lifeTimer += dt;
      const interval = this.lifeMode === 'ecology' ? 1 : 0.5;
      if (this.living && this.lifeTimer >= interval) {
        this.lifeTimer -= interval;
        this.tickLife();
      } else if (!this.living) this.lifeTimer = 0;
      if (this.timer < 0.15) return;
      const t = this.timer;
      this.timer = 0;
      const solar = weather ? weather.sun * (1 - weather.cloud * 0.64) : 0,
        wind = weather ? weather.airSpeed : 0;
      for (let z = 0; z < 40; z++)
        for (let x = 0; x < 64; x++) {
          const i = z * 64 + x,
            l = z * 64 + Math.max(0, x - 1),
            r = z * 64 + Math.min(63, x + 1),
            a = Math.max(0, z - 1) * 64 + x,
            b = Math.min(39, z + 1) * 64 + x,
            w = this.wet[i],
            h = this.heat[i],
            ex = this.exposure[i],
            ev = (0.008 + 0.22 * h + 0.0012 * wind + 0.008 * solar * ex) * w,
            rain = weather ? weather.rainAt(-44 + ((x + 0.5) * 88) / 64, -28 + ((z + 0.5) * 56) / 40) * ex : this.rain;
          this.w2[i] = clamp(
            w +
              t *
                (0.14 * (this.wet[l] + this.wet[r] + this.wet[a] + this.wet[b] - 4 * w) +
                  rain * 0.065 +
                  (this.living && this.life[i] ? 0.033 : 0) -
                  ev),
            0,
            1
          );
          this.h2[i] = clamp(
            h +
              t *
                (0.22 * (this.heat[l] + this.heat[r] + this.heat[a] + this.heat[b] - 4 * h) +
                  0.016 * solar * ex -
                  0.06 * h -
                  0.2 * ev -
                  0.028 * rain * h),
            0,
            1
          );
        }
      [this.wet, this.w2] = [this.w2, this.wet];
      [this.heat, this.h2] = [this.h2, this.heat];
      this.revision++;
    }
    visual() {
      const wet = [],
        heat = [],
        life = [];
      let wetMean = 0,
        heatMean = 0;
      for (let z = 0; z < 40; z += 4)
        for (let x = 0; x < 64; x += 4) {
          let w = 0,
            h = 0,
            n = 0;
          for (let j = 0; j < 4; j++)
            for (let i = 0; i < 4; i++) {
              const k = (z + j) * 64 + x + i;
              w += this.wet[k];
              h += this.heat[k];
              n += this.life[k];
            }
          wet.push(Math.round((w / 16) * 100));
          heat.push(Math.round((h / 16) * 100));
          life.push(this.living ? Math.round((n / 16) * 100) : 0);
          wetMean += w;
          heatMean += h;
        }
      return {
        nx: 16,
        nz: 10,
        wet,
        heat,
        life,
        revision: this.revision,
        wetMean: wetMean / 2560,
        heatMean: heatMean / 2560
      };
    }
    save() {
      return {
        wet: Array.from(this.wet),
        heat: Array.from(this.heat),
        life: Array.from(this.life),
        rain: this.rain,
        living: this.living,
        lifeMode: this.lifeMode,
        generation: this.generation,
        timer: this.timer,
        lifeTimer: this.lifeTimer,
        revision: this.revision,
        rng: this.rng.s
      };
    }
    load(d) {
      for (const k of ['wet', 'heat', 'life']) {
        if (!Array.isArray(d?.[k]) || d[k].length !== this.N || d[k].some(v => !Number.isFinite(v) || v < 0 || v > 1))
          throw Error('Invalid saved surface ' + k);
        this[k].set(d[k]);
      }
      if (!['conway', 'ecology'].includes(d.lifeMode || 'conway')) throw Error('Invalid cellular model.');
      for (const k of ['rain', 'timer', 'lifeTimer', 'generation', 'revision'])
        if (d[k] !== undefined && !Number.isFinite(d[k])) throw Error('Invalid surface clock.');
      this.rain = d.rain || 0;
      this.living = !!d.living;
      this.lifeMode = d.lifeMode || 'conway';
      this.generation = d.generation || 0;
      this.timer = d.timer || 0;
      this.lifeTimer = d.lifeTimer || 0;
      this.revision = d.revision || 0;
      this.rng = new RNG(d.rng || 23);
    }
  }
  root.TField = Field;
  if (typeof module !== 'undefined') module.exports = Field;
})(globalThis);
