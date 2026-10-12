// Narrow-body cabin interior (stable around the user) + visible wing/engine outside the window
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { mulberry32, D2R, lerp, clamp } from './util.js';
import { makeCrowd, personGeometries } from './people.js';

export const SEAT_X = -1.38, EYE_Y = 1.17, EYE_Z = 0.05, ROW_PITCH = 0.79;
export const FLOOR_H = 3.3; // cabin floor height above the ground when on the wheels
const R = 1.86, CY = 1.05, ZF = -11.2, ZB = 7.0, WALL_X = 1.84;
const wallX = (y) => Math.sqrt(R * R - (y - CY) * (y - CY));
export const WIN_Y = 1.12, WIN_Z0 = -0.15, WIN_PITCH = 0.53;
const SEATS_X = [-1.38, -0.92, -0.46, 0.46, 0.92, 1.38];

function sweep(pts, z0, z1, { uLen = 1, vLen = null, shade = null } = {}) {
  const n = pts.length, pos = [], uv = [], col = [], idx = [], cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const vL = vLen ?? cum[n - 1];
  for (const z of [z0, z1]) for (let i = 0; i < n; i++) {
    pos.push(pts[i][0], pts[i][1], z); uv.push(z / uLen, 1 - cum[i] / vL);
    const s = shade ? shade(pts[i][0], pts[i][1]) : 1; col.push(s, s, s);
  }
  for (let i = 0; i < n - 1; i++) { const a = i, b = i + 1, c = n + i, d = n + i + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
const mir = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
const shadeY = (x, y) => 0.74 + 0.26 * THREE.MathUtils.smoothstep(y, 0, 1.9);

function rrPts(cu, cv, w, h, r, seg = 5) {
  const pts = [], corners = [[cu + w / 2 - r, cv + h / 2 - r, 0], [cu - w / 2 + r, cv + h / 2 - r, 90], [cu - w / 2 + r, cv - h / 2 + r, 180], [cu + w / 2 - r, cv - h / 2 + r, 270]];
  for (const [x, y, a0] of corners) for (let k = 0; k <= seg; k++) { const a = (a0 + 90 * k / seg) * D2R; pts.push(new THREE.Vector2(x + r * Math.cos(a), y + r * Math.sin(a))); }
  return pts;
}
// shading baked into vertex colors from normals (cheap fake lighting for MeshBasicMaterial)
const LDIR = new THREE.Vector3(0.15, 0.8, 0.6).normalize();
function bakeBox(w, h, d, color, m, fabric = false) {
  const g = new THREE.BoxGeometry(w, h, d); g.applyMatrix4(m);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { if (fabric) uv.setXY(i, 0.01 + uv.getX(i) * 0.47, uv.getY(i)); else uv.setXY(i, 0.75, 0.5); }
  const n = g.attributes.normal, c = new THREE.Color(color), col = [];
  for (let i = 0; i < n.count; i++) {
    const s = 0.6 + 0.32 * Math.max(0, n.getX(i) * LDIR.x + n.getY(i) * LDIR.y + n.getZ(i) * LDIR.z) + 0.08 * n.getY(i);
    col.push(c.r * s, c.g * s, c.b * s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

function seatGeometry() {
  const up = '#2c3b58', up2 = '#30405f', shell = '#9aa0a8', dark = '#3a3d42';
  const Fb = M(0, 0.84, 0.26, 0.12);
  const F = (x, y, z) => Fb.clone().multiply(M(x, y, z));
  const parts = [
    bakeBox(0.40, 0.06, 0.42, dark, M(0, 0.36, -0.02)),
    bakeBox(0.04, 0.36, 0.36, '#55595e', M(0.16, 0.18, 0.03)),
    bakeBox(0.04, 0.36, 0.36, '#55595e', M(-0.16, 0.18, 0.03)),
    bakeBox(0.44, 0.12, 0.48, up, M(0, 0.45, -0.03), true),
    bakeBox(0.44, 0.66, 0.10, up, F(0, 0, 0), true),
    bakeBox(0.45, 0.70, 0.03, shell, F(0, 0, 0.065)),
    bakeBox(0.40, 0.20, 0.13, up2, F(0, 0.42, -0.005), true),
    bakeBox(0.30, 0.07, 0.012, '#e6e4de', F(0, 0.47, 0.066)),
    bakeBox(0.30, 0.07, 0.012, '#e6e4de', F(0, 0.47, -0.07)),
    bakeBox(0.21, 0.13, 0.008, '#14171b', F(0, 0.13, 0.082)),
    bakeBox(0.38, 0.25, 0.006, '#b1b4b8', F(0, -0.17, 0.082)),
    bakeBox(0.05, 0.015, 0.008, '#5a5d60', F(0, -0.035, 0.087)),
    bakeBox(0.36, 0.12, 0.02, '#2a2e35', F(0, -0.30, 0.09), true),
    bakeBox(0.14, 0.17, 0.004, '#e9e4d2', F(-0.08, -0.27, 0.098)),   // safety card in the seatback pocket
    bakeBox(0.12, 0.15, 0.004, '#4f7fb0', F(0.06, -0.28, 0.1)),      // in-flight magazine
    bakeBox(0.06, 0.02, 0.012, '#c9ccd0', F(0, 0.06, 0.088)),        // tray-table latch
    bakeBox(0.38, 0.012, 0.006, '#8d9196', F(0, -0.045, 0.086)),     // tray table top edge
    bakeBox(0.05, 0.05, 0.42, '#4a4e55', M(0.245, 0.64, 0.0)),
    bakeBox(0.05, 0.05, 0.42, '#4a4e55', M(-0.245, 0.64, 0.0)),
    bakeBox(0.04, 0.18, 0.05, '#4a4e55', M(0.245, 0.53, 0.17)),
    bakeBox(0.04, 0.18, 0.05, '#4a4e55', M(-0.245, 0.53, 0.17)),
  ];
  return mergeGeometries(parts);
}

// ---------------- Wing ----------------
// Bend the whole wing in world space: tip rises with lift, flexes a little in bumps (shader-side, no extra cost)
const flexU = { value: 0 };
function flexMat(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlex = flexU;
    sh.vertexShader = 'uniform float uFlex;\n' + sh.vertexShader.replace('#include <project_vertex>',
      'vec4 wpF = modelMatrix * vec4(transformed, 1.0); float spF = max(abs(wpF.x) - 1.9, 0.0) / 15.1; wpF.y += uFlex * spF * spF; vec4 mvPosition = viewMatrix * wpF; gl_Position = projectionMatrix * mvPosition;');
  };
  m.customProgramCacheKey = () => 'wingflex';
  return m;
}
function makeWing(sx, glowTex) {
  const grp = new THREE.Group();
  const wingMat = flexMat(new THREE.MeshLambertMaterial({ color: '#c9ced4', side: THREE.DoubleSide }));
  const panelMat = flexMat(new THREE.MeshLambertMaterial({ color: '#b3b9c0', side: THREE.DoubleSide }));
  const rootX = 1.9, tipX = 17.0, KINK = 0.33;
  // swept leading edge, trailing-edge kink ("Yehudi") so the inboard wing is deep and the outboard tapers
  const chord = (f) => (f < KINK ? lerp(7.4, 4.4, f / KINK) : lerp(4.4, 1.5, (f - KINK) / (1 - KINK)));
  const sec = (f) => ({ x: lerp(rootX, tipX, f), zLE: lerp(-2.8, 5.0, f), c: chord(f), yb: lerp(-0.55, -0.55 + 15.1 * Math.tan(5.5 * D2R), f), t: f < KINK ? lerp(0.62, 0.38, f / KINK) : lerp(0.38, 0.15, (f - KINK) / (1 - KINK)) });
  const prof = [[0, 0], [0.02, 0.32], [0.08, 0.62], [0.25, 0.95], [0.45, 1.0], [0.7, 0.72], [1, 0.12], [1, 0.04], [0.7, -0.18], [0.45, -0.3], [0.25, -0.32], [0.08, -0.26], [0.02, -0.16]];
  const P = (f, cf, tf) => { const s = sec(f); return new THREE.Vector3(sx * s.x, s.yb + tf * s.t * 0.62, s.zLE + cf * s.c); };
  const topY = (f, cf) => { const top = prof.slice(0, 7); for (let i = 0; i < top.length - 1; i++) if (cf >= top[i][0] && cf <= top[i + 1][0]) { const k = (cf - top[i][0]) / (top[i + 1][0] - top[i][0]); return P(f, cf, lerp(top[i][1], top[i + 1][1], k)); } return P(f, cf, 0); };
  const stations = [0, KINK, 0.66, 1], pos = [], idx = [], n = prof.length;
  for (const f of stations) for (const [cf, tf] of prof) { const p = P(f, cf, tf); pos.push(p.x, p.y, p.z); }
  for (let s = 0; s < stations.length - 1; s++) for (let i = 0; i < n; i++) { const a = s * n + i, b = s * n + (i + 1) % n, c = a + n, d = b + n; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const last = (stations.length - 1) * n, capIdx = []; for (let i = 1; i < n - 1; i++) { capIdx.push(0, i, i + 1); capIdx.push(last, last + i + 1, last + i); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(capIdx); cg.computeVertexNormals();
  grp.add(new THREE.Mesh(mergeGeometries([g, cg]), wingMat));
  // panel lines / walkway markings: thin darker strips on top (cheap realism)
  const lines = [];
  for (const cf of [0.12, 0.62]) { const a = topY(0.04, cf), b = topY(0.95, cf); const l = new THREE.BufferGeometry().setFromPoints([a.clone().add(new THREE.Vector3(0, 0.012, 0)), b.clone().add(new THREE.Vector3(0, 0.012, 0))]); lines.push(l); }
  const lineMat = flexMat(new THREE.LineBasicMaterial({ color: '#8f969e' }));
  for (const l of lines) grp.add(new THREE.Line(l, lineMat));

  // hinged plate helper (flaps / spoilers / slats). Points in wing space, hinge = A..B
  const pivots = [];
  function plate(f0, f1, c0, c1, dy, thick, mat, kind) {
    const A = topY(f0, c0).add(new THREE.Vector3(0, dy, 0)), B = topY(f1, c0).add(new THREE.Vector3(0, dy, 0));
    const At = topY(f0, c1).add(new THREE.Vector3(0, dy, 0)), Bt = topY(f1, c1).add(new THREE.Vector3(0, dy, 0));
    let X = new THREE.Vector3().subVectors(A, B); if (X.x < 0) X.negate(); X.normalize();
    const Z = new THREE.Vector3().crossVectors(X, new THREE.Vector3(0, 1, 0)).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(mid);
    const inv = basis.clone().invert();
    const corners = [A, B, Bt, At].map((p) => p.clone().applyMatrix4(inv));
    const v = [];
    for (const off of [0, -thick]) for (const p of corners) v.push(p.x, p.y + off, p.z);
    const gi = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); pg.setIndex(gi); pg.computeVertexNormals();
    const pivot = new THREE.Object3D(); pivot.matrixAutoUpdate = false;
    const mesh = new THREE.Mesh(pg, mat); pivot.add(mesh); grp.add(pivot);
    pivots.push({ pivot, kind, basis, Z });
  }
  plate(0.03, KINK, 0.72, 1.0, -0.03, 0.06, wingMat, 'flap');
  plate(KINK + 0.01, 0.72, 0.74, 1.0, -0.03, 0.05, wingMat, 'flap');
  plate(0.74, 0.95, 0.78, 1.0, -0.02, 0.04, panelMat, 'aileron');
  plate(0.05, 0.20, 0.50, 0.70, 0.006, 0.02, panelMat, 'spoiler');
  plate(0.20, KINK, 0.50, 0.70, 0.006, 0.02, panelMat, 'spoiler');
  plate(0.36, 0.50, 0.52, 0.71, 0.006, 0.02, panelMat, 'spoiler');
  plate(0.50, 0.63, 0.52, 0.71, 0.006, 0.02, panelMat, 'spoiler');
  plate(0.40, 0.97, 0.0, 0.10, 0.004, 0.05, wingMat, 'slat');

  // engine nacelle + pylon (one mesh, vertex colours): intake lip, fan face, spinner, core exhaust
  const ex = sx * 5.8, ey = -1.72, ez = -4.3;
  const eparts = [];
  const ep = (geo, color, m) => { geo.applyMatrix4(m); geo = geo.index ? geo.toNonIndexed() : geo; geo.deleteAttribute('uv'); const c = new THREE.Color(color), col = []; for (let i = 0; i < geo.attributes.position.count; i++) col.push(c.r, c.g, c.b); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); eparts.push(geo); };
  const prof2 = [[0.84, -0.05], [0.98, 0.1], [1.04, 0.5], [1.03, 1.6], [0.95, 2.6], [0.80, 3.3], [0.66, 3.6]].map(([r, y]) => new THREE.Vector2(r, y));
  ep(new THREE.LatheGeometry(prof2, 24), '#e7e9ec', M(ex, ey, ez, Math.PI / 2));
  ep(new THREE.TorusGeometry(0.9, 0.07, 6, 24), '#b8bcc1', M(ex, ey, ez - 0.02));
  ep(new THREE.CircleGeometry(0.86, 24), '#1a1d22', M(ex, ey, ez + 0.3, 0, Math.PI));
  ep(new THREE.ConeGeometry(0.26, 0.5, 14), '#d5d7da', M(ex, ey, ez + 0.06, -Math.PI / 2));
  ep(new THREE.CylinderGeometry(0.58, 0.5, 0.9, 16, 1, true), '#8a8e94', M(ex, ey, ez + 3.95, Math.PI / 2));
  ep(new THREE.ConeGeometry(0.42, 1.1, 14), '#5f6369', M(ex, ey, ez + 4.85, Math.PI / 2));
  ep(new THREE.BoxGeometry(0.34, 1.0, 4.6), '#e2e4e7', M(ex, ey + 1.05, ez + 2.6, -0.07));
  const engMat = flexMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  grp.add(new THREE.Mesh(mergeGeometries(eparts), engMat));
  // blended winglet
  const tip = sec(1);
  const wl = [[sx * tip.x, tip.yb + 0.05, tip.zLE + 0.05], [sx * tip.x, tip.yb + 0.05, tip.zLE + 1.5], [sx * (tip.x + 0.45), tip.yb + 0.75, tip.zLE + 1.75], [sx * (tip.x + 0.55), tip.yb + 2.4, tip.zLE + 2.55], [sx * (tip.x + 0.55), tip.yb + 2.4, tip.zLE + 1.95], [sx * (tip.x + 0.45), tip.yb + 0.75, tip.zLE + 0.65]];
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wl.flat(), 3)); wg.setIndex([0, 1, 2, 0, 2, 5, 5, 2, 3, 5, 3, 4]); wg.computeVertexNormals();
  const wlMat = flexMat(new THREE.MeshLambertMaterial({ color: '#3a6797', side: THREE.DoubleSide }));
  grp.add(new THREE.Mesh(wg, wlMat));
  // nav (red left / green right) + white strobe, each with an additive glow sprite
  const navCol = sx < 0 ? '#ff2a2a' : '#2aff5a';
  const navPos = new THREE.Vector3(sx * (tip.x + 0.08), tip.yb + 0.12, tip.zLE + 0.45), strobePos = new THREE.Vector3(sx * (tip.x + 0.08), tip.yb + 0.12, tip.zLE + 1.15);
  const nav = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: navCol })); nav.position.copy(navPos); grp.add(nav);
  const glow = (col, size) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); sp.scale.setScalar(size); sp.renderOrder = 15; return sp; };
  const navGlow = glow(navCol, 1.4); navGlow.position.copy(navPos); grp.add(navGlow);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  strobe.position.copy(strobePos); strobe.visible = false; grp.add(strobe);
  const strobeGlow = glow('#ffffff', 5); strobeGlow.position.copy(strobePos); strobeGlow.visible = false; grp.add(strobeGlow);

  const mats = [wingMat, panelMat, engMat, wlMat];
  const tmp = new THREE.Matrix4(), tr = new THREE.Matrix4();
  function set(flaps, spoil) {
    for (const p of pivots) {
      if (p.kind === 'flap') { const aft = Math.min(1, flaps / 0.45); tr.makeTranslation(0, -0.08 * flaps, 0.95 * aft); tmp.makeRotationX(32 * D2R * flaps); p.pivot.matrix.copy(p.basis).multiply(tr).multiply(tmp); }
      else if (p.kind === 'slat') { const a = Math.min(1, flaps / 0.3); tr.makeTranslation(0, -0.16 * a, -0.32 * a); tmp.makeRotationX(14 * D2R * a); p.pivot.matrix.copy(p.basis).multiply(tr).multiply(tmp); }
      else if (p.kind === 'aileron') { p.pivot.matrix.copy(p.basis); }
      else { tmp.makeRotationX(-45 * D2R * spoil); p.pivot.matrix.copy(p.basis).multiply(tmp); }
      p.pivot.matrixWorldNeedsUpdate = true;
    }
  }
  set(0, 0);
  grp.position.z = 4.6; // seat is a few rows ahead of the wing: ground view forward, wing + engine looking aft
  return { group: grp, set, strobe, strobeGlow, navGlow, mats };
}

// ---------------- Cabin ----------------
export function createCabin() {
  const group = new THREE.Group();
  const brightMats = [];
  const basic = (o) => { const m = new THREE.MeshBasicMaterial({ fog: false, ...o }); m.userData.base = m.color.clone(); brightMats.push(m); return m; };
  const r = mulberry32(99);
  const L = ZB - ZF;

  // floor
  const carpet = TX.carpetTexture(); carpet.repeat.set(1, L / 1.2);
  const floorG = new THREE.PlaneGeometry(2 * wallX(0), L); floorG.rotateX(-Math.PI / 2); floorG.translate(0, 0, (ZF + ZB) / 2);
  group.add(new THREE.Mesh(floorG, basic({ map: carpet, color: '#c9cbd0' })));

  const speck = TX.wallSpeckleTexture(); speck.repeat.set(0.8, 3);
  const wallMat = basic({ color: '#e6e3dc', vertexColors: true, side: THREE.DoubleSide, map: speck });
  const kickMat = basic({ color: '#8e9298', vertexColors: true, side: THREE.DoubleSide });
  const lower = [0.1, 0.3, 0.5, 0.7].map((y) => [-wallX(y), y]); lower.push([-WALL_X, 0.86]);
  const kick = [[-wallX(0), 0], [-wallX(0.1), 0.1]];
  const upper = [[-WALL_X, 1.40], [-wallX(1.5), 1.5], [-wallX(1.6), 1.6]];
  const binFront = [[-0.66, 1.665], [-0.60, 1.80], [-0.61, 1.95], [-0.70, 2.06]];
  const psu = [[-wallX(1.6), 1.6], [-0.66, 1.665]];
  const cove = [[-0.70, 2.06], [-0.58, 2.12]];
  const ceil = [[-0.58, 2.12], [-0.3, 2.17], [0, 2.185], [0.3, 2.17], [0.58, 2.12]];
  const binTex = TX.binTexture(); const psuTex = TX.psuTexture();
  const binMat = basic({ map: binTex, color: '#ffffff', vertexColors: true, side: THREE.DoubleSide });
  const psuMat = basic({ map: psuTex, color: '#ffffff', vertexColors: true, side: THREE.DoubleSide });
  const coveMat = basic({ color: '#fff1d2', side: THREE.DoubleSide });
  const shellB = new Map();
  const put = (g, m) => { if (!shellB.has(m)) shellB.set(m, []); shellB.get(m).push(g); };
  for (const side of [1, -1]) {
    const f = side > 0 ? (p) => p : mir;
    put(sweep(f(lower), ZF, ZB, { shade: shadeY }), wallMat);
    put(sweep(f(kick), ZF, ZB, { shade: shadeY }), kickMat);
    put(sweep(f(upper), ZF, ZB, { shade: () => 0.93 }), wallMat);
    put(sweep(f(binFront), ZF, ZB, { uLen: 1.6, shade: (x, y) => 0.86 + 0.12 * (y - 1.66) / 0.4 }), binMat);
    const pg = sweep(f(psu), ZF, ZB, { uLen: ROW_PITCH, shade: () => 0.8 });
    if (side < 0) { const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); }
    put(pg, psuMat);
    put(sweep(f(cove), ZF, ZB), coveMat);
  }
  put(sweep(ceil, ZF, ZB, { shade: () => 0.97 }), wallMat);
  for (const [m, list] of shellB) group.add(new THREE.Mesh(mergeGeometries(list), m));

  // window band panels with real holes, tunnels (bezels), glass and shades
  const bandMat = basic({ color: '#ebe8e2', side: THREE.DoubleSide });
  const tunMat = basic({ color: '#f2f0ea', vertexColors: true, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshBasicMaterial({ color: '#a8c4d6', transparent: true, opacity: 0.10, depthWrite: false, fog: false });
  const shadeMat = new THREE.MeshBasicMaterial({ color: '#e4e1d9', side: THREE.DoubleSide, fog: false });
  const winZ = []; for (let k = -21; k <= 13; k++) { const z = WIN_Z0 + k * WIN_PITCH; if (z > ZF + 0.4 && z < ZB - 0.4) winZ.push({ z, k }); }
  const tunGs = [], glassGs = [], shadeGs = [], bandGs = [];
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape([new THREE.Vector2(ZF, 0.835), new THREE.Vector2(ZB, 0.835), new THREE.Vector2(ZB, 1.425), new THREE.Vector2(ZF, 1.425)]);
    for (const { z } of winZ) shape.holes.push(new THREE.Path(rrPts(z, WIN_Y, 0.33, 0.46, 0.13)));
    const bg = new THREE.ShapeGeometry(shape);
    const p = bg.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i), v = p.getY(i); p.setXYZ(i, side * (WALL_X + 0.002), v, u); }
    bandGs.push(bg);
    for (const { z, k } of winZ) {
      const inner = rrPts(z, WIN_Y, 0.33, 0.46, 0.13), outer = rrPts(z, WIN_Y, 0.255, 0.36, 0.10);
      const pos = [], col = [], idx = [], n = inner.length;
      for (const q of inner) { pos.push(side * WALL_X, q.y, q.x); col.push(1, 1, 1); }
      for (const q of outer) { pos.push(side * (WALL_X + 0.10), q.y, q.x); col.push(0.74, 0.74, 0.74); }
      for (let i = 0; i < n; i++) { const a = i, b = (i + 1) % n; idx.push(a, b, n + a, b, n + b, n + a); }
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); tg.setIndex(idx);
      tunGs.push(tg);
      const gg = new THREE.ShapeGeometry(new THREE.Shape(outer)); const gp = gg.attributes.position;
      for (let i = 0; i < gp.count; i++) { const u = gp.getX(i), v = gp.getY(i); gp.setXYZ(i, side * (WALL_X + 0.095), v, u); }
      gg.deleteAttribute('normal'); gg.deleteAttribute('uv');
      glassGs.push(gg);
      if (side < 0 && k === 0) continue; // user's own shade is separate
      const rr = r(); const open = rr < 0.68 ? 0.44 : rr < 0.88 ? 0.22 : 0.0;
      const sg = new THREE.PlaneGeometry(0.33, 0.46); sg.rotateY(side * -Math.PI / 2); sg.translate(side * (WALL_X + 0.05), WIN_Y + open, z);
      sg.deleteAttribute('normal'); sg.deleteAttribute('uv');
      shadeGs.push(sg);
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(bandGs.map((g) => { g.deleteAttribute('normal'); g.deleteAttribute('uv'); return g; })), bandMat));
  group.add(new THREE.Mesh(mergeGeometries(tunGs), tunMat));
  group.add(new THREE.Mesh(mergeGeometries(shadeGs), shadeMat));
  const glass = new THREE.Mesh(mergeGeometries(glassGs), glassMat); glass.renderOrder = 5; group.add(glass);
  // user's shade (animated) with a pull tab
  const userShade = new THREE.Group();
  const us = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.46), shadeMat); us.rotation.y = Math.PI / 2; userShade.add(us);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.08), basic({ color: '#9a9890' })); tab.position.set(0.005, -0.215, 0); userShade.add(tab);
  userShade.position.set(-(WALL_X + 0.05), WIN_Y + 0.44, WIN_Z0);
  group.add(userShade);
  const shadeHit = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.46), new THREE.MeshBasicMaterial({ visible: false }));
  shadeHit.rotation.y = Math.PI / 2; shadeHit.position.set(-WALL_X + 0.005, WIN_Y, WIN_Z0); group.add(shadeHit);

  // bulkheads
  const bh = new THREE.PlaneGeometry(3.7, 2.3); bh.translate(0, 1.15, ZF);
  group.add(new THREE.Mesh(bh, basic({ map: TX.bulkheadTexture(false), color: '#f2f2f2' })));
  const bh2 = new THREE.PlaneGeometry(3.7, 2.3); bh2.rotateY(Math.PI); bh2.translate(0, 1.15, ZB);
  group.add(new THREE.Mesh(bh2, basic({ map: TX.bulkheadTexture(true), color: '#f2f2f2' })));

  // seats (instanced, one draw call)
  const rows = []; for (let k = -13; k <= 8; k++) rows.push(k);
  const seatMesh = new THREE.InstancedMesh(seatGeometry(), basic({ vertexColors: true, color: '#ffffff', map: TX.seatFabricTexture() }), rows.length * 6);
  let i = 0; const m4 = new THREE.Matrix4();
  for (const k of rows) for (const x of SEATS_X) { m4.makeTranslation(x, 0, k * ROW_PITCH); seatMesh.setMatrixAt(i++, m4); }
  group.add(seatMesh);

  // other passengers: heads + shoulders peeking over the seatbacks ahead, full seated people across the aisle
  const hairs = ['#2b1d14', '#3b2a1e', '#1c1a19', '#6b4a2e', '#a4825a', '#8d8d8d', '#c9b48a', '#4a3020', '#5b4636'];
  const shirts = ['#3d5a80', '#7a2e3a', '#2f4f4f', '#c9b79c', '#444a52', '#6b8e5a', '#8a6d9c', '#d0d3d6', '#1f2a3a'];
  const occ = [];
  for (let k = -13; k <= -2; k++) for (const x of SEATS_X) {
    if (x > 0 && k >= -3) continue;
    if (r() < 0.62) occ.push([x + (r() - 0.5) * 0.05, 1.29 + r() * 0.05, k * ROW_PITCH + 0.12 + r() * 0.03]);
  }
  const headG = new THREE.SphereGeometry(0.095, 10, 8); headG.scale(1, 1.12, 1.05);
  const heads = new THREE.InstancedMesh(headG, basic({ color: '#ffffff' }), occ.length);
  const shG = new THREE.BoxGeometry(0.40, 0.16, 0.2);
  const shoulders = new THREE.InstancedMesh(shG, basic({ color: '#ffffff' }), occ.length);
  occ.forEach(([x, y, z], j) => {
    m4.makeTranslation(x, y, z); heads.setMatrixAt(j, m4); heads.setColorAt(j, new THREE.Color(hairs[Math.floor(r() * hairs.length)]));
    m4.makeTranslation(x, y - 0.21, z + 0.02); shoulders.setMatrixAt(j, m4); shoulders.setColorAt(j, new THREE.Color(shirts[Math.floor(r() * shirts.length)]).multiplyScalar(0.85));
  });
  group.add(heads, shoulders);
  const seated = [];
  for (let k = -3; k <= 3; k++) for (const x of [0.46, 0.92, 1.38]) if (r() < 0.6) seated.push({ x, y: 0, z: k * ROW_PITCH + 0.03, yaw: 0 });
  seated.push({ x: -1.38, y: 0, z: -1 * ROW_PITCH + 0.03 }, { x: -0.46, y: 0, z: -1 * ROW_PITCH + 0.03 }); // row ahead (their heads show above the seat)
  const crowd = makeCrowd(seated, 'sit', () => basic({ vertexColors: true, color: '#ffffff' }), mulberry32(7));
  group.add(crowd.group);

  // flight attendant (walk-throughs, cart pass) + trolley
  const fa = makeCrowd([{ x: 0, y: 0, z: -9, yaw: Math.PI, shirt: '#1f2f52', pants: '#1f2f52', hair: '#2b1d14', skin: '#e0ac85' }], 'stand', () => basic({ vertexColors: true, color: '#ffffff' }), mulberry32(3));
  group.add(fa.group);
  const cart = new THREE.Group();
  const cartG = mergeGeometries([bakeBox(0.30, 1.0, 0.80, '#c4c8cc', M(0, 0.55, 0)), bakeBox(0.31, 0.05, 0.81, '#6d7277', M(0, 1.06, 0)), bakeBox(0.26, 0.05, 0.05, '#2d3136', M(0, 0.03, 0.33)), bakeBox(0.26, 0.05, 0.05, '#2d3136', M(0, 0.03, -0.33)),
    bakeBox(0.06, 0.14, 0.06, '#d9dde0', M(0.06, 1.15, 0.2)), bakeBox(0.06, 0.12, 0.06, '#c94a3a', M(-0.05, 1.14, 0.1)), bakeBox(0.07, 0.10, 0.07, '#eeeeee', M(0.02, 1.13, -0.15))].map((g) => { g.deleteAttribute('uv'); return g; }));
  cart.add(new THREE.Mesh(cartG, basic({ vertexColors: true, color: '#ffffff' })));
  cart.visible = false; group.add(cart);

  // floor path lighting strips (visible at night)
  const pathMat = new THREE.MeshBasicMaterial({ color: '#bcd9ff', transparent: true, opacity: 0, fog: false, depthWrite: false });
  for (const x of [-0.27, 0.27]) { const pg = new THREE.PlaneGeometry(0.018, L); pg.rotateX(-Math.PI / 2); pg.translate(x, 0.004, (ZF + ZB) / 2); group.add(new THREE.Mesh(pg, pathMat)); }

  // lit seatbelt signs in the PSUs
  const signG = new THREE.PlaneGeometry(0.10, 0.05); signG.rotateZ(Math.PI); signG.rotateX(Math.PI / 2);
  const signMat = new THREE.MeshBasicMaterial({ map: TX.seatbeltSignTexture(), fog: false });
  const signs = new THREE.InstancedMesh(signG, signMat, rows.length * 2);
  i = 0; for (const k of rows) for (const sx of [-1, 1]) { m4.makeTranslation(sx * 1.15, 1.633, k * ROW_PITCH + 0.43); signs.setMatrixAt(i++, m4); }
  signs.visible = false; group.add(signs);

  // illuminated EXIT signs (never dimmed): ceiling signs near the overwing exits + bulkheads
  const [ec, ex] = TX.mkCanvas(256, 96); ex.fillStyle = '#140808'; ex.fillRect(0, 0, 256, 96); ex.fillStyle = '#ff3b30'; ex.font = 'bold 66px Arial'; ex.textAlign = 'center'; ex.textBaseline = 'middle'; ex.fillText('EXIT', 128, 52);
  const exitMat = new THREE.MeshBasicMaterial({ map: TX.toTex(ec, { wrap: false }), fog: false, side: THREE.DoubleSide });
  const exitGs = [];
  for (const z of [2.6, 4.9]) { const g = new THREE.PlaneGeometry(0.30, 0.11); g.translate(0, 2.05, z); exitGs.push(g); }
  for (const [z, ry] of [[ZF + 0.02, 0], [ZB - 0.02, Math.PI]]) { const g = new THREE.PlaneGeometry(0.28, 0.105); g.rotateY(ry); g.translate(0, 2.0, z); exitGs.push(g); }
  group.add(new THREE.Mesh(mergeGeometries(exitGs), exitMat));

  // reading lights: bright spots in the PSU + soft pools on laps/seat tops (shown when the cabin is dimmed)
  const glowTex = TX.glowTexture();
  const readMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffe3b0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0, fog: false });
  const poolGs = [], bulbGs = [], rr2 = mulberry32(12);
  for (let k = -12; k <= 3; k++) for (const x of SEATS_X) {
    if (rr2() > 0.22 || (k === 0 && x === SEAT_X)) continue;
    const z = k * ROW_PITCH;
    const b = new THREE.CircleGeometry(0.018, 10); b.rotateX(Math.PI / 2); b.translate(x * 0.86, 1.64, z + 0.18); bulbGs.push(b);
    const p = new THREE.PlaneGeometry(0.75, 0.75); p.rotateX(-Math.PI / 2); p.translate(x, 0.66, z - 0.12); poolGs.push(p);
    const p2 = new THREE.PlaneGeometry(0.5, 0.5); p2.translate(x, 1.26, z + 0.23); poolGs.push(p2);
  }
  const pools = new THREE.Mesh(mergeGeometries(poolGs), readMat); pools.renderOrder = 6; group.add(pools);
  group.add(new THREE.Mesh(mergeGeometries(bulbGs), bulbMat));
  // taxi/landing-light pool on the ground outside (aircraft frame; only near the ground at night)
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#fff2d8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lpool = new THREE.Mesh(new THREE.PlaneGeometry(26, 60), poolMat); lpool.rotation.x = -Math.PI / 2; lpool.position.set(-4, -FLOOR_H + 0.08, -42); lpool.renderOrder = 6; group.add(lpool);

  // in-flight entertainment screen anchor on the seatback in front of the user
  const ifeAnchor = new THREE.Object3D();
  ifeAnchor.position.set(SEAT_X, 0.84, -ROW_PITCH + 0.26); ifeAnchor.rotation.x = 0.12;
  group.add(ifeAnchor);

  // wings (outside, attached to the aircraft so they move with the cabin)
  const wingL = makeWing(-1, glowTex), wingR = makeWing(1, glowTex);
  group.add(wingL.group, wingR.group);

  let shadeOpen = true, shadeAmt = 1, strobeT = 0, beaconT = 0;
  const tint = new THREE.Color(1, 1, 1), tmpC = new THREE.Color();
  const coveDay = new THREE.Color('#fff1d2'), coveNight = new THREE.Color('#6f6cff');
  const glassDay = new THREE.Color('#a8c4d6'), glassNight = new THREE.Color('#9aa6c0');
  return {
    group, ifeAnchor, shadeHit,
    get shadeOpen() { return shadeOpen; },
    setShade(open) { shadeOpen = open; },
    setSign(on) { signs.visible = on; },
    // crew: { faZ, faYaw, faOn, cartZ, cartOn, walk }
    setCrew(c) {
      const s0 = fa.spots[0];
      fa.group.visible = c.faOn; s0.z = c.faZ; s0.yaw = c.faYaw; s0.y = c.walk ? Math.abs(Math.sin(c.walk * 6)) * 0.02 : 0; fa.update();
      cart.visible = c.cartOn; cart.position.set(0, 0, c.cartZ);
    },
    // st: flight sample + cabin: { level, night, reading, flex, groundLight, alt, n1 }
    update(dt, st) {
      shadeAmt += Math.sign((shadeOpen ? 1 : 0) - shadeAmt) * Math.min(Math.abs((shadeOpen ? 1 : 0) - shadeAmt), dt * 1.4);
      userShade.position.y = WIN_Y + 0.44 * shadeAmt;
      wingL.set(st.flaps, st.spoil); wingR.set(st.flaps, st.spoil);
      flexU.value = st.flex || 0;
      const n = st.night || 0;
      // anti-collision lights: double-flash white strobes, red beacon reflections on the wing at night
      strobeT += dt; const ph = strobeT % 1.2; const on = ph < 0.06 || (ph > 0.18 && ph < 0.24);
      const lightsOn = st.n1 > 15 && !st.ground || (st.ground && st.phaseKey === 'takeoff');
      for (const w of [wingL, wingR]) { w.strobe.visible = on && lightsOn; w.strobeGlow.visible = on && lightsOn; w.strobeGlow.scale.setScalar(lerp(2.5, 7, n)); w.navGlow.scale.setScalar(lerp(0.6, 1.6, n)); w.navGlow.material.opacity = lerp(0.5, 1, n); }
      beaconT += dt; const bc = st.n1 > 5 ? Math.max(0, 1 - Math.abs((beaconT % 1.0) - 0.15) * 9) : 0;
      for (const m of [...wingL.mats, ...wingR.mats]) { if (!m.emissive) continue; m.emissive.setRGB(0.035 * n + 0.25 * bc * n + (on && lightsOn ? 0.12 * n : 0), 0.04 * n + (on && lightsOn ? 0.12 * n : 0), 0.05 * n + (on && lightsOn ? 0.13 * n : 0)); }
      this.flash = on && lightsOn ? 1 : 0;
      // cabin lighting: tint colour (warm white by day, dimmed blue at night)
      tint.copy(st.cabinTint || tmpC.setRGB(st.cabinLight, st.cabinLight, st.cabinLight));
      for (const m of brightMats) m.color.copy(m.userData.base).multiply(tint);
      coveMat.color.copy(coveDay).lerp(coveNight, n * (st.dim || 0)).multiplyScalar(lerp(Math.min(1.15, tint.r * 1.1), 0.9, n * (st.dim || 0)));
      shadeMat.color.set('#e4e1d9').multiply(tint).multiplyScalar(lerp(1.06, 1.35, n));
      glassMat.color.copy(glassDay).lerp(glassNight, n); glassMat.opacity = lerp(0.10, 0.2, n);
      readMat.opacity = 0.55 * (st.reading || 0); bulbMat.opacity = st.reading || 0;
      pathMat.opacity = 0.75 * n * (st.dim || 0);
      // ground light pool (taxi / landing lights)
      const gl = n * (st.alt < 25 ? 1 - st.alt / 25 : 0) * (st.speed > 0.5 || st.phaseKey === 'approach' ? 1 : 0);
      poolMat.opacity = 0.55 * gl; lpool.visible = gl > 0.01; lpool.position.y = -FLOOR_H - st.alt + 0.08;
    },
  };
}
