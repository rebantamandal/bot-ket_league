(function (root) {
  'use strict';
  const $ = id => document.getElementById(id),
    names = ['Mica', 'Ember', 'Slate', 'Sienna'],
    views = ['mica', 'ember', 'slate', 'sienna'],
    clamp = TM.clamp;
  const pauseIcon = '<svg viewBox="0 0 18 18"><path d="M6 4v10M12 4v10" stroke-width="2"/></svg>',
    playIcon = '<svg viewBox="0 0 18 18"><path d="m5 3 9 6-9 6z" fill="currentColor" stroke="none"/></svg>';
  const fmt = t => Math.floor(Math.max(0, t) / 60) + ':' + String(Math.floor(Math.max(0, t)) % 60).padStart(2, '0');
  // Keep in sync with the renderer factory in renderer-atelier.js, which reads the graphics choice before App exists.
  const PREFS_KEY = 'touchline.world07.prefs',
    LEGACY_PREFS_KEY = 'touchline.edition06.prefs';
  class Sound {
    constructor() {
      this.on = false;
      this.ctx = null;
      this.last = 0;
    }
    async toggle() {
      if (!this.ctx) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) throw Error('No audio support.');
        this.ctx = new A();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        this.engines = [];
        for (let i = 0; i < 4; i++) {
          const o = this.ctx.createOscillator(),
            g = this.ctx.createGain(),
            f = this.ctx.createBiquadFilter();
          o.type = 'triangle';
          o.frequency.value = 50;
          f.type = 'lowpass';
          f.frequency.value = 180;
          g.gain.value = 0.06;
          o.connect(f).connect(g).connect(this.master);
          o.start();
          this.engines.push({ o, g, f });
        }
      }
      await this.ctx.resume();
      this.on = !this.on;
      this.master.gain.setTargetAtTime(this.on ? 0.3 : 0, this.ctx.currentTime, 0.05);
      if (!this.surfaceAudio) this.createSurfaceAudio();
      return this.on;
    }
    // Looping noise shaped into rain and tyre-slip layers. Muted by default; driven by physical signals only.
    createSurfaceAudio() {
      const c = this.ctx,
        n = c.sampleRate,
        buffer = c.createBuffer(1, n, c.sampleRate),
        samples = buffer.getChannelData(0);
      let seed = 529;
      for (let i = 0; i < n; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = ((seed / 4294967296) * 2 - 1) * 0.5;
      }
      const noise = c.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const rain = c.createGain(),
        tire = c.createGain(),
        wind = c.createGain(),
        rf = c.createBiquadFilter(),
        tf = c.createBiquadFilter(),
        wf = c.createBiquadFilter();
      rf.type = 'lowpass';
      rf.frequency.value = 1600;
      tf.type = 'bandpass';
      tf.frequency.value = 740;
      tf.Q.value = 0.7;
      wf.type = 'lowpass';
      wf.frequency.value = 340;
      rain.gain.value = 0;
      tire.gain.value = 0;
      wind.gain.value = 0;
      noise.connect(rf).connect(rain).connect(this.master);
      noise.connect(tf).connect(tire).connect(this.master);
      noise.connect(wf).connect(wind).connect(this.master);
      noise.start();
      this.surfaceAudio = { rain, tire, wind };
    }
    update(s, paused) {
      this.updateEngines(s, paused);
      this.updateSurface(s, paused);
    }
    updateSurface(s, paused) {
      if (!this.surfaceAudio || !this.ctx) return;
      const t = this.ctx.currentTime,
        rain = paused ? 0 : (s.weather?.rain || 0) * 0.25,
        slip = paused
          ? 0
          : Math.min(
              0.22,
              s.cars.reduce((n, c) => n + Math.abs(c.slip || 0) * (1 + (c.wet || 0)) * 0.011, 0)
            );
      this.surfaceAudio.rain.gain.setTargetAtTime(rain, t, 0.4);
      this.surfaceAudio.tire.gain.setTargetAtTime(slip, t, 0.1);
      // Wind is audible as the air speed climbs, so a gale sounds like one.
      const gust = paused ? 0 : Math.min(0.2, ((s.weather?.airSpeed || 0) / 14) * 0.2);
      this.surfaceAudio.wind.gain.setTargetAtTime(gust, t, 0.7);
    }
    updateEngines(s, paused) {
      if (!this.ctx || performance.now() - this.last < 70) return;
      this.last = performance.now();
      this.engines.forEach((e, i) => {
        if (!s.cars[i]) {
          e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.07);
          return;
        }
        e.o.frequency.setTargetAtTime(37 + s.cars[i].speed * 2.4, this.ctx.currentTime, 0.08);
        e.g.gain.setTargetAtTime(
          paused ? 0 : ((0.07 + s.cars[i].speed * 0.002) * 2) / s.cars.length,
          this.ctx.currentTime,
          0.07
        );
        e.f.frequency.setTargetAtTime(160 + s.cars[i].speed * 5, this.ctx.currentTime, 0.08);
      });
    }
    event(e) {
      if (!this.ctx || !this.on || !['touch', 'bump', 'goal'].includes(e.type)) return;
      const c = this.ctx,
        t = c.currentTime,
        o = c.createOscillator(),
        g = c.createGain();
      o.type = e.type === 'goal' ? 'sine' : 'triangle';
      o.frequency.setValueAtTime(e.type === 'goal' ? 392 : 110, t);
      o.frequency.exponentialRampToValueAtTime(e.type === 'goal' ? 196 : 38, t + 0.18);
      g.gain.setValueAtTime(e.type === 'goal' ? 0.32 : 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.25);
    }
    mute() {
      if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
    resume() {
      if (this.ctx) this.master.gain.setTargetAtTime(this.on ? 0.3 : 0, this.ctx.currentTime, 0.08);
    }
  }
  class App {
    constructor() {
      this.renderer = new SmoothRenderer($('arena'));
      this.audio = new Sound();
      this.seq = 0;
      this.requests = new Map();
      this.worker = null;
      this.fallback = null;
      this.workerMode = 'Dedicated worker';
      this.a = null;
      this.b = null;
      this.arrived = 0;
      this.telemetry = null;
      this.detail = null;
      this.frameLimit = 60;
      this.frameTimes = [];
      this.fps = 60;
      this.lastDraw = 0;
      this.lastUI = 0;
      this.lastFrame = performance.now();
      this.paletteMode = 'auto';
      this.lastNoticeAt = -100;
      this.job = null;
      this.archiveSignature = '';
      this.paused = false;
      this.drawer = false;
      this.tab = 'now';
      this.agent = 0;
      this.badge = 0;
      this.replay = null;
      this.tool = null;
      this.manual = {};
      this.director = true; // automatic slow-motion cut on goals
      this.directorCut = null;
      this.directorPausedUntil = 0;
      this.padInput = {};
      this.padSig = '';
      this.saved = null;
      this.stateTick = 0;
      this.lastJournal = '';
      this.ready = false;
      this.debug = { errors: [], longTasks: [], frames: 0 };
      this.bind();
      this.loadPreferences();
      this.startWorker();
      this.frame = this.frame.bind(this);
      this.raf = requestAnimationFrame(this.frame);
      if ('PerformanceObserver' in window) {
        try {
          new PerformanceObserver(list => {
            for (const e of list.getEntries()) {
              this.debug.longTasks.push(e.duration);
              if (this.debug.longTasks.length > 100) this.debug.longTasks.shift();
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch {}
      }
    }
    async startWorker() {
      const source = $('simulation-source').textContent;
      let data = await this.readSavedWorld();
      const readyTimer = setTimeout(() => {
        if (!this.ready)
          this.bootError(
            'The simulation did not start. Your browser may be blocking local scripts. Try another browser or serve the source folder locally.'
          );
      }, 12000);
      const onReady = () => clearTimeout(readyTimer);
      this.onReady = onReady;
      try {
        const url = URL.createObjectURL(
          new Blob(
            [
              source,
              '\nconst simulation=createRuntime(m=>self.postMessage(m));self.onmessage=e=>simulation.receive(e.data);'
            ],
            { type: 'text/javascript' }
          )
        );
        this.worker = new Worker(url);
        this.worker.onmessage = e => this.receive(e.data);
        this.worker.onerror = e => {
          if (!this.ready) {
            this.worker.terminate();
            this.worker = null;
            this.startFallback(source, data);
          } else {
            this.worker.terminate();
            this.worker = null;
            this.cancelStudy();
            this.paused = true;
            this.audio.mute();
            for (const pending of this.requests.values()) {
              clearTimeout(pending.timer);
              pending.reject(Error('Simulation worker stopped.'));
            }
            this.requests.clear();
            this.bootError(
              'The simulation stopped. Export the last available backup below, when present, before reloading. ' +
                e.message
            );
            if (this.saved) $('recoverSave').hidden = false;
          }
        };
        this.worker.postMessage({ type: 'init', data });
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch {
        this.startFallback(source, data);
      }
    }
    startFallback(source, data) {
      if (this.fallback) return;
      try {
        const create = new Function(source + '\nreturn createRuntime;')();
        this.workerMode = 'Same-thread fallback';
        this.fallback = create(m => queueMicrotask(() => this.receive(m)));
        this.fallback.receive({ type: 'init', data });
        this.toast('Worker blocked by this browser. Using the lighter same-thread fallback.');
      } catch (e) {
        this.bootError(e.message);
      }
    }
    bootError(message) {
      $('boot').hidden = false;
      $('bootText').textContent = message;
      $('reload').hidden = false;
      this.debug.errors.push(message);
    }
    send(message) {
      if (this.worker) this.worker.postMessage(message);
      else this.fallback?.receive(message);
    }
    request(type, extra = {}) {
      return new Promise((resolve, reject) => {
        const id = ++this.seq,
          timer = setTimeout(() => {
            this.requests.delete(id);
            reject(Error('Simulation response timed out.'));
          }, 12000);
        this.requests.set(id, { resolve, reject, timer });
        this.send({ type, id, ...extra });
      });
    }
    receive(m) {
      if (m.type === 'response' || m.type === 'error') {
        const r = this.requests.get(m.id);
        if (r) {
          clearTimeout(r.timer);
          this.requests.delete(m.id);
          m.type === 'error' ? r.reject(Error(m.message)) : r.resolve(m.result);
        } else if (m.type === 'error') this.toast(m.message);
        return;
      }
      if (m.type === 'ready') {
        this.ready = true;
        window.touchlineReady = true;
        this.onReady?.();
        $('boot').hidden = true;
        setTimeout(() => ($('hint').hidden = true), 7000);
        return;
      }
      if (m.type === 'warning') {
        this.toast(m.message);
        return;
      }
      if (m.type === 'save') {
        this.persist(m.json ?? m.data);
        return;
      }
      if (m.type === 'detail') {
        this.detail = m;
        if (!this.replay) this.renderer.updateField(m.field);
        this.updateArchiveOptions();
        if (this.drawer) {
          this.updateAgent();
          if (this.tab === 'discoveries') this.renderJournal();
        }
        return;
      }
      if (m.type === 'state') {
        const now = performance.now();
        if (!this.b || m.state.time !== this.b.time) {
          this.a = this.b || m.state;
          this.b = m.state;
          this.arrived = now;
        } else {
          this.b = m.state;
          if (m.telemetry.paused || m.telemetry.replaying) this.a = m.state;
        }
        this.telemetry = m.telemetry;
        this.syncRoster();
        this.paused = m.telemetry.paused;
        this.stateTick++;
        for (const e of m.events) {
          this.renderer.event(e);
          this.audio.event(e);
          if (e.type === 'goal') {
            const scoring =
              m.telemetry.mode === 'doubles'
                ? e.side > 0
                  ? 'BLUE TEAM'
                  : 'ORANGE TEAM'
                : e.side > 0
                  ? 'MICA'
                  : 'EMBER';
            $('goalText').textContent =
              m.telemetry.mode === 'coop' ? (e.side > 0 ? 'TEAM GOAL' : 'OWN GOAL') : scoring + ' SCORES';
            $('goalText').style.color = e.side > 0 ? 'var(--blue)' : 'var(--orange)';
            $('goalSub').textContent = 'RESETTING FOR KICKOFF';
            $('goal').classList.add('show');
            clearTimeout(this.goalTimer);
            this.goalTimer = setTimeout(() => $('goal').classList.remove('show'), 1600);
            this.startDirectorCut();
          }
          // The teams change ends every period, so say so: otherwise they appear to line up on the
          // wrong halves for no reason.
          if (e.type === 'period') {
            $('goalText').textContent = 'ENDS CHANGED';
            $('goalText').style.color = 'var(--ink)';
            $('goalSub').textContent = 'TEAMS SWAP GOALS';
            $('goal').classList.add('show');
            clearTimeout(this.goalTimer);
            this.goalTimer = setTimeout(() => $('goal').classList.remove('show'), 1900);
          }
        }
        for (const n of m.notices) this.discovery(n);
      }
    }
    // ---- Storage: IndexedDB world saves with a localStorage fallback ----
    async db() {
      if (this.database) return this.database;
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        let req;
        try {
          req = indexedDB.open('touchline-world07', 1);
        } catch (e) {
          reject(e);
          return;
        }
        const timer = setTimeout(() => reject(Error('Storage timed out.')), 1800);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('saves')) req.result.createObjectStore('saves');
        };
        req.onsuccess = () => {
          clearTimeout(timer);
          this.database = req.result;
          resolve(req.result);
        };
        req.onerror = () => {
          clearTimeout(timer);
          reject(req.error);
        };
      });
      return this.databasePromise;
    }
    async readSavedWorld() {
      try {
        const db = await this.db(),
          data = await new Promise((resolve, reject) => {
            const req = db.transaction('saves', 'readonly').objectStore('saves').get('world');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
        if (data) return typeof data === 'string' ? JSON.parse(data) : data;
      } catch {}
      try {
        const raw =
          localStorage.getItem('touchline.world07') ||
          localStorage.getItem('touchline.pocket.04') ||
          localStorage.getItem('touchline.studio.03');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
    async persist(data) {
      this.saved = data;
      try {
        const db = await this.db();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(data, 'world');
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        $('saveState').textContent = 'Full world saved in this browser. Autosave every 30 seconds.';
      } catch {
        try {
          localStorage.setItem('touchline.world07', typeof data === 'string' ? data : JSON.stringify(data));
          $('saveState').textContent = 'Full world saved locally. Export for a portable backup.';
        } catch {
          $('saveState').textContent = 'Storage unavailable or full. Save a world file to keep this session.';
        }
      }
    }
    // ---- Preferences and palette ----
    loadPreferences() {
      // The renderer factory has already resolved root.touchlineGraphics from the same preference record.
      $('graphics').value = root.touchlineGraphics || 'auto';
      try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) || localStorage.getItem(LEGACY_PREFS_KEY) || '{}');
        if (['auto', 'coarse', 'fine'].includes(p.quality)) {
          $('quality').value = p.quality;
          this.renderer.quality = p.quality;
          this.renderer.resize();
        }
        if ([30, 60, 120].includes(p.frameLimit)) {
          this.frameLimit = p.frameLimit;
          $('frameLimit').value = p.frameLimit;
        }
        if (typeof p.director === 'boolean') {
          this.director = p.director;
          $('director').setAttribute('aria-checked', p.director);
        }
        for (const k of ['labels', 'effects'])
          if (typeof p[k] === 'boolean') {
            this.renderer[k === 'effects' ? 'fx' : k] = p[k];
            $(k).setAttribute('aria-checked', p[k]);
          }
        this.setTheme(['auto', 'day', 'night'].includes(p.paletteMode) ? p.paletteMode : 'auto', false);
      } catch {
        this.setTheme('auto', false);
      }
    }
    savePreferences() {
      try {
        localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({
            graphics: root.touchlineGraphics || 'auto',
            paletteMode: this.paletteMode,
            quality: this.renderer.quality,
            frameLimit: this.frameLimit,
            director: this.director,
            labels: this.renderer.labels,
            effects: this.renderer.fx
          })
        );
      } catch {}
    }
    // mode: 'auto' follows the simulated sun; 'day' and 'night' are fixed.
    setTheme(mode, persist = true) {
      this.paletteMode = mode;
      const theme =
          mode === 'auto' ? ((this.displayWeather?.sun ?? this.b?.weather?.sun ?? 1) < 0.09 ? 'night' : 'day') : mode,
        night = theme === 'night';
      document.documentElement.dataset.theme = theme;
      if (this.renderer.theme !== theme) this.renderer.setTheme(theme);
      $('palette').value = mode;
      $('theme').setAttribute(
        'aria-label',
        mode === 'auto'
          ? 'Palette follows the world. Switch to after-hours.'
          : mode === 'night'
            ? 'After-hours palette. Switch to daylight.'
            : 'Daylight palette. Follow the world.'
      );
      $('theme').innerHTML =
        mode === 'auto'
          ? '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6"/><path d="M9 3a6 6 0 0 1 0 12Z" fill="currentColor"/></svg>'
          : night
            ? '<svg viewBox="0 0 18 18"><path d="M14.8 10.8A6.4 6.4 0 0 1 7.2 3.2a6.1 6.1 0 1 0 7.6 7.6Z"/></svg>'
            : '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="3"/><path d="M9 1v2m0 12v2M1 9h2m12 0h2"/></svg>';
      document.querySelector('meta[name="theme-color"]').content = night ? '#101e1d' : '#f5f4ef';
      this.updatePortrait();
      if (persist) this.savePreferences();
    }
    updatePortrait() {
      this.renderer.drawPortrait($('agentPortrait'), this.agent);
      $('portraitName').textContent = names[this.agent];
      $('portraitName').style.color = this.agent % 2 ? 'var(--orange)' : 'var(--blue)';
      $('portraitNumber').textContent = String(this.agent + 1).padStart(2, '0');
      $('agentPortrait').setAttribute('aria-label', names[this.agent] + ' car model');
    }
    focusView() {
      if (this.drawer) this.openInspector(false);
      document.body.classList.toggle('clean');
      $('arena').focus({ preventScroll: true });
    }
    blend(a, b, f) {
      const mix = (x, y) => {
        const o = { ...y };
        for (const k of ['x', 'y', 'z']) o[k] = TM.lerp(x[k], y[k], f);
        o.q = TM.Q.mix(x.q || [0, 0, 0, 1], y.q || [0, 0, 0, 1], f);
        return o;
      };
      if (a.round !== b.round) return b;
      return {
        ...b,
        time: TM.lerp(a.time, b.time, f),
        ball: mix(a.ball, b.ball),
        cars: b.cars.map((v, i) =>
          !a.cars[i] || a.round !== b.round || a.cars.length !== b.cars.length
            ? v
            : { ...mix(a.cars[i], v), wheelSpin: TM.lerp(a.cars[i].wheelSpin, v.wheelSpin, f) }
        ),
        props: b.props.map((v, i) => (a.props[i] ? mix(a.props[i], v) : v))
      };
    }
    snapshot(now, dt) {
      if (this.replay) {
        const r = this.replay;
        r.elapsed += dt * 0.8;
        const end = r.frames.at(-1).time,
          begin = r.frames[0].time,
          t = begin + r.elapsed;
        if (t >= end) {
          this.stopReplay();
          return this.b;
        }
        let i = r.index || 0;
        while (i < r.frames.length - 2 && r.frames[i + 1].time < t) i++;
        r.index = i;
        const a = r.frames[i],
          b = r.frames[i + 1];
        $('replayProgress').style.width = (100 * (t - begin)) / (end - begin) + '%';
        return this.blend(a, b, clamp((t - a.time) / (b.time - a.time || 0.1), 0, 1));
      }
      return this.b ? this.blend(this.a, this.b, clamp((now - this.arrived) / 33, 0, 1)) : null;
    }
    frame(now) {
      this.raf = requestAnimationFrame(this.frame);
      const dt = clamp((now - this.lastFrame) / 1000, 0, 0.1);
      this.lastFrame = now;
      if (document.hidden || !this.b) return;
      this.pollGamepad();
      if (this.directorCut && now > this.directorCut.until) this.endDirectorCut();
      const limit = this.paused && !this.replay ? Math.min(15, this.frameLimit) : this.frameLimit;
      const interval = 1000 / limit;
      if (this.drawLimit !== limit || !this.nextPaint) {
        this.drawLimit = limit;
        this.nextPaint = now;
      }
      if (now + 1.5 < this.nextPaint) return;
      this.nextPaint += interval;
      if (this.nextPaint < now - interval * 0.25) this.nextPaint = now + interval;
      const renderDt = (now - this.lastDraw) / 1000;
      if (this.lastDraw && renderDt < 0.5) {
        this.frameTimes.push(renderDt * 1000);
        if (this.frameTimes.length > 120) this.frameTimes.shift();
        this.fps = 1000 / (this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length);
      }
      this.lastDraw = now;
      const s = this.snapshot(now, clamp(renderDt, 0, 0.1));
      if (this.replay && s.surface) this.renderer.updateField(s.surface);
      this.renderer.render(s, clamp(renderDt, 0, 0.1));
      this.audio.update(s, this.paused || !!this.replay);
      this.debug.frames++;
      this.adaptGraphics(now, renderDt);
      if (now - this.lastUI > 250) {
        this.lastUI = now;
        this.updateUI(s);
      }
    }
    // ---- Periodic UI refresh (every 250 ms of display time) ----
    updateUI(s) {
      this.updateHUD(s);
      this.updateWorld(s);
      $('play').setAttribute('aria-pressed', String(!this.paused));
      $('play').title = this.paused ? 'Resume (P)' : 'Pause (P)';
      $('stage').dataset.running = String(!this.paused && !this.replay);
    }
    updateHUD(s) {
      const t = this.telemetry;
      if (!t) return;
      $('score0').textContent = s.score[0];
      $('score1').textContent = s.score[1];
      const mode = s.mode || t.mode;
      $('team0').textContent = mode === 'doubles' ? 'BLUE' : mode === 'coop' ? 'TEAM' : 'MICA';
      $('team1').textContent = mode === 'doubles' ? 'ORANGE' : mode === 'coop' ? 'OWN' : 'EMBER';
      document
        .querySelector('.scoreboard')
        .setAttribute(
          'aria-label',
          t.mode === 'coop'
            ? 'Team goals ' + s.score[0] + '. Own goals ' + s.score[1] + '.'
            : (mode === 'doubles' ? 'Blue team ' : 'Mica ') +
                s.score[0] +
                (mode === 'doubles' ? '. Orange team ' : '. Ember ') +
                s.score[1] +
                '.'
        );
      $('clock').textContent = fmt(this.replay ? s.time : t.matchTime);
      $('modeLabel').textContent = this.replay
        ? 'REPLAY'
        : t.mode === 'doubles'
          ? '2 V 2'
          : t.mode === 'coop'
            ? 'CO-OP'
            : '1 V 1';
      $('play').innerHTML = this.paused ? playIcon : pauseIcon;
      $('play').setAttribute('aria-label', this.paused ? 'Resume simulation' : 'Pause simulation');
      let status = this.replay
        ? 'Recorded sequence'
        : t.bench
          ? t.mode === 'doubles'
            ? 'Blue vs archived Orange'
            : 'Mica + archived Ember'
          : this.tool
            ? 'Click the field'
            : t.human >= 0
              ? t.mode === 'doubles'
                ? 'You + 3 agents'
                : 'You + Ember'
              : this.paused
                ? 'Paused'
                : !t.learning
                  ? 'Policies frozen'
                  : 'Learning live';
      if (!this.paused && !this.replay && t.learning && t.human < 0 && t.pace < 0.7 && t.matchTime > 5)
        status = 'Learning / ' + t.pace.toFixed(1) + 'x actual';
      $('status').textContent = status;
      $('stageState').textContent = this.replay ? 'RECORDED SEQUENCE' : this.paused ? 'PAUSED' : 'LIVE ARENA';
      $('liveDot').classList.toggle('paused', this.paused || !t.learning);
      $('panelStatus').textContent = this.replay
        ? 'REPLAY / LEARNING OFF'
        : this.paused
          ? 'SIMULATION PAUSED'
          : t.learning
            ? 'LEARNING ON'
            : 'POLICIES FROZEN';
      if (this.drawer) {
        this.updateAgent();
        if (this.tab === 'lab') this.updateSettings();
      }
    }
    updateWorld(s) {
      const w = s.weather || this.telemetry?.weather;
      if (!w) return;
      this.displayWeather = w;
      const time =
          String(Math.floor(w.clock * 24)).padStart(2, '0') +
          ':' +
          String(Math.floor(w.clock * 1440) % 60).padStart(2, '0'),
        day = String(w.day).padStart(2, '0');
      $('worldClock').textContent = 'Day ' + day + ' / ' + time;
      $('worldWeather').textContent = w.label;
      $('weatherSymbol').innerHTML = w.rain > 0.1 ? '&#9730;' : w.sun < 0.03 ? '&#9790;' : '&#9728;';
      if (this.paletteMode === 'auto' && (this.renderer.theme === 'night') !== w.sun < 0.09)
        this.setTheme('auto', false);
      if (!this.drawer || this.tab !== 'lab') return;
      $('worldHour').textContent = time;
      const label = document.createElement('span');
      label.textContent = ' / DAY ' + day;
      $('worldHour').append(label);
      $('weatherPhase').textContent = w.phase + ' / ' + w.label;
      $('sunTrack').style.left = w.clock * 100 + '%';
      const surface = s.surface || this.telemetry.surface;
      $('worldConditions').textContent =
        Math.round((surface?.wetMean || 0) * 100) +
        '% moisture / ' +
        Math.round((surface?.wearMean || 0) * 100) +
        '% turf wear / ' +
        w.temperature.toFixed(1) +
        ' C / wind ' +
        w.airSpeed.toFixed(1) +
        ' m/s';
      if (document.activeElement !== $('weatherMode')) $('weatherMode').value = w.mode;
      if (document.activeElement !== $('hourScrub')) {
        $('hourScrub').value = String(Math.round(w.clock * 48) / 2);
        $('hourOut').textContent = time;
      }
      if (document.activeElement !== $('dayLength')) $('dayLength').value = String(w.dayLength);
    }
    // ---- Fieldnotes: selected agent ----
    updateAgent() {
      this.updateAgentReadout();
      this.updatePlan();
      this.updateTactics();
      this.updateTeamReadout();
    }
    updateAgentReadout() {
      const t = this.telemetry;
      if (!t) return;
      const a = t.agents[this.agent],
        human = t.human === this.agent;
      $('intent').textContent = human ? 'Following your controls.' : a.intent;
      $('reason').textContent = human ? 'This car is not updating its learned weights while you drive.' : a.reason;
      $('thinking').textContent = human
        ? 'Human control'
        : this.replay
          ? 'Watching a recorded sequence'
          : this.paused
            ? 'Simulation paused'
            : !t.learning || a.frozen
              ? 'Learned weights frozen'
              : a.exploring
                ? 'Exploring a different plan'
                : 'Choosing by learned value';
      $('updates').textContent = a.updates.toLocaleString();
      $('boost').textContent = Math.round(a.boost);
      $('velocity').textContent = a.speed.toFixed(1);
      $('norm').textContent = a.norm.toFixed(3);
      $('steerOut').textContent = (a.controls.steer || 0).toFixed(1);
      $('throttleOut').textContent = (a.controls.throttle || 0).toFixed(1);
      $('steerBar').style.width = Math.abs(a.controls.steer || 0) * 50 + '%';
      $('steerBar').style.marginLeft = ((a.controls.steer || 0) < 0 ? 50 - 50 * Math.abs(a.controls.steer) : 50) + '%';
      $('throttleBar').style.width = Math.abs(a.controls.throttle || 0) * 100 + '%';
      $('followAgent').textContent = 'Follow ' + names[this.agent] + ' \u2192';
      const temper = a.temper;
      $('temperament').textContent = temper
        ? 'TEMPERAMENT / AGGRESSION ' +
          temper.aggression.toFixed(2) +
          ' / PATIENCE ' +
          temper.patience.toFixed(2) +
          ' / BOOST ' +
          temper.boostHunger.toFixed(2) +
          ' / FLAIR ' +
          temper.flair.toFixed(2)
        : '';
      const history = this.detail?.agents[this.agent]?.history || [];
      if (history.length > 1) {
        const max = Math.max(0.01, ...history.map(h => h.norm));
        const path = history
          .map(
            (h, i) =>
              (i ? 'L' : 'M') +
              ((i / (history.length - 1)) * 300).toFixed(1) +
              ' ' +
              (55 - (h.norm / max) * 45).toFixed(1)
          )
          .join(' ');
        $('weightPath').setAttribute('d', path);
      } else $('weightPath').setAttribute('d', 'M0 55H300');
    }
    updatePlan() {
      const a = this.telemetry?.agents[this.agent],
        p = a?.plan;
      if (!p) return;
      const e = p.environment || {},
        box = $('planReadout');
      box.replaceChildren();
      const title = document.createElement('strong');
      title.textContent =
        (p.variant || 'balanced').replace(/^./, x => x.toUpperCase()) +
        ' approach / ' +
        (p.brakeBias > 0.7 ? 'earlier braking' : p.brakeBias < 0.4 ? 'later braking' : 'balanced braking');
      const line = document.createElement('span');
      line.textContent =
        'Route ' +
        Math.round((e.wet || 0) * 100) +
        '% wet. Engine heat ' +
        Math.round((a.heat || 0) * 100) +
        '%. Commitment ' +
        p.commitTime.toFixed(2) +
        ' s.';
      box.append(title, line);
      if (a.frozen) {
        const note = document.createElement('strong');
        note.textContent = 'Historical policy / learning frozen';
        box.append(note);
      }
      const items = this.detail?.agents[this.agent]?.alternatives || [],
        sig = JSON.stringify(items);
      if (sig !== this.alternativeSig) {
        this.alternativeSig = sig;
        $('alternatives').replaceChildren();
        for (const p of items) {
          const row = document.createElement('div');
          row.className = 'plan-option';
          const text = document.createElement('span');
          text.textContent = (p.role || p.kind) + ' / ' + (p.variant || 'balanced');
          const sub = document.createElement('small');
          sub.textContent =
            'Prior ' + p.prior.toFixed(2) + ' / learned ' + (p.correction >= 0 ? '+' : '') + p.correction.toFixed(2);
          text.append(sub);
          const value = document.createElement('b');
          value.textContent = p.score.toFixed(2);
          row.append(text, value);
          $('alternatives').append(row);
        }
      }
    }
    updateTactics() {
      const a = this.telemetry?.agents[this.agent],
        p = a?.plan;
      if (!a) return;
      $('inspector').classList.toggle('replay-inspector', !!this.replay);
      if (this.replay) {
        $('intent').textContent = 'Recorded motion.';
        $('reason').textContent =
          'Live learning is paused. Historical decision estimates were not saved with these replay frames.';
        return;
      }
      const role =
        {
          attack: 'SHOT',
          setup: 'POSITION',
          clear: 'CLEARANCE',
          shadow: 'COVERAGE',
          refuel: 'RESOURCE',
          support: 'SUPPORT'
        }[p?.role] || 'INTERCEPT';
      $('tacticalRole').textContent = role;
      $('arrivalEstimate').textContent = Number.isFinite(p?.arrival) ? p.arrival.toFixed(2) + ' s' : '--';
      $('rivalEstimate').textContent = Number.isFinite(p?.opponentETA) ? p.opponentETA.toFixed(2) + ' s' : '--';
      const lane = Number.isFinite(p?.blocked) ? 1 - p.blocked : null;
      $('laneClearance').style.width = (lane === null ? clamp(p?.threat || 0, 0, 1) : lane) * 100 + '%';
      $('tacticalNote').textContent =
        lane === null
          ? 'Goal pressure ' + Math.round((p?.threat || 0) * 100) + '/100.'
          : 'Lane clearance ' + Math.round(lane * 100) + '/100.';
      if (a.exploring) $('thinking').textContent = 'Exploring among comparable plans';
      else if (this.telemetry.learning && !this.paused && !a.frozen && this.telemetry.human !== this.agent)
        $('thinking').textContent = 'Planning + learning live';
    }
    updateTeamReadout() {
      const a = this.telemetry?.agents[this.agent],
        box = $('teamReadout');
      if (!box) return;
      box.hidden = this.telemetry?.mode !== 'doubles' || !!this.replay;
      if (box.hidden || !a) return;
      const team = a.plan?.team,
        heading = document.createElement('strong'),
        body = document.createElement('span');
      heading.textContent =
        (this.agent % 2 ? 'ORANGE' : 'BLUE') +
        ' / ' +
        (team?.primary ? 'FIRST CHALLENGE' : team?.role === 'cover' ? 'SECOND / COVER' : 'SECOND / SUPPORT');
      body.textContent = team
        ? names[team.mate] +
          ' is the teammate. ' +
          (a.plan.role === 'pass'
            ? 'Selected a pass toward ' + names[a.plan.passTo] + '.'
            : team.primary
              ? 'Taking the earliest team approach.'
              : 'Keeping a separate lane for the next touch.')
        : 'Waiting for the first team assignment.';
      const counts = document.createElement('small');
      counts.textContent =
        'Observed in this mode: ' +
        (this.telemetry.stats.passes || 0) +
        ' received passes / ' +
        (this.telemetry.stats.assists || 0) +
        ' assists.';
      box.replaceChildren(heading, body, counts);
      if (a.plan?.role === 'pass') $('tacticalRole').textContent = 'PASS';
      else if (a.plan?.role === 'cover') $('tacticalRole').textContent = 'COVER';
    }
    // ---- Fieldnotes: world tab ----
    updateSettings() {
      const t = this.telemetry;
      if (!t) return;
      $('learning').setAttribute('aria-checked', t.learning);
      $('life').setAttribute('aria-checked', t.life);
      $('mode').value = t.mode;
      $('modeHelp').textContent =
        t.mode === 'doubles'
          ? 'Mica + Slate / blue. Ember + Sienna / orange. Four independent learners; shared team outcomes.'
          : t.mode === 'coop'
            ? 'Both agents attack the orange goal. Separate co-op policies.'
            : 'Separate agents. Opposing goals.';
      $('drive').textContent = t.human >= 0 ? 'Hand back to Mica' : 'Drive Mica';
      $('gripOut').textContent = t.grip.toFixed(2);
      $('gravityOut').textContent = t.gravity.toFixed(0);
      if (document.activeElement !== $('grip')) $('grip').value = t.grip;
      if (document.activeElement !== $('gravity')) $('gravity').value = t.gravity;
      const perf = $('performance');
      perf.replaceChildren();
      for (const [label, v] of [
        ['Display', Math.round(this.fps) + ' fps'],
        ['Renderer', this.renderer.kind || 'Canvas'],
        ['Backing', this.renderer.w + ' \u00d7 ' + this.renderer.h],
        ['CPU submit', this.renderer.renderMs.toFixed(2) + ' ms'],
        ['Simulation', t.pace.toFixed(2) + 'x / ' + t.tickMs.toFixed(2) + ' ms tick'],
        ['Execution', this.workerMode]
      ]) {
        const d = document.createElement('div');
        d.textContent = label + '  ';
        const strong = document.createElement('strong');
        strong.textContent = v;
        d.append(strong);
        perf.append(d);
      }
      $('lifeMode').value = t.lifeMode;
      $('bounceOut').textContent = t.bounce.toFixed(2);
      if (document.activeElement !== $('bounce')) $('bounce').value = t.bounce;
      $('evaluate').disabled = !!this.job || !['duel', 'doubles'].includes(t.mode) || !!t.bench;
      $('archiveNow').disabled = !!t.bench;
      $('compareMoment').disabled = !!this.job || !t.anchor;
      $('momentState').textContent = t.anchor
        ? 'Moment saved at ' + fmt(t.anchor.time) + ' of world time. Both test branches freeze learning.'
        : 'No moment saved yet.';
      if (document.activeElement !== $('sparSelect')) $('sparSelect').value = t.bench ? String(t.bench.id) : 'live';
    }
    // ---- Discoveries journal ----
    interesting(p) {
      return p.count > 0;
    }
    discovery(n) {
      const p = n.pattern;
      if (!this.interesting(p) || (!p.positive && !p.stage)) return;
      this.badge++;
      $('badge').textContent = this.badge > 99 ? '99+' : this.badge;
      $('badge').hidden = this.drawer && this.tab === 'discoveries';
      if (n.time - this.lastNoticeAt < 12 && p.stage < 2) return;
      this.lastNoticeAt = n.time;
      $('hint').hidden = true;
      $('noticeType').textContent =
        (p.stage === 2 ? 'LEARNING-ASSOCIATED' : p.stage === 1 ? 'RECURRING SEQUENCE' : 'CANDIDATE PATTERN') +
        ' / ' +
        names[p.agent].toUpperCase();
      $('noticeText').textContent = p.title;
      $('notice').classList.add('show');
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => $('notice').classList.remove('show'), 5500);
    }
    renderJournal() {
      const ps = (this.detail?.patterns || [])
          .filter(p => this.interesting(p))
          .sort((a, b) => b.stage - a.stage || b.last - a.last),
        sig = ps.map(p => [p.id, p.count, p.stage, p.clipAvailable].join(':')).join('|');
      if (sig === this.lastJournal && $('discoveries').childNodes.length) return;
      this.lastJournal = sig;
      const list = $('discoveries');
      list.replaceChildren();
      if (!ps.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.innerHTML =
          '<div class="empty-icon">&#9675;</div><h3>No sequences yet.</h3><p>Repeated approaches appear here after attempts, including misses.</p>';
        list.append(e);
        return;
      }
      for (const p of ps) {
        const card = document.createElement('article');
        card.className = 'entry';
        const meta = document.createElement('div');
        meta.className = 'entry-meta';
        const stage = document.createElement('span');
        stage.className = 'stage stage' + p.stage;
        stage.textContent = p.legacy ? 'LEGACY RECORD' : ['CANDIDATE', 'RECURRING', 'LEARNING-ASSOCIATED'][p.stage];
        const who = document.createElement('span');
        who.textContent = names[p.agent].toUpperCase();
        who.style.color = p.agent % 2 ? 'var(--orange)' : 'var(--blue)';
        meta.append(stage, who);
        const title = document.createElement('h3');
        title.textContent = p.title;
        const ev = document.createElement('div');
        ev.className = 'evidence';
        ev.textContent =
          p.count +
          ' attempts / ' +
          p.rounds.length +
          ' rounds / ' +
          p.positive +
          ' positive / ' +
          (p.misses || 0) +
          ' missed';
        card.append(meta, title, ev);
        const comp = p.comparison;
        if (comp) {
          const explain = document.createElement('p');
          explain.className = 'detail';
          explain.textContent =
            'Positive progress: ' +
            Math.round((p.positive / p.count) * 100) +
            '%. Other approaches in this context: ' +
            (comp.n
              ? Math.round((comp.positive / comp.n) * 100) + '% from ' + comp.n + ' attempts'
              : 'not enough observations') +
            '.';
          const range = document.createElement('div');
          range.className = 'evidence-range';
          range.title =
            'Descriptive 95% Wilson interval: ' +
            Math.round(comp.interval[0] * 100) +
            ' to ' +
            Math.round(comp.interval[1] * 100) +
            '%. Attempts are not independent.';
          const i = document.createElement('i');
          i.style.left = comp.interval[0] * 100 + '%';
          i.style.width = (comp.interval[1] - comp.interval[0]) * 100 + '%';
          range.append(i);
          card.append(explain, range);
        }
        if (p.result) {
          const latest = document.createElement('p');
          latest.className = 'footnote';
          latest.textContent = 'Latest: ' + p.result + '.';
          card.append(latest);
        }
        if (p.stage > 0) {
          const shifted = document.createElement('p');
          shifted.className = 'footnote';
          shifted.textContent = 'Learned-preference shift ' + (p.shift >= 0 ? '+' : '') + p.shift.toFixed(3) + '.';
          card.append(shifted);
        }
        const watch = document.createElement('button');
        watch.innerHTML = playIcon;
        watch.append(document.createTextNode(p.clipAvailable ? 'Watch evidence' : 'No saved replay'));
        watch.disabled = !p.clipAvailable;
        watch.onclick = () => this.startReplay(p);
        card.append(watch);
        list.append(card);
      }
    }
    // ---- History, frozen comparisons and branches (run in a separate worker) ----
    updateArchiveOptions() {
      const a = (this.detail?.archives || []).filter(x => x.mode === (this.telemetry?.mode || 'duel')),
        sig = a.map(x => x.id + ':' + x.updates.join(',')).join('|');
      const lastReport = this.detail?.evaluations?.at(-1);
      if (lastReport && !this.job && lastReport.date !== this.lastEvaluationDate) {
        this.lastEvaluationDate = lastReport.date;
        this.renderEvaluation(lastReport);
      }
      if (sig === this.archiveSignature) return;
      this.archiveSignature = sig;
      const selected = $('archiveSelect').value;
      $('archiveSelect').replaceChildren();
      $('sparSelect').replaceChildren(new Option('Live learner', 'live'));
      for (const x of a) {
        const title = '#' + x.id + ' / ' + fmt(x.time) + ' / ' + x.updates.join('-') + ' updates';
        $('archiveSelect').add(new Option(title, String(x.id)));
        $('sparSelect').add(new Option(title, String(x.id)));
      }
      if (a.some(x => String(x.id) === selected)) $('archiveSelect').value = selected;
      const last = this.detail?.evaluations?.at(-1);
      if (last && !this.job) this.renderEvaluation(last);
    }
    cancelStudy() {
      if (!this.job) return;
      this.job.worker.terminate();
      URL.revokeObjectURL(this.job.url);
      this.job = null;
      $('evaluationProgress').hidden = true;
      $('branchReport').querySelector('.cancel-study')?.remove();
      if ($('branchJobLabel')) $('branchJobLabel').textContent = 'Comparison cancelled; saved moment retained.';
      this.updateSettings();
      this.toast('Comparison cancelled. Live learning was not interrupted.');
    }
    async runStudy(kind, data) {
      if (this.job) {
        this.toast('Finish or cancel the current comparison first.');
        return;
      }
      if (!window.Worker) {
        this.toast('Separate-worker comparisons are unavailable in this browser.');
        return;
      }
      try {
        const source = $('simulation-source').textContent,
          code =
            source +
            '\nself.onmessage=async e=>{try{const r=await TEvaluation[e.data.kind](e.data.data,p=>self.postMessage({type:"progress",data:p}));self.postMessage({type:"done",data:r});}catch(error){self.postMessage({type:"error",message:error.message});}};',
          url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })),
          worker = new Worker(url);
        this.job = { kind, worker, url };
        $('evaluationProgress').hidden = false;
        $('jobProgress').value = 0;
        $('jobLabel').textContent = kind === 'branch' ? 'Comparing two frozen branches.' : 'Running 16 frozen trials.';
        if (kind === 'branch') {
          $('branchReport').replaceChildren();
          const label = document.createElement('p');
          label.id = 'branchJobLabel';
          label.textContent = 'Comparing two physical continuations...';
          const cancel = document.createElement('button');
          cancel.className = 'smallbtn cancel-study';
          cancel.textContent = 'Cancel';
          cancel.onclick = () => this.cancelStudy();
          $('branchReport').append(label, cancel);
        }
        this.updateSettings();
        this.toast('Comparison running separately. Live learning continues.');
        const finish = () => {
          worker.terminate();
          URL.revokeObjectURL(url);
          this.job = null;
          $('evaluationProgress').hidden = true;
          this.updateSettings();
        };
        worker.onerror = e => {
          finish();
          this.toast('Comparison worker failed: ' + e.message);
        };
        worker.onmessage = async e => {
          const m = e.data;
          if (m.type === 'progress') {
            $('jobProgress').value = m.data.done / m.data.total;
            $('jobLabel').textContent = m.data.message;
            if ($('branchJobLabel')) $('branchJobLabel').textContent = m.data.message;
          } else if (m.type === 'done') {
            finish();
            if (kind === 'evaluate') {
              this.renderEvaluation(m.data);
              await this.request('evaluationResult', { result: m.data });
            } else this.renderBranch(m.data);
            this.toast('Comparison complete. Results are in Fieldnotes.');
          } else if (m.type === 'error') {
            finish();
            this.toast('Comparison failed: ' + m.message);
          }
        };
        worker.postMessage({ kind, data });
      } catch (e) {
        this.job = null;
        this.updateSettings();
        this.toast('Comparison unavailable: ' + e.message);
      }
    }
    renderEvaluation(r) {
      const root = $('evaluationReport');
      root.replaceChildren();
      const title = document.createElement('h4');
      title.textContent = 'Current policies vs snapshot #' + r.archiveId;
      root.append(title);
      for (const a of r.agents) {
        const p = document.createElement('p');
        p.textContent =
          (r.mode === 'doubles' ? ['Blue team', 'Orange team'][a.agent] : names[a.agent]) +
          ': ' +
          (a.goalDifferenceChange >= 0 ? '+' : '') +
          a.goalDifferenceChange +
          ' goal-differential change across ' +
          a.trials +
          ' matched starts. ' +
          (a.allTied
            ? 'No change in any of those starts.'
            : 'Mean paired change ' +
              a.mean.toFixed(2) +
              '; small-sample interval ' +
              a.interval.map(x => x.toFixed(2)).join(' to ') +
              '.');
        root.append(p);
      }
      const note = document.createElement('p');
      note.className = 'footnote';
      note.textContent = r.secondsPerGame + ' s per game / frozen policies / dry + wet / swapped sides.';
      root.append(note);
    }
    renderBranch(r) {
      this.branchResult = r;
      const root = $('branchReport');
      root.replaceChildren();
      for (const c of r.cases) {
        const p = document.createElement('p');
        p.textContent =
          (c.variant === 'recorded'
            ? 'Original conditions'
            : c.variant === 'dry'
              ? 'Dry-turf variant'
              : c.variant === 'wet'
                ? 'Wet-turf variant'
                : 'Calm-wind variant') +
          ': ' +
          c.scoreDelta.join(' - ') +
          ' added goals; ' +
          c.touches.join(' / ') +
          ' contacts.';
        const b = document.createElement('button');
        b.className = 'smallbtn';
        b.textContent = 'Watch ' + (c.variant === 'recorded' ? 'original' : 'variant');
        b.onclick = () => this.playStudy(c.frames, c.variant);
        root.append(p, b);
      }
      const note = document.createElement('p');
      note.className = 'footnote';
      note.textContent = '18 simulated seconds from the same saved state, both policies frozen.';
      root.append(note);
    }
    async playStudy(frames, variant) {
      try {
        this.stopReplay();
        await this.request('externalReplay');
        this.replay = { frames, elapsed: 0, index: 0, oldView: this.renderer.mode };
        this.tool = null;
        this.openInspector(false);
        this.view('arena');
        $('ribbon').hidden = false;
        $('ribbonText').textContent =
          'BRANCH / ' + (variant === 'recorded' ? 'ORIGINAL CONDITIONS' : variant.toUpperCase() + ' VARIANT');
        $('ribbonExit').textContent = 'Return live';
        this.renderer.particles = [];
        this.renderer.ballTrail = [];
        this.renderer.trails = [[], [], [], []];
      } catch (e) {
        this.toast(e.message);
      }
    }
    // ---- Match format ----
    async changeMatch(mode) {
      if (this.changingMode || mode === this.telemetry?.mode) return;
      this.changingMode = true;
      for (const b of document.querySelectorAll('[data-match]')) b.disabled = true;
      try {
        this.stopReplay();
        this.setTool(null);
        this.cancelStudy();
        await this.request('mode', { value: mode });
        this.a = this.b;
        this.badge = 0;
        this.lastJournal = '';
        this.archiveSignature = '';
        $('badge').hidden = true;
        $('goal').classList.remove('show');
        $('notice').classList.remove('show');
        this.syncRoster();
        this.updateArchiveOptions();
        this.toast(
          mode === 'doubles'
            ? '2v2 / Mica + Slate against Ember + Sienna.'
            : "Match changed. This mode's learned policies are retained."
        );
      } catch (e) {
        $('mode').value = this.telemetry?.mode || 'duel';
        this.toast(e.message);
      } finally {
        this.changingMode = false;
        for (const b of document.querySelectorAll('[data-match]')) b.disabled = false;
      }
    }
    syncRoster() {
      const t = this.telemetry;
      if (!t) return;
      const mode = t.mode,
        n = t.agents.length;
      if (this.rosterMode === mode) return;
      this.rosterMode = mode;
      document.body.dataset.match = mode;
      this.lastJournal = '';
      this.archiveSignature = '';
      for (const b of document.querySelectorAll('[data-doubles]')) {
        b.hidden = n < 4;
        if (b.tagName === 'OPTION') b.disabled = n < 4;
      }
      for (const b of document.querySelectorAll('[data-match]'))
        b.setAttribute('aria-pressed', String(b.dataset.match === mode));
      $('mode').value = mode;
      $('team0').title = n === 4 ? 'Mica + Slate' : 'Mica';
      $('team1').title = n === 4 ? 'Ember + Sienna' : 'Ember';
      $('sparLabel').textContent = n === 4 ? 'Orange team policies' : 'Ember policy';
      $('sparHelp').textContent =
        n === 4
          ? 'The archived orange team is frozen. Both blue agents keep learning; the two live orange policies are kept aside.'
          : "Archived Ember is frozen. Mica can learn against that snapshot; Ember's live policy is kept safely aside.";
      if (this.agent >= n) this.selectAgent(0);
      if (n < 4 && ['slate', 'sienna'].includes(this.renderer.mode)) this.view('arena');
      this.updatePortrait();
    }
    // ---- Inspector, tabs, camera and playback ----
    openInspector(on = true) {
      if (on && !this.drawer) this.drawerReturn = document.activeElement;
      this.drawer = on;
      $('inspector').hidden = !on;
      document.body.classList.toggle('drawer', on);
      $('inspectButton').setAttribute('aria-expanded', on);
      this.send({ type: 'inspect', value: on });
      this.renderer.resize();
      if (on) {
        this.updateAgent();
        this.updatePortrait();
        if (this.tab === 'discoveries') {
          this.badge = 0;
          $('badge').hidden = true;
          this.renderJournal();
        }
        this.updateSettings();
      } else $('inspectButton').focus({ preventScroll: true });
      // Below 1200px the drawer covers the arena, so it behaves as a modal dialog.
      const modal = innerWidth < 1200;
      $('drawerScrim').hidden = !on || !modal;
      $('inspector').setAttribute('role', 'dialog');
      $('inspector').setAttribute('aria-modal', String(modal));
      if (on) {
        $('closeInspector').focus({ preventScroll: true });
        if (modal) $('game').inert = true;
      } else {
        $('game').inert = false;
        if (this.drawerReturn?.isConnected && this.drawerReturn?.focus)
          this.drawerReturn.focus({ preventScroll: true });
      }
    }
    setTab(tab) {
      this.tab = tab;
      for (const id of ['now', 'discoveries', 'lab']) {
        $('panel-' + id).hidden = id !== tab;
        $('tab-' + id).setAttribute('aria-selected', id === tab);
        $('tab-' + id).tabIndex = id === tab ? 0 : -1;
      }
      if (tab === 'discoveries') {
        this.badge = 0;
        $('badge').hidden = true;
        this.renderJournal();
      }
      if (tab === 'lab') this.updateSettings();
    }
    selectAgent(id) {
      if (!Number.isInteger(id) || id < 0 || id >= (this.telemetry?.agents.length || 2)) return;
      this.agent = id;
      for (const b of document.querySelectorAll('[data-agent]')) {
        const active = +b.dataset.agent === id;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active);
      }
      this.updateAgent();
      this.updatePortrait();
    }
    // A goal cuts to the ball camera, then hands the view back. The cut never changes simulation
    // speed. Choosing a camera by hand stands the director down; it never interrupts driving or a replay.
    startDirectorCut() {
      const now = performance.now();
      if (
        !this.director ||
        this.directorCut ||
        this.replay ||
        this.tool ||
        (this.telemetry?.human ?? -1) >= 0 ||
        now < this.directorPausedUntil
      )
        return;
      this.directorCut = { until: now + 3400, view: this.renderer.mode };
      this.view('ball');
    }
    endDirectorCut() {
      const cut = this.directorCut;
      if (!cut) return;
      this.directorCut = null;
      if (!this.replay && (this.telemetry?.human ?? -1) < 0) this.view(cut.view);
    }
    view(mode) {
      if (
        (mode === 'slate' || mode === 'sienna') &&
        (this.replay?.frames?.[0]?.cars.length || this.b?.cars.length || 2) < 4
      )
        mode = 'arena';
      $('stage').dataset.camera = mode;
      $('resetCamera').hidden = true;
      for (const b of document.querySelectorAll('#cameraChapters [data-view]'))
        b.setAttribute('aria-pressed', String(b.dataset.view === mode));
      this.renderer.setView(mode);
      $('camera').value = mode;
      $('viewName').textContent =
        {
          arena: 'OVERVIEW',
          mica: 'FOLLOW / MICA',
          ember: 'FOLLOW / EMBER',
          ball: 'BALL CAM',
          slate: 'FOLLOW / SLATE',
          sienna: 'FOLLOW / SIENNA'
        }[mode] || 'OVERVIEW';
    }
    pause() {
      if (this.replay) {
        this.stopReplay();
        return;
      }
      this.paused = !this.paused;
      this.send({ type: 'pause', value: this.paused });
    }
    async startReplay(p) {
      try {
        const r = await this.request('replay', { idValue: p.id });
        this.replay = { ...r, elapsed: 0, index: 0, oldView: this.renderer.mode };
        this.tool = null;
        this.openInspector(false);
        this.view('arena');
        $('ribbon').hidden = false;
        $('ribbonText').textContent = 'RECORDED / ' + names[p.agent].toUpperCase();
        $('ribbonExit').textContent = 'Return live';
        $('notice').classList.remove('show');
        this.renderer.particles = [];
        this.renderer.ballTrail = [];
        this.renderer.trails = [[], [], [], []];
      } catch (e) {
        this.toast(e.message);
      }
    }
    stopReplay() {
      if (this.replay) {
        const view = this.replay.oldView;
        this.replay = null;
        this.send({ type: 'live' });
        this.view(view);
        $('ribbon').hidden = true;
        $('replayProgress').style.width = '0%';
        this.renderer.ballTrail = [];
        this.renderer.trails = [[], [], [], []];
      }
      // Replays repaint the turf from recorded frames; always restore the live surface.
      this.renderer.fieldRevision = -1;
      if (this.detail?.field) this.renderer.updateField(this.detail.field);
    }
    setTool(tool) {
      this.stopReplay();
      this.tool = tool;
      if (tool) {
        this.openInspector(false);
        $('ribbon').hidden = false;
        $('ribbonText').textContent =
          { wet: 'WATER', heat: 'HEAT', sphere: 'HEAVY BALL', impulse: 'IMPULSE', gust: 'WIND GUST' }[tool] +
          ' / CLICK THE FIELD';
        $('ribbonExit').textContent = 'Cancel';
        $('arena').style.cursor = 'crosshair';
      } else {
        $('ribbon').hidden = true;
        $('arena').style.cursor = '';
      }
    }
    async human(on) {
      this.stopReplay();
      this.setTool(null);
      await this.request('human', { value: on });
      this.manual = {};
      if (on) {
        this.openInspector(false);
        this.view('mica');
        $('ribbon').hidden = false;
        $('ribbonText').textContent = 'YOU ARE DRIVING MICA';
        $('ribbonExit').textContent = 'Hand back';
        $('arena').focus({ preventScroll: true });
        this.toast('WASD / arrows drive. Shift boost. Space jump. Ctrl powerslide.');
      } else {
        $('ribbon').hidden = true;
        this.view('arena');
      }
    }
    toast(message) {
      $('toast').textContent = message;
      $('toast').hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
    }
    async export() {
      try {
        const data = await this.request('export');
        this.persist(data);
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
          a = document.createElement('a');
        a.href = url;
        a.download = 'bo-ket-league-' + data.mode + '-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        this.toast('Full world saved to file.');
      } catch (e) {
        this.toast(e.message);
      }
    }
    async import(file) {
      if (!file) return;
      try {
        if (file.size > 24 * 1024 * 1024) throw Error('World file exceeds the 24 MB limit.');
        const data = JSON.parse(await file.text());
        await this.request('import', { data });
        this.stopReplay();
        this.setTool(null);
        this.badge = 0;
        $('badge').hidden = true;
        this.lastJournal = '';
        this.toast(
          ['touchline-world-v7', 'touchline-world-v11'].includes(data.format)
            ? data.universe?.plannerVersion === 11
              ? 'World resumed: physics, weather and learning restored.'
              : 'World restored with the team-aware 11 planner. Physical state and weights are retained; future decisions can differ.'
            : 'Legacy policy migrated; new weather features start at zero.'
        );
      } catch (e) {
        this.toast('Import rejected: ' + e.message);
      } finally {
        $('importFile').value = '';
      }
    }
    bind() {
      $('xray').onclick = () => {
        this.renderer.xray = !this.renderer.xray;
        $('xray').setAttribute('aria-pressed', String(this.renderer.xray));
        $('hullNote').hidden = !this.renderer.xray;
        this.updatePortrait();
      };
      for (const b of document.querySelectorAll('#cameraChapters [data-view]'))
        b.onclick = () => {
          this.directorPausedUntil = performance.now() + 20000;
          this.endDirectorCut();
          this.view(b.dataset.view);
        };
      const click = (id, fn) => $(id).addEventListener('click', fn);
      click('theme', () =>
        this.setTheme(this.paletteMode === 'auto' ? 'night' : this.paletteMode === 'night' ? 'day' : 'auto')
      );
      $('palette').onchange = e => this.setTheme(e.target.value);
      click('focus', () => this.focusView());
      click('settingsButton', () => {
        this.setTab('lab');
        this.openInspector(true);
      });
      click('inspectButton', () => this.openInspector(!this.drawer));
      click('closeInspector', () => this.openInspector(false));
      for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => this.setTab(b.dataset.tab);
      for (const b of document.querySelectorAll('[data-agent]')) b.onclick = () => this.selectAgent(+b.dataset.agent);
      document.querySelector('.panel-nav').onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const tabs = ['now', 'discoveries', 'lab'];
        let i = tabs.indexOf(this.tab);
        i = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowLeft' ? 2 : 1)) % 3;
        this.setTab(tabs[i]);
        $('tab-' + tabs[i]).focus();
      };
      click('play', () => this.pause());
      $('speed').onchange = e => this.send({ type: 'speed', value: +e.target.value });
      $('camera').onchange = e => this.view(e.target.value);
      click('followAgent', () => {
        this.view(views[this.agent]);
        this.openInspector(false);
      });
      click('noticeButton', () => {
        this.setTab('discoveries');
        this.openInspector(true);
        $('notice').classList.remove('show');
      });
      click('sound', async () => {
        try {
          const on = await this.audio.toggle();
          $('sound').setAttribute('aria-pressed', on);
          $('sound').setAttribute('aria-label', on ? 'Mute sound' : 'Enable sound');
          $('sound').innerHTML = on
            ? '<svg viewBox="0 0 18 18"><path d="M8 4 4 7H2v4h2l4 3zM12 6q4 3 0 6m2-8q6 5 0 10"/></svg>'
            : '<svg viewBox="0 0 18 18"><path d="M8 4 4 7H2v4h2l4 3zM12 7l4 4m0-4-4 4"/></svg>';
        } catch (e) {
          this.toast('Audio unavailable: ' + e.message);
        }
      });
      click('fullscreen', () => this.fullscreen());
      click('learning', () => this.send({ type: 'learning', value: !this.telemetry?.learning }));
      $('mode').onchange = e => this.changeMatch(e.target.value);
      $('graphics').onchange = e => this.switchGraphics(e.target.value);
      $('quality').onchange = e => {
        this.renderer.quality = e.target.value;
        this.renderer.resize();
        this.savePreferences();
      };
      $('frameLimit').onchange = e => {
        this.frameLimit = +e.target.value;
        this.savePreferences();
      };
      click('director', () => {
        this.director = !this.director;
        $('director').setAttribute('aria-checked', this.director);
        if (!this.director) this.endDirectorCut();
        this.savePreferences();
      });
      for (const [id, key] of [
        ['labels', 'labels'],
        ['effects', 'fx'],
        ['paths', 'routes']
      ])
        click(id, () => {
          this.renderer[key] = !this.renderer[key];
          $(id).setAttribute('aria-checked', this.renderer[key]);
          this.savePreferences();
        });
      click('drive', () => this.human(this.telemetry?.human < 0));
      for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => this.setTool(b.dataset.tool);
      click('life', () => this.send({ type: 'life', value: !this.telemetry?.life }));
      $('grip').oninput = e => this.send({ type: 'world', grip: +e.target.value });
      $('gravity').oninput = e => this.send({ type: 'world', gravity: +e.target.value });
      click('clearWorld', () => this.send({ type: 'clearWorld' }));
      click('export', () => this.export());
      click('import', () => $('importFile').click());
      $('importFile').onchange = e => this.import(e.target.files[0]);
      click('reset', () => $('resetDialog').showModal());
      click('cancelReset', () => $('resetDialog').close());
      click('confirmReset', async () => {
        try {
          await this.request('reset');
          $('resetDialog').close();
          this.badge = 0;
          $('badge').hidden = true;
          this.lastJournal = '';
          this.toast('Learners restarted. The physical world continues.');
        } catch (e) {
          $('resetDialog').close();
          this.toast(e.message);
        }
      });
      click('ribbonExit', () => {
        if (this.replay) this.stopReplay();
        else if (this.tool) this.setTool(null);
        else if (this.telemetry?.human >= 0) this.human(false);
      });
      click('reload', () => location.reload());
      click('restoreHUD', () => document.body.classList.remove('clean'));
      $('arena').addEventListener('pointerdown', e => {
        if (this.tool) {
          const p = this.renderer.unproject(e.clientX, e.clientY);
          if (Math.abs(p.x) > 44 || Math.abs(p.z) > 28) {
            this.toast('Choose a point inside the field.');
            return;
          }
          this.send({ type: 'intervene', kind: this.tool, ...p });
          this.setTool(null);
          return;
        }
        if (this.telemetry?.human >= 0) return;
        const rect = $('arena').getBoundingClientRect();
        const candidates = (this.b?.cars || [])
          .map(c => {
            const p = this.renderer.screenPoint(c.x, c.y, c.z);
            return { id: c.id, d: Math.hypot(p.x - (e.clientX - rect.left), p.y - (e.clientY - rect.top)) };
          })
          .sort((a, b) => a.d - b.d);
        if (candidates[0]?.d < 36) {
          this.selectAgent(candidates[0].id);
          this.setTab('now');
          this.openInspector(true);
        }
      });
      this.bindOrbit();
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => {
          cancelAnimationFrame(this.resizeFrame);
          this.resizeFrame = requestAnimationFrame(() => this.renderer.resize());
        });
        this.resizeObserver.observe($('arena'));
      }
      addEventListener('resize', () => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.renderer.resize(), 100);
      });
      document.addEventListener('visibilitychange', () => {
        this.send({ type: 'hidden', value: document.hidden });
        this.manual = {};
        this.send({ type: 'keys', value: {} });
        if (document.hidden) {
          this.audio.mute();
          this.request('export')
            .then(d => this.persist(d))
            .catch(() => {});
        } else {
          this.audio.resume();
          this.a = this.b;
          this.lastFrame = performance.now();
        }
      });
      addEventListener('blur', () => {
        this.manual = {};
        this.padInput = {};
        this.padSig = '';
        this.send({ type: 'keys', value: {} });
      });
      addEventListener('pagehide', () => {
        if (this.saved) this.persist(this.saved);
      });
      addEventListener('keydown', e => this.key(e, true));
      addEventListener('keyup', e => this.key(e, false));
      this.bindWorldControls();
      this.bindAccessibility();
      for (const b of document.querySelectorAll('[data-match]')) b.onclick = () => this.changeMatch(b.dataset.match);
    }
    bindWorldControls() {
      const ask = async (type, args = {}) => {
        try {
          return await this.request(type, args);
        } catch (e) {
          this.toast(e.message);
        }
      };
      $('weatherBadge').onclick = () => {
        this.setTab('lab');
        this.openInspector(true);
        $('panel-lab').scrollTop = 0;
      };
      $('weatherMode').onchange = e => ask('weather', { value: { mode: e.target.value } });
      $('dayLength').onchange = e => ask('weather', { value: { dayLength: +e.target.value } });
      for (const b of document.querySelectorAll('[data-hour]'))
        b.onclick = () => ask('weather', { value: { hour: +b.dataset.hour } });
      $('lifeMode').onchange = e => ask('lifeMode', { value: e.target.value });
      $('stormNow').onclick = () => ask('weather', { value: { mode: 'rain', windScale: 1.6 } });
      $('hourScrub').oninput = e => {
        const hour = +e.target.value;
        $('hourOut').textContent =
          String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.round((hour % 1) * 60)).padStart(2, '0');
        ask('weather', { value: { hour } });
      };
      $('bounce').oninput = e => ask('world', { bounce: +e.target.value });
      $('archiveNow').onclick = async () => {
        const a = await ask('archive');
        if (a) this.toast('Policy snapshot #' + a.id + ' saved.');
      };
      $('sparSelect').onchange = e => ask('spar', { value: e.target.value });
      $('evaluate').onclick = async () => {
        const data = await ask('evaluationData', { archiveId: +$('archiveSelect').value });
        if (data) this.runStudy('evaluate', data);
      };
      $('markMoment').onclick = async () => {
        const r = await ask('mark');
        if (r) this.toast('Moment saved at ' + fmt(r.time) + '. The live world continues.');
      };
      $('compareMoment').onclick = async () => {
        const data = await ask('branchData', { variant: $('branchVariant').value });
        if (data) this.runStudy('branch', data);
      };
      $('cancelJob').onclick = () => this.cancelStudy();
    }
    bindAccessibility() {
      $('recoverSave').onclick = () => {
        if (!this.saved) return;
        const text = typeof this.saved === 'string' ? this.saved : JSON.stringify(this.saved),
          url = URL.createObjectURL(new Blob([text], { type: 'application/json' })),
          a = document.createElement('a');
        a.href = url;
        a.download = 'bo-ket-league-last-available-backup.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      $('drawerScrim').onclick = () => this.openInspector(false);
      // Trap Tab focus inside the modal drawer.
      document.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || !this.drawer || innerWidth >= 1200) return;
        const nodes = [
          ...$('inspector').querySelectorAll('button:not([disabled]),select,input,summary,[tabindex="0"]')
        ].filter(n => n.getClientRects().length && !n.closest('[hidden]'));
        if (!nodes.length) return;
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
      addEventListener('resize', () => {
        if (!this.drawer) return;
        const modal = innerWidth < 1200;
        $('drawerScrim').hidden = !modal;
        $('game').inert = modal;
        $('inspector').setAttribute('aria-modal', String(modal));
      });
    }
    switchGraphics(preference, adaptive = false) {
      const old = this.renderer,
        props = {};
      for (const k of ['theme', 'mode', 'quality', 'fx', 'labels', 'routes', 'xray']) props[k] = old[k];
      for (const r of [old, old.fallback])
        if (r) {
          r.disposed = true;
          r.base?.remove();
          r.fieldLayer?.remove();
          r.front?.remove();
        }
      if (old.gl) old.gl.getExtension('WEBGL_lose_context')?.loseContext();
      root.touchlineGraphics = preference;
      this.renderer = adaptive ? new root.CanvasAtelier($('arena')) : new SmoothRenderer($('arena'));
      for (const [k, v] of Object.entries(props)) this.renderer[k] = v;
      this.renderer.setTheme(props.theme);
      this.renderer.setView(props.mode);
      this.renderer.resize();
      if (this.detail?.field) this.renderer.updateField(this.detail.field);
      this.updatePortrait();
      this.frameTimes = [];
      this.fps = 60;
      this.slowGraphics = 0;
      this.graphicsSince = performance.now();
      if (!adaptive) this.savePreferences();
      else this.toast('Switched to lighter graphics. The simulation is unchanged.');
    }
    adaptGraphics(now, dt) {
      this.adaptRenderer(now, dt);
      this.adaptCanvasResolution(now, dt);
    }
    // Sustained low fps on WebGL in automatic mode: switch to the lighter Canvas renderer.
    adaptRenderer(now, dt) {
      if (!this.graphicsSince) this.graphicsSince = now;
      if (
        root.touchlineGraphics !== 'auto' ||
        !this.renderer.gl ||
        this.renderer.fallback ||
        this.paused ||
        this.replay ||
        document.hidden ||
        this.frameLimit < 50 ||
        now - this.graphicsSince < 6000
      )
        return;
      this.slowGraphics =
        this.fps < 38 ? (this.slowGraphics || 0) + Math.min(dt, 0.25) : Math.max(0, (this.slowGraphics || 0) - dt * 2);
      if (this.slowGraphics > 4) this.switchGraphics('auto', true);
    }
    // Sustained pressure on the Canvas renderer: step its backing resolution down, to 82% at most.
    adaptCanvasResolution(now, dt) {
      const parent = this.renderer,
        r = parent.fallback || parent;
      if (
        !(r instanceof CanvasAtelier) ||
        parent.quality !== 'auto' ||
        this.paused ||
        this.replay ||
        document.hidden ||
        this.frameLimit < 50 ||
        now - (this.scaledAt || this.graphicsSince || now) < 5000
      )
        return;
      this.canvasPressure =
        this.fps < 48 || r.renderMs > 12
          ? (this.canvasPressure || 0) + Math.min(dt, 0.25)
          : Math.max(0, (this.canvasPressure || 0) - dt * 2);
      if (this.canvasPressure < 2.5 || (r.resolutionScale || 1) <= 0.8201) return;
      const camera = {
        orbitYaw: r.orbitYaw,
        orbitPitch: r.orbitPitch,
        camYaw: r.camYaw,
        camPitch: r.camPitch,
        cameraSize: r.cameraSize
      };
      r.resolutionScale = Math.max(0.82, (r.resolutionScale || 1) - 0.1);
      r.resize();
      Object.assign(r, camera);
      if (parent !== r) parent.copyFallback();
      this.scaledAt = now;
      this.canvasPressure = 0;
      if (!this.scaleNotice) {
        this.scaleNotice = true;
        this.toast('Balanced graphics adjusted for smoother playback. Physics and learning are unchanged.');
      }
    }
    bindOrbit() {
      const canvas = $('arena');
      let drag = null;
      canvas.addEventListener('pointerdown', e => {
        if (
          this.tool ||
          this.telemetry?.human >= 0 ||
          this.drawer ||
          !this.renderer.orbit ||
          this.renderer.mode !== 'arena' ||
          e.button !== 0
        )
          return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) drag.moved = true;
        if (drag.moved) {
          this.renderer.orbit(dx, dy);
          canvas.classList.add('dragging');
          $('resetCamera').hidden = false;
        }
        drag.x = e.clientX;
        drag.y = e.clientY;
      });
      const release = e => {
        if (!drag || drag.id !== e.pointerId) return;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
        drag = null;
        canvas.classList.remove('dragging');
      };
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
      $('resetCamera').onclick = () => {
        this.renderer.resetCamera?.();
        $('resetCamera').hidden = true;
      };
    }
    key(e, down) {
      if (e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      if (key === 'escape' && down) {
        if ($('resetDialog').open) return;
        if (this.replay) this.stopReplay();
        else if (this.tool) this.setTool(null);
        else if (this.telemetry?.human >= 0) this.human(false);
        else this.openInspector(false);
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
      if (
        ['BUTTON', 'SUMMARY'].includes(e.target.tagName) &&
        [' ', 'enter', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)
      )
        return;
      const map = {
        w: 'forward',
        arrowup: 'forward',
        s: 'reverse',
        arrowdown: 'reverse',
        a: 'left',
        arrowleft: 'left',
        d: 'right',
        arrowright: 'right',
        shift: 'boost',
        ' ': 'jump',
        control: 'drift',
        q: 'rollLeft',
        e: 'rollRight'
      };
      if (this.telemetry?.human >= 0 && map[key]) {
        e.preventDefault();
        this.manual[map[key]] = down;
        this.send({ type: 'keys', value: { ...this.manual, ...this.padInput } });
        return;
      }
      if (!down || e.repeat) return;
      if (key === 'p' || key === ' ') {
        e.preventDefault();
        this.pause();
      }
      if (['1', '2', '3', '4', '5', '6'].includes(key))
        this.view(['arena', 'mica', 'ember', 'ball', 'slate', 'sienna'][+key - 1]);
      if (key === 'i') this.openInspector(!this.drawer);
      if (key === 'h') this.focusView();
      if (key === 'f') this.fullscreen();
      if (key === '[' || key === ']') this.stepSpeed(key === ']' ? 1 : -1);
    }
    stepSpeed(direction) {
      const speeds = [0.5, 1, 2, 4],
        current = speeds.indexOf(+$('speed').value),
        next = speeds[clamp((current < 0 ? 1 : current) + direction, 0, speeds.length - 1)];
      $('speed').value = String(next);
      this.send({ type: 'speed', value: next });
      this.toast('Simulation speed ' + next + 'x.');
    }
    // A standard-mapping gamepad drives Mica: left stick steers (and pitches in the air), right and left
    // triggers throttle and reverse, A jumps, B boosts, X powerslides, bumpers air-roll. Start takes or
    // hands back control. Only non-neutral inputs are sent, so the keyboard keeps working alongside it.
    pollGamepad() {
      const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected && p.mapping === 'standard');
      if (!pad) return;
      const pressed = i => !!pad.buttons[i]?.pressed,
        value = i => pad.buttons[i]?.value || 0,
        deadzone = v => (Math.abs(v) < 0.15 ? 0 : (Math.sign(v) * (Math.abs(v) - 0.15)) / 0.85),
        step = v => Math.round(v * 50) / 50;
      const start = pressed(9);
      if (start && !this.padStart && this.telemetry) this.human(this.telemetry.human < 0);
      this.padStart = start;
      if (!(this.telemetry?.human >= 0)) return;
      const input = {},
        axes = {
          throttle: step(value(7) - value(6)),
          steer: step(deadzone(pad.axes[0] || 0)),
          pitch: step(deadzone(pad.axes[1] || 0)),
          roll: (pressed(5) ? 1 : 0) - (pressed(4) ? 1 : 0)
        };
      for (const [k, v] of Object.entries(axes)) if (v) input[k] = v;
      if (pressed(0)) input.jump = true;
      if (pressed(1)) input.boost = true;
      if (pressed(2)) input.drift = true;
      const sig = JSON.stringify(input);
      if (sig === this.padSig) return;
      this.padSig = sig;
      this.padInput = input;
      this.send({ type: 'keys', value: { ...this.manual, ...input } });
    }
    async fullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        this.toast('Fullscreen is unavailable here. The arena still works in this window.');
      }
    }
  }
  root.PocketApp = App;
  try {
    root.app = new App();
  } catch (e) {
    $('bootText').textContent = 'Could not open the arena: ' + e.message;
    $('reload').hidden = false;
    console.error(e);
  }
})(globalThis);
