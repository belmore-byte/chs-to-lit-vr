// Procedural canvas textures (no external image files)
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function toTex(c, { repeat = null, flipY = true, wrap = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.flipY = flipY; t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
function noise(ctx, w, h, amt, rand, color = false) {
  const d = ctx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const n = (rand() - 0.5) * amt;
    if (color) { a[i] += n + (rand() - 0.5) * amt * 0.4; a[i + 1] += n; a[i + 2] += n + (rand() - 0.5) * amt * 0.4; }
    else { a[i] += n; a[i + 1] += n; a[i + 2] += n; }
  }
  ctx.putImageData(d, 0, 0);
}
function blur(ctx, c, px) {
  const [c2, x2] = mkCanvas(c.width, c.height);
  x2.filter = `blur(${px}px)`; x2.drawImage(c, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(c2, 0, 0);
}

// Countryside seen from the air: patchwork fields, forests, rivers, roads, towns. Tileable.
export function groundTexture() {
  const S = 2048, [c, ctx] = mkCanvas(S, S), r = mulberry32(11);
  const pal = ['#6c8a45', '#7b9650', '#8a9f59', '#9f9862', '#94845a', '#5d7a3d', '#a9a26b', '#768b48', '#83915a', '#687c40', '#b4a774', '#7f8f4f'];
  // irregular grid partition (tileable since it spans exactly 0..S)
  const part = () => { const a = [0]; let p = 0; while (p < S) { p += 22 + r() * 70; a.push(Math.min(S, p)); } if (S - a[a.length - 2] < 15) a.splice(a.length - 2, 1); return a; };
  const xs = part(), ys = part();
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
    const n = 1 + Math.floor(r() * 3), vert = r() < 0.5;
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = pal[Math.floor(r() * pal.length)];
      if (vert) ctx.fillRect(x0 + (x1 - x0) * k / n, y0, (x1 - x0) / n + 0.6, y1 - y0 + 0.6);
      else ctx.fillRect(x0, y0 + (y1 - y0) * k / n, x1 - x0 + 0.6, (y1 - y0) / n + 0.6);
    }
  }
  // field boundaries / hedgerows
  ctx.strokeStyle = 'rgba(60,80,45,0.35)'; ctx.lineWidth = 1;
  for (const x of xs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
  for (const y of ys) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }

  const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); } };
  // large-scale tonal variation
  const blobs = []; for (let i = 0; i < 40; i++) blobs.push([r() * S, r() * S, 120 + r() * 300, r() < 0.5]);
  wrap(() => { for (const [x, y, rad, dark] of blobs) { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, dark ? 'rgba(40,60,30,0.18)' : 'rgba(220,210,160,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
  // forests
  const forests = [];
  for (let i = 0; i < 70; i++) { const cx = r() * S, cy = r() * S, n = 8 + r() * 30, sp = 15 + r() * 50; const pts = []; for (let k = 0; k < n; k++) pts.push([cx + (r() - 0.5) * sp * 2, cy + (r() - 0.5) * sp * 2, 5 + r() * 16]); forests.push(pts); }
  wrap(() => { for (const f of forests) for (const [x, y, rad] of f) { ctx.fillStyle = r() < 0.5 ? '#3f5b31' : '#466338'; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); } });
  // lakes
  const lakes = []; for (let i = 0; i < 7; i++) lakes.push([r() * S, r() * S, 8 + r() * 26, 5 + r() * 14, r() * 3]);
  wrap(() => { ctx.fillStyle = '#4f6e7c'; for (const [x, y, a, b, rot] of lakes) { ctx.beginPath(); ctx.ellipse(x, y, a, b, rot, 0, 7); ctx.fill(); } });
  // river (periodic so it tiles)
  const rx0 = r() * S;
  wrap(() => {
    ctx.strokeStyle = '#4c6b78'; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let y = 0; y <= S; y += 8) { const x = rx0 + 140 * Math.sin(2 * Math.PI * y / S * 2) + 50 * Math.sin(2 * Math.PI * y / S * 5 + 1); y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  });
  // roads (periodic wobble)
  const roads = []; for (let i = 0; i < 9; i++) roads.push({ horiz: i % 2 === 0, p: r() * S, a: 20 + r() * 60, f: 1 + Math.floor(r() * 3), ph: r() * 6, w: i < 2 ? 4 : 2.2 });
  wrap(() => {
    for (const rd of roads) {
      ctx.strokeStyle = rd.w > 3 ? '#a3a39b' : '#9b9a8f'; ctx.lineWidth = rd.w; ctx.beginPath();
      for (let q = 0; q <= S; q += 16) { const o = rd.p + rd.a * Math.sin(2 * Math.PI * q / S * rd.f + rd.ph); rd.horiz ? (q ? ctx.lineTo(q, o) : ctx.moveTo(q, o)) : (q ? ctx.lineTo(o, q) : ctx.moveTo(o, q)); }
      ctx.stroke();
    }
  });
  // towns
  const towns = [];
  for (let i = 0; i < 26; i++) { const cx = r() * S, cy = r() * S, n = 20 + r() * 90, rad = 18 + r() * 45, b = []; for (let k = 0; k < n; k++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; b.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + r() * 5, ['#b9b6ad', '#c9c4b8', '#a5a29c', '#9c7f6c', '#d8d6d0', '#8f8c86'][Math.floor(r() * 6)]]); } towns.push([cx, cy, rad, b]); }
  wrap(() => {
    for (const [cx, cy, rad, b] of towns) {
      ctx.fillStyle = 'rgba(150,150,140,0.35)'; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.05, 0, 7); ctx.fill();
      for (const [x, y, s, col] of b) { ctx.fillStyle = col; ctx.fillRect(x, y, s, s * 0.8); }
    }
  });
  noise(ctx, S, S, 16, r, true);
  return toTex(c, { aniso: 16 });
}

export function grassTexture() {
  const S = 256, [c, ctx] = mkCanvas(S, S), r = mulberry32(5);
  ctx.fillStyle = '#6a8a46'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(80,110,50,0.35)' : 'rgba(140,160,90,0.25)'; const x = r() * S, y = r() * S; ctx.fillRect(x, y, 2 + r() * 10, 1 + r() * 3); }
  noise(ctx, S, S, 34, r, true);
  return toTex(c, { aniso: 16 });
}

// 45m x 3060m runway. Canvas y=0 is the south end (z=+60). Used with flipY=false.
export function runwayTexture() {
  const W = 256, H = 4096, [c, ctx] = mkCanvas(W, H), r = mulberry32(3);
  ctx.fillStyle = '#4a4c4f'; ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 26, r);
  const ppm = H / 3060, mx = W / 45;
  const yOf = (z) => (60 - z) * ppm; // z (local, north negative) -> canvas y
  // rubber deposits in touchdown zones
  for (const zc of [-500, -2440]) { for (let i = 0; i < 60; i++) { ctx.fillStyle = 'rgba(20,20,22,0.10)'; ctx.fillRect(W / 2 - (8 + r() * 6) * mx * (r() < 0.5 ? 1 : -0.1), yOf(zc) + (r() - 0.5) * 500 * ppm, (3 + r() * 6) * mx, 30 * ppm); } }
  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(0.7 * mx, yOf(0), 0.9 * mx, yOf(-2940) - yOf(0));
  ctx.fillRect(W - 1.6 * mx, yOf(0), 0.9 * mx, yOf(-2940) - yOf(0));
  for (let z = -90; z > -2860; z -= 60) ctx.fillRect(W / 2 - 0.45 * mx, yOf(z), 0.9 * mx, 36 * ppm);
  const ends = [{ m: (z) => z, num: '36', sx: 1, sy: -1 }, { m: (z) => -2940 - z, num: '18', sx: -1, sy: 1 }];
  for (const e of ends) {
    // threshold bar + piano keys
    const z0 = e.m(-6), z1 = e.m(-36);
    const ya = Math.min(yOf(z0), yOf(z1)), yb = Math.max(yOf(z0), yOf(z1));
    for (let k = 0; k < 8; k++) { const off = 3 + k * 3.6; ctx.fillRect(W / 2 - (off + 1.8) * mx - 2.5 * mx + 2.5 * mx, ya, 1.8 * mx, yb - ya); ctx.fillRect(W / 2 + off * mx, ya, 1.8 * mx, yb - ya); }
    // numbers (stretched along the runway)
    const yc = yOf(e.m(-70));
    ctx.save(); ctx.translate(W / 2, yc); ctx.scale(1.35 * e.sx, 0.85 * e.sy); ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.num, 0, 0); ctx.restore();
    // touchdown zone markings
    const sets = [[-150, 3], [-300, 3], [-450, 2], [-600, 2], [-750, 1], [-900, 1]];
    for (const [z, n] of sets) { const y = Math.min(yOf(e.m(z)), yOf(e.m(z - 22.5))); for (let k = 0; k < n; k++) { const off = 5 + k * 2.6; ctx.fillRect(W / 2 - (off + 1.8) * mx, y, 1.8 * mx, 22.5 * ppm); ctx.fillRect(W / 2 + off * mx, y, 1.8 * mx, 22.5 * ppm); } }
    const ya2 = Math.min(yOf(e.m(-380)), yOf(e.m(-425)));
    ctx.fillRect(W / 2 - 15 * mx, ya2, 7 * mx, 45 * ppm); ctx.fillRect(W / 2 + 8 * mx, ya2, 7 * mx, 45 * ppm);
  }
  // blast pad chevrons (yellow)
  ctx.strokeStyle = '#d7b64a'; ctx.lineWidth = 4;
  for (const [ya, dir] of [[yOf(55), 1], [yOf(-2995), -1]]) for (let k = 0; k < 3; k++) { const y = ya + dir * k * 14 * ppm; ctx.beginPath(); ctx.moveTo(3, y + dir * 25); ctx.lineTo(W / 2, y); ctx.lineTo(W - 3, y + dir * 25); ctx.stroke(); }
  return toTex(c, { flipY: false, wrap: false, aniso: 16 });
}

export function taxiwayTexture() {
  const W = 64, H = 256, [c, ctx] = mkCanvas(W, H), r = mulberry32(9);
  ctx.fillStyle = '#55575a'; ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 24, r);
  ctx.fillStyle = '#d9b443'; ctx.fillRect(W / 2 - 1, 0, 2, H);
  ctx.fillRect(2, 0, 1.5, H); ctx.fillRect(5, 0, 1.5, H); ctx.fillRect(W - 3.5, 0, 1.5, H); ctx.fillRect(W - 6.5, 0, 1.5, H);
  return toTex(c, { aniso: 16 });
}
export function concreteTexture() {
  const S = 256, [c, ctx] = mkCanvas(S, S), r = mulberry32(13);
  ctx.fillStyle = '#a3a39d'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) { ctx.fillStyle = `rgba(${120 + r() * 40},${120 + r() * 40},${115 + r() * 35},0.25)`; ctx.fillRect((i % 4) * 64, Math.floor(i / 4) * 64, 64, 64); }
  noise(ctx, S, S, 22, r);
  ctx.fillStyle = 'rgba(70,70,65,0.55)';
  for (let k = 0; k < 4; k++) { ctx.fillRect(k * 64, 0, 1.5, S); ctx.fillRect(0, k * 64, S, 1.5); }
  // stray oil stains
  for (let i = 0; i < 10; i++) { ctx.fillStyle = 'rgba(40,40,40,0.12)'; ctx.beginPath(); ctx.ellipse(r() * S, r() * S, 4 + r() * 12, 3 + r() * 8, r() * 3, 0, 7); ctx.fill(); }
  return toTex(c, { aniso: 16 });
}

export function terminalTexture() {
  const W = 512, H = 256, [c, ctx] = mkCanvas(W, H), r = mulberry32(21);
  ctx.fillStyle = '#c9c5bb'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 70, 0, 190); g.addColorStop(0, '#5f7d94'); g.addColorStop(0.5, '#86a3b8'); g.addColorStop(1, '#4c6578');
  ctx.fillStyle = g; ctx.fillRect(0, 70, W, 120);
  ctx.fillStyle = '#3c4a55'; for (let x = 0; x < W; x += 32) ctx.fillRect(x, 70, 3, 120);
  ctx.fillRect(0, 128, W, 3);
  ctx.fillStyle = '#e6e2d8'; ctx.fillRect(0, 0, W, 16); ctx.fillRect(0, 190, W, 8);
  noise(ctx, W, H, 10, r);
  return toTex(c);
}
export function hangarTexture() {
  const W = 256, H = 128, [c, ctx] = mkCanvas(W, H), r = mulberry32(31);
  ctx.fillStyle = '#b8bcc0'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(80,85,90,0.5)'; for (let x = 0; x < W; x += 8) ctx.fillRect(x, 0, 1, H);
  ctx.fillStyle = '#8e959c'; ctx.fillRect(20, 40, W - 40, H - 40);
  ctx.fillStyle = '#6f777f'; for (let x = 20; x < W - 20; x += 27) ctx.fillRect(x, 40, 2, H - 40);
  noise(ctx, W, H, 14, r);
  return toTex(c);
}
export function buildingTexture() {
  const W = 128, H = 128, [c, ctx] = mkCanvas(W, H), r = mulberry32(41);
  ctx.fillStyle = '#ddd8cd'; ctx.fillRect(0, 0, W, H);
  for (let y = 8; y < H; y += 16) for (let x = 6; x < W; x += 14) { ctx.fillStyle = r() < 0.3 ? '#8aa0b0' : '#56697a'; ctx.fillRect(x, y, 8, 9); }
  noise(ctx, W, H, 12, r);
  return toTex(c);
}

// Soft cumulus puffs: 2x2 atlas, white tops, grey bases, alpha falloff
export function cloudAtlas() {
  const S = 512, [c, ctx] = mkCanvas(S, S), r = mulberry32(77);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * 256, oy = Math.floor(v / 2) * 256;
    const [c2, x2] = mkCanvas(256, 256);
    const n = 16 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, d = Math.pow(r(), 0.7) * 62;
      const x = 128 + Math.cos(a) * d * 1.25, y = 136 + Math.sin(a) * d * 0.6 - (r() * 18);
      const rad = 26 + r() * 40;
      const g = x2.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.55, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x2.fillStyle = g; x2.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // flatter base
    x2.globalCompositeOperation = 'destination-out';
    const gb = x2.createLinearGradient(0, 170, 0, 215); gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(0,0,0,1)');
    x2.fillStyle = gb; x2.fillRect(0, 170, 256, 86);
    // shading: lit tops, grey undersides
    x2.globalCompositeOperation = 'source-atop';
    const gs = x2.createLinearGradient(0, 60, 0, 210); gs.addColorStop(0, 'rgba(255,255,255,1)'); gs.addColorStop(0.55, 'rgba(236,240,245,1)'); gs.addColorStop(1, 'rgba(160,170,184,1)');
    x2.fillStyle = gs; x2.fillRect(0, 0, 256, 256);
    // keep 1px gutter between atlas cells
    ctx.drawImage(c2, 2, 2, 252, 252, ox + 2, oy + 2, 252, 252);
  }
  const t = toTex(c, { wrap: false }); t.generateMipmaps = true; return t;
}

// ---------- Cabin textures ----------
export function carpetTexture() {
  const W = 256, H = 256, [c, ctx] = mkCanvas(W, H), r = mulberry32(51);
  ctx.fillStyle = '#3d4a5f'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2c3646'; ctx.fillRect(W * 0.42, 0, W * 0.16, H);
  ctx.fillStyle = 'rgba(120,140,170,0.25)';
  for (let y = 0; y < H; y += 16) for (let x = (y / 16 % 2) * 8; x < W; x += 16) ctx.fillRect(x, y, 2, 2);
  // emergency floor path lights along the aisle edges
  ctx.fillStyle = '#9aa3a9'; ctx.fillRect(W * 0.42 - 2, 0, 2, H); ctx.fillRect(W * 0.58, 0, 2, H);
  noise(ctx, W, H, 26, r);
  return toTex(c, { aniso: 8 });
}
export function binTexture() {
  const W = 256, H = 128, [c, ctx] = mkCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#f1f0eb'); g.addColorStop(1, '#e2e0d9');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#a9a7a0'; ctx.fillRect(0, 0, 2, H); ctx.fillRect(W - 2, 0, 2, H);
  ctx.fillStyle = '#c8c6bf'; ctx.fillRect(0, 6, W, 1);
  // latch at the lower edge of the bin door (canvas top = section start = lower front edge)
  ctx.fillStyle = '#7d8086'; roundRect(ctx, W / 2 - 22, 14, 44, 12, 5); ctx.fill();
  ctx.fillStyle = '#5b5e63'; roundRect(ctx, W / 2 - 16, 17, 32, 6, 3); ctx.fill();
  return toTex(c, { aniso: 8 });
}
export function psuTexture() {
  // u along z (one row = 0.79m), v across from wall (top) to bin edge (bottom)
  const W = 256, H = 128, [c, ctx] = mkCanvas(W, H);
  ctx.fillStyle = '#dcdad3'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c4c2bb'; ctx.fillRect(0, 0, 3, H); ctx.fillRect(W * 0.33, 0, 2, H);
  for (const v of [0.3, 0.5, 0.7]) {
    ctx.fillStyle = '#9fa1a4'; ctx.beginPath(); ctx.arc(W * 0.12, H * v, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#f4f2ea'; ctx.beginPath(); ctx.arc(W * 0.12, H * v, 4.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#7b7e82'; ctx.beginPath(); ctx.arc(W * 0.22, H * v, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a4d51'; ctx.beginPath(); ctx.arc(W * 0.22, H * v, 2.5, 0, 7); ctx.fill();
  }
  // sign panel (unlit)
  ctx.fillStyle = '#6a6c70'; ctx.fillRect(W * 0.5, H * 0.47, W * 0.15, H * 0.2);
  ctx.fillStyle = '#8a8c90'; ctx.fillRect(W * 0.51, H * 0.49, W * 0.06, H * 0.16); ctx.fillRect(W * 0.58, H * 0.49, W * 0.06, H * 0.16);
  // speaker grille
  ctx.fillStyle = '#b6b4ad'; for (let i = 0; i < 6; i++) ctx.fillRect(W * 0.75 + i * 6, H * 0.4, 3, H * 0.25);
  return toTex(c, { aniso: 8 });
}
export function seatbeltSignTexture() {
  const [c, ctx] = mkCanvas(128, 64);
  ctx.fillStyle = '#1f2328'; ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#fff3c8';
  // seat belt icon (left)
  ctx.lineWidth = 5; ctx.strokeStyle = '#fff3c8';
  ctx.beginPath(); ctx.moveTo(10, 40); ctx.lineTo(28, 30); ctx.lineTo(46, 40); ctx.stroke();
  ctx.fillRect(24, 26, 10, 10);
  ctx.beginPath(); ctx.arc(28, 16, 6, 0, 7); ctx.fill();
  // no-phone/no-smoking icon (right)
  ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(94, 32, 18, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(81, 45); ctx.lineTo(107, 19); ctx.stroke();
  ctx.fillRect(84, 30, 20, 5);
  return toTex(c, { wrap: false });
}
export function bulkheadTexture(back = false) {
  const W = 512, H = 320, [c, ctx] = mkCanvas(W, H), r = mulberry32(back ? 63 : 61);
  ctx.fillStyle = '#e4e2dc'; ctx.fillRect(0, 0, W, H);
  const mx = W / 3.7, ax = W / 2;
  // panels / doors
  ctx.strokeStyle = '#b9b7b0'; ctx.lineWidth = 2;
  ctx.fillStyle = '#dcd9d2';
  roundRect(ctx, ax - 1.45 * mx, 0.25 * H, 1.0 * mx, 0.75 * H, 6); ctx.fill(); ctx.stroke();
  roundRect(ctx, ax + 0.45 * mx, 0.25 * H, 1.0 * mx, 0.75 * H, 6); ctx.fill(); ctx.stroke();
  // door handles + lavatory sign on one side
  ctx.fillStyle = '#8b8d90'; ctx.fillRect(ax - 0.55 * mx, 0.6 * H, 8, 26); ctx.fillRect(ax + 0.5 * mx, 0.6 * H, 8, 26);
  ctx.fillStyle = '#2a2e33'; ctx.fillRect(ax - 1.1 * mx, 0.35 * H, 40, 22);
  ctx.fillStyle = '#9fe3a3'; ctx.font = 'bold 15px Arial'; ctx.fillText(back ? 'LAV' : 'LAV', ax - 1.1 * mx + 6, 0.35 * H + 16);
  // curtain in the aisle
  const cg = ctx.createLinearGradient(ax - 0.45 * mx, 0, ax + 0.45 * mx, 0);
  for (let i = 0; i <= 10; i++) cg.addColorStop(i / 10, i % 2 ? '#2d3c5a' : '#3c4d70');
  ctx.fillStyle = cg; ctx.fillRect(ax - 0.42 * mx, 0.22 * H, 0.84 * mx, 0.78 * H);
  // EXIT sign
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(ax - 34, 0.06 * H, 68, 26);
  ctx.fillStyle = '#ff3b30'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.fillText('EXIT', ax, 0.06 * H + 20);
  noise(ctx, W, H, 6, r);
  return toTex(c, { wrap: false });
}
export function roundRect(ctx, x, y, w, h, rr) {
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
