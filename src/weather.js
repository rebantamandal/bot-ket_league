/* Persistent, seeded atmospheric forcing. Simplified game rules, not meteorology.
   Goals never reset this clock. Randomness is independent of both learners. */
(function (root) {
  'use strict';
  const { clamp, lerp, RNG } = TM;
  class Weather {
    constructor(seed = 1834) {
      this.rng = new RNG(seed);
      this.elapsed = 0;
      this.clock = 14.8 / 24;
      this.day = 1;
      this.dayLength = 600;
      this.mode = 'auto';
      this.windScale = 1;
      this.cloud = 0.38;
      this.humidity = 0.65;
      this.cloudTarget = 0.76;
      this.humidityTarget = 0.8;
      this.frontIn = 75;
      this.windX = 2.2;
      this.windZ = 0.9;
      this.targetX = 3.1;
      this.targetZ = 1.4;
      this.frontX = 0;
      this.frontZ = 0;
      this.rain = 0;
      this.sun = 1;
      this.temperature = 22;
      this.airSpeed = 2;
      this.updateDerived();
    }
    updateDerived() {
      this.sun = Math.max(0, Math.sin((this.clock - 0.25) * Math.PI * 2));
      this.light = clamp(0.2 + 0.8 * this.sun * (1 - this.cloud * 0.36), 0.18, 1);
      this.temperature = 12 + 15 * this.sun - 3 * this.cloud;
      this.airSpeed = Math.hypot(this.windX, this.windZ);
      this.phase = this.sun <= 0 ? 'Night' : this.sun < 0.3 ? (this.clock < 0.5 ? 'Dawn' : 'Dusk') : 'Daylight';
      this.label =
        this.rain > 0.55
          ? 'Rain'
          : this.rain > 0.1
            ? 'Drizzle'
            : this.airSpeed > 5
              ? 'Breezy'
              : this.cloud > 0.6
                ? 'Overcast'
                : this.cloud > 0.28
                  ? 'Fair'
                  : 'Clear';
    }
    step(dt) {
      this.elapsed += dt;
      this.clock += dt / this.dayLength;
      while (this.clock >= 1) {
        this.clock--;
        this.day++;
      }
      this.frontIn -= dt;
      if (this.frontIn <= 0) {
        this.frontIn = this.rng.range(65, 140);
        this.cloudTarget = this.rng.range(0.18, 0.95);
        this.humidityTarget = this.rng.range(0.5, 0.96);
        const angle = this.rng.range(-Math.PI, Math.PI),
          s = this.rng.range(1, 6);
        this.targetX = Math.cos(angle) * s;
        this.targetZ = Math.sin(angle) * s;
      }
      let cloud = this.cloudTarget,
        humidity = this.humidityTarget;
      if (this.mode === 'rain') {
        cloud = 0.96;
        humidity = 0.94;
      }
      if (this.mode === 'clear') {
        cloud = 0.12;
        humidity = 0.48;
      }
      if (this.mode === 'wind') {
        cloud = 0.46;
        humidity = 0.58;
      }
      this.cloud = lerp(this.cloud, cloud, 1 - Math.exp(-dt / 22));
      this.humidity = lerp(this.humidity, humidity, 1 - Math.exp(-dt / 30));
      const wx = this.mode === 'wind' ? 6.5 : this.targetX,
        wz = this.mode === 'wind' ? 3 : this.targetZ;
      this.windX = lerp(this.windX, wx * this.windScale, 1 - Math.exp(-dt / 13));
      this.windZ = lerp(this.windZ, wz * this.windScale, 1 - Math.exp(-dt / 13));
      const rainTarget = clamp((this.cloud - 0.48) * 2.2, 0, 1) * clamp((this.humidity - 0.45) * 2.1, 0, 1);
      this.rain = lerp(this.rain, rainTarget, 1 - Math.exp(-dt / 6));
      this.frontX = (this.frontX + this.windX * dt * 0.18) % 300;
      this.frontZ = (this.frontZ + this.windZ * dt * 0.18) % 300;
      this.updateDerived();
    }
    rainAt(x, z) {
      return this.rain * (0.72 + 0.28 * Math.sin((x - this.frontX) * 0.049 + (z - this.frontZ) * 0.038));
    }
    configure(d) {
      if (d.mode !== undefined) {
        if (!['auto', 'clear', 'rain', 'wind'].includes(d.mode)) throw Error('Unknown weather condition.');
        this.mode = d.mode;
      }
      if (d.dayLength !== undefined) {
        if (!Number.isFinite(d.dayLength) || d.dayLength < 180 || d.dayLength > 3600)
          throw Error('Day length must be 180 to 3600 seconds.');
        this.dayLength = d.dayLength;
      }
      if (d.hour !== undefined) {
        if (!Number.isFinite(d.hour) || d.hour < 0 || d.hour >= 24) throw Error('Clock hour is outside its range.');
        this.clock = d.hour / 24;
      }
      if (d.windScale !== undefined) {
        if (!Number.isFinite(d.windScale) || d.windScale < 0 || d.windScale > 2)
          throw Error('Wind strength is outside its range.');
        this.windScale = d.windScale;
      }
      this.updateDerived();
    }
    snapshot() {
      return {
        clock: this.clock,
        day: this.day,
        dayLength: this.dayLength,
        phase: this.phase,
        label: this.label,
        mode: this.mode,
        cloud: this.cloud,
        rain: this.rain,
        sun: this.sun,
        light: this.light,
        temperature: this.temperature,
        windX: this.windX,
        windZ: this.windZ,
        airSpeed: this.airSpeed,
        windScale: this.windScale
      };
    }
    save() {
      const { rng, ...d } = this;
      return { ...d, rng: rng.s };
    }
    load(d) {
      if (!d || !['auto', 'rain', 'clear', 'wind'].includes(d.mode)) throw Error('Invalid saved weather.');
      for (const k of [
        'elapsed',
        'clock',
        'day',
        'dayLength',
        'windScale',
        'cloud',
        'humidity',
        'cloudTarget',
        'humidityTarget',
        'frontIn',
        'windX',
        'windZ',
        'targetX',
        'targetZ',
        'frontX',
        'frontZ',
        'rain'
      ])
        if (!Number.isFinite(d[k])) throw Error('Invalid weather value: ' + k);
      if (
        d.clock < 0 ||
        d.clock >= 1 ||
        d.dayLength < 180 ||
        d.dayLength > 3600 ||
        d.rain < 0 ||
        d.rain > 1.01 ||
        d.windScale < 0 ||
        d.windScale > 2 ||
        Math.abs(d.windX) > 20 ||
        Math.abs(d.windZ) > 20
      )
        throw Error('Weather outside supported bounds.');
      Object.assign(this, d);
      this.rng = new RNG(d.rng);
      this.updateDerived();
    }
  }
  root.TWeather = Weather;
  if (typeof module !== 'undefined') module.exports = Weather;
})(globalThis);
