// Land-cover masks for the ground shader + matching night-light point positions.
//  macro tile (wraps every MT metres):  R = forest, G = towns/roads, B = water
//  CHS region (48 km around the departure airport, leg 1 only): R = water, G = marsh, B = city
import * as THREE from 'three';
import { mkCanvas } from './textures.js';
import { mulberry32 } from './util.js';

export const MT = 32000;
export const REG = 48000;

function maskTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
function softBlurWrapped(c, px) {
  const S = c.width, [big, bx] = mkCanvas(S * 3, S * 3);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) bx.drawImage(c, i * S, j * S);
  const [out, ox] = mkCanvas(S, S);
  ox.filter = `blur(${px}px)`; ox.drawImage(big, S, S, S, S, 0, 0, S, S);
  return out;
}
const wiggle = (pts, r, amp, step) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(len / step));
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    for (let k = 0; k < n; k++) { const t = k / n, w = (r() - 0.5) * amp * Math.sin(Math.PI * t + 0.3); out.push([x0 + (x1 - x0) * t + nx * w, y0 + (y1 - y0) * t + ny * w]); }
  }
  out.push(pts[pts.length - 1]); return out;
};
const stroke = (ctx, pts, w, style) => { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.lineJoin = ctx.lineCap = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };

// ---------- generic countryside (tiles) ----------
export function buildMacro() {
  const S = 1024, [c, ctx] = mkCanvas(S, S), r = mulberry32(321), m = MT / S;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); } };
  // forests (R)
  const forests = [];
  for (let i = 0; i < 150; i++) { const cx = r() * S, cy = r() * S, n = 6 + r() * 26, sp = 10 + r() * 45; for (let k = 0; k < n; k++) forests.push([cx + (r() - 0.5) * sp * 2, cy + (r() - 0.5) * sp * 2, 4 + r() * 16]); }
  wrap(() => { ctx.fillStyle = 'rgb(255,0,0)'; for (const [x, y, rad] of forests) { ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); } });
  // water (B): two periodic rivers + lakes
  const river = (vertical, p0, w) => { const pts = []; for (let q = -8; q <= S + 8; q += 8) { const o = p0 + 60 * Math.sin(2 * Math.PI * q / S * 2 + p0) + 25 * Math.sin(2 * Math.PI * q / S * 7 + 1.3) + 9 * Math.sin(2 * Math.PI * q / S * 19); pts.push(vertical ? [o, q] : [q, o]); } return { pts, w }; };
  const rivers = [river(true, S * 0.31, 4.2), river(false, S * 0.72, 3.0), river(true, S * 0.83, 2.2)];
  const lakes = []; for (let i = 0; i < 9; i++) lakes.push([r() * S, r() * S, 5 + r() * 22, 3 + r() * 9, r() * 3]);
  wrap(() => { for (const rv of rivers) stroke(ctx, rv.pts, rv.w, 'rgb(0,0,255)'); ctx.fillStyle = 'rgb(0,0,255)'; for (const [x, y, a, b, rot] of lakes) { ctx.beginPath(); ctx.ellipse(x, y, a, b, rot, 0, 7); ctx.fill(); } });
  // towns (G) + roads joining them
  const towns = [];
  for (let i = 0; i < 20; i++) towns.push([r() * S, r() * S, i < 2 ? 70 + r() * 40 : 14 + r() * 34]);
  const roads = [];
  for (let i = 0; i < towns.length; i++) {
    const [ax, ay] = towns[i]; let best = null, bd = 1e9;
    for (let j = 0; j < towns.length; j++) { if (j === i) continue; let [bx, by] = towns[j]; bx += Math.round((ax - bx) / S) * S; by += Math.round((ay - by) / S) * S; const d = Math.hypot(bx - ax, by - ay); if (d < bd && !roads.some((q) => q.j === i && q.i === j)) { bd = d; best = [bx, by, j]; } }
    if (best) roads.push({ i, j: best[2], pts: wiggle([[ax, ay], [best[0], best[1]]], r, 30, 40) });
  }
  wrap(() => {
    for (const rd of roads) stroke(ctx, rd.pts, 1.3, 'rgb(0,120,0)');
    for (const [x, y, rad] of towns) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(0,255,0,1)'); g.addColorStop(0.55, 'rgba(0,210,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      for (let k = 0; k < rad / 4; k++) { const a = r() * 6.28, d = rad * (0.6 + r() * 0.7); ctx.fillStyle = 'rgba(0,200,0,0.8)'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 2 + r() * rad * 0.18, 0, 7); ctx.fill(); }
    }
  });
  const out = softBlurWrapped(c, 1.2);
  // night-light points from the town mask + strings along roads
  const data = out.getContext('2d').getImageData(0, 0, S, S).data;
  const pts = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const g = data[(y * S + x) * 4 + 1], b = data[(y * S + x) * 4 + 2];
    if (g < 150 || b > 90) continue;
    const n = r() < (g / 255) * 0.55 ? (r() < 0.35 ? 2 : 1) : 0;
    for (let k = 0; k < n; k++) pts.push((x + r()) * m, (y + r()) * m, r() < 0.8 ? 0 : 1);
  }
  for (const rd of roads) for (let i = 0; i < rd.pts.length - 1; i++) {
    const [x0, y0] = rd.pts[i], [x1, y1] = rd.pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0) * m, n = Math.floor(len / 55);
    for (let k = 0; k < n; k++) { const t = k / n; let px = (x0 + (x1 - x0) * t) * m, py = (y0 + (y1 - y0) * t) * m; px = ((px % MT) + MT) % MT; py = ((py % MT) + MT) % MT; pts.push(px, py, 2); }
  }
  return { tex: maskTex(out), lights: pts };
}

// ---------- Lowcountry around Charleston: harbor, ocean, tidal rivers, salt marsh ----------
export function buildChsRegion() {
  const S = 2048, [c, ctx] = mkCanvas(S, S), r = mulberry32(843), k = S / REG;
  const P = (x, z) => [(x + REG / 2) * k, (z + REG / 2) * k];
  const W = (m) => m * k;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  // coastline (ocean to the south-east)
  const coast = wiggle([[-25000, 15500], [-15000, 13800], [-7000, 12600], [-1000, 11800], [4000, 10600], [9000, 8200], [14000, 5000], [19000, 1500], [25000, -2500]].map(([x, z]) => P(x, z)), r, 40, 25);
  // marsh band behind the coast and along the rivers (G)
  stroke(ctx, coast, W(7000), 'rgb(0,230,0)');
  const ashley = wiggle([[1500, 4800], [-800, 2600], [-2900, -800], [-3700, -5000], [-4600, -9000], [-4300, -14000], [-6200, -19000], [-6800, -25000]].map(([x, z]) => P(x, z)), r, 30, 18);
  const cooper = wiggle([[2600, 3800], [3300, 0], [4300, -5000], [3900, -11000], [5200, -17000], [4600, -25000]].map(([x, z]) => P(x, z)), r, 34, 18);
  const wando = wiggle([[4600, 5600], [8000, 2200], [11200, -1800], [13000, -6000]].map(([x, z]) => P(x, z)), r, 26, 16);
  const stono = wiggle([[-9000, 12500], [-8000, 9000], [-10500, 5000], [-14000, 2500], [-20000, 1000]].map(([x, z]) => P(x, z)), r, 26, 16);
  for (const [rv, w] of [[ashley, 2600], [cooper, 2200], [wando, 2600], [stono, 3000]]) stroke(ctx, rv, W(w), 'rgb(0,200,0)');
  // tidal creeks threading the marsh (R, thin)
  const creekSeeds = [...ashley, ...cooper, ...wando, ...stono, ...coast.filter((_, i) => i % 2 === 0)];
  for (let i = 0; i < 260; i++) {
    let [x, y] = creekSeeds[Math.floor(r() * creekSeeds.length)], a = r() * 6.28; const pts = [[x, y]], n = 6 + r() * 20;
    for (let s = 0; s < n; s++) { a += (r() - 0.5) * 1.3; x += Math.cos(a) * W(140); y += Math.sin(a) * W(140); pts.push([x, y]); }
    stroke(ctx, pts, W(25 + r() * 35), 'rgb(255,0,0)');
  }
  // rivers + harbor (R)
  stroke(ctx, ashley, W(330), 'rgb(255,0,0)'); stroke(ctx, cooper, W(520), 'rgb(255,0,0)'); stroke(ctx, wando, W(420), 'rgb(255,0,0)'); stroke(ctx, stono, W(260), 'rgb(255,0,0)');
  stroke(ctx, wiggle([[5500, 10500], [4400, 7500], [3200, 5200], [2300, 3800]].map(([x, z]) => P(x, z)), r, 10, 30), W(2200), 'rgb(255,0,0)');
  // ocean
  ctx.fillStyle = 'rgb(255,0,0)'; ctx.beginPath(); coast.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(S + 10, S + 10); ctx.lineTo(-10, S + 10); ctx.closePath(); ctx.fill();
  // barrier islands (clear the water there)
  ctx.globalCompositeOperation = 'source-over';
  for (const [x, z, a, b, rot] of [[-12000, 15200, 4200, 700, -0.12], [-3500, 13600, 3200, 620, -0.15], [10500, 9000, 3400, 650, -0.6], [16500, 4800, 3800, 600, -0.62], [1800, 12700, 1500, 450, -0.2]]) {
    const [cx, cy] = P(x, z); ctx.fillStyle = 'rgb(0,60,0)'; ctx.beginPath(); ctx.ellipse(cx, cy, W(a), W(b), rot, 0, 7); ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  // towns (B): Charleston peninsula, North Charleston, West Ashley, Mt Pleasant, Summerville
  const towns = [[1200, 6600, 1500], [2300, 1800, 1700], [1800, -4200, 1600], [-1800, -8500, 1700], [-6500, 3200, 2400], [7600, 4300, 2200], [-9800, -18500, 3200], [-5400, -2600, 1300], [9500, -6000, 1600]];
  const r2 = mulberry32(5);
  for (const [x, z, rad] of towns) {
    const [cx, cy] = P(x, z); const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W(rad));
    g.addColorStop(0, 'rgba(0,0,255,1)'); g.addColorStop(0.6, 'rgba(0,0,230,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, W(rad), 0, 7); ctx.fill();
    for (let q = 0; q < 10; q++) { const a = r2() * 6.28, d = W(rad) * (0.5 + r2() * 0.6); ctx.fillStyle = 'rgba(0,0,210,0.8)'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, W(200 + r2() * 500), 0, 7); ctx.fill(); }
  }
  const hwys = [wiggle([[-14000, -25000], [-7000, -15000], [-2600, -8200], [1300, -3500], [1900, 2500], [1500, 8000]].map(([x, z]) => P(x, z)), r, 6, 60),
    wiggle([[-25000, 2000], [-12000, 2600], [-4000, 3000], [1200, 5800], [6000, 5200], [14000, 2000], [25000, -1000]].map(([x, z]) => P(x, z)), r, 6, 60)];
  for (const h of hwys) stroke(ctx, h, W(70), 'rgb(0,0,140)');
  // keep the airfield itself clear
  ctx.globalCompositeOperation = 'source-over';
  const [ax0, az0] = P(-700, -3600), [ax1, az1] = P(650, 1100);
  const id = ctx.getImageData(ax0, az0, ax1 - ax0, az1 - az0); for (let i = 0; i < id.data.length; i += 4) { id.data[i] = 0; id.data[i + 1] = 0; id.data[i + 2] = Math.min(id.data[i + 2], 0); } ctx.putImageData(id, ax0, az0);
  const [out, ox] = mkCanvas(S, S); ox.filter = 'blur(1px)'; ox.drawImage(c, 0, 0);
  const data = ox.getImageData(0, 0, S, S).data, pts = [], m = REG / S;
  for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
    const i = (y * S + x) * 4; if (data[i + 2] < 160 || data[i] > 100) continue;
    if (r() < (data[i + 2] / 255) * 0.3) pts.push(x * m - REG / 2 + r() * m, y * m - REG / 2 + r() * m, r() < 0.75 ? 0 : 1);
  }
  for (const h of hwys) for (let i = 0; i < h.length - 1; i++) {
    const [x0, y0] = h[i], [x1, y1] = h[i + 1], len = Math.hypot(x1 - x0, y1 - y0) * m, n = Math.floor(len / 45);
    for (let q = 0; q < n; q++) { const t = q / n; for (const side of [-1, 1]) pts.push((x0 + (x1 - x0) * t) * m - REG / 2 + side * 14, (y0 + (y1 - y0) * t) * m - REG / 2, 2); }
  }
  return { tex: maskTex(out), lights: pts };
}

// wispy high cirrus (alpha only)
export function cirrusTexture() {
  const S = 1024, [c, ctx] = mkCanvas(S, S), r = mulberry32(77);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, len = 60 + r() * 260, w = 3 + r() * 10, a = -0.35 + (r() - 0.5) * 0.3;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(a);
      const g = ctx.createLinearGradient(-len / 2, 0, len / 2, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, `rgba(255,255,255,${0.08 + r() * 0.12})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, len / 2, w, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  }
  const t = new THREE.CanvasTexture(softBlurWrapped(c, 3)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
