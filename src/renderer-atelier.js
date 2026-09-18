/* Touchline 08. Original, dependency-free WebGL2 scene.
   Presentation owns no simulation values. The existing Canvas renderer remains the fallback.
   One batched stadium, small reusable car meshes, a bounded shadow map; no postprocessing. */
(function (root) {
  'use strict';
  const Fallback = root.SmoothRenderer,
    { clamp, lerp, Q } = TM,
    TAU = Math.PI * 2;
  const V = {
    sub: (a, b) => a.map((v, i) => v - b[i]),
    add: (a, b) => a.map((v, i) => v + b[i]),
    dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: a => {
      const d = Math.hypot(...a) || 1;
      return a.map(v => v / d);
    }
  };
  const I = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  function model(q = [0, 0, 0, 1], p = [0, 0, 0], s = [1, 1, 1]) {
    const [x, y, z, w] = q,
      m = I();
    m.set([
      (1 - 2 * y * y - 2 * z * z) * s[0],
      (2 * x * y + 2 * w * z) * s[0],
      (2 * x * z - 2 * w * y) * s[0],
      0,
      (2 * x * y - 2 * w * z) * s[1],
      (1 - 2 * x * x - 2 * z * z) * s[1],
      (2 * y * z + 2 * w * x) * s[1],
      0,
      (2 * x * z + 2 * w * y) * s[2],
      (2 * y * z - 2 * w * x) * s[2],
      (1 - 2 * x * x - 2 * y * y) * s[2],
      0,
      ...p,
      1
    ]);
    return m;
  }
  function look(eye, target) {
    const z = V.norm(V.sub(eye, target)),
      x = V.norm(V.cross([0, 1, 0], z)),
      y = V.cross(z, x);
    return new Float32Array([
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -V.dot(x, eye),
      -V.dot(y, eye),
      -V.dot(z, eye),
      1
    ]);
  }
  function ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l),
      0,
      0,
      0,
      0,
      2 / (t - b),
      0,
      0,
      0,
      0,
      -2 / (f - n),
      0,
      -(r + l) / (r - l),
      -(t + b) / (t - b),
      -(f + n) / (f - n),
      1
    ]);
  }
  function tr(m, p) {
    const x = p[0],
      y = p[1],
      z = p[2],
      w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    ];
  }
  function inv(a) {
    const r = I(),
      m = new Float64Array(a);
    for (let i = 0; i < 4; i++) {
      let pivot = i;
      for (let j = i + 1; j < 4; j++) if (Math.abs(m[i * 4 + j]) > Math.abs(m[i * 4 + pivot])) pivot = j;
      if (pivot !== i)
        for (let c = 0; c < 4; c++) {
          [m[c * 4 + i], m[c * 4 + pivot]] = [m[c * 4 + pivot], m[c * 4 + i]];
          [r[c * 4 + i], r[c * 4 + pivot]] = [r[c * 4 + pivot], r[c * 4 + i]];
        }
      const d = m[i * 4 + i];
      if (Math.abs(d) < 1e-10) return I();
      for (let c = 0; c < 4; c++) {
        m[c * 4 + i] /= d;
        r[c * 4 + i] /= d;
      }
      for (let j = 0; j < 4; j++)
        if (j !== i) {
          const k = m[i * 4 + j];
          for (let c = 0; c < 4; c++) {
            m[c * 4 + j] -= k * m[c * 4 + i];
            r[c * 4 + j] -= k * r[c * 4 + i];
          }
        }
    }
    return r;
  }
  const rgb = h => [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255
  ];
  const PA = {
    ivory: rgb('#dddcd1'),
    edge: rgb('#eae7dd'),
    dark: rgb('#273b36'),
    ink: rgb('#182a29'),
    turf: rgb('#4d7061'),
    line: rgb('#bed0b9'),
    blue: rgb('#519abe'),
    ember: rgb('#de895e'),
    glass: rgb('#203d44'),
    rubber: rgb('#202c2c'),
    metal: rgb('#b5c7c4'),
    gold: rgb('#d7b778')
  };
  // Shared by the WebGL scene, the Canvas scene and the inspector portrait.
  // Car origin sits CLEAR (0.53) above the turf, so a mount at y = -0.01 rests the tyre on it.
  const WHEEL_RADIUS = 0.52,
    WHEEL_MOUNTS = [
      [-1.1, -0.01, -1],
      [-1.1, -0.01, 1],
      [1.12, -0.01, -1],
      [1.12, -0.01, 1]
    ];
  class Geo {
    constructor() {
      this.a = [];
    }
    vertex(p, n, c, rough = 0.7, kind = 0) {
      this.a.push(...p, ...n, ...c, rough, kind);
    }
    tri(a, b, c, col = PA.ivory, rough = 0.7, kind = 0, norms = null) {
      const n = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
      [a, b, c].forEach((p, i) => this.vertex(p, norms ? norms[i] : n, col, rough, kind));
    }
    face(pts, col, rough = 0.7, kind = 0, n = null) {
      for (let i = 1; i < pts.length - 1; i++)
        this.tri(pts[0], pts[i], pts[i + 1], col, rough, kind, n ? [n, n, n] : null);
    }
    box(x, y, z, w, h, d, col = PA.ivory, rough = 0.7, kind = 0) {
      const a = x - w / 2,
        b = x + w / 2,
        c = y - h / 2,
        e = y + h / 2,
        f = z - d / 2,
        g = z + d / 2;
      this.face(
        [
          [a, e, f],
          [a, e, g],
          [b, e, g],
          [b, e, f]
        ],
        col,
        rough,
        kind,
        [0, 1, 0]
      );
      this.face(
        [
          [a, c, g],
          [a, c, f],
          [b, c, f],
          [b, c, g]
        ],
        col,
        rough,
        kind,
        [0, -1, 0]
      );
      this.face(
        [
          [a, c, g],
          [b, c, g],
          [b, e, g],
          [a, e, g]
        ],
        col,
        rough,
        kind,
        [0, 0, 1]
      );
      this.face(
        [
          [b, c, f],
          [a, c, f],
          [a, e, f],
          [b, e, f]
        ],
        col,
        rough,
        kind,
        [0, 0, -1]
      );
      this.face(
        [
          [b, c, g],
          [b, c, f],
          [b, e, f],
          [b, e, g]
        ],
        col,
        rough,
        kind,
        [1, 0, 0]
      );
      this.face(
        [
          [a, c, f],
          [a, c, g],
          [a, e, g],
          [a, e, f]
        ],
        col,
        rough,
        kind,
        [-1, 0, 0]
      );
    }
    tube(a, b, r, col, rough = 0.7, kind = 0, segments = 8) {
      const dir = V.norm(V.sub(b, a)),
        u = V.norm(V.cross(dir, Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])),
        v = V.cross(dir, u);
      for (let i = 0; i < segments; i++) {
        const aa = (TAU * i) / segments,
          bb = (TAU * (i + 1)) / segments,
          na = u.map((x, j) => x * Math.cos(aa) + v[j] * Math.sin(aa)),
          nb = u.map((x, j) => x * Math.cos(bb) + v[j] * Math.sin(bb));
        const p = a.map((x, j) => x + na[j] * r),
          q = a.map((x, j) => x + nb[j] * r),
          s = b.map((x, j) => x + nb[j] * r),
          t = b.map((x, j) => x + na[j] * r);
        this.tri(p, q, s, col, rough, kind, [na, nb, nb]);
        this.tri(p, s, t, col, rough, kind, [na, nb, na]);
        this.tri(a, q, p, col, rough, kind);
        this.tri(b, t, s, col, rough, kind);
      }
    }
    sphere(r, col, rough = 0.7, kind = 0, rows = 16, cols = 28) {
      const p = (a, b) => [Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)];
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const ns = [
              p((i * Math.PI) / rows, (j * TAU) / cols),
              p(((i + 1) * Math.PI) / rows, (j * TAU) / cols),
              p(((i + 1) * Math.PI) / rows, ((j + 1) * TAU) / cols),
              p((i * Math.PI) / rows, ((j + 1) * TAU) / cols)
            ],
            ps = ns.map(n => n.map(v => v * r));
          this.tri(ps[0], ps[1], ps[2], col, rough, kind, [ns[0], ns[1], ns[2]]);
          this.tri(ps[0], ps[2], ps[3], col, rough, kind, [ns[0], ns[2], ns[3]]);
        }
    }
  }
  function outline(x, z, r, y = 0, n = 16) {
    const a = [];
    for (const [cx, cz, start] of [
      [x - r, z - r, 0],
      [-x + r, z - r, 90],
      [-x + r, -z + r, 180],
      [x - r, -z + r, 270]
    ])
      for (let i = 0; i < n; i++) {
        const t = ((start + (i * 90) / n) * Math.PI) / 180;
        a.push([cx + Math.cos(t) * r, y, cz + Math.sin(t) * r]);
      }
    return a;
  }
  function layer(g, rings, col, cap = true) {
    const ps = rings.map(r => outline(...r));
    for (let k = 1; k < ps.length; k++)
      for (let i = 0; i < ps[k].length; i++) {
        const j = (i + 1) % ps[k].length;
        g.face([ps[k - 1][j], ps[k - 1][i], ps[k][i], ps[k][j]], col, 0.6);
      }
    if (cap) g.face(ps.at(-1), col, 0.7, 0, [0, 1, 0]);
  }
  function ribbon(g, outer, inner, col, rough = 0.7, kind = 0) {
    const a = outline(...outer),
      b = outline(...inner);
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      g.face([a[i], a[j], b[j], b[i]], col, rough, kind, [0, 1, 0]);
    }
  }
  function flatLine(g, pts, col, width = 0.1, kind = 0) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        d = V.sub(b, a),
        len = Math.hypot(d[0], d[2]) || 1,
        ox = ((d[2] / len) * width) / 2,
        oz = ((-d[0] / len) * width) / 2;
      g.face(
        [
          [a[0] - ox, a[1], a[2] - oz],
          [a[0] + ox, a[1], a[2] + oz],
          [b[0] + ox, b[1], b[2] + oz],
          [b[0] - ox, b[1], b[2] - oz]
        ],
        col,
        0.95,
        kind,
        [0, 1, 0]
      );
    }
  }
  function circle(g, x, z, r, col, width = 0.1, y = 0.026) {
    const p = [];
    for (let i = 0; i <= 72; i++) p.push([x + r * Math.cos((i * TAU) / 72), y, z + r * Math.sin((i * TAU) / 72)]);
    flatLine(g, p, col, width);
  }
  const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aP;layout(location=1) in vec3 aN;layout(location=2) in vec3 aC;layout(location=3) in vec2 aM;
uniform mat4 uVP,uModel,uLight;
out vec3 vP,vN,vC,vLocal;out vec2 vM;out vec4 vShadow;
void main(){vec4 p=uModel*vec4(aP,1.);vP=p.xyz;vLocal=aP;vN=normalize(mat3(uModel)*aN);vC=aC;vM=aM;vShadow=uLight*p;gl_Position=uVP*p;}`;
  const FS = `#version 300 es
precision highp float;
in vec3 vP,vN,vC,vLocal;in vec2 vM;in vec4 vShadow;
uniform vec3 uEye,uSun;uniform float uNight,uCloud,uRain,uOpacity,uShadows,uWarm;
uniform sampler2D uShadow,uField;uniform vec4 uBodies[5];
out vec4 frag;
float rounded(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float shadow(){vec3 p=vShadow.xyz/vShadow.w*.5+.5;if(uShadows<.01||p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.)return 1.;float bias=max(.0010,.0035*(1.-dot(normalize(vN),uSun)));float s=0.;vec2 t=1./vec2(textureSize(uShadow,0));for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){s+=p.z-bias>texture(uShadow,p.xy+vec2(float(x),float(y))*t).r?0.:1.;}return mix(1.,.48+.52*s/9.,uShadows);}
void main(){vec3 n=normalize(vN),c=vC;float kind=vM.y,rough=vM.x;
 if(kind>2.5&&kind<3.5){vec3 paper=mix(vec3(.925,.924,.892),vec3(.043,.074,.078),uNight);float d=rounded(vP.xz-vec2(3.5,4.0),vec2(48.,32.),8.);float ao=.20*exp(-max(d,0.)*max(d,0.)/24.);float s=shadow();c=paper*(1.-ao)*(1.-(1.-s)*.10);float lift=exp(-dot(vP.xz,vP.xz)/12000.);c+=vec3(.012,.014,.01)*lift*(1.-uNight);frag=vec4(c,1.);return;}
 float wet=0.;
 if(kind>.5&&kind<1.5){vec4 fieldTex=texture(uField,clamp((vP.xz+vec2(44.,28.))/vec2(88.,56.),0.,1.));vec3 field=fieldTex.rgb;float wear=fieldTex.a;wet=field.r;c*=mix(1.,.77,wet);float stripe=step(.5,fract((vP.x+44.)/14.667));c*=.974+.026*stripe;float fine=sin(vP.x*40.0)*sin(vP.z*40.0)*.002*(1.-smoothstep(.1,.7,length(fwidth(vP.xz*40.))));c+=fine;float edge=rounded(vP.xz,vec2(44.,28.),7.8);c*=1.-.14*exp(-abs(edge)/1.5);c=mix(c,vec3(.53,.58,.32),field.g*.12+field.b*.18);c=mix(c,vec3(.47,.44,.33),smoothstep(.08,.8,wear)*.62);c=mix(c,vec3(.25,.21,.16),smoothstep(.1,.7,wear)*smoothstep(.12,.55,wet)*.75);rough=mix(.93,.32,wet);}
 if(kind>3.5&&kind<4.5){vec3 p=normalize(vLocal);float d=-1.;float k=1.618033989;for(int a=-1;a<=1;a+=2)for(int b=-1;b<=1;b+=2){d=max(d,dot(p,normalize(vec3(0.,float(a),float(b)*k))));d=max(d,dot(p,normalize(vec3(float(a),float(b)*k,0.))));d=max(d,dot(p,normalize(vec3(float(b)*k,0.,float(a)))));}float panelMask=smoothstep(.928,.935,d);c=mix(vec3(.92,.934,.865),vec3(.115,.20,.18),panelMask);rough=.53;}
 vec3 sky=mix(vec3(.35,.365,.375),vec3(.19,.265,.32),uNight),key=mix(vec3(.82,.80,.77),vec3(.58,.67,.72),uNight);key=mix(key,vec3(.98,.74,.52),uWarm);sky=mix(sky,vec3(.40,.34,.35),uWarm*.5);
 float hemi=.65+.35*max(n.y,0.);float ndl=max(dot(n,uSun),0.),sh=shadow();vec3 lit=c*(sky*hemi+key*ndl*sh*(1.-uCloud*.14));
 vec3 view=normalize(uEye-vP),halfway=normalize(view+uSun);float spec=pow(max(dot(n,halfway),0.),mix(100.,9.,rough));float fres=pow(1.-max(dot(n,view),0.),4.);lit+=mix(vec3(.09),vec3(.18),wet)*spec*ndl*sh;lit+=c*fres*.07;
 if(kind>5.5&&kind<6.5){lit=mix(lit,vec3(.42,.61,.63),pow(1.-abs(dot(n,view)),3.)*.55);lit+=vec3(.24)*spec*sh;}
 if(kind>4.5&&kind<5.5)lit=mix(c*.93,c*1.22,uNight);
 if(kind<1.5&&vP.y<.18&&vP.y>-.1){for(int i=0;i<5;i++){vec4 b=uBodies[i];float radius=b.w*(1.+b.z*.035),dist=length(vP.xz-b.xy-vec2(.18,.10)*b.z)/radius;float ao=exp(-dist*dist*2.5)*.34*exp(-b.z*.05);lit*=1.-ao;}}
 if(kind>.5&&kind<1.5&&uNight>.01){vec2 l0=vP.xz-vec2(-30.,-17.),l1=vP.xz-vec2(30.,-17.);float pool=exp(-dot(l0,l0)/420.)+exp(-dot(l1,l1)/420.);vec3 toLamp=normalize(vec3(sign(vP.x)*39.,9.4,-28.7)-vP);float glint=pow(max(dot(n,normalize(view+toLamp)),0.),mix(90.,12.,rough));lit+=c*vec3(1.,.96,.84)*pool*uNight*.32+vec3(.2,.2,.17)*glint*wet*uNight*(.25+pool);}
 lit=mix(lit,lit*vec3(.80,.91,1.02),uNight*.27);lit=clamp(lit,0.,1.);frag=vec4(lit,uOpacity);}`;
  const DVS = `#version 300 es
precision highp float;layout(location=0)in vec3 aP;uniform mat4 uVP,uModel;void main(){gl_Position=uVP*uModel*vec4(aP,1.);}`;
  const DFS = `#version 300 es
precision highp float;void main(){}`;
  function program(gl, v, f) {
    const compile = (type, s) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram(),
      vs = compile(gl.VERTEX_SHADER, v),
      fs = compile(gl.FRAGMENT_SHADER, f);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
    return p;
  }
  class AtelierRenderer {
    constructor(canvas, base = null) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.base = base || document.createElement('canvas');
      const gl = this.base.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false
      });
      if (!gl) throw Error('WebGL2 unavailable');
      this.gl = gl;
      this.kind = 'WebGL2 / Atelier';
      this.quality = 'auto';
      this.theme = 'day';
      this.mode = 'arena';
      this.fx = true;
      this.labels = true;
      this.routes = false;
      this.xray = false;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.renderMs = 0;
      this.frames = 0;
      this.particles = [];
      this.trails = [[], [], [], []];
      this.ballTrail = [];
      this.zoom = 1;
      this.orbitYaw = -0.42;
      this.orbitPitch = 0.58;
      this.orbitZoom = 1;
      this.camFocus = [0, 0, 0];
      this.camYaw = -0.42;
      this.camPitch = 0.58;
      this.cameraSize = 38;
      this.lastState = null;
      this.night = 0;
      this.field = null;
      this.fieldRevision = -1;
      this.lost = false;
      this.prog = program(gl, VS, FS);
      this.depthProg = program(gl, DVS, DFS);
      this.uniforms = {};
      for (const k of [
        'VP',
        'Model',
        'Light',
        'Eye',
        'Sun',
        'Night',
        'Cloud',
        'Rain',
        'Opacity',
        'Shadows',
        'Warm',
        'Shadow',
        'Field',
        'Bodies'
      ])
        this.uniforms[k] = gl.getUniformLocation(this.prog, 'u' + k + (k === 'Bodies' ? '[0]' : ''));
      this.depthUniforms = {
        VP: gl.getUniformLocation(this.depthProg, 'uVP'),
        Model: gl.getUniformLocation(this.depthProg, 'uModel')
      };
      this.setupShadow();
      this.setupField();
      this.buildMeshes();
      this.base.className = 'scene-cache atelier-scene';
      this.base.setAttribute('aria-hidden', 'true');
      Object.assign(this.base.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        zIndex: '1',
        pointerEvents: 'none'
      });
      canvas.parentElement.insertBefore(this.base, canvas);
      canvas.style.zIndex = 3;
      this.base.addEventListener('webglcontextlost', e => {
        if (this.disposed) return;
        e.preventDefault();
        this.lost = true;
        this.switchToFallback('Graphics context lost');
      });
      this.resize();
      document.documentElement.dataset.renderer = 'webgl';
    }
    setupShadow() {
      const gl = this.gl;
      this.shadowSize = 1024;
      this.shadowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.DEPTH_COMPONENT24,
        this.shadowSize,
        this.shadowSize,
        0,
        gl.DEPTH_COMPONENT,
        gl.UNSIGNED_INT,
        null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.shadowFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.hasShadow = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.sun = V.norm([-45, 90, -55]);
      this.lightVP = mul(
        ortho(-70, 70, -65, 65, 1, 250),
        look(
          this.sun.map(v => v * 150),
          [0, 0, 0]
        )
      );
    }
    // The key light follows the simulated clock: noon matches the original light, mornings and
    // evenings swing it round and lower it, dusk warms it, and shadows fade out as the sun sets.
    updateSun(w = {}, dt = 0) {
      const sunHeight = w.sun ?? 1,
        az = Math.atan2(-55, -45) + ((w.clock ?? 0.5) - 0.5) * 2.4,
        el = lerp(0.32, 0.9, clamp(sunHeight / 0.9, 0, 1)),
        target = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
        k = this.reduced || !this.frames ? 1 : 1 - Math.exp(-dt * 1.5);
      this.sun = V.norm(this.sun.map((v, i) => lerp(v, target[i], k)));
      this.lightVP = mul(
        ortho(-70, 70, -65, 65, 1, 250),
        look(
          this.sun.map(v => v * 150),
          [0, 0, 0]
        )
      );
      this.daylight = clamp(sunHeight / 0.3, 0, 1) * (1 - (w.cloud || 0) * 0.35) * (1 - this.night);
      this.warm = clamp((0.5 - sunHeight) / 0.4, 0, 1) * clamp(sunHeight / 0.08, 0, 1) * (1 - this.night) * 0.8;
    }
    setupField() {
      const gl = this.gl;
      this.fieldTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    mesh(g) {
      const gl = this.gl,
        vao = gl.createVertexArray(),
        buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const data = new Float32Array(g.a);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (const [loc, n, off] of [
        [0, 3, 0],
        [1, 3, 3],
        [2, 3, 6],
        [3, 2, 9]
      ]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 44, off * 4);
      }
      gl.bindVertexArray(null);
      return { vao, buffer, count: data.length / 11, data };
    }
    buildMeshes() {
      const g = new Geo(),
        decor = new Geo();
      layer(
        g,
        [
          [48.7, 32.7, 8.7, -2.65],
          [49.0, 33.0, 9, -2.35],
          [49, 33, 9, -1.25],
          [48.5, 32.5, 8.5, -0.72]
        ],
        PA.ivory
      );
      ribbon(g, [48.9, 32.9, 8.9, -1.8], [48.78, 32.78, 8.78, -1.8], PA.ink); // a fine hardware seam
      layer(
        g,
        [
          [45.5, 29.5, 8.7, -0.72],
          [45.4, 29.4, 8.6, -0.2],
          [44.8, 28.8, 8, 0.12]
        ],
        PA.dark,
        false
      );
      this.plinthMesh = this.mesh(g);
      g.a = [];
      const floor = new Geo();
      floor.face(outline(44, 28, 7.8, 0.0), PA.turf, 0.96, 1, [0, 1, 0]);
      this.pitchMesh = this.mesh(floor);
      ribbon(g, [46.0, 30.0, 9.2, 0.3], [44.6, 28.6, 7.8, 0.3], PA.edge);
      layer(
        g,
        [
          [46, 30, 9.2, -0.6],
          [46, 30, 9.2, 0.3]
        ],
        PA.ivory,
        false
      );
      // Thin rear barrier and three architectural seating bays. No decorative crowd.
      for (const [left, right] of [
        [-38, -15],
        [-11, 11],
        [15, 38]
      ]) {
        for (let row = 0; row < 3; row++) {
          const z = -30.1 - row * 0.78,
            y = 0.62 + row * 0.62;
          g.box((left + right) / 2, y, z, right - left, 0.28, 0.85, PA.ivory);
          for (let x = left + 0.85; x < right - 0.5; x += 1.32) {
            g.box(x, y + 0.21, z, 0.87, 0.13, 0.48, PA.dark);
            g.box(x, y + 0.4, z - 0.24, 0.86, 0.4, 0.09, PA.dark);
          }
        }
      }
      for (const x of [-38, -13, 13, 38]) g.tube([x, 0.2, -32.0], [x, 6.15, -32.0], 0.12, PA.metal);
      g.box(0, 6.15, -32.3, 78, 0.25, 3.15, PA.edge, 0.45);
      g.box(0, 5.99, -31.9, 76, 0.08, 1.7, PA.dark);
      g.box(0, 5.93, -30.45, 73, 0.07, 0.12, rgb('#e4d9b6'), 0.5, 5);
      // Field linework stays physically on the surface.
      const mark = outline(41, 25, 6, 0.025);
      mark.push(mark[0]);
      flatLine(decor, mark, PA.line, 0.095);
      flatLine(
        decor,
        [
          [0, 0.026, -25],
          [0, 0.026, 25]
        ],
        PA.line,
        0.095
      );
      circle(decor, 0, 0, 8, PA.line, 0.095);
      circle(decor, 0, 0, 0.17, PA.line, 0.18);
      for (const side of [-1, 1]) {
        flatLine(
          decor,
          [
            [side * 41, 0.026, -12],
            [side * 32, 0.026, -12],
            [side * 32, 0.026, 12],
            [side * 41, 0.026, 12]
          ],
          PA.line,
          0.095
        );
        flatLine(
          decor,
          [
            [side * 41, 0.026, -7],
            [side * 37, 0.026, -7],
            [side * 37, 0.026, 7],
            [side * 41, 0.026, 7]
          ],
          PA.line,
          0.085
        );
        circle(decor, side * 27, 0, 0.17, PA.line, 0.15);
        this.makeGoal(g, decor, side);
      }
      // A continuous quiet touchline, alternating only at the goal ends.
      for (const side of [-1, 1]) {
        const color = side < 0 ? PA.blue : PA.ember;
        for (const z of [-21, 21]) {
          g.box(side * 45.45, 0.58, z, 0.64, 0.66, 9.0, PA.ivory);
          g.box(side * 45.06, 0.62, z, 0.03, 0.14, 8.1, color, 0.5, 5);
        }
        g.box(side * 29, 0.44, -28.7, 15, 0.12, 0.07, color, 0.5, 5);
        g.box(side * 29, -1.5, 32.84, 12, 0.12, 0.06, color, 0.6);
      }
      for (const x of [-39, 39]) {
        g.tube([x, 0.2, -28.8], [x, 9.4, -28.8], 0.105, PA.metal);
        g.box(x, 9.45, -28.7, 3.5, 0.48, 0.6, PA.dark);
        g.box(x, 9.4, -28.35, 3.1, 0.24, 0.055, rgb('#ece5c9'), 0.3, 5);
      }
      this.stadium = this.mesh(g);
      this.markings = this.mesh(decor);
      const ground = new Geo();
      ground.face(
        [
          [-2000, -2.82, -2000],
          [-2000, -2.82, 2000],
          [2000, -2.82, 2000],
          [2000, -2.82, -2000]
        ],
        rgb('#eeece3'),
        1,
        3,
        [0, 1, 0]
      );
      this.groundMesh = this.mesh(ground);
      this.carBodies = [
        this.makeCar(PA.blue),
        this.makeCar(PA.ember),
        this.makeCar(rgb('#86b7cb')),
        this.makeCar(rgb('#c4764e'))
      ];
      this.wheelMesh = this.makeWheel();
      const ball = new Geo();
      ball.sphere(1.25, PA.edge, 0.5, 4);
      this.ballMesh = this.mesh(ball);
      const lowBall = new Geo();
      lowBall.sphere(1.25, PA.edge, 0.5, 4, 8, 16);
      this.ballLow = this.mesh(lowBall);
      const lowWheel = new Geo();
      lowWheel.tube([0, 0, -0.24], [0, 0, 0.24], WHEEL_RADIUS, PA.rubber, 0.92, 0, 12);
      for (const side of [-1, 1]) lowWheel.tube([0, 0, side * 0.245], [0, 0, side * 0.26], 0.3, PA.metal, 0.4, 0, 12);
      this.wheelLow = this.mesh(lowWheel);
      const prop = new Geo();
      prop.sphere(1.4, rgb('#a89878'), 0.8);
      this.propMesh = this.mesh(prop);
      const pad = new Geo();
      circle(pad, 0, 0, 0.7, PA.gold, 0.075, 0.036);
      circle(pad, 0, 0, 0.38, rgb('#e9ce95'), 0.1, 0.04);
      this.padMesh = this.mesh(pad);
      const flame = new Geo();
      flame.sphere(1, rgb('#f1d5a2'), 0.7, 5);
      this.flameMesh = this.mesh(flame);
      this.triangleCount = [
        this.plinthMesh,
        this.stadium,
        this.markings,
        this.pitchMesh,
        ...this.carBodies,
        this.wheelMesh,
        this.ballMesh
      ].reduce((n, m) => n + m.count / 3, 0);
    }
    makeGoal(g, lines, s) {
      const x = s * 44,
        b = s * 48,
        col = s < 0 ? PA.blue : PA.ember;
      g.box(s * 46, -0.06, 0, 4, 0.12, 17, col, 0.85);
      for (const z of [-8.5, 8.5]) {
        g.tube([x, 0.1, z], [x, 6.8, z], 0.16, PA.edge, 0.35, 0, 12);
        g.tube([x, 6.8, z], [b, 6.4, z], 0.105, PA.edge);
        g.tube([b, 0, z], [b, 6.4, z], 0.1, PA.metal);
      }
      g.tube([x, 6.8, -8.5], [x, 6.8, 8.5], 0.17, PA.edge, 0.35, 0, 12);
      g.tube([b, 6.4, -8.5], [b, 6.4, 8.5], 0.09, PA.metal);
      g.tube([x - s * 0.05, 6.88, -8.3], [x - s * 0.05, 6.88, 8.3], 0.04, col, 0.4, 5);
      const net = rgb('#84988d');
      for (let z = -8.4; z < 8.5; z += 1.2) {
        g.tube([b, 0.05, z], [b, 6.4, z], 0.023, net, 0.9, 0, 4);
        g.tube([x, 6.78, z], [b, 6.4, z], 0.02, net, 0.9, 0, 4);
      }
      for (let y = 0.7; y < 6.4; y += 0.9) {
        g.tube([b, y, -8.5], [b, y, 8.5], 0.023, net, 0.9, 0, 4);
        for (const z of [-8.5, 8.5]) g.tube([x, y, z], [b, y, z], 0.018, net, 0.9, 0, 4);
      }
      for (let z = -7; z < 8; z += 2.8)
        flatLine(
          lines,
          [
            [s * 44.3, 0.018, z],
            [s * 47.6, 0.018, z + 1.5]
          ],
          PA.line,
          0.05
        );
    }
    // Toy battle-car: chunky wheels, wedge nose, set-back bubble cabin, wheel-arch flares,
    // rear wing and one central boost nozzle. +x is forward, y up; the physics hull is
    // 3.32 x 0.90 x 1.88, so the bodywork stays within it apart from flares and the wing.
    makeCar(color) {
      const g = new Geo(),
        shade = color.map(v => v * 0.72),
        center = [0, 0.1, 0];
      // Face with an outward normal, whatever the point order (the Canvas path culls by normal).
      const shell = (pts, col, rough = 0.36, kind = 0, from = center) => {
        const n = V.norm(V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0]))),
          mid = pts.reduce((s, p) => V.add(s, p), [0, 0, 0]).map(v => v / pts.length);
        g.face(V.dot(n, V.sub(mid, from)) < 0 ? pts.slice().reverse() : pts, col, rough, kind);
      };
      const prism = (profile, y0, y1, col, rough = 0.38) => {
        const lo = profile.map(([x, z]) => [x, y0, z]),
          hi = profile.map(([x, z]) => [x, y1, z]),
          mid = [profile.reduce((s, p) => s + p[0], 0) / profile.length, (y0 + y1) / 2, 0];
        g.face(hi, col, rough, 0, [0, 1, 0]);
        for (let i = 0; i < lo.length; i++) {
          const j = (i + 1) % lo.length;
          shell([lo[j], lo[i], hi[i], hi[j]], col, rough, 0, mid);
        }
      };
      const hull = [
        [-1.62, -0.7],
        [-1.5, -0.86],
        [1.3, -0.86],
        [1.64, -0.66],
        [1.74, -0.4],
        [1.74, 0.4],
        [1.64, 0.66],
        [1.3, 0.86],
        [-1.5, 0.86],
        [-1.62, 0.7]
      ];
      prism(
        hull.map(([x, z]) => [x * 0.97, z * 0.97]),
        -0.36,
        -0.2,
        PA.ink,
        0.8
      ); // dark tub
      prism(hull, -0.2, 0.14, color); // lower shell
      // wedge nose rising to the cabin
      for (const z of [-1, 1])
        shell(
          [
            [0.3, 0.14, z * 0.8],
            [1.72, 0.14, z * 0.6],
            [1.72, 0.2, z * 0.56],
            [0.3, 0.5, z * 0.7]
          ],
          color,
          0.34,
          0,
          [1, 0.2, 0]
        );
      g.face(
        [
          [0.3, 0.5, -0.7],
          [1.72, 0.2, -0.56],
          [1.72, 0.2, 0.56],
          [0.3, 0.5, 0.7]
        ],
        color,
        0.3,
        0,
        V.norm([0.21, 1, 0])
      );
      shell(
        [
          [1.72, 0.14, -0.6],
          [1.72, 0.14, 0.6],
          [1.72, 0.2, 0.56],
          [1.72, 0.2, -0.56]
        ],
        color,
        0.34,
        0,
        [0, 0.17, 0]
      );
      g.box(-0.66, 0.32, 0, 1.92, 0.36, 1.46, color, 0.36); // raised rear deck
      // set-back bubble cabin
      const b0 = [-0.98, 0.5, -0.66],
        b1 = [0.34, 0.5, -0.7],
        b2 = [0.34, 0.5, 0.7],
        b3 = [-0.98, 0.5, 0.66],
        t0 = [-0.76, 1.0, -0.5],
        t1 = [0.02, 1.0, -0.52],
        t2 = [0.02, 1.0, 0.52],
        t3 = [-0.76, 1.0, 0.5],
        cab = [-0.4, 0.75, 0];
      g.face([t0, t3, t2, t1], color, 0.3, 0, [0, 1, 0]);
      shell([b1, b2, t2, t1], PA.glass, 0.16, 6, cab);
      shell([b3, b0, t0, t3], PA.glass, 0.2, 6, cab);
      shell([b0, b1, t1, t0], PA.glass, 0.18, 6, cab);
      shell([b2, b3, t3, t2], PA.glass, 0.18, 6, cab);
      for (const z of [-1, 1]) g.tube([-0.36, 0.52, z * 0.68], [-0.36, 0.98, z * 0.51], 0.035, color, 0.4);
      // roof roundel and one ivory inlay down the nose
      const roundel = [];
      for (let i = 0; i < 14; i++) {
        const a = (-i * TAU) / 14;
        roundel.push([-0.37 + Math.cos(a) * 0.19, 1.008, Math.sin(a) * 0.19]);
      }
      g.face(roundel, PA.edge, 0.45, 0, [0, 1, 0]);
      g.face(
        [
          [0.36, 0.508, -0.07],
          [1.7, 0.208, -0.07],
          [1.7, 0.208, 0.07],
          [0.36, 0.508, 0.07]
        ],
        PA.edge,
        0.45,
        0,
        V.norm([0.21, 1, 0])
      );
      for (const z of [-1, 1]) {
        g.box(-0.08, 0.0, z * 0.868, 2.7, 0.05, 0.012, PA.edge, 0.45); // side pinstripe
        for (const x of [-1.1, 1.12]) {
          g.box(x, 0.2, z * 0.92, 1.06, 0.12, 0.2, shade, 0.4); // arch flare
          g.box(x, 0.28, z * 0.9, 0.9, 0.05, 0.16, color, 0.36);
        }
        // rear wing: struts, blade and endplates
        g.box(-1.38, 0.66, z * 0.42, 0.1, 0.34, 0.08, PA.dark);
        g.box(-1.6, 0.66, z * 0.96, 0.46, 0.3, 0.05, PA.dark);
      }
      g.box(-1.54, 0.85, 0, 0.44, 0.08, 1.96, color, 0.32);
      g.box(1.63, -0.3, 0, 0.32, 0.08, 1.46, PA.dark); // front splitter
      g.box(-1.62, -0.22, 0, 0.12, 0.2, 1.3, PA.dark); // diffuser
      for (const z of [-0.44, 0.44]) {
        g.box(1.746, 0.02, z, 0.03, 0.1, 0.24, rgb('#eee6be'), 0.3, 5);
        g.box(-1.636, 0.22, z, 0.03, 0.08, 0.36, rgb('#da6555'), 0.3, 5);
      }
      g.tube([-1.6, 0.04, 0], [-1.88, 0.04, 0], 0.2, PA.metal, 0.3, 0, 14); // boost nozzle
      g.tube([-1.881, 0.04, 0], [-1.9, 0.04, 0], 0.13, PA.ink, 0.8, 0, 12);
      return this.mesh(g);
    }
    makeWheel() {
      const g = new Geo();
      g.tube([0, 0, -0.2], [0, 0, 0.2], WHEEL_RADIUS, PA.rubber, 0.92, 0, 24);
      for (const s of [-1, 1]) {
        g.tube([0, 0, s * 0.2], [0, 0, s * 0.24], WHEEL_RADIUS - 0.03, PA.rubber, 0.9, 0, 24); // rounded shoulder
        g.tube([0, 0, s * 0.241], [0, 0, s * 0.256], 0.31, PA.metal, 0.35, 0, 20);
        g.tube([0, 0, s * 0.257], [0, 0, s * 0.266], 0.23, PA.dark, 0.5, 0, 20);
        for (let i = 0; i < 5; i++) {
          const a = (i * TAU) / 5,
            b = a + 0.14;
          g.face(
            [
              [0.07 * Math.cos(a), 0.07 * Math.sin(a), s * 0.275],
              [0.27 * Math.cos(a - 0.1), 0.27 * Math.sin(a - 0.1), s * 0.275],
              [0.27 * Math.cos(b + 0.1), 0.27 * Math.sin(b + 0.1), s * 0.275],
              [0.07 * Math.cos(b), 0.07 * Math.sin(b), s * 0.275]
            ],
            PA.metal,
            0.32,
            0,
            [0, 0, s]
          );
        }
        g.tube([0, 0, s * 0.275], [0, 0, s * 0.282], 0.08, PA.gold, 0.3, 0, 10);
      }
      return this.mesh(g);
    }
    resize() {
      if (this.fallback) {
        this.fallback.quality = this.quality;
        this.fallback.resize();
        this.copyFallback();
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      if (
        this.w &&
        this.cssW === r.width &&
        this.cssH === r.height &&
        this.lastQuality === this.quality &&
        this.lastDpr === devicePixelRatio
      )
        return;
      this.cssW = Math.max(1, r.width);
      this.cssH = Math.max(1, r.height);
      this.lastQuality = this.quality;
      this.lastDpr = devicePixelRatio;
      this.density = Math.min(
        this.quality === 'coarse'
          ? 0.85
          : this.quality === 'fine'
            ? Math.max(1.6, Math.min(2, devicePixelRatio || 1))
            : Math.max(1.2, Math.min(1.5, devicePixelRatio || 1)),
        Math.sqrt(2200000 / (this.cssW * this.cssH))
      );
      this.w = Math.max(160, Math.round(this.cssW * this.density));
      this.h = Math.max(120, Math.round(this.cssH * this.density));
      this.base.width = this.w;
      this.base.height = this.h;
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.ratioX = this.cssW / this.w;
      this.ratioY = this.cssH / this.h;
      this.portrait = this.cssW < 620 && this.cssH > this.cssW * 0.85;
      if (this.portrait && this.mode === 'arena') this.camYaw = this.orbitYaw = -1.15;
      else if (this.mode === 'arena') this.camYaw = this.orbitYaw = -0.42;
      this.cameraSize = 0;
    }
    setTheme(t) {
      this.theme = t === 'night' ? 'night' : 'day';
      if (this.fallback) this.fallback.setTheme(t);
    }
    buildArena() {} // Original API: meshes are immutable and are never rebuilt for camera motion.
    setView(mode) {
      this.mode = mode;
      if (mode === 'arena') {
        this.orbitYaw = this.portrait ? -1.15 : -0.42;
        this.orbitPitch = 0.58;
        this.orbitZoom = 1;
      }
      if (this.fallback) {
        this.fallback.setView(mode);
        this.orbitYaw = this.fallback.orbitYaw;
        this.orbitPitch = this.fallback.orbitPitch;
      }
    }
    resetCamera() {
      this.setView(this.mode);
    }
    orbit(dx, dy) {
      if (this.fallback) {
        this.fallback.orbit(dx, dy);
        this.orbitYaw = this.fallback.orbitYaw;
        this.orbitPitch = this.fallback.orbitPitch;
        return;
      }
      if (this.mode !== 'arena') return;
      this.orbitYaw -= dx * 0.004;
      this.orbitPitch = clamp(this.orbitPitch + dy * 0.0025, 0.32, 1.1);
    }
    updateField(f) {
      if (!f) return;
      this.field = f;
      if (this.fallback) {
        this.fallback.updateField(f);
        return;
      }
      if (this.fieldRevision === f.revision) return;
      this.fieldRevision = f.revision;
      const nx = f.nx || 64,
        nz = f.nz || 40,
        q = f.nx ? 100 : 1,
        data = new Uint8Array(nx * nz * 4);
      for (let i = 0; i < nx * nz; i++) {
        data[i * 4] = clamp(((f.wet[i] || 0) / q) * 255, 0, 255);
        data[i * 4 + 1] = clamp(((f.heat[i] || 0) / q) * 255, 0, 255);
        data[i * 4 + 2] = clamp(((f.life?.[i] || 0) / q) * 255, 0, 255);
        data[i * 4 + 3] = clamp(((f.wear?.[i] || 0) / q) * 255, 0, 255);
      }
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, nz, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    event(e) {
      if (this.fallback) {
        this.fallback.event(e);
        return;
      }
      if (!this.fx || this.reduced || !['touch', 'bump', 'goal', 'land'].includes(e.type)) return;
      const count = e.type === 'goal' ? 20 : e.type === 'touch' ? 6 : 3;
      const rng = new TM.RNG(Math.round(e.time * 1000));
      for (let i = 0; i < count; i++)
        this.particles.push({
          x: e.x || 0,
          y: e.y || 0.2,
          z: e.z || 0,
          vx: rng.range(-4, 4),
          vy: rng.range(2, 6),
          vz: rng.range(-4, 4),
          life: rng.range(0.2, 0.6),
          side: e.side || 0
        });
      if (this.particles.length > 72) this.particles.splice(0, this.particles.length - 72);
    }
    prepareCamera(s, dt) {
      let target = [0, 0, -1],
        yaw = this.orbitYaw,
        pitch = this.orbitPitch;
      const follow = this.mode !== 'arena';
      if (follow) {
        const a =
          this.mode === 'ball'
            ? s.ball
            : s.cars[{ mica: 0, ember: 1, slate: 2, sienna: 3 }[this.mode] ?? 0] || s.cars[0];
        target = [lerp(a.x, s.ball.x, 0.2), Math.min(7, a.y) * 0.32, lerp(a.z, s.ball.z, 0.2)];
        yaw = this.portrait ? -1.05 : -0.56;
        pitch = 0.65;
      }
      const smooth = this.reduced ? 1 : 1 - Math.exp(-dt * 4.8);
      this.camFocus = this.camFocus.map((v, i) => lerp(v, target[i], smooth));
      this.camYaw = lerp(this.camYaw, yaw, smooth);
      this.camPitch = lerp(this.camPitch, pitch, smooth);
      const dir = [
        Math.sin(this.camYaw) * Math.cos(this.camPitch),
        Math.sin(this.camPitch),
        Math.cos(this.camYaw) * Math.cos(this.camPitch)
      ];
      this.eye = V.add(
        this.camFocus,
        dir.map(v => v * 155)
      );
      this.view = look(this.eye, this.camFocus);
      let maxX = 0,
        maxY = 0;
      for (const x of [-50, 50])
        for (const y of [-3, 10])
          for (const z of [-34, 31]) {
            const p = tr(
              look(
                dir.map(v => v * 155),
                [0, 0, -1]
              ),
              [x, y, z]
            );
            maxX = Math.max(maxX, Math.abs(p[0]));
            maxY = Math.max(maxY, Math.abs(p[1]));
          }
      let size = Math.max(maxY / 0.93, maxX / ((this.cssW / this.cssH) * 0.92));
      if (follow) size = this.portrait ? 21 : 20.5;
      else size /= this.orbitZoom;
      if (!this.cameraSize) this.cameraSize = size;
      this.cameraSize = lerp(this.cameraSize, size, smooth);
      const aspect = this.w / this.h;
      this.projection = ortho(
        -this.cameraSize * aspect,
        this.cameraSize * aspect,
        -this.cameraSize,
        this.cameraSize,
        1,
        400
      );
      this.vp = mul(this.projection, this.view);
      this.inverseVP = inv(this.vp);
      this.scale = this.h / (this.cameraSize * 2);
      this.zoom = follow ? 2 : 1;
    }
    screenPoint(x, y, z) {
      if (this.fallback) return this.fallback.screenPoint(x, y, z);
      if (!this.vp) return { x: 0, y: 0 };
      const p = tr(this.vp, [x, y, z]);
      return { x: (p[0] * 0.5 + 0.5) * this.cssW, y: (0.5 - p[1] * 0.5) * this.cssH };
    }
    project(x, y, z) {
      const p = this.screenPoint(x, y, z);
      return [p.x / this.ratioX, p.y / this.ratioY];
    }
    unproject(sx, sy) {
      if (this.fallback) return this.fallback.unproject(sx, sy);
      const r = this.canvas.getBoundingClientRect(),
        x = ((sx - r.left) / r.width) * 2 - 1,
        y = 1 - ((sy - r.top) / r.height) * 2,
        a = tr(this.inverseVP, [x, y, -1]),
        b = tr(this.inverseVP, [x, y, 1]),
        t = -a[1] / (b[1] - a[1]);
      return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t };
    }
    draw(mesh, m = I(), depth = false, opacity = 1) {
      const gl = this.gl;
      if (depth) gl.uniformMatrix4fv(this.depthUniforms.Model, false, m);
      else {
        gl.uniformMatrix4fv(this.uniforms.Model, false, m);
        gl.uniform1f(this.uniforms.Opacity, opacity);
      }
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    drawCars(s, depth = false) {
      for (const c of s.cars) {
        const m = model(c.q, [c.x, c.y, c.z]);
        this.draw(this.carBodies[c.id], m, depth);
        for (const [x, y, z] of WHEEL_MOUNTS) {
          const steer = x > 0 ? (c.steer || 0) * 0.43 : 0,
            local = mul(
              model([0, Math.sin(steer / 2), 0, Math.cos(steer / 2)], [x, y, z]),
              model([0, 0, Math.sin((c.wheelSpin || 0) / 2), Math.cos((c.wheelSpin || 0) / 2)])
            );
          this.draw(this.wheelMesh, mul(m, local), depth);
        }
        if (c.boosting && !depth && this.fx)
          this.draw(
            this.flameMesh,
            mul(m, model([0, 0, 0, 1], [-2.75, 0.04, 0], [0.9 + 0.1 * Math.sin(s.time * 51), 0.19, 0.19]))
          );
      }
      this.draw(this.ballMesh, model(s.ball.q, [s.ball.x, s.ball.y, s.ball.z]), depth);
      for (const p of s.props) this.draw(this.propMesh, model(p.q, [p.x, p.y, p.z]), depth);
    }
    render(s, dt = 1 / 60) {
      if (this.fallback) {
        for (const k of ['fx', 'labels', 'routes', 'xray', 'quality']) this.fallback[k] = this[k];
        this.fallback.render(s, dt);
        this.copyFallback();
        return;
      }
      if (!s || this.lost) return;
      const start = performance.now(),
        gl = this.gl;
      this.lastState = s;
      this.lastTime = s.time;
      dt = clamp(dt, 0, 0.1);
      this.prepareCamera(s, dt);
      this.night = lerp(this.night, this.theme === 'night' ? 1 : 0, this.reduced ? 1 : 1 - Math.exp(-dt * 2.5));
      this.updateSun(s.weather, dt);
      const shadows = this.hasShadow && this.quality !== 'coarse' && this.daylight > 0.01;
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      if (shadows && (this.frames % 3 === 0 || !this.frames)) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.depthProg);
        gl.uniformMatrix4fv(this.depthUniforms.VP, false, this.lightVP);
        this.draw(this.plinthMesh, I(), true);
        this.draw(this.stadium, I(), true);
        this.drawCars(s, true);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0.925, 0.924, 0.892, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.prog);
      const u = this.uniforms;
      gl.uniformMatrix4fv(u.VP, false, this.vp);
      gl.uniformMatrix4fv(u.Light, false, this.lightVP);
      gl.uniform3fv(u.Eye, this.eye);
      gl.uniform3fv(u.Sun, this.sun);
      gl.uniform1f(u.Night, this.night);
      gl.uniform1f(u.Cloud, s.weather?.cloud || 0);
      gl.uniform1f(u.Rain, s.weather?.rain || 0);
      gl.uniform1f(u.Shadows, shadows ? this.daylight : 0);
      gl.uniform1f(u.Warm, this.warm);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.uniform1i(u.Shadow, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.uniform1i(u.Field, 1);
      gl.uniform4fv(
        u.Bodies,
        new Float32Array([
          ...s.cars.flatMap(c => [c.x, c.z, c.y, 1.75]),
          s.ball.x,
          s.ball.z,
          s.ball.y,
          1.16,
          ...Array.from({ length: 4 - s.cars.length }, () => [10000, 10000, 10000, 1]).flat()
        ])
      );
      this.draw(this.groundMesh);
      this.draw(this.plinthMesh);
      this.draw(this.stadium);
      this.draw(this.pitchMesh);
      this.draw(this.markings);
      for (const p of s.pads) {
        const scale = (p.big ? 1 : 0.46) * (0.75 + 0.25 * (p.charge ?? 1));
        this.draw(this.padMesh, model(undefined, [p.x, 0, p.z], [scale, 1, scale]));
      }
      this.drawCars(s);
      this.drawOverlay(s, dt);
      this.frames++;
      this.renderMs = this.renderMs * 0.94 + (performance.now() - start) * 0.06;
    }
    drawOverlay(s, dt, clear = true) {
      const c = this.ctx,
        d = this.density;
      if (clear) c.clearRect(0, 0, this.w, this.h);
      const point = p => this.project(...p),
        line = (a, b, col, width = 1) => {
          const p = point(a),
            q = point(b);
          c.strokeStyle = col;
          c.lineWidth = width * d;
          c.beginPath();
          c.moveTo(...p);
          c.lineTo(...q);
          c.stroke();
        };
      if (this.routes) {
        c.setLineDash([4 * d, 5 * d]);
        for (const car of s.cars)
          line([car.x, 0.07, car.z], [car.target.x, 0.07, car.target.z], car.id % 2 ? '#ce855f' : '#69a5be', 1);
        c.setLineDash([]);
      }
      if (this.fx && !this.reduced) this.drawWeather(s, point, line);
      if (this.fx && !this.reduced) {
        const rain = s.weather?.rain || 0,
          count = Math.floor(rain * (this.quality === 'coarse' ? 24 : 64));
        c.lineCap = 'round';
        for (let i = 0; i < count; i++) {
          const x = -49 + ((((i * 29.317 + s.time * (s.weather.windX || 0) * 0.2) % 98) + 98) % 98),
            z = -31 + ((((i * 17.427 + s.time * (s.weather.windZ || 0) * 0.2) % 62) + 62) % 62),
            y = 17 - ((s.time * 18 + i * 5.71) % 18);
          line(
            [x, y, z],
            [x + 0.16 * (s.weather.windX || 0), y - 1.3, z + 0.16 * (s.weather.windZ || 0)],
            this.night > 0.5 ? 'rgba(190,211,212,.28)' : 'rgba(127,157,150,.25)',
            0.65
          );
        }
        for (const car of s.cars) {
          const trail = this.trails[car.id] || (this.trails[car.id] = []);
          if ((car.boosting || car.slip > 0.45) && (!trail.length || s.time - trail.at(-1).t > 0.025))
            trail.push({ p: [car.x, car.y, car.z], t: s.time });
          while (trail.length && (s.time - trail[0].t > 0.22 || trail.length > 10)) trail.shift();
          for (let i = 1; i < trail.length; i++)
            line(trail[i - 1].p, trail[i].p, car.id % 2 ? 'rgba(224,151,98,.18)' : 'rgba(109,169,190,.18)', 1.5);
          if (car.ground && car.wet > 0.18 && car.speed > 9) {
            const f = Q.v(car.q, [1, 0, 0]),
              r = Q.v(car.q, [0, 0, 1]);
            for (const side of [-1, 1]) {
              const p = [car.x + r[0] * side - f[0], 0.25, car.z + r[2] * side - f[2]],
                len = car.speed * 0.055 * car.wet;
              line(p, [p[0] - f[0] * len, 0.48, p[2] - f[2] * len], 'rgba(224,235,226,.4)', 1);
            }
          }
        }
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 12 * dt;
        const q = this.project(p.x, Math.max(0.1, p.y), p.z);
        c.fillStyle = p.side > 0 ? '#89bdd0' : p.side < 0 ? '#e6ad82' : '#e5e4cf';
        c.globalAlpha = Math.min(1, p.life * 2);
        c.beginPath();
        c.arc(...q, 1.2 * d, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
      const labelBoxes = [];
      for (const car of s.cars) {
        if (this.xray) {
          const pts = [];
          for (const y of [-0.45, 0.45])
            for (const x of [-1.66, 1.66])
              for (const z of [-0.94, 0.94]) pts.push(V.add(Q.v(car.q, [x, y, z]), [car.x, car.y, car.z]));
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
            line(pts[a], pts[b], car.id % 2 ? '#fac494' : '#a1d6e9', 1);
        }
        if (this.labels) {
          const p = this.project(car.x, car.y + 2.15, car.z),
            anchor = p.slice();
          let tries = 0;
          while (labelBoxes.some(b => Math.abs(p[0] - b[0]) < 60 * d && Math.abs(p[1] - b[1]) < 19 * d) && tries++ < 4)
            p[1] -= 19 * d;
          labelBoxes.push(p.slice());
          if (tries) {
            c.strokeStyle = this.night > 0.5 ? 'rgba(225,232,220,.45)' : 'rgba(39,60,47,.3)';
            c.lineWidth = 0.6 * d;
            c.beginPath();
            c.moveTo(anchor[0], anchor[1]);
            c.lineTo(p[0], p[1]);
            c.stroke();
          }
          const col =
            car.id % 2 ? (this.night > 0.5 ? '#e8b38d' : '#744b36') : this.night > 0.5 ? '#badbe7' : '#315970';
          c.font = 9 * d + 'px Arial, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'bottom';
          c.fillStyle = this.night > 0.5 ? 'rgba(16,29,31,.84)' : 'rgba(247,246,238,.93)';
          const text = ['MICA', 'EMBER', 'SLATE', 'SIENNA'][car.id] || 'CAR',
            tw = c.measureText(text).width + 12 * d;
          c.beginPath();
          c.roundRect(p[0] - tw / 2, p[1] - 13 * d, tw, 16 * d, 3 * d);
          c.fill();
          c.fillStyle = col;
          c.fillText(text, p[0], p[1] - 2 * d);
        }
      }
    }
    // Visible weather, drawn on the shared overlay so both renderers show it. Everything here is
    // presentation derived from the snapshot: it never feeds back into the simulation.
    drawWeather(s, point, line) {
      const c = this.ctx,
        d = this.density,
        w = s.weather || {},
        t = s.time || 0,
        night = this.night > 0.5,
        windX = w.windX || 0,
        windZ = w.windZ || 0,
        wind = Math.hypot(windX, windZ),
        daylight = clamp((w.sun ?? 1) / 0.3, 0, 1),
        hash = n => {
          const x = Math.sin(n * 127.1) * 43758.5453;
          return x - Math.floor(x);
        },
        squash = Math.max(0.2, Math.sin(this.camPitch || 0.6)),
        blob = (x, z, radius, color, alpha) => {
          const p = point([x, 0.05, z]),
            r = radius * this.scale;
          if (r < 1 || alpha <= 0.002) return;
          c.save();
          c.translate(p[0], p[1]);
          c.scale(1, squash);
          const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
          g.addColorStop(0, `rgba(${color},${alpha})`);
          g.addColorStop(1, `rgba(${color},0)`);
          c.fillStyle = g;
          c.beginPath();
          c.arc(0, 0, r, 0, TAU);
          c.fill();
          c.restore();
        };
      // Cloud shadows drift with the wind across the whole arena.
      const cloud = clamp(((w.cloud || 0) - 0.3) / 0.6, 0, 1) * daylight;
      if (cloud > 0.02)
        for (let i = 0; i < 3; i++) {
          const x = ((((hash(i + 1) * 180 + t * windX * 0.35) % 180) + 180) % 180) - 90,
            z = ((((hash(i + 7) * 120 + t * windZ * 0.35) % 120) + 120) % 120) - 60;
          blob(x, z, 22 + hash(i + 3) * 14, '28,45,38', 0.13 * cloud);
        }
      // Splash rings where drops land on the turf.
      const rain = w.rain || 0;
      if (rain > 0.12) {
        const rings = Math.floor(rain * (this.quality === 'coarse' ? 10 : 26));
        c.lineWidth = 0.7 * d;
        for (let i = 0; i < rings; i++) {
          const cycle = t * 1.7 + hash(i + 11),
            phase = cycle - Math.floor(cycle),
            seed = i * 31 + Math.floor(cycle) * 7,
            x = -40 + hash(seed) * 80,
            z = -24 + hash(seed + 5) * 48,
            p = point([x, 0.04, z]),
            r = (0.15 + phase * 0.7) * this.scale;
          c.strokeStyle = night ? `rgba(200,220,214,${0.35 * (1 - phase)})` : `rgba(226,236,228,${0.5 * (1 - phase)})`;
          c.beginPath();
          c.ellipse(p[0], p[1], r, r * squash, 0, 0, TAU);
          c.stroke();
        }
      }
      // Flags on the floodlight masts stream downwind; they droop in still air.
      const flow = clamp(wind / 6, 0, 1),
        dirX = wind > 0.05 ? windX / wind : 1,
        dirZ = wind > 0.05 ? windZ / wind : 0;
      for (const [mx, color] of [
        [-39, '82,154,190'],
        [39, '222,137,94']
      ]) {
        const top = [mx, 12.2, -28.8];
        line([mx, 9.9, -28.8], top, night ? 'rgba(200,215,206,.55)' : 'rgba(39,59,54,.55)', 1);
        const length = 2.4,
          pts = [];
        for (let k = 0; k <= 4; k++) {
          const u = k / 4,
            wave = Math.sin(t * (3 + flow * 6) - u * 5) * 0.25 * u * (0.3 + flow);
          pts.push([
            top[0] + dirX * length * u * (0.25 + flow * 0.75) - dirZ * wave,
            top[1] - 0.35 - (1 - flow) * u * 1.6,
            top[2] + dirZ * length * u * (0.25 + flow * 0.75) + dirX * wave
          ]);
        }
        c.fillStyle = `rgba(${color},${night ? 0.75 : 0.85})`;
        c.beginPath();
        pts.forEach((q, k) => {
          const a = point(q);
          k ? c.lineTo(...a) : c.moveTo(...a);
        });
        for (let k = pts.length - 1; k >= 0; k--)
          c.lineTo(...point([pts[k][0], pts[k][1] - 0.7 * (1 - k / 5), pts[k][2]]));
        c.closePath();
        c.fill();
      }
      // Leaves and debris skate across the pitch in a strong wind.
      if (wind > 3.5) {
        const leaves = Math.floor(clamp((wind - 3.5) / 4, 0, 1) * 18);
        for (let i = 0; i < leaves; i++) {
          const speed = 0.6 + hash(i + 40),
            x = ((((hash(i + 20) * 100 + t * windX * speed) % 100) + 100) % 100) - 50,
            z = ((((hash(i + 60) * 64 + t * windZ * speed) % 64) + 64) % 64) - 32,
            y = 0.2 + Math.abs(Math.sin(t * 3 + i)) * 0.8,
            q = point([x, y, z]);
          c.fillStyle = hash(i + 80) > 0.5 ? 'rgba(166,138,82,.7)' : 'rgba(120,138,92,.65)';
          c.beginPath();
          c.ellipse(q[0], q[1], 1.8 * d, 0.9 * d, t * 4 + i, 0, TAU);
          c.fill();
        }
      }
      // Morning mist: low sun, still air, early in the day.
      const clock = w.clock ?? 0.5,
        morning = clamp(1 - Math.abs(clock - 0.28) / 0.07, 0, 1),
        mist = morning * clamp(1 - wind / 5, 0, 1) * clamp(1 - (w.sun ?? 1) * 1.6, 0, 1);
      if (mist > 0.02) {
        const g = c.createLinearGradient(0, 0, 0, this.h);
        g.addColorStop(0, `rgba(237,237,229,${0.05 * mist})`);
        g.addColorStop(1, `rgba(237,237,229,${0.38 * mist})`);
        c.fillStyle = g;
        c.fillRect(0, 0, this.w, this.h);
      }
    }
    drawPortrait(canvas, id) {
      if (this.fallback) {
        this.fallback.drawPortrait(canvas, id);
        return;
      }
      const ctx = canvas.getContext('2d'),
        w = canvas.width,
        h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const light = V.norm([-0.4, 1, -0.6]),
        view = look([-7, 4.7, 8], [0, 0.3, 0]),
        scale = Math.min(w / 6.2, h / 3.6),
        faces = [];
      const gather = (mesh, m = I()) => {
        const a = mesh.data;
        for (let i = 0; i < a.length; i += 33) {
          const pts = [],
            ns = [];
          for (let j = 0; j < 3; j++) {
            const k = i + j * 11;
            pts.push(tr(m, [a[k], a[k + 1], a[k + 2]]));
            ns.push([a[k + 3], a[k + 4], a[k + 5]]);
          }
          const p = pts.map(x => tr(view, x));
          faces.push({ p, n: ns[0], col: [a[i + 6], a[i + 7], a[i + 8]], z: p.reduce((s, v) => s + v[2], 0) / 3 });
        }
      };
      gather(this.carBodies[id]);
      for (const mount of WHEEL_MOUNTS) gather(this.wheelMesh, model(undefined, mount));
      ctx.save();
      ctx.translate(w * 0.52, h * 0.57);
      ctx.fillStyle = this.theme === 'night' ? 'rgba(0,0,0,.18)' : 'rgba(45,65,55,.09)';
      ctx.beginPath();
      ctx.ellipse(0, 28, scale * 2.1, scale * 0.43, -0.08, 0, TAU);
      ctx.fill();
      faces.sort((a, b) => a.z - b.z);
      ctx.globalAlpha = this.xray ? 0.2 : 1;
      for (const f of faces) {
        const li = 0.48 + 0.53 * Math.max(0, V.dot(f.n, light));
        ctx.fillStyle = 'rgb(' + f.col.map(x => Math.round(clamp(x * li, 0, 1) * 255)).join(',') + ')';
        ctx.beginPath();
        f.p.forEach((p, i) => (i ? ctx.lineTo(p[0] * scale, -p[1] * scale) : ctx.moveTo(p[0] * scale, -p[1] * scale)));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (this.xray) {
        ctx.strokeStyle = id % 2 ? '#d18f62' : '#569bbc';
        ctx.lineWidth = 1.7;
        const ps = [];
        for (const y of [-0.45, 0.45])
          for (const x of [-1.66, 1.66]) for (const z of [-0.94, 0.94]) ps.push(tr(view, [x, y, z]));
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
        ]) {
          ctx.beginPath();
          ctx.moveTo(ps[a][0] * scale, -ps[a][1] * scale);
          ctx.lineTo(ps[b][0] * scale, -ps[b][1] * scale);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    switchToFallback(reason) {
      if (this.fallback) return;
      this.base.remove();
      this.fallback = new CanvasAtelier(this.canvas);
      for (const k of ['mode', 'quality', 'fx', 'labels', 'routes', 'xray']) this.fallback[k] = this[k];
      this.fallback.setTheme(this.theme);
      if (this.field) this.fallback.updateField(this.field);
      this.kind = 'Canvas / Atelier';
      this.fallbackReason = reason;
      document.documentElement.dataset.renderer = 'canvas';
      this.copyFallback();
    }
    copyFallback() {
      for (const k of ['w', 'h', 'density', 'cssW', 'cssH', 'renderMs', 'frames', 'scale']) this[k] = this.fallback[k];
    }
  }
  /* The same scene, in a cached painter pipeline for software GPUs and low-power devices.
   Static meshes are shaded once per camera direction/palette; only cars are redrawn. */
  class CanvasAtelier {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.kind = 'Canvas / Atelier';
      this.quality = 'auto';
      this.mode = 'arena';
      this.theme = 'day';
      this.fx = true;
      this.labels = true;
      this.routes = false;
      this.xray = false;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.frames = 0;
      this.renderMs = 0;
      this.particles = [];
      this.trails = [[], [], [], []];
      this.ballTrail = [];
      this.zoom = 1;
      this.orbitYaw = -0.42;
      this.orbitPitch = 0.58;
      this.orbitZoom = 1;
      this.camYaw = -0.42;
      this.camPitch = 0.58;
      this.camFocus = [0, 0, 0];
      this.cameraSize = 0;
      this.night = 0;
      this.sun = V.norm([-45, 90, -55]);
      this.field = null;
      this.fieldRevision = -1;
      this.cacheStamp = '';
      this.base = document.createElement('canvas');
      this.fieldLayer = document.createElement('canvas');
      for (const [layer, z] of [
        [this.base, 1],
        [this.fieldLayer, 2]
      ]) {
        layer.className = 'scene-cache';
        layer.setAttribute('aria-hidden', 'true');
        Object.assign(layer.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: String(z),
          transformOrigin: '0 0',
          willChange: 'transform'
        });
        canvas.parentElement.insertBefore(layer, canvas);
      }
      canvas.style.zIndex = 3;
      this.buildMeshes();
      this.resize();
      document.documentElement.dataset.renderer = 'canvas-atelier';
    }
    mesh(g) {
      const data = new Float32Array(g.a);
      return { data, count: data.length / 11 };
    }
    resize() {
      const r = this.canvas.getBoundingClientRect(),
        adaptive = this.resolutionScale || 1;
      if (
        this.w &&
        this.cssW === r.width &&
        this.cssH === r.height &&
        this.lastQuality === this.quality &&
        this.lastDpr === devicePixelRatio &&
        this.lastResolutionScale === adaptive
      )
        return;
      this.cssW = Math.max(1, r.width);
      this.cssH = Math.max(1, r.height);
      this.lastQuality = this.quality;
      this.lastDpr = devicePixelRatio;
      this.lastResolutionScale = adaptive;
      this.density = Math.min(
        this.quality === 'coarse' ? 1 : this.quality === 'fine' ? 1.7 : 1.25 * adaptive,
        Math.sqrt(2200000 / (this.cssW * this.cssH))
      );
      this.w = Math.max(160, Math.round(this.cssW * this.density));
      this.h = Math.max(120, Math.round(this.cssH * this.density));
      for (const layer of [this.canvas, this.base, this.fieldLayer]) {
        layer.width = this.w;
        layer.height = this.h;
      }
      this.ratioX = this.cssW / this.w;
      this.ratioY = this.cssH / this.h;
      this.portrait = this.cssW < 620 && this.cssH > this.cssW * 0.85;
      if (this.mode === 'arena') this.camYaw = this.orbitYaw = this.portrait ? -1.15 : -0.42;
      this.cameraSize = 0;
      this.cacheStamp = '';
      this.fieldRevision = -1;
    }
    setTheme(t) {
      if (t === this.theme) return;
      this.theme = t === 'night' ? 'night' : 'day';
      this.night = this.theme === 'night' ? 1 : 0;
      this.cacheStamp = '';
    }
    setView(mode) {
      this.mode = mode;
      if (mode === 'arena') {
        this.orbitYaw = this.portrait ? -1.15 : -0.42;
        this.orbitPitch = 0.58;
        this.orbitZoom = 1;
      }
      this.camYaw = mode === 'arena' ? this.orbitYaw : this.portrait ? -1.05 : -0.56;
      this.camPitch = mode === 'arena' ? this.orbitPitch : 0.65;
      this.cacheStamp = '';
    }
    updateField(f) {
      if (!f) return;
      this.field = f;
      if (!this.cacheVP) return;
      if (this.fieldRevision === f.revision) return;
      this.fieldRevision = f.revision;
      const c = this.fieldLayer.getContext('2d');
      c.clearRect(0, 0, this.w, this.h);
      const nx = f.nx || 64,
        nz = f.nz || 40,
        q = f.nx ? 100 : 1;
      this.small = this.small || document.createElement('canvas');
      this.small.width = nx;
      this.small.height = nz;
      const sc = this.small.getContext('2d'),
        im = sc.createImageData(nx, nz);
      let visible = false;
      for (let i = 0; i < nx * nz; i++) {
        const wet = (f.wet[i] || 0) / q,
          heat = (f.heat[i] || 0) / q,
          life = (f.life?.[i] || 0) / q,
          wear = (f.wear?.[i] || 0) / q,
          k = i * 4;
        if (wet > 0.01 || heat > 0.04 || life || wear > 0.06) visible = true;
        if (wear > 0.06 && wear * 1.4 > wet + heat) {
          const mud = Math.min(1, wet * 1.8);
          im.data[k] = 150 - mud * 80;
          im.data[k + 1] = 138 - mud * 80;
          im.data[k + 2] = 98 - mud * 60;
          im.data[k + 3] = Math.min(120, wear * 130);
          continue;
        }
        im.data[k] = life ? 156 : wet > heat ? 86 : 201;
        im.data[k + 1] = life ? 170 : wet > heat ? 145 : 161;
        im.data[k + 2] = life ? 104 : wet > heat ? 153 : 109;
        im.data[k + 3] = Math.min(80, wet * 55 + heat * 20 + life * 22);
      }
      sc.putImageData(im, 0, 0);
      const proj = p => {
          const a = tr(this.cacheVP, p);
          return [(a[0] * 0.5 + 0.5) * this.w, (0.5 - a[1] * 0.5) * this.h];
        },
        pts = outline(43.8, 27.8, 7.8, 0.031).map(proj);
      c.save();
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
      c.closePath();
      c.clip();
      const o = proj([-44, 0.03, -28]),
        x = proj([44, 0.03, -28]),
        z = proj([-44, 0.03, 28]);
      c.setTransform((x[0] - o[0]) / nx, (x[1] - o[1]) / nx, (z[0] - o[0]) / nz, (z[1] - o[1]) / nz, o[0], o[1]);
      c.imageSmoothingEnabled = true;
      c.drawImage(this.small, 0, 0);
      c.restore();
      this.fieldLayer.hidden = !visible;
    }
    collect(mesh, m, vp, eye, faces, night = 0) {
      const a = mesh.data,
        dir = V.norm(eye),
        sun = this.sun;
      for (let i = 0; i < a.length; i += 33) {
        const normal = [
          m[0] * a[i + 3] + m[4] * a[i + 4] + m[8] * a[i + 5],
          m[1] * a[i + 3] + m[5] * a[i + 4] + m[9] * a[i + 5],
          m[2] * a[i + 3] + m[6] * a[i + 4] + m[10] * a[i + 5]
        ];
        if (V.dot(normal, dir) < -0.02) continue;
        const ps = [],
          ws = [];
        for (let j = 0; j < 3; j++) {
          const k = i + j * 11,
            p = tr(m, [a[k], a[k + 1], a[k + 2]]);
          ws.push(p);
          const q = tr(vp, p);
          ps.push([(q[0] * 0.5 + 0.5) * this.w, (0.5 - q[1] * 0.5) * this.h]);
        }
        const center = ws[0].map((v, j) => (v + ws[1][j] + ws[2][j]) / 3);
        let col = [a[i + 6], a[i + 7], a[i + 8]],
          kind = a[i + 10];
        if (kind > 3.5 && kind < 4.5) {
          const p = V.norm([
              (a[i] + a[i + 11] + a[i + 22]) / 3,
              (a[i + 1] + a[i + 12] + a[i + 23]) / 3,
              (a[i + 2] + a[i + 13] + a[i + 24]) / 3
            ]),
            gold = 1.618;
          let best = -1;
          for (const aa of [-1, 1])
            for (const bb of [-1, 1])
              for (const d of [
                [0, aa, bb * gold],
                [aa, bb * gold, 0],
                [bb * gold, 0, aa]
              ])
                best = Math.max(best, V.dot(p, V.norm(d)));
          col = best > 0.935 ? [0.16, 0.24, 0.21] : [0.91, 0.93, 0.855];
        }
        const hemi = 0.65 + 0.35 * Math.max(0, normal[1]),
          ndl = Math.max(0, V.dot(normal, sun)),
          illum = col.map(
            (v, j) =>
              v *
              (([0.35, 0.365, 0.375][j] * (1 - night) + [0.19, 0.265, 0.32][j] * night) * hemi +
                ([0.82, 0.8, 0.77][j] * (1 - night) + [0.58, 0.67, 0.72][j] * night) * ndl)
          );
        if (kind > 4.5 && kind < 5.5) for (let j = 0; j < 3; j++) illum[j] = col[j] * (0.93 + 0.27 * night);
        if (kind > 5.5 && kind < 6.5) for (let j = 0; j < 3; j++) illum[j] += [0.04, 0.06, 0.06][j];
        const fill = 'rgb(' + illum.map(v => Math.round(clamp(v, 0, 1) * 255)).join(',') + ')';
        faces.push({ ps, fill, depth: V.dot(center, dir) });
      }
    }
    paint(ctx, faces, seams = false) {
      faces.sort((a, b) => a.depth - b.depth);
      for (const f of faces) {
        ctx.fillStyle = f.fill;
        ctx.beginPath();
        ctx.moveTo(...f.ps[0]);
        ctx.lineTo(...f.ps[1]);
        ctx.lineTo(...f.ps[2]);
        ctx.closePath();
        ctx.fill();
        if (seams) {
          ctx.strokeStyle = f.fill;
          ctx.lineWidth = 0.55;
          ctx.stroke();
        }
      }
    }
    cache() {
      const factor = Math.min(this.mode === 'arena' ? 1 : 1.5, Math.sqrt(3200000 / (this.w * this.h)));
      this.base.width = Math.round(this.w * factor);
      this.base.height = Math.round(this.h * factor);
      this.base.getContext('2d').setTransform(factor, 0, 0, factor, 0, 0);
      this.cacheSize = this.cameraSize;
      const dir = [
          Math.sin(this.camYaw) * Math.cos(this.camPitch),
          Math.sin(this.camPitch),
          Math.cos(this.camYaw) * Math.cos(this.camPitch)
        ],
        eye = dir.map(v => v * 155),
        view = look(eye, [0, 0, 0]);
      if (this.mode !== 'arena') {
        let fit = 0;
        for (const x of [-54, 54])
          for (const y of [-4, 13])
            for (const z of [-37, 35]) {
              const p = tr(view, [x, y, z]);
              fit = Math.max(fit, Math.abs(p[1]), (Math.abs(p[0]) * this.h) / this.w);
            }
        this.cacheSize = Math.max(this.cameraSize, fit * 1.04);
      }
      this.cacheVP = mul(
        ortho(
          (-this.cacheSize * this.w) / this.h,
          (this.cacheSize * this.w) / this.h,
          -this.cacheSize,
          this.cacheSize,
          1,
          400
        ),
        view
      );
      this.cacheDir = dir;
      const c = this.base.getContext('2d');
      c.clearRect(0, 0, this.w, this.h);
      c.fillStyle = this.theme === 'night' ? '#101c1f' : '#edede5';
      c.fillRect(0, 0, this.w, this.h);
      const pp = tr(this.cacheVP, [3, -3, 4]),
        cx = (pp[0] * 0.5 + 0.5) * this.w,
        cy = (0.5 - pp[1] * 0.5) * this.h;
      c.save();
      c.translate(cx, cy);
      c.rotate(-0.12);
      c.scale(1, 0.45);
      const r = this.w * 0.38,
        grad = c.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
      grad.addColorStop(0, this.theme === 'night' ? 'rgba(0,0,0,.35)' : 'rgba(43,56,44,.24)');
      grad.addColorStop(0.7, this.theme === 'night' ? 'rgba(0,0,0,.13)' : 'rgba(43,56,44,.10)');
      grad.addColorStop(1, 'rgba(35,47,40,0)');
      c.fillStyle = grad;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.restore();
      let faces = [];
      this.collect(this.plinthMesh, I(), this.cacheVP, dir, faces, this.night);
      this.paint(c, faces, true);
      this.paintFloor(c);
      faces = [];
      this.collect(this.markings, I(), this.cacheVP, dir, faces, this.night);
      this.paint(c, faces, true);
      faces = [];
      this.collect(this.stadium, I(), this.cacheVP, dir, faces, this.night);
      this.paint(c, faces, true);
      this.fieldRevision = -1;
      if (this.field) this.updateField(this.field);
    }
    paintFloor(c) {
      const project = p => {
          const a = tr(this.cacheVP, p);
          return [(a[0] * 0.5 + 0.5) * this.w, (0.5 - a[1] * 0.5) * this.h];
        },
        shape = outline(44, 28, 7.8, 0).map(project),
        poly = ps => {
          c.beginPath();
          ps.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
          c.closePath();
        };
      c.save();
      poly(shape);
      c.clip();
      c.fillStyle = this.theme === 'night' ? '#344f49' : '#496e5a';
      c.fill();
      for (let i = 0; i < 12; i++)
        if (i % 2) {
          const x = -44 + (i * 88) / 12;
          poly(
            [
              [x, 0, -28],
              [x + 88 / 12, 0, -28],
              [x + 88 / 12, 0, 28],
              [x, 0, 28]
            ].map(project)
          );
          c.fillStyle = this.theme === 'night' ? '#35514a' : '#4c705d';
          c.fill();
        }
      poly(outline(43.8, 27.8, 7.8, 0.03).map(project));
      c.strokeStyle = this.theme === 'night' ? '#283e38' : '#3c5b48';
      c.lineWidth = (this.w / this.cacheSize) * 0.18;
      c.stroke();
      c.restore();
    }
    shadow(c, obj, r) {
      const p = this.project(obj.x + 0.18 * obj.y, 0.032, obj.z + 0.1 * obj.y),
        radius = this.scale * r;
      const t = Math.sin(this.camPitch);
      c.save();
      c.translate(...p);
      c.scale(1, t * 0.83);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, radius);
      g.addColorStop(0, 'rgba(15,28,22,' + 0.36 * Math.exp(-obj.y * 0.025) + ')');
      g.addColorStop(1, 'rgba(15,28,22,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, radius, 0, TAU);
      c.fill();
      c.restore();
    }
    render(s, dt = 1 / 60) {
      if (!s) return;
      const start = performance.now();
      this.lastState = s;
      this.lastTime = s.time;
      dt = clamp(dt, 0, 0.1);
      this.prepareCamera(s, dt);
      const stamp = [this.theme, this.camYaw.toFixed(2), this.camPitch.toFixed(2), this.w, this.h].join(':');
      if (stamp !== this.cacheStamp) {
        this.cacheStamp = stamp;
        this.cache();
      }
      const origin = tr(this.vp, [0, 0, 0]),
        cached = tr(this.cacheVP, [0, 0, 0]),
        zoom = this.cacheSize / this.cameraSize,
        tx = ((origin[0] * 0.5 + 0.5) * this.w - zoom * (cached[0] * 0.5 + 0.5) * this.w) * this.ratioX,
        ty = ((0.5 - origin[1] * 0.5) * this.h - zoom * (0.5 - cached[1] * 0.5) * this.h) * this.ratioY,
        transform = 'matrix(' + zoom + ',0,0,' + zoom + ',' + tx + ',' + ty + ')';
      for (const layer of [this.base, this.fieldLayer]) layer.style.transform = transform;
      const c = this.ctx;
      c.clearRect(0, 0, this.w, this.h);
      for (const pad of s.pads) {
        const p = this.project(pad.x, 0.035, pad.z),
          size = this.scale * (pad.big ? 0.68 : 0.27);
        c.strokeStyle = pad.charge > 0.15 ? (pad.big ? '#d5ca92' : '#94a886') : '#577764';
        c.lineWidth = 0.75 * this.density;
        c.beginPath();
        c.ellipse(p[0], p[1], size, size * Math.sin(this.camPitch), 0, 0, TAU);
        c.stroke();
      }
      for (const obj of [...s.cars, s.ball, ...s.props]) this.shadow(c, obj, obj.id !== undefined ? 1.7 : 1.2);
      let faces = [];
      const eye = V.sub(this.eye, this.camFocus);
      for (const car of s.cars) {
        const m = model(car.q, [car.x, car.y, car.z]);
        this.collect(this.carBodies[car.id], m, this.vp, eye, faces, this.night);
        for (const [x, y, z] of WHEEL_MOUNTS) {
          const a = x > 0 ? (car.steer || 0) * 0.43 : 0,
            wm = mul(
              m,
              mul(
                model([0, Math.sin(a / 2), 0, Math.cos(a / 2)], [x, y, z]),
                model([0, 0, Math.sin((car.wheelSpin || 0) / 2), Math.cos((car.wheelSpin || 0) / 2)])
              )
            );
          this.collect(this.scale < 12 ? this.wheelLow : this.wheelMesh, wm, this.vp, eye, faces, this.night);
        }
      }
      this.collect(
        this.scale < 12 ? this.ballLow : this.ballMesh,
        model(s.ball.q, [s.ball.x, s.ball.y, s.ball.z]),
        this.vp,
        eye,
        faces,
        this.night
      );
      for (const p of s.props)
        this.collect(this.propMesh, model(p.q, [p.x, p.y, p.z]), this.vp, eye, faces, this.night);
      this.paint(c, faces);
      if (this.fx)
        for (const car of s.cars)
          if (car.boosting) {
            const f = Q.v(car.q, [1, 0, 0]),
              rear = this.project(car.x - f[0] * 1.8, car.y, car.z - f[2] * 1.8),
              tail = this.project(car.x - f[0] * 3.5, car.y, car.z - f[2] * 3.5);
            c.strokeStyle = car.id % 2 ? '#eed1a2' : '#aed0da';
            c.lineCap = 'round';
            c.lineWidth = 2 * this.density;
            c.beginPath();
            c.moveTo(...rear);
            c.lineTo(...tail);
            c.stroke();
          }
      this.drawOverlay(s, dt, false);
      this.frames++;
      this.renderMs = this.renderMs * 0.94 + (performance.now() - start) * 0.06;
    }
  }
  Object.setPrototypeOf(CanvasAtelier.prototype, AtelierRenderer.prototype);
  root.CanvasAtelier = CanvasAtelier;

  root.AtelierRenderer = AtelierRenderer;
  root.SmoothRenderer = function (canvas) {
    let base = null;
    try {
      let preference = root.touchlineGraphics;
      try {
        preference =
          preference ||
          JSON.parse(
            localStorage.getItem('touchline.world07.prefs') || localStorage.getItem('touchline.edition06.prefs') || '{}'
          ).graphics;
      } catch {}
      preference = preference || 'auto';
      root.touchlineGraphics = preference;
      if (preference === 'canvas') return new CanvasAtelier(canvas);
      base = document.createElement('canvas');
      const gl = base.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false
      });
      const ext = gl?.getExtension('WEBGL_debug_renderer_info'),
        vendor = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      if (!gl || (preference === 'auto' && /swiftshader|llvmpipe|software|lavapipe/i.test(vendor))) {
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return new CanvasAtelier(canvas);
      }
      const renderer = new AtelierRenderer(canvas, base);
      renderer.adapter = vendor;
      return renderer;
    } catch (e) {
      base?.remove();
      console.warn('Bo-ket League: using the lightweight scene.', e.message);
      try {
        return new CanvasAtelier(canvas);
      } catch (error) {
        const r = new Fallback(canvas);
        r.kind = 'Canvas / compatibility';
        r.fallbackReason = error.message;
        return r;
      }
    }
  };
})(globalThis);
