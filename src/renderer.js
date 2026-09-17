/* Touchline 06 / smooth, antialiased architectural renderer.
   Continuous projected geometry; bounded high-DPI backing stores; cached static layers.
   No engine, policy, physics, or observer state is modified by presentation. */
(function (root) {
  'use strict';
  const { clamp, lerp, Q, RNG } = TM;
  // Presentation only. Neither palette nor camera can alter the simulation.
  const PALETTES = {
    day: {
      bg: '#edede5',
      dark: '#173732',
      edge: '#cbdad1',
      side: '#9bb3a7',
      rim: '#eff2e8',
      turf: '#315f53',
      turf2: '#336255',
      line: '#a5bdab',
      cream: '#f6f2dc',
      mint: '#d5e89e',
      blue: '#78b9db',
      orange: '#ec9b69',
      blueDark: '#315e78',
      orangeDark: '#ab5939',
      concrete: '#e1e8dc',
      concreteSide: '#91a99a',
      seat: '#4a6b5b',
      seat2: '#638372',
      sign: '#e4ebde',
      signText: '#244537',
      groundShadow: '#81988c',
      carBlue: '#529bc3',
      carBlueLight: '#93cfe4',
      carBlueSide: '#337398',
      carOrange: '#df754b',
      carOrangeLight: '#f6ae76',
      carOrangeSide: '#af4f35'
    },
    night: {
      bg: '#101c1f',
      dark: '#142b2a',
      edge: '#6f9185',
      side: '#45665b',
      rim: '#c8d7c4',
      turf: '#284e43',
      turf2: '#2a5146',
      line: '#85a291',
      cream: '#f1f1d6',
      mint: '#d7e69b',
      blue: '#9acbe6',
      orange: '#f2ae7d',
      blueDark: '#3d6e84',
      orangeDark: '#9e6145',
      concrete: '#91aa97',
      concreteSide: '#4c6a5b',
      seat: '#375b49',
      seat2: '#527562',
      sign: '#a0b59d',
      signText: '#1e3f32',
      groundShadow: '#061a16',
      carBlue: '#79b5d7',
      carBlueLight: '#b9e2ee',
      carBlueSide: '#4e8aaf',
      carOrange: '#e68e5f',
      carOrangeLight: '#f5c491',
      carOrangeSide: '#b86a45'
    }
  };
  const C = { ...PALETTES.day };
  const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  // Text stays vector-sharp. Kept as a public compatibility helper for the app.
  function pixelText(ctx, text, x, y, col = C.cream, scale = 1, align = 'left') {
    ctx.save();
    ctx.fillStyle = col;
    ctx.font = 8 * scale + 'px Arial, Helvetica, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  }
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.quality = 'auto';
      this.xray = false;
      this.theme = 'day';
      this.mode = 'arena';
      this.zoom = 1;
      this.yaw = -0.3;
      this.pitch = 0.66;
      this.up = 0.79;
      this.offset = [0, 0];
      this.focus = [0, 0];
      this.particles = [];
      this.trails = [[], [], [], []];
      this.ballTrail = [];
      this.lastTime = 0;
      this.fx = true;
      this.labels = true;
      this.routes = false;
      this.field = null;
      this.fieldRevision = -1;
      this.weather = null;
      this.renderMs = 0;
      this.frames = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      if (
        this.base &&
        this.cssW === r.width &&
        this.cssH === r.height &&
        this.lastQuality === this.quality &&
        this.lastDpr === (devicePixelRatio || 1)
      )
        return;
      this.lastQuality = this.quality;
      this.lastDpr = devicePixelRatio || 1;
      this.cssW = Math.max(1, r.width);
      this.cssH = Math.max(1, r.height);
      // Native/supersampled geometry, never nearest-neighbour upscaling. Backing stores
      // are capped at 2.5M pixels, including on 4K/high-DPI monitors.
      const dpr = Math.min(devicePixelRatio || 1, 2),
        target =
          this.quality === 'coarse'
            ? 1
            : this.quality === 'fine'
              ? Math.max(1.6, dpr)
              : Math.max(1.25, Math.min(dpr, 1.5));
      this.density = Math.min(target, 1920 / this.cssW, Math.sqrt(2500000 / (this.cssW * this.cssH)));
      this.w = Math.max(160, Math.round(this.cssW * this.density));
      this.h = Math.max(120, Math.round(this.cssH * this.density));
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.ratioX = this.cssW / this.w;
      this.ratioY = this.cssH / this.h;
      this.portrait = this.cssW < 620 && this.cssH > this.cssW * 0.86;
      this.yaw = this.portrait ? -1.44 : -0.33;
      this.cs = Math.cos(this.yaw);
      this.sn = Math.sin(this.yaw);
      this.pitch = this.portrait ? 0.91 : 0.58;
      this.up = this.portrait ? 0.415 : 0.815;
      const rw = 105 * Math.abs(this.cs) + 78 * Math.abs(this.sn),
        rh = (105 * Math.abs(this.sn) + 78 * Math.abs(this.cs)) * this.pitch + 15 * this.up;
      this.scale = Math.min((this.w * (this.portrait ? 0.95 : 0.94)) / rw, ((this.h - 65 * this.density) * 0.99) / rh);
      this.cx = this.w / 2;
      this.cy = this.h * (this.portrait ? 0.54 : 0.56);
      this.focus = [0, 0];
      this.offset = [0, 0];
      this.base = this.base || makeCanvas(1, 1);
      this.front = this.front || makeCanvas(1, 1);
      this.fieldLayer = this.fieldLayer || makeCanvas(1, 1);
      this.backdrop = this.backdrop || makeCanvas(1, 1);
      for (const layer of [this.fieldLayer, this.backdrop]) {
        layer.width = this.w;
        layer.height = this.h;
      }
      this.mountLayers();
      this.buildArena();
      this.fieldRevision = -1;
      if (this.field) this.updateField(this.field);
    }
    mountLayers() {
      // Static canvases become compositor layers. Camera motion never resamples the
      // entire stadium inside the dynamic drawing canvas on every display frame.
      const parent = this.canvas.parentElement;
      if (!parent) return;
      for (const [layer, z] of [
        [this.base, 1],
        [this.fieldLayer, 2]
      ]) {
        layer.setAttribute('aria-hidden', 'true');
        layer.className = 'scene-cache';
        Object.assign(layer.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: String(z),
          transformOrigin: '0 0',
          willChange: 'transform',
          imageRendering: 'auto'
        });
        if (layer.parentElement !== parent) parent.insertBefore(layer, this.canvas);
      }
      this.canvas.style.zIndex = '3';
      this.fieldLayer.hidden = true;
      this.layerTransform = '';
    }
    setTheme(theme) {
      this.theme = theme === 'night' ? 'night' : 'day';
      Object.assign(C, PALETTES[this.theme]);
      this.buildArena();
      this.fieldRevision = -1;
      if (this.field) this.updateField(this.field);
    }
    project(x, y, z) {
      return [
        this.cx + (x * this.cs - z * this.sn) * this.scale,
        this.cy + ((x * this.sn + z * this.cs) * this.pitch - y * this.up) * this.scale
      ];
    }
    unproject(screenX, screenY) {
      const r = this.canvas.getBoundingClientRect();
      let u = (screenX - r.left) / this.ratioX,
        v = (screenY - r.top) / this.ratioY;
      u = (u - this.cx) / this.zoom + this.cx - this.offset[0];
      v = (v - this.cy) / this.zoom + this.cy - this.offset[1];
      const a = (u - this.cx) / this.scale,
        b = (v - this.cy) / (this.scale * this.pitch);
      return { x: a * this.cs + b * this.sn, z: -a * this.sn + b * this.cs };
    }
    screenPoint(x, y, z) {
      let p = this.project(x, y, z);
      p = [
        this.cx + (p[0] + this.offset[0] - this.cx) * this.zoom,
        this.cy + (p[1] + this.offset[1] - this.cy) * this.zoom
      ];
      return { x: p[0] * this.ratioX, y: p[1] * this.ratioY };
    }
    poly(ctx, pts, color, line = null) {
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = this.project(...p);
        i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
      });
      ctx.closePath();
      if (color) {
        ctx.fillStyle = color;
        ctx.fill();
      }
      if (line) {
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    line(ctx, pts, color, width = 1) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = this.project(...p);
        i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width * (this.density || 1);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ring(ctx, x, z, r, color, width = 1, y = 0.04) {
      let pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
      }
      this.line(ctx, pts, color, width);
    }
    rect(ctx, x0, z0, x1, z1, y, color, line = null) {
      this.poly(
        ctx,
        [
          [x0, y, z0],
          [x1, y, z0],
          [x1, y, z1],
          [x0, y, z1]
        ],
        color,
        line
      );
    }
    box(ctx, x, y, z, wx, wy, wz, top, side = top, end = side) {
      this.poly(
        ctx,
        [
          [x - wx / 2, y - wy / 2, z + wz / 2],
          [x + wx / 2, y - wy / 2, z + wz / 2],
          [x + wx / 2, y + wy / 2, z + wz / 2],
          [x - wx / 2, y + wy / 2, z + wz / 2]
        ],
        side
      );
      this.poly(
        ctx,
        [
          [x - wx / 2, y - wy / 2, z - wz / 2],
          [x - wx / 2, y - wy / 2, z + wz / 2],
          [x - wx / 2, y + wy / 2, z + wz / 2],
          [x - wx / 2, y + wy / 2, z - wz / 2]
        ],
        end
      );
      this.rect(ctx, x - wx / 2, z - wz / 2, x + wx / 2, z + wz / 2, y + wy / 2, top);
    }
    outline(x, z, r, y = 0) {
      const pts = [];
      for (const [cx, cz, a0] of [
        [x - r, z - r, 0],
        [-x + r, z - r, 90],
        [-x + r, -z + r, 180],
        [x - r, -z + r, 270]
      ])
        for (let i = 0; i <= 18; i++) {
          const a = ((a0 + i * 5) * Math.PI) / 180;
          pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
        }
      return pts;
    }
    buildArena() {
      // Follow cameras receive a denser static cache once per view change, rather
      // than redrawing the stadium each frame or magnifying low-resolution pixels.
      const cacheScale = Math.min(
        this.quality === 'coarse' ? 1 : this.mode === 'arena' ? 1.15 : 1.65,
        Math.sqrt(3000000 / (this.w * this.h))
      );
      for (const layer of [this.base, this.front]) {
        const lw = Math.round(this.w * cacheScale),
          lh = Math.round(this.h * cacheScale);
        if (layer.width !== lw) layer.width = lw;
        if (layer.height !== lh) layer.height = lh;
        layer.getContext('2d').setTransform(cacheScale, 0, 0, cacheScale, 0, 0);
      }
      const c = this.base.getContext('2d');
      c.clearRect(0, 0, this.w, this.h);
      const f = this.front.getContext('2d');
      f.clearRect(0, 0, this.w, this.h);
      const bg = this.backdrop.getContext('2d');
      bg.fillStyle = C.bg;
      bg.fillRect(0, 0, this.w, this.h);
      // A quiet studio backdrop. Broad light/shadow is baked, not postprocessed.
      const sky = bg.createLinearGradient(0, 0, this.w, this.h);
      sky.addColorStop(0, this.theme === 'night' ? '#101c1f' : '#eeeee6');
      sky.addColorStop(1, C.bg);
      bg.fillStyle = sky;
      bg.fillRect(0, 0, this.w, this.h);
      const sh = this.project(3, -4.5, 5);
      c.save();
      c.translate(sh[0], sh[1]);
      c.rotate(-0.12);
      c.scale(1, 0.44);
      const rr = 57 * this.scale,
        g = c.createRadialGradient(0, 0, rr * 0.4, 0, 0, rr);
      g.addColorStop(0, this.theme === 'night' ? 'rgba(3,16,9,.48)' : 'rgba(46,72,58,.22)');
      g.addColorStop(0.72, this.theme === 'night' ? 'rgba(3,16,9,.18)' : 'rgba(46,72,58,.09)');
      g.addColorStop(1, 'rgba(46,72,58,0)');
      c.fillStyle = g;
      c.fillRect(-rr, -rr, rr * 2, rr * 2);
      c.restore();
      const top = this.outline(49.6, 32.1, 7, -0.5),
        bottom = top.map(p => [p[0], -3, p[2]]);
      for (let i = 0; i < top.length; i++) {
        const j = (i + 1) % top.length;
        this.poly(c, [top[i], top[j], bottom[j], bottom[i]], top[i][2] > 0 ? C.concreteSide : C.side);
      }
      this.poly(c, top, C.concrete);
      this.line(c, top.concat([top[0]]), C.rim, 0.7);
      this.poly(c, this.outline(48.4, 30.9, 6, -0.42), C.dark);
      // Continuous architectural tiers, with fine, curved chair backs. Sparse detail
      // has more definition than the previous block-by-block pixel grandstand.
      for (let row = 3; row >= 0; row--) {
        const z = -29.6 - row * 1.6,
          y = 0.85 + row * 1.1;
        this.box(c, 0, y, z, 75, 0.7, 1.8, C.concrete, C.concreteSide, C.side);
        for (let x = -35; x < 36; x += 1.9) {
          if (Math.abs(x) < 1.3 || Math.abs(x - 25) < 1.4 || Math.abs(x + 25) < 1.4) continue;
          this.rect(c, x - 0.57, z - 0.47, x + 0.57, z + 0.45, y + 0.43, row % 2 ? C.seat : C.seat2);
          this.line(
            c,
            [
              [x - 0.57, y + 0.68, z - 0.35],
              [x - 0.48, y + 0.88, z - 0.39],
              [x + 0.48, y + 0.88, z - 0.39],
              [x + 0.57, y + 0.68, z - 0.35]
            ],
            C.seat,
            1.1
          );
        }
      }
      // Recessed access aisles and the very thin roof lift the object off the turf.
      for (const x of [-25, 0, 25])
        for (let i = 0; i < 4; i++)
          this.rect(c, x - 0.9, -30.5 - i * 1.6, x + 0.9, -29 - i * 1.6, 1.31 + i * 1.1, C.concrete);
      for (const x of [-37, 37]) this.box(c, x, 4.1, -34.5, 0.45, 8.4, 0.6, C.rim, C.concreteSide, C.side);
      this.box(c, 0, 7.7, -34.9, 78, 0.48, 5.7, C.rim, C.concrete, C.concreteSide);
      this.line(
        c,
        [
          [-39, 7.98, -32.05],
          [39, 7.98, -32.05]
        ],
        C.cream,
        0.75
      );
      this.box(c, 0, 8.45, -36.5, 23, 1.8, 0.46, C.sign, C.sign, C.sign);
      const sign = this.project(0, 9, -36.18);
      pixelText(c, 'T O U C H L I N E', sign[0], sign[1], C.signText, this.scale * 0.17, 'center');
      // Floodlights remain graphic physical fixtures; no expensive light passes.
      for (const x of [-42, 42]) {
        this.box(c, x, 5.6, -29.5, 0.32, 11.8, 0.42, C.rim, C.concreteSide, C.side);
        this.box(c, x, 11.6, -29.5, 4.9, 1.05, 0.65, C.concrete, C.cream, C.side);
        for (let i = 0; i < 3; i++) {
          const p = this.project(x - 1.5 + i * 1.5, 11.65, -29.1);
          c.fillStyle = this.theme === 'night' ? C.cream : '#e8e7c6';
          c.beginPath();
          c.arc(p[0], p[1], 1.05 * (this.density || 1), 0, Math.PI * 2);
          c.fill();
        }
      }
      this.poly(c, this.outline(44, 28, 8, 0.02), C.turf);
      c.save();
      const bounds = this.outline(44, 28, 8, 0.02).map(p => this.project(...p));
      c.beginPath();
      bounds.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
      c.closePath();
      c.clip();
      for (let i = 0; i < 12; i++)
        if (i % 2) this.rect(c, -44 + (i * 88) / 12, -28, -44 + ((i + 1) * 88) / 12, 28, 0.022, C.turf2);
      // Fine, continuous mowing lines; no noisy square texture or grain.
      for (let x = -43; x < 44; x += 0.75)
        this.line(
          c,
          [
            [x, 0.028, -28],
            [x, 0.028, 28]
          ],
          this.theme === 'night' ? 'rgba(204,223,194,.013)' : 'rgba(213,231,205,.025)',
          0.35
        );
      // Shallow bank edging describes the curved physical boundary without a cage.
      this.line(
        c,
        this.outline(43.2, 27.2, 7.3, 0.08).concat([[43.2, 0.08, 19.9]]),
        this.theme === 'night' ? '#466651' : '#50795f',
        3
      );
      this.line(c, this.outline(41, 25, 6, 0.09).concat([[41, 0.09, 19]]), C.line, 0.7);
      this.line(
        c,
        [
          [0, 0.1, -25],
          [0, 0.1, 25]
        ],
        C.line,
        0.65
      );
      this.ring(c, 0, 0, 8, C.line, 0.7, 0.11);
      this.rect(c, -0.18, -0.18, 0.18, 0.18, 0.12, C.cream);
      for (const s of [-1, 1]) {
        this.line(
          c,
          [
            [s * 41, 0.11, -12],
            [s * 32, 0.11, -12],
            [s * 32, 0.11, 12],
            [s * 41, 0.11, 12]
          ],
          C.line,
          0.7
        );
        this.line(
          c,
          [
            [s * 41, 0.11, -7],
            [s * 37, 0.11, -7],
            [s * 37, 0.11, 7],
            [s * 41, 0.11, 7]
          ],
          C.line,
          0.6
        );
        this.ring(c, s * 27, 0, 0.25, C.line, 1, 0.11);
      }
      c.restore();
      // A far rail with two team-coloured inserts, rather than a busy perimeter.
      this.box(c, 0, 0.9, -28.1, 70, 1.8, 0.75, C.rim, C.concreteSide, C.side);
      this.line(
        c,
        [
          [-34, 1.86, -27.69],
          [34, 1.86, -27.69]
        ],
        C.rim,
        0.8
      );
      this.box(c, -27, 1, -27.64, 12, 0.8, 0.08, C.blueDark, C.blueDark, C.blueDark);
      this.box(c, 27, 1, -27.64, 12, 0.8, 0.08, C.orangeDark, C.orangeDark, C.orangeDark);
      for (const s of [-1, 1]) this.goal(c, s);
      // Keep the near rail low so it never hides either agent.
      this.line(
        f,
        [
          [-35, 0.45, 28],
          [35, 0.45, 28]
        ],
        C.rim,
        1.1
      );
      this.line(
        f,
        [
          [-35, -0.1, 28],
          [35, -0.1, 28]
        ],
        C.dark,
        1
      );
      for (let x = -28; x <= 28; x += 7)
        this.line(
          f,
          [
            [x, -0.65, 31.9],
            [x, -2.6, 31.9]
          ],
          this.theme === 'night' ? '#3d583f' : '#899f89',
          0.75
        );
      this.line(
        f,
        [
          [-33, -1.2, 32],
          [-21, -1.2, 32]
        ],
        C.blueDark,
        1.2
      );
      this.line(
        f,
        [
          [21, -1.2, 32],
          [33, -1.2, 32]
        ],
        C.orangeDark,
        1.2
      );
      // Consolidate the background and outer plinth into one opaque cached layer.
      // These details sit outside the playable boundary, so they do not hide cars.
      c.drawImage(this.front, 0, 0, this.w, this.h);
      c.save();
      c.globalCompositeOperation = 'destination-over';
      c.drawImage(this.backdrop, 0, 0);
      c.restore();
    }
    goal(c, s) {
      const x = s * 44,
        back = s * 49,
        col = s < 0 ? C.blue : C.orange,
        dark = s < 0 ? C.blueDark : C.orangeDark;
      this.rect(c, Math.min(x, back), -8.5, Math.max(x, back), 8.5, 0.05, dark);
      this.poly(
        c,
        [
          [back, 0, -8.5],
          [back, 0, 8.5],
          [back, 6.8, 8.5],
          [back, 6.8, -8.5]
        ],
        this.theme === 'night' ? '#24463c' : '#537766'
      );
      const net = this.theme === 'night' ? 'rgba(165,194,169,.5)' : 'rgba(199,218,197,.72)';
      for (let z = -8; z <= 8; z += 1.6)
        this.line(
          c,
          [
            [back, 0.3, z],
            [back, 6.8, z]
          ],
          net,
          0.55
        );
      for (let y = 1; y < 7; y += 1.25)
        this.line(
          c,
          [
            [back, y, -8.5],
            [back, y, 8.5]
          ],
          net,
          0.55
        );
      this.line(
        c,
        [
          [x, 0, -8.5],
          [x, 6.8, -8.5],
          [x, 6.8, 8.5],
          [x, 0, 8.5]
        ],
        C.rim,
        2
      );
      this.line(
        c,
        [
          [x, 0, -8.5],
          [x, 6.8, -8.5],
          [x, 6.8, 8.5],
          [x, 0, 8.5]
        ],
        col,
        0.8
      );
      this.line(
        c,
        [
          [back, 0, -8.5],
          [back, 6.8, -8.5],
          [x, 6.8, -8.5]
        ],
        C.rim,
        0.8
      );
      this.line(
        c,
        [
          [x, 6.8, 8.5],
          [back, 6.8, 8.5],
          [back, 0, 8.5]
        ],
        C.rim,
        0.8
      );
      for (let z = -7; z < 8; z += 2)
        this.line(
          c,
          [
            [x, 6.8, z],
            [back, 6.8, z]
          ],
          net,
          0.5
        );
      for (let y = 1.25; y < 6.5; y += 1.25)
        this.line(
          c,
          [
            [x, y, 8.5],
            [back, y, 8.5]
          ],
          net,
          0.5
        );
      for (const z of [-20, 20]) {
        this.box(c, s * 45, 0.8, z, 1.2, 1.6, 12, C.rim, C.concreteSide, C.side);
        this.line(
          c,
          [
            [s * 45, 1.7, z - 5.7],
            [s * 45, 1.7, z + 5.7]
          ],
          col,
          1.15
        );
      }
      for (let z = -5.6; z < 6; z += 2.8)
        this.line(
          c,
          [
            [s * 44.4, 0.11, z],
            [s * 47.6, 0.11, z + 1.6]
          ],
          col,
          0.6
        );
    }
    updateField(field) {
      this.field = field;
      if (this.fieldRevision === field.revision) return;
      this.fieldRevision = field.revision;
      const c = this.fieldLayer.getContext('2d');
      c.clearRect(0, 0, this.w, this.h);
      const nx = field.nx || 64,
        nz = field.nz || 40,
        quant = !!field.nx;
      this.chemistry = this.chemistry || makeCanvas(nx, nz);
      if (this.chemistry.width !== nx) this.chemistry.width = nx;
      if (this.chemistry.height !== nz) this.chemistry.height = nz;
      const small = this.chemistry.getContext('2d'),
        im = small.createImageData(nx, nz);
      let visible = false;
      for (let i = 0; i < nx * nz; i++) {
        const wet = (field.wet[i] || 0) / (quant ? 100 : 1),
          heat = (field.heat[i] || 0) / (quant ? 100 : 1),
          life = (field.life?.[i] || 0) / (quant ? 100 : 1);
        if (wet > 0.01 || heat > 0.04 || life) visible = true;
        const k = i * 4;
        im.data[k] = life > 0 ? 141 : wet > heat ? 121 : 204;
        im.data[k + 1] = life > 0 ? 179 : wet > heat ? 183 : 161;
        im.data[k + 2] = life > 0 ? 109 : wet > heat ? 190 : 108;
        im.data[k + 3] = Math.min(82, wet * 49 + heat * 22 + life * 27);
      }
      small.putImageData(im, 0, 0);
      c.save();
      const shape = this.outline(43.4, 27.4, 7.8, 0.06);
      c.beginPath();
      shape.forEach((p, i) => {
        const q = this.project(...p);
        i ? c.lineTo(...q) : c.moveTo(...q);
      });
      c.closePath();
      c.clip();
      const p = this.project(-44, 0.06, -28);
      c.setTransform(
        (88 / nx) * this.cs * this.scale,
        (88 / nx) * this.sn * this.pitch * this.scale,
        (-56 / nz) * this.sn * this.scale,
        (56 / nz) * this.cs * this.pitch * this.scale,
        p[0],
        p[1]
      );
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(this.chemistry, 0, 0);
      c.restore();
      this.fieldLayer.hidden = !visible;
    }
    weatherLight(c, s) {
      const w = s.weather;
      if (!w) return;
      this.weather = w;
      const night = 1 - clamp(w.sun * 3, 0, 1),
        dusk = w.sun > 0 ? clamp(1 - w.sun * 2, 0, 1) * (1 - w.cloud * 0.6) : 0;
      // Low-cost translucent fills, not filters, shadow maps or a full-scene redraw.
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      const g = c.createLinearGradient(0, 0, this.w, this.h);
      g.addColorStop(0, 'rgba(45,66,92,' + (night * 0.14 + w.cloud * 0.025) + ')');
      g.addColorStop(1, 'rgba(220,160,98,' + dusk * 0.12 + ')');
      c.fillStyle = g;
      c.fillRect(0, 0, this.w, this.h);
      c.restore();
      if (night > 0.12) {
        for (const [x, z] of [
          [-40, -27],
          [40, -27],
          [-40, 24],
          [40, 24]
        ]) {
          const p = this.project(x, 6, z),
            r = this.scale * 8.8,
            g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
          g.addColorStop(0, 'rgba(255,235,173,' + night * 0.07 + ')');
          g.addColorStop(1, 'rgba(242,225,177,0)');
          c.fillStyle = g;
          c.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
        }
      }
    }
    weatherParticles(c, s) {
      const w = s.weather;
      if (!w || !this.fx || this.reduced) return;
      const count = Math.floor(w.rain * (this.quality === 'coarse' ? 26 : 64)),
        time = s.time;
      if (count) {
        c.save();
        c.strokeStyle = this.theme === 'night' ? 'rgba(196,219,222,.32)' : 'rgba(223,241,239,.46)';
        c.lineWidth = (0.65 * this.density) / Math.max(1, this.zoom);
        c.beginPath();
        for (let i = 0; i < count; i++) {
          const seed = (i * 47.17) % 1,
            x = -52 + ((((i * 29.37 + time * w.windX * 0.15) % 104) + 104) % 104),
            z = -33 + ((((i * 17.43 + time * w.windZ * 0.15) % 66) + 66) % 66),
            y = 17 - ((time * 16 + i * 5.73) % 18),
            a = this.project(x, y, z),
            b = this.project(x + w.windX * 0.04, y - 1.6, z + w.windZ * 0.04);
          c.moveTo(...a);
          c.lineTo(...b);
        }
        c.stroke();
        c.restore();
      }
      for (const car of s.cars) {
        if (car.ground && car.wet > 0.15 && car.speed > 7) {
          const f = Q.v(car.q, [1, 0, 0]),
            r = Q.v(car.q, [0, 0, 1]);
          for (const side of [-1, 1]) {
            const x = car.x + r[0] * side * 0.92 - f[0] * 1.2,
              z = car.z + r[2] * side * 0.92 - f[2] * 1.2,
              len = car.speed * 0.055 * car.wet;
            this.line(
              c,
              [
                [x, 0.22, z],
                [x - f[0] * len, 0.45, z - f[2] * len]
              ],
              'rgba(218,236,226,' + car.wet * 0.4 + ')',
              0.9
            );
          }
        }
        if ((car.heat || 0) > 0.55 && !car.boosting) {
          const p = this.project(car.x, car.y + 1.5, car.z);
          c.fillStyle = 'rgba(215,226,214,.15)';
          c.beginPath();
          c.ellipse(p[0], p[1] - Math.sin(time * 3) * 2, this.scale * 0.48, this.scale * 0.8, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
    }

    setView(mode) {
      const prev = this.mode;
      this.mode = mode;
      this.focus = [0, 0];
      if ((prev === 'arena') !== (mode === 'arena')) this.buildArena();
    }
    event(e) {
      if (!this.fx || this.reduced) return;
      if (!['touch', 'bump', 'goal', 'land'].includes(e.type)) return;
      const count = e.type === 'goal' ? 28 : e.type === 'touch' ? 8 : 4;
      const rng = new RNG(Math.round(e.time * 1000));
      for (let i = 0; i < count; i++)
        this.particles.push({
          x: e.x || 0,
          y: e.y || 0.2,
          z: e.z || 0,
          vx: rng.range(-5, 5),
          vy: rng.range(2, 7),
          vz: rng.range(-5, 5),
          life: rng.range(0.18, 0.6) * (e.type === 'goal' ? 2 : 1),
          max: 1,
          col: e.type === 'goal' ? (e.side > 0 ? C.blue : C.orange) : C.cream
        });
      if (this.particles.length > 96) this.particles.splice(0, this.particles.length - 96);
    }
    shadow(c, x, y, z, r = 1.3) {
      const p = this.project(x + (0.1 + (this.weather ? 1 - this.weather.sun : 0) * 0.32) * y, 0.05, z + 0.12 * y),
        s = this.scale * (1 - 0.012 * Math.min(y, 16));
      c.save();
      c.translate(p[0], p[1]);
      c.scale(1, this.pitch * 0.61);
      const radius = Math.max(2, r * s),
        g = c.createRadialGradient(0, 0, radius * 0.15, 0, 0, radius);
      g.addColorStop(0, y > 4 ? 'rgba(9,28,24,.20)' : 'rgba(9,28,24,.42)');
      g.addColorStop(1, 'rgba(9,28,24,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, radius, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    car(ctx, c) {
      if (this.weather && this.weather.sun < 0.22 && c.ground) {
        const f = Q.v(c.q, [1, 0, 0]),
          r = Q.v(c.q, [0, 0, 1]),
          p0 = [c.x + f[0] * 1.8, 0.07, c.z + f[2] * 1.8];
        this.poly(
          ctx,
          [
            p0,
            [c.x + f[0] * 9 + r[0] * 2.4, 0.07, c.z + f[2] * 9 + r[2] * 2.4],
            [c.x + f[0] * 9 - r[0] * 2.4, 0.07, c.z + f[2] * 9 - r[2] * 2.4]
          ],
          'rgba(246,238,196,.065)'
        );
      }
      const blue = !c.id,
        body = blue ? C.carBlue : C.carOrange,
        light = blue ? C.carBlueLight : C.carOrangeLight,
        side = blue ? C.carBlueSide : C.carOrangeSide,
        dark = blue ? C.blueDark : C.orangeDark;
      const faces = [];
      const transform = p => {
        const q = Q.v(c.q, p);
        return [c.x + q[0], c.y + q[1], c.z + q[2]];
      };
      const face = (ps, col) => {
        const a = ps.map(transform);
        faces.push({
          p: a,
          col,
          d: a.reduce((s, p) => s + p[0] * this.sn + p[2] * this.cs + p[1] * 0.8, 0) / a.length
        });
      };
      const box = (x, y, z, wx, wy, wz, colors) => {
        const a = x - wx / 2,
          b = x + wx / 2,
          d = z - wz / 2,
          e = z + wz / 2,
          l = y - wy / 2,
          h = y + wy / 2;
        const [t, s, n] = colors;
        face(
          [
            [a, l, d],
            [b, l, d],
            [b, h, d],
            [a, h, d]
          ],
          s
        );
        face(
          [
            [a, l, e],
            [b, l, e],
            [b, h, e],
            [a, h, e]
          ],
          s
        );
        face(
          [
            [a, l, d],
            [a, l, e],
            [a, h, e],
            [a, h, d]
          ],
          n || s
        );
        face(
          [
            [b, l, d],
            [b, l, e],
            [b, h, e],
            [b, h, d]
          ],
          n || s
        );
        face(
          [
            [a, h, d],
            [b, h, d],
            [b, h, e],
            [a, h, e]
          ],
          t
        );
      };
      // Independently steered, twenty-sided tires and metallic rotating hub spokes.
      for (const x of [-1.12, 1.05])
        for (const z of [-1, 1]) {
          const steer = x > 0 ? c.steer * 0.42 : 0,
            cs = Math.cos(steer),
            sn = Math.sin(steer);
          const wheel = (a, zz, r) => [
            x + Math.cos(a) * r * cs + zz * sn,
            -0.17 + Math.sin(a) * r,
            z + zz * cs - Math.cos(a) * r * sn
          ];
          let ring = [];
          for (let i = 0; i < 20; i++) ring.push(wheel((i * Math.PI) / 10, z > 0 ? 0.23 : -0.23, 0.48));
          face(ring, '#101e25');
          for (let i = 0; i < 20; i++) {
            const a = (i * Math.PI) / 10,
              b = ((i + 1) * Math.PI) / 10;
            face(
              [wheel(a, -0.2, 0.48), wheel(b, -0.2, 0.48), wheel(b, 0.2, 0.48), wheel(a, 0.2, 0.48)],
              i < 10 ? '#293b3e' : '#17282c'
            );
          }
          ring = [];
          for (let i = 0; i < 20; i++) ring.push(wheel((i * Math.PI) / 10, z > 0 ? 0.25 : -0.25, 0.27));
          face(ring, '#59757b');
          for (let i = 0; i < 5; i++) {
            const a = (i * Math.PI * 2) / 5 + c.wheelSpin;
            face(
              [
                wheel(a - 0.12, z > 0 ? 0.26 : -0.26, 0.075),
                wheel(a - 0.14, z > 0 ? 0.26 : -0.26, 0.24),
                wheel(a + 0.14, z > 0 ? 0.26 : -0.26, 0.24),
                wheel(a + 0.12, z > 0 ? 0.26 : -0.26, 0.075)
              ],
              '#c5d9d6'
            );
          }
        }
      // Chamfered sill, curved nose and sloped shoulder remove the toy-box silhouette.
      const bodyOutline = [
        [-1.55, -0.94],
        [1.31, -0.94],
        [1.68, -0.68],
        [1.76, -0.38],
        [1.76, 0.38],
        [1.68, 0.68],
        [1.31, 0.94],
        [-1.55, 0.94],
        [-1.7, 0.68],
        [-1.7, -0.68]
      ];
      face(
        bodyOutline.map(([x, z]) => [x, 0.27, z]),
        body
      );
      for (let i = 0; i < bodyOutline.length; i++) {
        const a = bodyOutline[i],
          b = bodyOutline[(i + 1) % bodyOutline.length];
        face(
          [
            [a[0], -0.27, a[1] * 0.92],
            [b[0], -0.27, b[1] * 0.92],
            [b[0], 0.27, b[1]],
            [a[0], 0.27, a[1]]
          ],
          i < 5 ? side : dark
        );
      }
      face(
        [
          [0.69, 0.38, -0.79],
          [1.33, 0.33, -0.81],
          [1.65, 0.2, -0.53],
          [1.68, 0.2, 0.53],
          [1.33, 0.33, 0.81],
          [0.69, 0.38, 0.79]
        ],
        light
      );
      for (const z of [-0.86, 0.86])
        face(
          [
            [-1.38, 0.22, z],
            [-0.88, 0.35, z],
            [1.32, 0.34, z],
            [1.65, 0.12, z]
          ],
          body
        );
      // A sloped windscreen, raised canopy, visible rear spoiler and dual exhaust.
      face(
        [
          [-1.3, 0.28, -0.8],
          [-0.88, 0.94, -0.64],
          [0.26, 1.03, -0.64],
          [0.83, 0.38, -0.8]
        ],
        side
      );
      face(
        [
          [-1.3, 0.28, 0.8],
          [-0.88, 0.94, 0.64],
          [0.26, 1.03, 0.64],
          [0.83, 0.38, 0.8]
        ],
        side
      );
      face(
        [
          [0.26, 1.03, -0.64],
          [0.26, 1.03, 0.64],
          [0.83, 0.38, 0.8],
          [0.83, 0.38, -0.8]
        ],
        '#183740'
      );
      face(
        [
          [-0.88, 0.94, -0.64],
          [-0.88, 0.94, 0.64],
          [0.26, 1.03, 0.64],
          [0.26, 1.03, -0.64]
        ],
        light
      );
      face(
        [
          [-0.86, 0.84, -0.67],
          [0.18, 0.92, -0.67],
          [0.64, 0.42, -0.81],
          [-0.98, 0.42, -0.81]
        ],
        '#21424c'
      );
      face(
        [
          [-0.86, 0.84, 0.67],
          [0.18, 0.92, 0.67],
          [0.64, 0.42, 0.81],
          [-0.98, 0.42, 0.81]
        ],
        '#264650'
      );
      box(-1.32, 0.55, -0.66, 0.15, 0.48, 0.13, [dark, dark, dark]);
      box(-1.32, 0.55, 0.66, 0.15, 0.48, 0.13, [dark, dark, dark]);
      box(-1.35, 0.82, 0, 0.52, 0.14, 2.35, [body, dark, dark]);
      box(1.69, -0.04, 0, 0.14, 0.25, 1.86, ['#526968', '#182c34', '#182c34']);
      for (const z of [-0.61, 0.61]) box(1.79, 0.08, z, 0.08, 0.16, 0.4, [C.cream, C.cream, C.cream]);
      for (const z of [-0.6, 0.6]) box(-1.78, -0.1, z, 0.25, 0.2, 0.28, ['#344e53', '#192c34', '#172731']);
      face(
        [
          [0.8, 0.367, -0.11],
          [1.5, 0.264, -0.11],
          [1.5, 0.264, 0.11],
          [0.8, 0.367, 0.11]
        ],
        '#e8efdb'
      );
      face(
        [
          [-0.81, 0.948, -0.13],
          [0.18, 1.038, -0.13],
          [0.18, 1.038, 0.13],
          [-0.81, 0.948, 0.13]
        ],
        '#e8efdb'
      );
      faces.sort((a, b) => a.d - b.d);
      const opacity = ctx.globalAlpha;
      if (this.xray) ctx.globalAlpha *= 0.2;
      for (const f of faces) this.poly(ctx, f.p, f.col);
      ctx.globalAlpha = opacity;
      if (this.xray) {
        // Exact ball-contact OBB half-extents from World.hit (physics.js).
        // Car/world and car/car contact tests use slightly different proxies.
        const corners = [];
        for (const y of [-0.45, 0.45])
          for (const x of [-1.66, 1.66]) for (const z of [-0.94, 0.94]) corners.push(transform([x, y, z]));
        const col = blue ? C.blue : C.orange;
        for (const [a, b] of [
          [0, 1],
          [0, 2],
          [1, 3],
          [2, 3],
          [4, 5],
          [4, 6],
          [5, 7],
          [6, 7],
          [0, 4],
          [1, 5],
          [2, 6],
          [3, 7]
        ])
          this.line(ctx, [corners[a], corners[b]], col, 0.75 / Math.max(1, this.zoom || 1));
        this.line(ctx, [transform([0, 0, 0]), transform([2.1, 0, 0])], C.cream, 0.65);
      }
      if (c.boosting) {
        for (const z of [-0.61, 0.61]) {
          const flicker = 0.19 + Math.sin(this.lastTime * 57) * 0.15,
            verts = [
              [-1.85, -0.1, z - 0.18],
              [-1.85, 0.17, z + 0.16],
              [-3.8 - flicker, -0.03, z]
            ];
          this.poly(ctx, verts.map(transform), blue ? '#69bbe6' : '#edb17a');
          this.poly(
            ctx,
            [
              [-1.82, -0.03, z - 0.12],
              [-1.82, 0.11, z + 0.1],
              [-2.8, -0.02, z]
            ].map(transform),
            C.cream
          );
        }
      }
      if (this.labels) {
        const p = this.project(c.x, c.y + 2.55, c.z),
          d = (this.density || 1) / Math.max(1, this.zoom || 1);
        ctx.save();
        ctx.font = 8.5 * d + 'px Arial, Helvetica, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const t = c.id ? 'Ember' : 'Mica',
          ww = ctx.measureText(t).width + 17 * d;
        ctx.fillStyle = this.theme === 'night' ? 'rgba(15,35,31,.88)' : 'rgba(242,246,236,.94)';
        ctx.beginPath();
        ctx.roundRect(p[0] - ww / 2, p[1] - 7 * d, ww, 14 * d, 7 * d);
        ctx.fill();
        ctx.fillStyle = c.id ? '#bb5735' : '#326c8c';
        if (this.theme === 'night') ctx.fillStyle = c.id ? C.orange : C.blue;
        ctx.fillText(t, p[0], p[1]);
        ctx.restore();
      }
    }
    ball(ctx, b, prop = false) {
      const p = this.project(b.x, b.y, b.z),
        r = Math.max(3, this.scale * (prop ? 1.4 : 1.25));
      ctx.save();
      const g = ctx.createRadialGradient(
        p[0] - r * 0.38,
        p[1] - r * 0.43,
        r * 0.05,
        p[0] + r * 0.15,
        p[1] + r * 0.26,
        r * 1.15
      );
      g.addColorStop(0, prop ? '#d5c3a6' : '#fffdec');
      g.addColorStop(0.48, prop ? '#a2957b' : '#dfe5d6');
      g.addColorStop(1, prop ? '#6b6f61' : '#8ca69a');
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.clip();
      if (!prop) {
        const view = [this.sn * this.pitch, this.up, this.cs * this.pitch];
        // Rotating pentagonal panels on the actual ball quaternion, projected onto a sphere.
        const golden = (1 + Math.sqrt(5)) / 2,
          dirs = [];
        for (const a of [-1, 1])
          for (const v of [-golden, golden]) {
            dirs.push([0, a, v], [a, v, 0], [v, 0, a]);
          }
        for (const v of dirs) {
          const length = Math.hypot(...v),
            n = v.map(x => x / length),
            an = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
          let u = [n[1] * an[2] - n[2] * an[1], n[2] * an[0] - n[0] * an[2], n[0] * an[1] - n[1] * an[0]],
            l = Math.hypot(...u);
          u = u.map(x => x / l);
          const vv = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]],
            rn = Q.v(b.q || Q.id(), n);
          const visible = rn.reduce((s, a, i) => s + a * view[i], 0);
          if (visible < 0.13) continue;
          const pts = [];
          for (let j = 0; j < 5; j++) {
            const a = (j * Math.PI * 2) / 5,
              vec = n.map((val, i) => val + u[i] * Math.cos(a) * 0.3 + vv[i] * Math.sin(a) * 0.3),
              ll = Math.hypot(...vec),
              q = Q.v(
                b.q || Q.id(),
                vec.map(x => (x / ll) * 1.265)
              );
            pts.push([b.x + q[0], b.y + q[1], b.z + q[2]]);
          }
          this.poly(ctx, pts, visible > 0.5 ? '#486961' : '#6e8877');
        }
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(239,248,225,.58)';
      ctx.lineWidth = 0.6 * (this.density || 1);
      ctx.stroke();
    }
    drawPortrait(canvas, id) {
      const c = canvas.getContext('2d');
      c.clearRect(0, 0, canvas.width, canvas.height);
      const r = Object.create(Renderer.prototype);
      Object.assign(r, {
        canvas,
        ctx: c,
        w: canvas.width,
        h: canvas.height,
        cx: canvas.width * 0.52,
        cy: canvas.height * 0.45,
        cs: Math.cos(-0.57),
        sn: Math.sin(-0.57),
        pitch: 0.56,
        up: 0.84,
        scale: 49,
        density: 2,
        xray: this.xray,
        labels: false,
        lastTime: 0,
        theme: this.theme
      });
      c.fillStyle = this.theme === 'night' ? 'rgba(5,20,9,.18)' : 'rgba(71,91,58,.11)';
      c.beginPath();
      c.ellipse(r.cx + 4, r.cy + 20, 126, 33, -0.15, 0, Math.PI * 2);
      c.fill();
      r.car(c, { id, x: 0, y: 0.42, z: 0, q: Q.id(), steer: 0.06, wheelSpin: 0.4, boosting: false });
    }

    render(s, dt = 1 / 60) {
      if (!s) return;
      const start = performance.now(),
        c = this.ctx;
      this.lastTime = s.time;
      dt = clamp(dt, 0, 0.07);
      let fx = 0,
        fz = 0;
      if (this.mode !== 'arena') {
        const car = s.cars[this.mode === 'ember' ? 1 : 0];
        fx = this.mode === 'ball' ? s.ball.x : car.x * 0.7 + s.ball.x * 0.3;
        fz = this.mode === 'ball' ? s.ball.z : car.z * 0.7 + s.ball.z * 0.3;
        this.focus[0] = lerp(this.focus[0], fx, 1 - Math.exp(-dt * 3));
        this.focus[1] = lerp(this.focus[1], fz, 1 - Math.exp(-dt * 3));
        const p = this.project(this.focus[0], 0, this.focus[1]);
        this.offset = [(this.cx - p[0]) * 0.57, (this.cy - p[1]) * 0.65];
      } else {
        this.offset[0] = lerp(this.offset[0], 0, 0.14);
        this.offset[1] = lerp(this.offset[1], 0, 0.14);
      }
      const targetZoom = this.mode === 'arena' ? 1 : this.portrait ? 1.72 : 2.02;
      this.zoom = lerp(this.zoom, targetZoom, 1 - Math.exp(-dt * 5));
      c.clearRect(0, 0, this.w, this.h);
      const tx = (this.cx * (1 - this.zoom) + this.offset[0] * this.zoom) * this.ratioX,
        ty = (this.cy * (1 - this.zoom) + this.offset[1] * this.zoom) * this.ratioY,
        transform = 'matrix(' + this.zoom + ',0,0,' + this.zoom + ',' + tx + ',' + ty + ')';
      if (transform !== this.layerTransform) {
        for (const layer of [this.base, this.fieldLayer]) layer.style.transform = transform;
        this.layerTransform = transform;
      }
      c.save();
      c.translate(this.cx, this.cy);
      c.scale(this.zoom, this.zoom);
      c.translate(-this.cx + this.offset[0], -this.cy + this.offset[1]);
      c.imageSmoothingEnabled = true;
      this.weatherLight(c, s);
      for (const p of s.pads) {
        const active = (p.charge ?? (p.timer ? 0 : 1)) > 0.15,
          q = this.project(p.x, 0.13, p.z),
          size = this.scale * (p.big ? 0.7 : 0.32);
        c.strokeStyle = active ? (p.big ? '#c6dbae' : '#6e957d') : C.turf;
        c.lineWidth = (p.big ? 0.8 : 0.6) * (this.density || 1);
        c.beginPath();
        c.ellipse(q[0], q[1], size, size * this.pitch, 0, 0, Math.PI * 2);
        c.stroke();
        if (p.big && p.charge !== undefined) {
          c.save();
          c.translate(q[0], q[1]);
          c.scale(1, this.pitch);
          c.beginPath();
          c.arc(0, 0, size * 1.34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge);
          c.strokeStyle = C.mint;
          c.lineWidth = 0.6 * this.density;
          c.stroke();
          c.restore();
        }
        if (active) {
          c.fillStyle = p.big ? '#d7e6b8' : '#92b394';
          c.beginPath();
          c.ellipse(q[0], q[1], size * 0.38, size * this.pitch * 0.38, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      if (this.routes) {
        for (const car of s.cars) {
          c.setLineDash([2, 3]);
          this.line(
            c,
            [
              [car.x, 0.06, car.z],
              [car.target.x, 0.06, car.target.z]
            ],
            car.id ? C.orange : C.blue
          );
          c.setLineDash([]);
        }
      }
      if (this.fx) {
        for (const car of s.cars) {
          const a = this.trails[car.id] || (this.trails[car.id] = []);
          if (car.boosting && (!a.length || s.time - a.at(-1).t > 0.035))
            a.push({ x: car.x, y: car.y, z: car.z, t: s.time });
          while (a.length && (s.time - a[0].t > 0.25 || a.length > 12)) a.shift();
          for (let i = 0; i < a.length; i++) {
            const p = this.project(a[i].x, a[i].y, a[i].z);
            c.fillStyle = car.id ? '#7c7054' : '#426f7a';
            c.beginPath();
            c.arc(p[0], p[1], 1.05 * (this.density || 1), 0, Math.PI * 2);
            c.fill();
          }
        }
        const bt = this.ballTrail;
        if (Math.hypot(s.ball.vx, s.ball.vz) > 17 && (!bt.length || s.time - bt.at(-1).t > 0.035))
          bt.push({ ...s.ball, t: s.time });
        while (bt.length && (s.time - bt[0].t > 0.2 || bt.length > 8)) bt.shift();
        for (const b of bt) {
          const p = this.project(b.x, b.y, b.z);
          c.fillStyle = '#829688';
          c.beginPath();
          c.arc(p[0], p[1], 0.7 * (this.density || 1), 0, Math.PI * 2);
          c.fill();
        }
      }
      for (const car of s.cars) this.shadow(c, car.x, car.y, car.z, 1.55);
      this.shadow(c, s.ball.x, s.ball.y, s.ball.z, 1.1);
      for (const p of s.props) this.shadow(c, p.x, p.y, p.z, 1.3);
      const objects = [
        ...s.cars.map(o => ({ kind: 'car', o })),
        { kind: 'ball', o: s.ball },
        ...s.props.map(o => ({ kind: 'prop', o }))
      ];
      objects.sort(
        (a, b) => a.o.x * this.sn + a.o.z * this.cs + a.o.y * 0.12 - (b.o.x * this.sn + b.o.z * this.cs + b.o.y * 0.12)
      );
      for (const item of objects)
        item.kind === 'car' ? this.car(c, item.o) : this.ball(c, item.o, item.kind === 'prop');
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y = Math.max(0.1, p.y + p.vy * dt);
        p.z += p.vz * dt;
        p.vy -= 12 * dt;
        const q = this.project(p.x, p.y, p.z);
        c.fillStyle = p.col;
        c.globalAlpha = Math.min(1, p.life * 3);
        c.beginPath();
        c.arc(q[0], q[1], (p.life > 0.25 ? 1.6 : 0.8) * (this.density || 1), 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }
      this.weatherParticles(c, s);
      c.restore();
      this.frames++;
      this.renderMs = this.renderMs * 0.94 + (performance.now() - start) * 0.06;
    }
  }
  root.SmoothRenderer = Renderer;
  root.PixelRenderer = Renderer;
  root.pixelText = pixelText;
})(globalThis);
