// Pre-flight airport: concourse, TSA-style security checkpoint (ID check, bins + X-ray belt, body scanner, bag pickup),
// departures board, gate with boarding by group, jet bridge. Guided "Continue" steps; teleport/smooth movement handled by main.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { mkCanvas, toTex, roundRect } from './textures.js';
import { makeCrowd } from './people.js';
import { airlinerGeometry, pointCloud, SKY_VS, SKY_FS } from './world.js';
import { mulberry32, clamp, lerp, ss } from './util.js';

const LD = new THREE.Vector3(0.25, 0.85, 0.45).normalize();
const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
function bake(geo, color, m) {
  if (m) geo.applyMatrix4(m);
  geo = geo.index ? geo.toNonIndexed() : geo; geo.computeVertexNormals();
  const n = geo.attributes.normal, c = new THREE.Color(color), col = [];
  for (let i = 0; i < n.count; i++) { const s = 0.62 + 0.3 * Math.max(0, n.getX(i) * LD.x + n.getY(i) * LD.y + n.getZ(i) * LD.z) + 0.08 * n.getY(i); col.push(c.r * s, c.g * s, c.b * s); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  return geo;
}
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
function signTex(w, h, draw) { const [c, g] = mkCanvas(w, h); draw(g, w, h); return toTex(c, { wrap: false }); }

export const GATE = 'B7';

export function createTerminal({ audio, say, onDone }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const r = mulberry32(606);
  const vc = [];                   // static vertex-coloured geometry -> one draw call
  const box = (w, h, d, x, y, z, color, ry = 0, rx = 0) => vc.push(bake(new THREE.BoxGeometry(w, h, d), color, M(x, y, z, rx, ry)));
  const cyl = (rt, rb, h, x, y, z, color, seg = 10) => vc.push(bake(new THREE.CylinderGeometry(rt, rb, h, seg), color, M(x, y, z)));
  const basic = (o) => new THREE.MeshBasicMaterial({ fog: false, ...o });

  // ---------------- shell: floor, walls, ceiling ----------------
  const HX = 12, Z0 = 6, Z1 = -100, CH = 6.5;
  const floorTex = signTex(512, 512, (g, w, h) => { g.fillStyle = '#d9d4ca'; g.fillRect(0, 0, w, h); const rr = mulberry32(2); for (let i = 0; i < 9000; i++) { g.fillStyle = ['#a8a196', '#efe9de', '#8a8378', '#c4bdb0', '#7d8b95'][Math.floor(rr() * 5)]; g.fillRect(rr() * w, rr() * h, 1 + rr() * 3, 1 + rr() * 3); } g.fillStyle = 'rgba(120,112,100,0.5)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(2 * HX / 3, (Z0 - Z1) / 3);
  const floorG = new THREE.PlaneGeometry(2 * HX, Z0 - Z1); floorG.rotateX(-Math.PI / 2); floorG.translate(0, 0, (Z0 + Z1) / 2);
  scene.add(new THREE.Mesh(floorG, basic({ map: floorTex })));
  const carpetTex = TX.carpetTexture(); carpetTex.repeat.set(4, 12);
  const cg = new THREE.PlaneGeometry(10.5, 36); cg.rotateX(-Math.PI / 2); cg.translate(-6.6, 0.006, -66);
  const carpet = new THREE.Mesh(cg, basic({ map: carpetTex, color: '#b9bcc8', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); scene.add(carpet);
  const ceilTex = signTex(256, 256, (g, w, h) => { g.fillStyle = '#e9e8e4'; g.fillRect(0, 0, w, h); g.fillStyle = '#d2d1cc'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); g.fillStyle = '#fffdf4'; g.fillRect(40, 100, 176, 56); });
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping; ceilTex.repeat.set(2 * HX / 3, (Z0 - Z1) / 3);
  const ceilG = new THREE.PlaneGeometry(2 * HX, Z0 - Z1); ceilG.rotateX(Math.PI / 2); ceilG.translate(0, CH, (Z0 + Z1) / 2);
  scene.add(new THREE.Mesh(ceilG, basic({ map: ceilTex })));
  const wallC = '#e6e2da', trimC = '#9aa3ad';
  box(0.3, CH, Z0 - Z1, HX + 0.15, CH / 2, (Z0 + Z1) / 2, wallC);           // right wall
  box(2 * HX, CH, 0.3, 0, CH / 2, Z0 + 0.15, wallC); box(2 * HX, CH, 0.3, 0, CH / 2, Z1 - 0.15, wallC);
  // left wall: solid at the ends, big windows at the gate area (z -46 .. -84), jet bridge door at z -75
  box(0.3, CH, Z0 + 46, -HX - 0.15, CH / 2, (Z0 - 46) / 2, wallC); box(0.3, CH, 16, -HX - 0.15, CH / 2, -92, wallC);
  box(0.4, 0.5, 38, -HX - 0.1, 0.25, -65, trimC); box(0.4, 1.0, 38, -HX - 0.1, CH - 0.5, -65, trimC);
  for (let z = -46; z >= -84; z -= 3.8) box(0.18, CH, 0.14, -HX, CH / 2, z, '#5d6670');
  box(0.1, 0.08, 38, -HX, 2.9, -65, '#5d6670');
  for (let x = -HX; x <= HX; x += 0.01) break;
  // skirting + column rhythm
  box(0.06, 0.12, Z0 - Z1, HX - 0.03, 0.06, (Z0 + Z1) / 2, '#6f747a');
  for (let z = -6; z >= -96; z -= 15) { box(0.8, CH, 0.8, 7.5, CH / 2, z, '#d9d5cd'); }

  // ---------------- signs ----------------
  const signs = [];
  const sign = (w, h, x, y, z, ry, draw, pw = 1024) => { const t = signTex(pw, Math.round(pw * h / w), draw); const g = new THREE.PlaneGeometry(w, h); const m = new THREE.Mesh(g, basic({ map: t, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); signs.push(m); return m; };
  const navSign = (txt, sub) => (g, w, h) => { g.fillStyle = '#1c2533'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd34d'; g.font = `700 ${h * 0.5}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(txt, h * 0.35, h * 0.52); if (sub) { g.fillStyle = '#ffffff'; g.font = `600 ${h * 0.34}px ${FONT}`; g.textAlign = 'right'; g.fillText(sub, w - h * 0.3, h * 0.54); } };
  sign(7, 0.9, -1, 4.6, -0.6, 0, navSign('Security Checkpoint', 'All Gates  \u2191'));
  sign(6, 0.8, 1, 4.6, -21, 0, navSign('Gates B1 \u2013 B12', '\u2191'));
  sign(6, 0.8, -2, 4.6, -45, 0, navSign('Gates B5 \u2013 B9', '\u2190'));
  sign(3.2, 0.7, 2.5, 2.6, -0.95, 0, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c2533'; g.font = `600 ${h * 0.32}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Have your ID and boarding pass ready', w / 2, h * 0.34); g.fillStyle = '#5a6675'; g.font = `400 ${h * 0.24}px ${FONT}`; g.fillText('Wait time: about 8 minutes', w / 2, h * 0.72); }, 768);
  box(0.06, 2.3, 0.06, 2.5, 1.15, -1.0, '#3a3f46'); box(0.5, 0.04, 0.5, 2.5, 0.02, -1.0, '#3a3f46');
  // shops along the right wall
  const shopNames = [['Coffee', '#6b4a33'], ['News & Books', '#29496b'], ['Grab & Go', '#3f6b3a'], ['Gifts', '#7a3b52'], ['Pharmacy', '#2e6d6a']];
  shopNames.forEach(([nm, col], i) => {
    const z = -26 - i * 8;
    sign(5.6, 3.6, HX - 0.02, 2.0, z, -Math.PI / 2, (g, w, h) => {
      g.fillStyle = '#d7d3ca'; g.fillRect(0, 0, w, h); g.fillStyle = col; g.fillRect(0, 0, w, h * 0.2);
      g.fillStyle = '#fff'; g.font = `700 ${h * 0.11}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(nm, w / 2, h * 0.105);
      const gr = g.createLinearGradient(0, h * 0.25, 0, h); gr.addColorStop(0, '#fff3dc'); gr.addColorStop(1, '#c9b89c'); g.fillStyle = gr; g.fillRect(w * 0.05, h * 0.26, w * 0.9, h * 0.72);
      const rr = mulberry32(i + 3); for (let k = 0; k < 4; k++) for (let j = 0; j < 9; j++) { g.fillStyle = `hsl(${rr() * 360},45%,${45 + rr() * 25}%)`; g.fillRect(w * (0.08 + j * 0.095), h * (0.34 + k * 0.15), w * 0.07, h * 0.1); }
      g.fillStyle = 'rgba(30,40,50,0.15)'; g.fillRect(w * 0.05, h * 0.26, w * 0.9, 6);
    }, 512);
  });

  // ---------------- queue: stanchions + retractable belts ----------------
  const belts = [[-5, 3.5, -1.3], [-6, 2.5, -2.7], [-5, 3.5, -4.1], [-6, 0.0, -5.5]];
  for (const [x0, x1, z] of belts) {
    const n = Math.max(1, Math.round((x1 - x0) / 1.25));
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; cyl(0.03, 0.03, 0.95, x, 0.475, z, '#b9bec4', 8); cyl(0.16, 0.17, 0.04, x, 0.02, z, '#2d3136', 12); cyl(0.04, 0.04, 0.05, x, 0.97, z, '#b9bec4', 8); }
    box(x1 - x0, 0.05, 0.006, (x0 + x1) / 2, 0.9, z, '#1d2f6a');
  }
  // ---------------- ID podium ----------------
  box(0.9, 1.1, 0.55, 1.25, 0.55, -7.65, '#4a5560'); box(1.0, 0.05, 0.65, 1.25, 1.12, -7.6, '#2f353c', 0, -0.25);
  box(0.25, 0.18, 0.3, 1.55, 1.24, -7.62, '#1d2126'); box(0.42, 0.3, 0.04, 1.05, 1.32, -7.85, '#14181d', 0, -0.25);
  const podGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09), basic({ color: '#ff3b30' })); podGlass.position.set(1.55, 1.34, -7.46); scene.add(podGlass);
  // ---------------- divest table, X-ray, exit rollers ----------------
  const BX = -1.2;
  box(0.72, 0.06, 3.6, BX, 0.73, -10.8, '#9ea4aa'); for (const z of [-9.1, -12.4]) for (const x of [-0.3, 0.3]) box(0.06, 0.73, 0.06, BX + x, 0.365, z, '#5d6268');
  for (let z = -9.1; z > -11.0; z -= 0.16) box(0.68, 0.025, 0.04, BX, 0.775, z, '#c8ccd0');
  box(0.62, 0.02, 1.5, BX, 0.772, -11.8, '#25282c');            // feed belt
  box(1.35, 1.55, 2.6, BX, 0.78, -13.8, '#cfd3d6');              // x-ray body
  box(0.75, 0.55, 0.02, BX, 1.02, -12.49, '#0e1012');            // tunnel mouth
  for (let i = 0; i < 6; i++) box(0.11, 0.5, 0.01, BX - 0.3 + i * 0.12, 1.03, -12.47, '#3a3f46');
  box(0.75, 0.55, 0.02, BX, 1.02, -15.11, '#0e1012');
  box(1.36, 0.25, 2.62, BX, 1.45, -13.8, '#2c4f7a');
  box(0.72, 0.06, 4.2, BX, 0.73, -17.2, '#9ea4aa'); for (const z of [-15.3, -19.1]) for (const x of [-0.3, 0.3]) box(0.06, 0.73, 0.06, BX + x, 0.365, z, '#5d6268');
  for (let z = -15.2; z > -19.2; z -= 0.16) box(0.68, 0.025, 0.04, BX, 0.775, z, '#c8ccd0');
  // operator desk + monitor
  box(0.8, 0.75, 0.6, -2.6, 0.375, -13.6, '#4a5560'); box(0.55, 0.38, 0.04, -2.55, 1.0, -13.55, '#111317', -Math.PI / 2 + 0.35);
  // bin stack
  const binC = '#7d858d';
  for (let i = 0; i < 6; i++) box(0.56, 0.06, 0.42, BX, 0.79 + i * 0.045, -9.25, i % 2 ? binC : '#6f777f');
  const binStackHit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.6), basic({ visible: false })); binStackHit.position.set(BX, 0.95, -9.25); scene.add(binStackHit);
  // ---------------- body scanner ----------------
  const SX = 1.45, SZ = -14.0;
  box(0.28, 2.25, 1.3, SX - 0.82, 1.125, SZ, '#d5d9dd'); box(0.28, 2.25, 1.3, SX + 0.82, 1.125, SZ, '#d5d9dd');
  box(1.92, 0.25, 1.3, SX, 2.37, SZ, '#2c4f7a'); box(1.4, 0.02, 1.2, SX, 0.012, SZ, '#bfc4c9');
  const feetT = signTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#ffd400'; for (const x of [80, 176]) { g.beginPath(); g.ellipse(x, 140, 30, 70, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(x, 52, 22, 20, 0, 0, 7); g.fill(); } });
  const feet = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), basic({ map: feetT, transparent: true })); feet.rotation.x = -Math.PI / 2; feet.rotation.z = 0; feet.position.set(SX, 0.026, SZ); scene.add(feet);
  const poseT = signTex(256, 320, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#2c4f7a'; g.fillRect(0, 0, w, 50); g.fillStyle = '#fff'; g.font = `700 30px ${FONT}`; g.textAlign = 'center'; g.fillText('Arms up', w / 2, 36); g.strokeStyle = '#1c2533'; g.lineWidth = 14; g.lineCap = 'round'; g.beginPath(); g.arc(128, 110, 22, 0, 7); g.stroke(); g.beginPath(); g.moveTo(128, 135); g.lineTo(128, 225); g.moveTo(128, 225); g.lineTo(100, 300); g.moveTo(128, 225); g.lineTo(156, 300); g.moveTo(128, 150); g.lineTo(78, 112); g.lineTo(98, 70); g.moveTo(128, 150); g.lineTo(178, 112); g.lineTo(158, 70); g.stroke(); });
  const poseSign = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), basic({ map: poseT })); poseSign.position.set(SX + 0.67, 1.55, SZ - 0.25); poseSign.rotation.y = -Math.PI / 2; scene.add(poseSign);
  const scanArms = new THREE.Group(); scanArms.position.set(SX, 0, SZ); scene.add(scanArms);
  for (const sgn of [-1, 1]) { const a = new THREE.Mesh(bake(new THREE.BoxGeometry(0.07, 2.0, 0.16), '#8fb5d9'), basic({ vertexColors: true })); a.position.set(sgn * 0.58, 1.1, 0); scanArms.add(a); }
  const scanLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), basic({ color: '#ffb02e' })); scanLight.position.set(SX, 2.55, SZ + 0.55); scene.add(scanLight);
  // ---------------- departures board ----------------
  const boardC = mkCanvas(1280, 720); const boardTex = toTex(boardC[0], { wrap: false });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.9), basic({ map: boardTex })); board.position.set(3.6, 2.7, -30); scene.add(board);
  box(3.6, 2.1, 0.12, 3.6, 2.7, -30.08, '#22272e'); box(0.15, 1.7, 0.15, 2.4, 0.85, -30.1, '#3a3f46'); box(0.15, 1.7, 0.15, 4.8, 0.85, -30.1, '#3a3f46');
  // ---------------- gate area ----------------
  for (const x of [-8.2, -5.0, -1.8]) for (let z = -54; z >= -71; z -= 0.62) {
    if (Math.abs(z + 62.5) < 0.6) continue;
    box(0.5, 0.06, 0.5, x, 0.45, z, '#2e3a4c'); box(0.06, 0.5, 0.5, x + 0.24, 0.72, z, '#2e3a4c'); box(0.05, 0.22, 0.05, x - 0.05, 0.6, z + 0.28, '#9aa1a8');
    if (Math.round(z / 0.62) % 3 === 0) box(0.06, 0.45, 0.06, x, 0.22, z, '#62686f');
  }
  for (const x of [-8.2, -5.0, -1.8]) box(0.08, 0.06, 17.5, x, 0.2, -62.5, '#62686f');
  box(1.1, 1.05, 0.6, -9.7, 0.525, -76.3, '#4a5560'); box(1.2, 0.05, 0.7, -9.7, 1.07, -76.3, '#2f353c');
  const gateScan = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.22), basic({ color: '#2a2e33' })); gateScan.position.set(-9.25, 1.15, -76.05); scene.add(gateScan);
  const gateGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.09), basic({ color: '#ff3b30' })); gateGlass.rotation.x = -Math.PI / 2; gateGlass.position.set(-9.25, 1.205, -76.05); scene.add(gateGlass);
  const gateSignC = mkCanvas(1024, 384); const gateSignTex = toTex(gateSignC[0], { wrap: false });
  const gateSign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), basic({ map: gateSignTex })); gateSign.position.set(-HX + 0.25, 3.6, -78.6); gateSign.rotation.y = Math.PI / 2; scene.add(gateSign);
  box(0.12, 2.6, 2.3, -HX + 0.05, 1.3, -75, '#3f4750'); // door frame (glass removed here)
  // ---------------- jet bridge ----------------
  const BRX0 = -HX, BRX1 = -34.2, BZ = -75, slope = (x) => lerp(0, -0.7, clamp((BRX0 - x) / (BRX0 - BRX1), 0, 1));
  const brLen = BRX0 - BRX1, ang = Math.atan2(0.7, brLen);
  const brFloor = new THREE.BoxGeometry(brLen, 0.1, 2.1); vc.push(bake(brFloor, '#3d4248', M((BRX0 + BRX1) / 2, -0.4, BZ, 0, 0, ang)));
  box(brLen, 2.4, 0.08, (BRX0 + BRX1) / 2, 0.8, BZ - 1.1, '#cfd2d4', 0); vc[vc.length - 1].applyMatrix4(new THREE.Matrix4());
  box(brLen, 2.4, 0.08, (BRX0 + BRX1) / 2, 0.8, BZ + 1.1, '#cfd2d4');
  box(brLen, 0.08, 2.3, (BRX0 + BRX1) / 2, 2.05, BZ, '#e8e8e6');
  for (let x = BRX0 - 2; x > BRX1; x -= 2.5) box(0.6, 0.02, 0.2, x, 2.0, BZ, '#fffef2');
  box(0.2, 2.6, 0.5, BRX1, 0.6, BZ - 0.95, '#f0f1f2'); box(0.2, 2.6, 0.5, BRX1, 0.6, BZ + 0.95, '#f0f1f2'); box(0.2, 0.5, 2.3, BRX1, 2.0, BZ, '#f0f1f2');
  box(0.04, 2.4, 1.45, BRX1, 0.5, BZ, '#e4dccb'); box(0.06, 2.4, 0.12, BRX1 + 0.03, 0.5, BZ - 0.48, '#9aa0a6'); box(0.06, 2.4, 0.12, BRX1 + 0.03, 0.5, BZ + 0.48, '#9aa0a6'); box(0.06, 0.4, 1.45, BRX1 + 0.03, 1.5, BZ, '#c9ccd0'); box(0.06, 0.2, 0.3, BRX1 + 0.04, 0.5, BZ - 0.25, '#7a7f86'); // aircraft door opening (galley beyond)
  const doorSign = sign(0.5, 0.18, BRX1 + 0.12, 2.0, BZ, Math.PI / 2, (g, w, h) => { g.fillStyle = '#140808'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff3b30'; g.font = `700 ${h * 0.7}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', w / 2, h * 0.55); }, 256);

  scene.add(new THREE.Mesh(mergeGeometries(vc), basic({ vertexColors: true })));

  // windows (glass)
  const glassMat = basic({ color: '#9fb6c8', transparent: true, opacity: 0.12, depthWrite: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(38, 5.0), glassMat); glass.rotation.y = Math.PI / 2; glass.position.set(-HX, 3.0, -65); glass.renderOrder = 5; scene.add(glass);

  // ---------------- outside: apron, our aircraft, sky, lights ----------------
  const GY = -3.1;
  const hemi = new THREE.HemisphereLight('#dde8ff', '#6b7553', 1.2), sun = new THREE.DirectionalLight('#fff3df', 2.2); sun.position.set(-300, 400, 200); scene.add(hemi, sun);
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(-0.5, 0.6, 0.3).normalize() }, sunCol: { value: new THREE.Color() }, moonDir: { value: new THREE.Vector3(-0.6, 0.4, -0.2).normalize() },
      uStars: { value: 0 }, uMoon: { value: 0 }, uGlow: { value: 0 }, uSunDisc: { value: 1 }, uCityGlow: { value: new THREE.Color() } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 24, 12), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const concT = TX.concreteTexture(); concT.repeat.set(30, 30);
  const apronMat = new THREE.MeshLambertMaterial({ map: concT, emissive: '#000000' });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), apronMat); apron.position.set(-150, GY, -70); scene.add(apron);
  const grassT = TX.grassTexture(); grassT.repeat.set(160, 160);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: grassT })); grass.position.set(-1300, GY - 0.05, -70); scene.add(grass);
  const rwT = TX.runwayTexture(); const rw = new THREE.Mesh(new THREE.PlaneGeometry(45, 3060).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: rwT, polygonOffset: true, polygonOffsetFactor: -2 })); rw.position.set(-520, GY + 0.02, -400); scene.add(rw);
  const planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#000000' });
  const ourPlane = new THREE.Mesh(airlinerGeometry('#ffffff'), planeMat); ourPlane.position.set(-36.4, GY, -86); ourPlane.rotation.y = Math.PI; scene.add(ourPlane);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.4, 4.3).applyMatrix4(M(0, 8.2, 15.8, -0.45)), new THREE.MeshLambertMaterial({ color: '#2f5d8a' })); tail.position.copy(ourPlane.position); tail.rotation.y = Math.PI; scene.add(tail);
  const other = new THREE.Mesh(airlinerGeometry('#ffffff'), planeMat); other.position.set(-50, GY, -140); other.rotation.y = -Math.PI / 2; scene.add(other);
  const other2 = new THREE.Mesh(airlinerGeometry('#ffffff'), planeMat); other2.position.set(-60, GY, -20); other2.rotation.y = -Math.PI / 2 + 0.15; scene.add(other2);
  // ground equipment: tug, belt loader, bag carts
  const gse = [];
  const gbox = (w, h, d, x, y, z, c, ry = 0) => gse.push(bake(new THREE.BoxGeometry(w, h, d), c, M(x, GY + y, z, 0, ry)));
  gbox(2.4, 1.4, 4.0, -36.4, 0.7, -61, '#e6c229'); gbox(1.2, 0.3, 7, -41.5, 1.2, -93, '#3a3f46', 0.25); gbox(1.4, 1.0, 1.4, -42.2, 0.5, -89.5, '#e6c229');
  for (let i = 0; i < 3; i++) { gbox(1.5, 0.9, 2.4, -45 - i * 2.2, 0.6, -98, '#8b9198'); gbox(1.3, 0.5, 2.0, -45 - i * 2.2, 1.3, -98, ['#1f5fa0', '#a03a2a', '#2f7a4a'][i]); }
  gbox(2.0, 2.8, 5.5, -42.5, 1.4, -104, '#f2f2f2'); gbox(0.6, 2.2, 0.5, -33.5, 1.1, -80, '#5a6068');
  const gseMat = new THREE.MeshLambertMaterial({ vertexColors: true }); scene.add(new THREE.Mesh(mergeGeometries(gse), gseMat));
  const ramp = makeCrowd([{ x: -43.3, z: -92.5, yaw: 0.6, shirt: '#ff7a1a' }, { x: -44.6, z: -96.2, yaw: -1.2, shirt: '#ff7a1a' }, { x: -34.6, z: -63.5, yaw: 2.4, shirt: '#ffb21a' }].map((p) => ({ ...p, y: GY })), 'stand', () => new THREE.MeshLambertMaterial({ vertexColors: true }), r);
  scene.add(ramp.group);
  // outside lights
  const OL = [], Lp = (x, y, z, hex, inten, size, flash = -1) => { const c = new THREE.Color(hex); OL.push(x, y, z, c.r, c.g, c.b, inten, size, flash); };
  for (let z = -1900; z <= 1100; z += 60) { Lp(-497, GY + 0.4, z, '#fff1cf', 1, 0.7); Lp(-543, GY + 0.4, z, '#fff1cf', 1, 0.7); }
  for (let z = -1000; z <= 600; z += 30) { Lp(-150, GY + 0.3, z, '#2f63ff', 0.9, 0.45); Lp(-128, GY + 0.3, z, '#2f63ff', 0.9, 0.45); }
  for (const [x, z] of [[-30, -60], [-30, -100], [-60, -40], [-62, -95], [-30, -20]]) { Lp(x, GY + 20, z, '#ffcf8a', 1.6, 3); }
  Lp(-36.4, GY + 5.4, -86, '#ff2a2a', 1.6, 0.6, 10.0);
  const outLights = pointCloud(OL, { minPx: 2.2 }); scene.add(outLights);
  const floodPool = new THREE.Mesh(new THREE.PlaneGeometry(70, 70).rotateX(-Math.PI / 2), basic({ map: TX.glowTexture(), color: '#ffbf73', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  floodPool.position.set(-38, GY + 0.05, -84); scene.add(floodPool);

  // ---------------- people ----------------
  const QPATH = [[0, 3], [-5.5, -0.4], [-5.5, -2.0], [2.9, -2.0], [3.0, -3.4], [-5.5, -3.4], [-5.5, -4.8], [0.6, -4.8], [0.5, -6.6], [0.6, -8.6], [0.2, -10.2]];
  const segLen = []; let qTotal = 0; for (let i = 0; i < QPATH.length - 1; i++) { const l = Math.hypot(QPATH[i + 1][0] - QPATH[i][0], QPATH[i + 1][1] - QPATH[i][1]); segLen.push(l); qTotal += l; }
  const qAt = (d) => { d = clamp(d, 0, qTotal); for (let i = 0; i < segLen.length; i++) { if (d <= segLen[i] || i === segLen.length - 1) { const t = segLen[i] ? d / segLen[i] : 0; return [lerp(QPATH[i][0], QPATH[i + 1][0], t), lerp(QPATH[i][1], QPATH[i + 1][1], t), Math.atan2(-(QPATH[i + 1][0] - QPATH[i][0]), -(QPATH[i + 1][1] - QPATH[i][1]))]; } d -= segLen[i]; } return [0, 0, 0]; };
  const qDist = (x, z) => { let best = 0, bd = 1e9, acc = 0; for (let i = 0; i < segLen.length; i++) { const [ax, az] = QPATH[i], [bx, bz] = QPATH[i + 1]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1); const d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < bd) { bd = d; best = acc + t * segLen[i]; } acc += segLen[i]; } return best; };
  const queueOff = [1.3, 2.4, 3.6, 4.7, 5.9, -1.3, -2.5];
  const qSpots = queueOff.map((o) => { const [x, z, yaw] = qAt(8 + o); return { x, z, yaw, d: 8 + o, off: o, y: 0, scale: 0.93 + r() * 0.14 }; });
  const queue = makeCrowd(qSpots, 'stand', () => basic({ vertexColors: true }), r); scene.add(queue.group);
  const qBags = new THREE.InstancedMesh(bake(new THREE.BoxGeometry(0.34, 0.5, 0.22).translate(0.32, 0.27, 0.05), '#2b3038'), basic({ vertexColors: true }), qSpots.length); scene.add(qBags);
  // officers + travellers already at the bins
  const staff = makeCrowd([
    { x: 1.25, z: -8.25, yaw: Math.PI, shirt: '#3b5a86', pants: '#1f2430' },          // ID check
    { x: -2.35, z: -13.6, yaw: -Math.PI / 2, shirt: '#3b5a86', pants: '#1f2430' },    // x-ray operator
    { x: 2.75, z: -14.9, yaw: Math.PI / 2 + 0.4, shirt: '#3b5a86', pants: '#1f2430' }, // scanner officer
    { x: -0.2, z: -16.0, yaw: 2.6, shirt: '#3b5a86', pants: '#1f2430' },               // bag check
    { x: -10.4, z: -76.3, yaw: -Math.PI / 2, shirt: '#1f2f52', pants: '#1f2f52' },     // gate agent
    { x: -10.3, z: -77.6, yaw: -Math.PI / 2 + 0.3, shirt: '#1f2f52', pants: '#1f2f52', hair: '#c9b48a' },
    { x: -33.5, z: -74.25, y: -0.66, yaw: -Math.PI / 2 + 0.35, shirt: '#1f2f52', pants: '#1f2f52', hair: '#2b1d14' }, // flight attendant at the door
    { x: -0.5, z: -12.7, yaw: Math.PI / 2 + 0.2 }, { x: 3.2, z: -18.5, yaw: 1.2 },
  ], 'stand', () => basic({ vertexColors: true }), r);
  scene.add(staff.group);
  const seatedSpots = []; for (const x of [-8.2, -5.0, -1.8]) for (let z = -54; z >= -71; z -= 0.62) { if (Math.abs(z + 62.5) < 0.6) continue; if (r() < 0.35 && !(x === -5.0 && Math.abs(z + 61.44) < 0.9)) seatedSpots.push({ x: x + 0.05, y: -0.04, z, yaw: Math.PI / 2 }); }
  const seatedCrowd = makeCrowd(seatedSpots, 'sit', () => basic({ vertexColors: true }), r); scene.add(seatedCrowd.group);
  const walkers = []; for (let i = 0; i < 12; i++) { const dir = r() < 0.5 ? 1 : -1; walkers.push({ x: -1 + r() * 6, z: -24 - r() * 70, y: 0, yaw: dir > 0 ? 0 : Math.PI, dir, v: 1.0 + r() * 0.45, scale: 0.9 + r() * 0.15 }); }
  const walkCrowd = makeCrowd(walkers, 'stand', () => basic({ vertexColors: true }), r); scene.add(walkCrowd.group);
  const wBags = new THREE.InstancedMesh(bake(new THREE.BoxGeometry(0.36, 0.55, 0.24).translate(0.3, 0.29, 0.45), '#3a3048'), basic({ vertexColors: true }), walkers.length); scene.add(wBags);

  // ---------------- interactive props ----------------
  const hl = []; // highlighted targets pulse
  const mkProp = (geo, color) => { const m = new THREE.Mesh(bake(geo, color), basic({ vertexColors: true, color: '#ffffff' })); scene.add(m); return m; };
  const binGeo = mergeGeometries([new THREE.BoxGeometry(0.56, 0.02, 0.42).translate(0, 0.01, 0), new THREE.BoxGeometry(0.56, 0.13, 0.02).translate(0, 0.065, 0.2), new THREE.BoxGeometry(0.56, 0.13, 0.02).translate(0, 0.065, -0.2), new THREE.BoxGeometry(0.02, 0.13, 0.42).translate(0.27, 0.065, 0), new THREE.BoxGeometry(0.02, 0.13, 0.42).translate(-0.27, 0.065, 0)].map((g) => g.toNonIndexed()));
  const bin = mkProp(binGeo, '#7d858d'); bin.visible = false;
  const bagGeo = mergeGeometries([new THREE.BoxGeometry(0.42, 0.24, 0.30).translate(0, 0.12, 0), new THREE.BoxGeometry(0.2, 0.06, 0.03).translate(0, 0.27, 0)].map((g) => g.toNonIndexed()));
  const bag = mkProp(bagGeo, '#294a72');
  const shoesGeo = mergeGeometries([new THREE.BoxGeometry(0.1, 0.08, 0.27).translate(-0.07, 0.04, 0), new THREE.BoxGeometry(0.1, 0.08, 0.27).translate(0.07, 0.04, 0)].map((g) => g.toNonIndexed()));
  const shoes = mkProp(shoesGeo, '#5a3d2a');
  const idCard = new THREE.Group();
  const card1 = new THREE.Mesh(new THREE.PlaneGeometry(0.086, 0.054), basic({ map: signTex(256, 160, (g, w, h) => { g.fillStyle = '#e8eef5'; g.fillRect(0, 0, w, h); g.fillStyle = '#2c4f7a'; g.fillRect(0, 0, w, 32); g.fillStyle = '#b9c6d4'; g.fillRect(16, 46, 70, 90); g.fillStyle = '#5a6675'; for (let i = 0; i < 4; i++) g.fillRect(100, 52 + i * 22, 130 - i * 20, 9); }), side: THREE.DoubleSide }));
  const pass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.08), basic({ map: signTex(512, 205, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c2533'; g.font = `700 34px ${FONT}`; g.fillText('BOARDING PASS', 18, 44); g.font = `600 30px ${FONT}`; g.fillText('CHS \u2192 CLT    GATE B7    GROUP 4', 18, 100); g.fillText('SEAT 14A  (WINDOW)', 18, 150); g.fillStyle = '#000'; for (let x = 380; x < 490; x += 6) if ((x * 7) % 13 > 4) g.fillRect(x, 120, 3, 70); }), side: THREE.DoubleSide }));
  card1.position.set(-0.07, 0.003, 0.02); pass.position.set(0.06, 0.001, 0); card1.rotation.x = pass.rotation.x = -Math.PI / 2;
  idCard.add(pass, card1); idCard.position.set(0.85, 1.16, -7.38); idCard.rotation.z = 0.0; scene.add(idCard);
  const idHit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), basic({ visible: false })); idHit.position.copy(idCard.position); scene.add(idHit);
  const gpass = pass.clone(); gpass.position.set(-9.05, 1.215, -75.8); gpass.rotation.set(-Math.PI / 2, 0, 0.3); scene.add(gpass);
  const gpassHit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.4), basic({ visible: false })); gpassHit.position.set(-9.15, 1.2, -75.95); scene.add(gpassHit);
  const carried = new THREE.Group(); // bag hanging at your side once collected (follows the rig, set by main)
  const cbag = new THREE.Mesh(bagGeo.clone().rotateY(Math.PI / 2), basic({ vertexColors: true })); cbag.geometry = bake(bagGeo.clone(), '#294a72'); cbag.position.set(0.32, 0.25, 0.05); carried.add(cbag); carried.visible = false;

  // ---------------- steps ----------------
  const st = { i: -1, t: 0, sub: 0, done: false, armsT: 0, scan: -1, anim: [], prompt: null, boardT: 0, group: 0, beltOn: false, path: null, pathD: 0, pathL: 0, prevP: null };
  const P = (x, z) => [x, z];
  const STEPS = [
    { id: 'entry', at: P(0, 3), path: null },
    { id: 'queue1', at: P(-4.5, -2.0), path: [P(-5.5, -0.4), P(-5.5, -2.0), P(-4.5, -2.0)] },
    { id: 'queue2', at: P(2.4, -3.4), path: [P(2.9, -2.0), P(3.0, -3.4), P(2.4, -3.4)] },
    { id: 'queue3', at: P(-3.5, -4.8), path: [P(-5.5, -3.4), P(-5.5, -4.8), P(-3.5, -4.8)] },
    { id: 'id', at: P(0.45, -6.8), path: [P(0.6, -4.8), P(0.45, -6.8)] },
    { id: 'divest', at: P(-0.25, -10.3), path: [P(0.3, -8.6), P(-0.25, -10.3)] },
    { id: 'scanwait', at: P(1.45, -12.4), path: null },
    { id: 'scanner', at: P(1.45, -14.0), path: null },
    { id: 'collect', at: P(-0.25, -17.3), path: [P(1.45, -15.6), P(0.3, -16.7), P(-0.25, -17.3)] },
    { id: 'board', at: P(1.8, -26.2), path: [P(0.8, -21), P(1.8, -26.2)] },
    { id: 'walk', at: P(0.5, -46), path: [P(1.5, -36), P(0.5, -46)] },
    { id: 'gate', at: P(-5.25, -61.44), path: [P(-3.4, -52.5), P(-3.4, -61.44), P(-5.25, -61.44)], sit: true },
    { id: 'gatepod', at: P(-8.6, -75.5), path: [P(-3.4, -62), P(-3.4, -73.5), P(-8.6, -75.5)] },
    { id: 'bridge', at: P(-32.6, -75), path: [P(-11.2, -75), P(-32.6, -75)] },
  ];
  const tips = {};
  let api = null;
  function prompt(title, text, button = 'Continue', target = null) { st.prompt = { title, text, button, target }; api.onPrompt?.(st.prompt); }
  function anim(obj, to, dur, then, arc = 0) { st.anim.push({ obj, from: obj.position.clone(), to: to.clone(), t: 0, dur, then, arc }); }
  function enter(i) {
    st.i = i; st.t = 0; st.sub = 0; const id = STEPS[i].id;
    api.onStep?.(id, i);
    switch (id) {
      case 'entry':
        audio.play('termchime');
        say('pa', 'Welcome to the airport. Please keep your belongings with you at all times, and report any unattended bags.', 0.6);
        prompt('Pre-flight: airport & security', 'Take your time - nothing here is timed. When you are ready, head to the security checkpoint ahead.', 'Continue');
        break;
      case 'queue1': say('tip', 'This is a normal security line. It moves steadily. Notice your feet on the floor and let your shoulders drop.'); prompt('In line', 'Have your ID and boarding pass ready. The line will move forward.'); break;
      case 'queue2': prompt('In line', 'Slow breath in... and a long breath out. Everyone here is doing the same routine.'); break;
      case 'queue3': say('pa', 'Reminder: liquids must be 3.4 ounces or less and fit in one quart-sized bag.', 1.0); prompt('Almost at the front', 'The officer at the podium will check your ID and boarding pass.'); break;
      case 'id': prompt('ID check', 'Hand over your ID and boarding pass: point at the glowing card on the podium and pull the trigger (or click).', null, idHit); break;
      case 'divest': say('tip', 'Bins, belt, scanner: every traveller does the same three things. There is no rush.'); prompt('Bins', 'Grab a bin: point at the stack of grey bins.', null, binStackHit); break;
      case 'scanwait': say('officer', 'Next. Step into the scanner please, feet on the yellow footprints.', 0.8); prompt('Body scanner', 'Step forward into the scanner when you are ready.'); break;
      case 'scanner': st.scan = -1; scanLight.material.color.set('#ffb02e'); say('officer', 'Raise your arms above your head, like the picture. Hold still for just a moment.', 0.4); prompt('Arms up', 'Raise both arms above your head (or press the button).', 'Arms up'); st.armsT = 0; break;
      case 'collect': prompt('Collect your things', 'Your bin is coming out of the X-ray. Pick up your bag when it arrives.', null, null); break;
      case 'board': prompt('Departures', 'Find your flight on the board: Charlotte - Gate B7 - On time.'); say('tip', "You're through security - for many people that's the most stressful part of the airport. Well done."); break;
      case 'walk': audio.play('termchime'); say('pa', 'Attention passengers: the moving walkway is ending. Please watch your step.', 1.0); prompt('Concourse', 'Walk on to Gate B7. Shops and restrooms are along the right.'); break;
      case 'gate': st.boardT = 0; st.group = 0; prompt('At the gate', 'Have a seat. Watch the plane outside being loaded while you wait for your group.', 'Skip the wait'); break;
      case 'gatepod': say('agent', 'Good to see you. Just scan your boarding pass here.', 0.5); prompt('Boarding', 'Scan your boarding pass: point at the pass on the gate scanner.', null, gpassHit); break;
      case 'bridge': say('crew', 'Welcome aboard! Your seat is 14A, on the left by the window.', 0.5); prompt('Welcome aboard', 'Step on board and take your window seat.', 'Take my seat'); break;
    }
  }
  function goNext() {
    if (st.i >= STEPS.length - 1) { st.done = true; onDone(); return; }
    const nx = STEPS[st.i + 1];
    const pts = [...(nx.path || [nx.at])];
    startWalk(pts, () => enter(st.i + 1));
    st.prompt = null; api.onPrompt?.(null);
    if (STEPS[st.i].id.startsWith('queue') || STEPS[st.i].id === 'entry') advanceQueue(st.i + 1);
  }
  function startWalk(pts, then) {
    const h = api.head(); const all = [[h.x, h.z], ...pts]; let L = 0; for (let k = 0; k < all.length - 1; k++) L += Math.hypot(all[k + 1][0] - all[k][0], all[k + 1][1] - all[k][1]);
    st.path = all; st.pathD = 0; st.pathL = L; st.prevP = [h.x, h.z]; st.then = then;
  }
  function pathAt(d) { const a = st.path; for (let k = 0; k < a.length - 1; k++) { const l = Math.hypot(a[k + 1][0] - a[k][0], a[k + 1][1] - a[k][1]); if (d <= l || k === a.length - 2) { const t = l ? clamp(d / l, 0, 1) : 1; return [lerp(a[k][0], a[k + 1][0], t), lerp(a[k][1], a[k + 1][1], t)]; } d -= l; } return a[a.length - 1]; }
  let queueBase = 5;
  // once you reach the ID podium, the people ahead of you move on through the checkpoint
  const qTarget = (q) => (queueBase >= 35 && q.off > 0 ? qTotal : queueBase + q.off);
  function advanceQueue(stepIdx) { queueBase = [5, 9.1, 18.5, 29.8, 35.9][stepIdx] ?? 46; }

  function drawBoard(tod) {
    const [c, g] = boardC, W = 1280, H = 720;
    g.fillStyle = '#0a1424'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1b3a66'; g.fillRect(0, 0, W, 86); g.fillStyle = '#fff'; g.font = `700 46px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('Departures', 30, 44);
    const base = tod === 0 ? 9 : tod === 1 ? 18 : 21;
    g.textAlign = 'right'; g.font = `500 34px ${FONT}`; g.fillText(`${base}:${tod === 2 ? '05' : '10'}`, W - 30, 44);
    g.font = `600 26px ${FONT}`; g.fillStyle = '#8fb0d8'; g.textAlign = 'left';
    const cols = [30, 200, 640, 820, 990]; ['Time', 'Destination', 'Flight', 'Gate', 'Status'].forEach((h, i) => g.fillText(h, cols[i], 118));
    const rows = [['Atlanta', 'FL 118', 'B2', 'Boarding'], ['Charlotte', 'FL 482', 'B7', 'On time'], ['New York LGA', 'FL 905', 'B4', 'On time'], ['Dallas', 'FL 233', 'B9', 'Delayed'], ['Washington DCA', 'FL 760', 'B1', 'On time'], ['Chicago', 'FL 341', 'B11', 'On time'], ['Miami', 'FL 627', 'B3', 'On time'], ['Denver', 'FL 552', 'B12', 'On time']];
    rows.forEach((rw, i) => {
      const y = 170 + i * 66, mins = 20 + i * 12, hh = base + Math.floor(mins / 60), mm = mins % 60;
      if (i === 1) { g.fillStyle = 'rgba(255,211,77,0.16)'; g.fillRect(14, y - 30, W - 28, 60); }
      g.font = `600 34px ${FONT}`; g.fillStyle = i === 1 ? '#ffd34d' : '#ffffff';
      g.fillText(`${hh}:${String(mm).padStart(2, '0')}`, cols[0], y); g.fillText(rw[0], cols[1], y); g.fillText(rw[1], cols[2], y); g.fillText(rw[2], cols[3], y);
      g.fillStyle = rw[3] === 'Delayed' ? '#ff9a6b' : rw[3] === 'Boarding' ? '#7dffa8' : '#9ef0b5'; g.fillText(i === 1 && st.group > 0 ? 'Boarding' : rw[3], cols[4], y);
    });
    boardTex.needsUpdate = true;
  }
  function drawGateSign() {
    const [c, g] = gateSignC, W = 1024, H = 384;
    g.fillStyle = '#0a1424'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffd34d'; g.font = `800 120px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(GATE, 34, 100);
    g.fillStyle = '#fff'; g.font = `700 74px ${FONT}`; g.fillText('Charlotte', 290, 100);
    g.font = `600 52px ${FONT}`; g.fillStyle = st.group > 0 ? '#7dffa8' : '#9ef0b5'; g.fillText(st.group > 0 ? `Now boarding: Group ${st.group}` : 'On time  \u00b7  Boarding soon', 34, 270);
    gateSignTex.needsUpdate = true;
  }

  function setTod(E, todIdx) {
    const night = E.night >= 1, sunset = todIdx === 1;
    skyMat.uniforms.top.value.copy(E.low.top); skyMat.uniforms.horizon.value.copy(E.low.hor); skyMat.uniforms.sunCol.value.copy(E.sunCol);
    skyMat.uniforms.sunDir.value.set(E.sunDir.x, E.sunDir.y, E.sunDir.z).normalize();
    skyMat.uniforms.uStars.value = night ? 0.9 : 0; skyMat.uniforms.uMoon.value = night ? 1 : 0; skyMat.uniforms.uGlow.value = E.glow; skyMat.uniforms.uSunDisc.value = night ? 0 : 1; skyMat.uniforms.uCityGlow.value.copy(E.cityGlow);
    sun.color.copy(E.sunCol); sun.intensity = E.low.sun * 1.1; sun.position.copy(E.sunDir).multiplyScalar(500);
    hemi.color.copy(E.hemiSky); hemi.groundColor.copy(E.hemiGnd); hemi.intensity = E.low.hemi;
    apronMat.emissive.set(night ? '#4a3518' : sunset ? '#1a1208' : '#000000');
    planeMat.emissive.set(night ? '#2a2620' : '#000000');
    outLights.material.uniforms.uIntensity.value = E.lights;
    floodPool.material.opacity = night ? 0.45 : sunset ? 0.12 : 0;
    glassMat.opacity = night ? 0.2 : 0.12; glassMat.color.set(night ? '#6c7a90' : '#9fb6c8');
    drawBoard(todIdx); this && 0;
    todNow = todIdx;
  }
  let todNow = 0, clock = 0;

  api = {
    scene, carried, STEPS, get step() { return STEPS[Math.max(0, st.i)]?.id; }, get stepIdx() { return st.i; }, get prompt() { return st.prompt; },
    get moving() { return !!st.path; }, get done() { return st.done; },
    head: () => new THREE.Vector3(), moveBy: () => {}, onPrompt: null, onStep: null,
    targets() { const t = []; if (st.prompt && st.prompt.target && !st.path) t.push(st.prompt.target); if (st.i === 5 && !st.path) { if (st.sub === 1) t.push(bag); if (st.sub === 2) t.push(shoes); if (st.sub === 3) t.push(bin); } if (st.i === 8 && !st.path) { if (st.sub === 1) t.push(bag); if (st.sub === 2) t.push(shoes); } return t; },
    start(todE, todIdx) {
      st.i = -1; st.done = false; st.path = null; st.anim = []; st.group = 0; st.scan = -1; queueBase = 5; scanArms.rotation.y = 0;
      bin.visible = false; bag.visible = true; bag.position.set(0.25, 0, -10.95); bag.rotation.set(0, 0.3, 0); shoes.visible = true; shoes.position.set(-0.45, 0, -10.75); shoes.rotation.set(0, -0.2, 0);
      idCard.position.set(0.85, 1.16, -7.38); idCard.visible = true; carried.visible = false; scanLight.material.color.set('#ffb02e'); podGlass.material.color.set('#ff3b30'); gateGlass.material.color.set('#ff3b30');
      qSpots.forEach((q, k) => { const td = qTarget(q); const [x, z, yaw] = qAt(td); q.x = x; q.z = z; q.yaw = yaw; q.d = td; }); queue.update();
      setTod.call(this, todE, todIdx); drawGateSign();
      enter(0);
    },
    setTod(E, i) { setTod.call(this, E, i); },
    // a target was hit (pointer + trigger / click)
    hit(obj) {
      if (st.path) return false;
      const id = STEPS[st.i]?.id;
      if (id === 'id' && obj === idHit) {
        audio.play('clack'); anim(idCard, new THREE.Vector3(1.4, 1.22, -7.62), 0.6, () => { audio.play('beep'); podGlass.material.color.set('#3cff6a'); setTimeout(() => audio.play('okbeep'), 600); });
        st.prompt = null; api.onPrompt?.(null);
        setTimeout(() => { say('officer', 'Thank you. You are all set - bins are just ahead on your left. Have a good flight.'); idCard.visible = false; prompt('ID checked', 'Continue to the bins and the X-ray belt.'); }, 1700);
        return true;
      }
      if (id === 'divest') {
        if (st.sub === 0 && obj === binStackHit) { bin.visible = true; bin.position.set(BX, 1.05, -9.25); audio.play('clack'); anim(bin, new THREE.Vector3(BX, 0.79, -10.3), 0.5); st.sub = 1; prompt('Bins', 'Put your bag in the bin: point at your bag on the floor.', null, bag); return true; }
        if (st.sub === 1 && obj === bag) { anim(bag, new THREE.Vector3(BX - 0.08, 0.81, -10.3), 0.7, () => audio.play('thud'), 0.35); st.sub = 2; prompt('Shoes', 'Shoes off: put your shoes in the bin too.', null, shoes); return true; }
        if (st.sub === 2 && obj === shoes) { anim(shoes, new THREE.Vector3(BX + 0.17, 0.81, -10.25), 0.6, () => audio.play('clack'), 0.3); st.sub = 3; prompt('Belt', 'Push the bin onto the belt: point at the bin.', null, bin); return true; }
        if (st.sub === 3 && obj === bin) {
          audio.play('clack'); audio.setBelt(true); st.beltOn = true;
          const grp = [bin, bag, shoes]; for (const o of grp) anim(o, o.position.clone().add(new THREE.Vector3(0, 0, -2.6)), 3.2, o === bin ? () => { for (const q of grp) q.visible = false; audio.setBelt(false); } : null);
          say('officer', "Thanks. Go ahead to the scanner when you're called.", 1.4);
          st.sub = 4; prompt('Belt', 'Your things are going through the X-ray. Walk over to the body scanner.'); return true;
        }
      }
      if (id === 'collect') {
        if (st.sub === 1 && obj === bag) { audio.play('thud'); bag.visible = false; carried.visible = true; st.sub = 2; prompt('Shoes', 'Put your shoes back on: point at your shoes.', null, shoes); return true; }
        if (st.sub === 2 && obj === shoes) { audio.play('step'); shoes.visible = false; bin.visible = false; st.sub = 3; prompt('All done', "You're through security. Continue to the departures board."); return true; }
      }
      if (id === 'gatepod' && obj === gpassHit) {
        audio.play('beep'); gateGlass.material.color.set('#3cff6a'); setTimeout(() => audio.play('okbeep'), 500); gpass.visible = false;
        say('agent', 'Thank you. Enjoy your flight to Charlotte.', 0.8); prompt('Boarding pass scanned', 'Walk down the jet bridge to the aircraft door.'); return true;
      }
      return false;
    },
    // the prompt button was pressed (Continue / Arms up / Skip the wait ...)
    button() {
      if (st.path || !st.prompt || !st.prompt.button) return;
      const id = STEPS[st.i].id;
      if (id === 'scanner' && st.scan < 0) { startScan(); return; }
      goNext();
    },
    // skip whatever the current step needs and move on
    skip() {
      if (st.path) { st.pathD = st.pathL; return; }
      const id = STEPS[st.i]?.id;
      if (id === 'divest') { bin.visible = bag.visible = shoes.visible = false; audio.setBelt(false); }
      if (id === 'collect') { bag.visible = shoes.visible = bin.visible = false; carried.visible = true; }
      if (id === 'id') idCard.visible = false;
      st.anim = []; goNext();
    },
    update(dt, { armsUp = false } = {}) {
      clock += dt; st.t += dt;
      for (const p of [outLights]) { p.material.uniforms.uTime.value = clock; }
      // guided walk
      if (st.path) {
        const v = 1.15, total = st.pathL, ramp = Math.min(1, st.pathD / 0.8, (total - st.pathD) / 0.8 + 0.25);
        st.pathD = Math.min(total, st.pathD + dt * v * Math.max(0.25, ramp));
        const p = pathAt(st.pathD); api.moveBy(p[0] - st.prevP[0], p[1] - st.prevP[1]); st.prevP = p;
        if (Math.floor(clock / 0.55) !== Math.floor((clock - dt) / 0.55)) audio.play('step');
        if (st.pathD >= total - 1e-4) { st.path = null; const th = st.then; st.then = null; th && th(); }
      } else if (st.i >= 0 && st.i < STEPS.length - 1 && !st.prompt?.target) {
        // arrived at the next station on your own (teleport / smooth move)
        const nx = STEPS[st.i + 1], h = api.head();
        if (st.prompt && st.prompt.button === 'Continue' && Math.hypot(h.x - nx.at[0], h.z - nx.at[1]) < 0.9) { st.prompt = null; api.onPrompt?.(null); if (st.i <= 3) advanceQueue(st.i + 1); enter(st.i + 1); }
      }
      // prop animations
      for (let k = st.anim.length - 1; k >= 0; k--) { const a = st.anim[k]; a.t += dt; const u = ss(Math.min(1, a.t / a.dur)); a.obj.position.lerpVectors(a.from, a.to, u); a.obj.position.y += a.arc * Math.sin(Math.PI * u); if (a.t >= a.dur) { st.anim.splice(k, 1); a.then && a.then(); } }
      // highlight current targets
      const pulse = 1 + 0.45 * (0.5 + 0.5 * Math.sin(clock * 5));
      for (const o of [bag, shoes, bin]) o.material.color.setScalar(1);
      for (const o of api.targets()) if (o.material && o.material.visible !== false) o.material.color.setScalar(pulse);
      card1.material.color.setScalar(st.prompt?.target === idHit ? pulse : 1); pass.material.color.setScalar(st.prompt?.target === idHit ? pulse : 1);
      gpass.material.color.setScalar(st.prompt?.target === gpassHit ? pulse : 1);
      // queue shuffles forward
      for (const q of qSpots) { const td = qTarget(q); if (Math.abs(td - q.d) > 0.01) { q.d += Math.sign(td - q.d) * Math.min(Math.abs(td - q.d), dt * 0.9); const [x, z, yaw] = qAt(q.d); q.x = x; q.z = z; q.yaw = yaw; q.y = Math.abs(Math.sin(clock * 6 + q.off)) * 0.015; } else q.y = 0; if (q.d >= qTotal - 0.05) q.y = -5; }
      queue.update(); const m4 = new THREE.Matrix4();
      qSpots.forEach((q, k) => { m4.makeRotationY(q.yaw).setPosition(q.x, q.d >= qTotal - 0.05 ? -5 : 0, q.z); qBags.setMatrixAt(k, m4); }); qBags.instanceMatrix.needsUpdate = true;
      // concourse walkers
      walkers.forEach((w, k) => { w.z += w.dir * -w.v * dt; if (w.z < -96) { w.dir = -1; w.yaw = Math.PI; } if (w.z > -22) { w.dir = 1; w.yaw = 0; } w.y = Math.abs(Math.sin(clock * 6.5 + k)) * 0.02; m4.makeRotationY(w.yaw).setPosition(w.x, 0, w.z); wBags.setMatrixAt(k, m4); });
      walkCrowd.update(); wBags.instanceMatrix.needsUpdate = true;
      // step-specific scripts
      const id = STEPS[st.i]?.id;
      if (id === 'id' && st.t > 0.8 && st.sub === 0) { st.sub = 1; say('officer', 'Next, please.'); }
      if (id === 'scanner') {
        if (st.scan < 0 && st.prompt) { st.armsT = armsUp ? st.armsT + dt : 0; if (st.armsT > 0.6) startScan(); }
        if (st.scan >= 0) {
          st.scan += dt; scanArms.rotation.y = Math.sin(Math.min(1, st.scan / 2.2) * Math.PI) * Math.PI * 0.9;
          if (st.scan > 2.4 && st.sub === 0) { st.sub = 1; scanLight.material.color.set('#3cff6a'); audio.play('okbeep'); say('officer', 'All clear. Step out and collect your things, please.'); prompt('All clear', 'Green light. Step out of the scanner.'); }
        }
      }
      if (id === 'collect') {
        if (st.sub === 0 && st.t > 0.3) {
          st.sub = 0.5; bin.visible = bag.visible = shoes.visible = true; audio.setBelt(true);
          bin.position.set(BX, 0.79, -15.0); bag.position.set(BX - 0.08, 0.81, -15.0); shoes.position.set(BX + 0.17, 0.81, -15.0);
          for (const o of [bin, bag, shoes]) anim(o, o.position.clone().add(new THREE.Vector3(0, 0, -2.4)), 2.8, o === bin ? () => { audio.setBelt(false); st.sub = 1; prompt('Collect your things', 'Pick up your bag: point at it.', null, bag); } : null);
        }
      }
      if (id === 'gate') {
        st.boardT += dt; const T = st.boardT;
        const calls = [[4, 0, 'pa', 'Good ' + (todNow ? 'evening' : 'morning') + ', passengers on the flight to Charlotte departing from gate B7. We will begin boarding in just a few minutes.'],
          [14, 0, 'tip', 'Look out of the window: the ramp crew are loading bags and the plane is plugged into the jet bridge. Routine, everyday work.'],
          [24, 1, 'pa', 'We now invite passengers needing a little extra time, and Group 1, to board.'], [33, 2, 'pa', 'Group 2 is now welcome to board.'],
          [42, 3, 'pa', 'Now boarding Group 3.'], [51, 4, 'pa', 'We are now boarding Group 4. Group 4, please make your way to the gate.']];
        for (const [t0, grp, who, txt] of calls) if (T - dt < t0 && T >= t0) { audio.play('termchime'); say(who, txt, who === 'pa' ? 1.0 : 0); if (grp) { st.group = grp; drawGateSign(); drawBoard(todNow); } if (grp === 4) prompt('Your group is boarding', 'Group 4 - that is you. Walk up to the gate agent when you are ready.'); }
      }
      if (id === 'divest' && st.sub === 4 && STEPS[st.i].id === 'divest' && !st.prompt?.button) { /* waiting for belt */ }
      api.update2?.(dt);
    },
    walkable(x, z) {
      if (Math.abs(x) < HX - 0.4 && z < Z0 - 0.4 && z > Z1 + 0.4) return 0;
      if (x <= -HX + 0.4 && x > BRX1 + 0.3 && Math.abs(z - BZ) < 0.85) return slope(x);
      return null;
    },
    floorAt(x, z) { return x < -HX ? slope(x) : 0; },
  };
  function startScan() { st.scan = 0; st.prompt = null; api.onPrompt?.(null); audio.play('scanner'); }
  return api;
}
