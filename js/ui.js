// In-world UI drawn on canvas textures: menu, seatback info screen, captions, breathing guide, overlay card
import * as THREE from 'three';
import { mkCanvas, toTex, roundRect } from './textures.js';
import { fmtTime, ss } from './util.js';

class CanvasPanel {
  constructor(w, h, pw, ph, { order = 20, depthTest = true } = {}) {
    [this.canvas, this.ctx] = mkCanvas(pw, ph);
    this.tex = toTex(this.canvas, { wrap: false, aniso: 4 });
    this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, fog: false, depthTest, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
    this.mesh.renderOrder = order;
    this.pw = pw; this.ph = ph;
  }
  commit() { this.tex.needsUpdate = true; }
}
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

export class Menu extends CanvasPanel {
  constructor(items) {
    super(0.50, 0.56, 900, 1008);
    this.items = items; this.hover = -1; this.rects = [];
    const cols = 2, x0 = 40, y0 = 150, bw = 400, bh = 132, gx = 20, gy = 22;
    items.forEach((it, i) => { const c = i % cols, r = Math.floor(i / cols); this.rects.push([x0 + c * (bw + gx), y0 + r * (bh + gy), bw, bh]); });
    this.draw();
  }
  draw() {
    const g = this.ctx, W = this.pw, H = this.ph;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,22,36,0.96)'; roundRect(g, 4, 4, W - 8, H - 8, 40); g.fill();
    g.strokeStyle = 'rgba(140,180,230,0.5)'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#e8f1ff'; g.font = `600 54px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Flight menu', 46, 78);
    g.fillStyle = '#8fa6c4'; g.font = `400 30px ${FONT}`; g.textAlign = 'right'; g.fillText('point + trigger', W - 46, 80);
    this.items.forEach((it, i) => {
      const [x, y, w, h] = this.rects[i];
      const active = it.active && it.active();
      g.fillStyle = i === this.hover ? '#3d6fb0' : active ? '#2a4d78' : 'rgba(255,255,255,0.08)';
      roundRect(g, x, y, w, h, 24); g.fill();
      if (i === this.hover) { g.strokeStyle = '#9fd0ff'; g.lineWidth = 5; g.stroke(); }
      g.fillStyle = '#ffffff'; g.textAlign = 'center';
      const lab = typeof it.label === 'function' ? it.label() : it.label;
      const [l1, l2] = lab.split('\n');
      if (l2) { g.font = `400 30px ${FONT}`; g.fillStyle = '#a9bdd6'; g.fillText(l1, x + w / 2, y + h / 2 - 22); g.font = `600 42px ${FONT}`; g.fillStyle = '#fff'; g.fillText(l2, x + w / 2, y + h / 2 + 22); }
      else { g.font = `600 42px ${FONT}`; g.fillText(l1, x + w / 2, y + h / 2 + 2); }
    });
    this.commit();
  }
  hitIndex(uv) {
    const px = uv.x * this.pw, py = (1 - uv.y) * this.ph;
    return this.rects.findIndex(([x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h);
  }
  setHover(i) { if (i !== this.hover) { this.hover = i; this.draw(); } }
}

export class InfoScreen extends CanvasPanel {
  constructor() { super(0.205, 0.125, 512, 312, { order: 1 }); this.mat.transparent = false; }
  draw(d) {
    const g = this.ctx, W = this.pw, H = this.ph;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d2340'); bg.addColorStop(1, '#071526');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.font = `700 40px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(d.from, 22, 50); g.textAlign = 'right'; g.fillText(d.to, W - 22, 50);
    // route progress
    const x0 = 120, x1 = W - 120, y = 38;
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 4; g.setLineDash([8, 8]); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#5fc3ff'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (x1 - x0) * d.progress, y); g.stroke();
    const px = x0 + (x1 - x0) * d.progress;
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(px + 14, y); g.lineTo(px - 10, y - 10); g.lineTo(px - 5, y); g.lineTo(px - 10, y + 10); g.closePath(); g.fill();
    g.fillStyle = '#5fc3ff'; g.font = `600 30px ${FONT}`; g.textAlign = 'left';
    g.fillText(d.phase, 22, 102);
    const rows = [['Altitude', d.alt], ['Ground speed', d.spd], ['Time remaining', d.rem]];
    g.font = `400 27px ${FONT}`;
    rows.forEach(([k, v], i) => { const yy = 150 + i * 44; g.fillStyle = '#9eb3cc'; g.textAlign = 'left'; g.fillText(k, 22, yy); g.fillStyle = '#ffffff'; g.textAlign = 'right'; g.font = `600 29px ${FONT}`; g.fillText(v, W - 22, yy); g.font = `400 27px ${FONT}`; });
    g.fillStyle = d.belt ? '#ffd27a' : '#6d819a'; g.font = `600 24px ${FONT}`; g.textAlign = 'left';
    g.fillText(d.belt ? 'SEATBELT SIGN ON' : 'Seatbelt sign off', 22, 292);
    g.textAlign = 'right'; g.fillStyle = '#6d819a'; g.fillText(d.paused ? 'PAUSED' : d.turb, W - 22, 292);
    this.commit();
  }
}

export class Caption extends CanvasPanel {
  constructor() { super(0.95, 0.223, 1100, 258, { order: 900, depthTest: false }); this.alpha = 0; this.until = 0; this.mesh.visible = false; }
  show(who, text, now) {
    const g = this.ctx, W = this.pw, H = this.ph;
    g.clearRect(0, 0, W, H);
    const col = who === 'captain' ? '#ffcf70' : who === 'crew' ? '#8fd3ff' : who === 'tip' ? '#9ef0b5' : '#ffffff';
    const label = who === 'captain' ? 'CAPTAIN' : who === 'crew' ? 'CABIN CREW' : who === 'tip' ? 'CALM TIP' : '';
    g.fillStyle = 'rgba(8,12,20,0.80)'; roundRect(g, 4, 4, W - 8, H - 8, 30); g.fill();
    g.fillStyle = col; g.fillRect(4 + 18, 24, 8, H - 48);
    g.font = `700 30px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(label, 50, 22);
    g.fillStyle = '#ffffff'; g.font = `500 38px ${FONT}`;
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > W - 90) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    lines.slice(0, 4).forEach((l, i) => g.fillText(l, 50, 66 + i * 46));
    this.commit();
    this.until = now + Math.max(5, text.length * 0.07);
    this.mesh.visible = true;
  }
  update(now, dt) {
    const target = now < this.until ? 1 : 0;
    this.alpha += Math.sign(target - this.alpha) * Math.min(Math.abs(target - this.alpha), dt * 2.5);
    this.mat.opacity = this.alpha; this.mesh.visible = this.alpha > 0.01;
  }
  clear() { this.until = 0; }
}

export class BreathGuide {
  constructor() {
    this.group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#9fe8de', transparent: true, opacity: 0.75, fog: false, depthWrite: false, depthTest: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.093, 0.1, 48), ringMat);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(0.09, 48), new THREE.MeshBasicMaterial({ color: '#5ccfc0', transparent: true, opacity: 0.45, fog: false, depthWrite: false, depthTest: false }));
    this.label = new CanvasPanel(0.22, 0.055, 440, 110, { order: 903, depthTest: false });
    this.label.mesh.position.y = -0.135;
    this.ring.renderOrder = 901; this.disc.renderOrder = 902;
    this.group.add(this.ring, this.disc, this.label.mesh);
    this.group.visible = false; this.t = 0; this.lastTxt = '';
  }
  update(dt) {
    if (!this.group.visible) return;
    this.t = (this.t + dt) % 10;
    const inh = this.t < 4;
    const s = inh ? 0.3 + 0.7 * ss(this.t / 4) : 1 - 0.7 * ss((this.t - 4) / 6);
    this.disc.scale.setScalar(s);
    const txt = inh ? `Breathe in  ${Math.ceil(4 - this.t)}` : `Breathe out  ${Math.ceil(10 - this.t)}`;
    if (txt !== this.lastTxt) {
      this.lastTxt = txt; const g = this.label.ctx; g.clearRect(0, 0, 440, 110);
      g.fillStyle = 'rgba(8,20,24,0.7)'; roundRect(g, 2, 2, 436, 106, 40); g.fill();
      g.fillStyle = '#d9fff8'; g.font = `600 50px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 220, 58); this.label.commit();
    }
  }
}

// Card used for the connection screen / end screen (drawn on top of a dark fade)
export class Card extends CanvasPanel {
  constructor() { super(1.0, 0.56, 1000, 560, { order: 1001, depthTest: false }); this.mesh.visible = false; }
  draw(title, lines, foot) {
    const g = this.ctx, W = this.pw, H = this.ph;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(16,28,48,0.95)'; roundRect(g, 4, 4, W - 8, H - 8, 40); g.fill();
    g.strokeStyle = 'rgba(140,180,230,0.6)'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#ffffff'; g.font = `700 54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(title, W / 2, 90);
    g.font = `400 38px ${FONT}`; g.fillStyle = '#cfe0f5';
    lines.forEach((l, i) => g.fillText(l, W / 2, 190 + i * 62));
    if (foot) { g.font = `600 34px ${FONT}`; g.fillStyle = '#9ef0b5'; g.fillText(foot, W / 2, H - 70); }
    this.commit();
  }
}
