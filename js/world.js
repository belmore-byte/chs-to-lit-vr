// Everything outside the aircraft. The world group is moved by the inverse of the aircraft pose,
// so the cabin (and the user) stay still and the world moves past the windows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { mulberry32, smooth, lerp, clamp, D2R } from './util.js';
import { TAXI_OUT_PTS, TAXI_IN_PTS, GATE_DEP, GATE_ARR, CLOUD_BASE, CLOUD_TOP } from './flight.js';

const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5));
  float s = max(dot(d, sunDir), 0.0);
  col += sunCol * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.06);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const CLOUD_VS = `attribute vec3 offset; attribute vec4 params;
uniform vec2 uCenter; uniform float uTile; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying float vAlpha; varying float vBright; varying float vFog;
void main(){
  vec3 c = offset;
  c.x = uCenter.x + mod(c.x - uCenter.x + uTile*0.5, uTile) - uTile*0.5;
  c.z = uCenter.y + mod(c.z - uCenter.y + uTile*0.5, uTile) - uTile*0.5;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float size = params.x; float r = params.w;
  vec2 p = position.xy;
  vec2 pr = vec2(p.x*cos(r) - p.y*sin(r), p.x*sin(r) + p.y*cos(r));
  mv.xy += pr * size;
  float dist = length(mv.xyz);
  vAlpha = smoothstep(size*0.35, size*1.1, dist);
  float e = max(abs(c.x-uCenter.x), abs(c.z-uCenter.y));
  vAlpha *= 1.0 - smoothstep(uTile*0.3, uTile*0.48, e);
  vFog = smoothstep(uFogNear, uFogFar, dist);
  vUv = (p*0.5+0.5)*0.5 + vec2(mod(params.y,2.0), floor(params.y/2.0))*0.5;
  vBright = params.z;
  gl_Position = projectionMatrix * mv;
}`;
const CLOUD_FS = `uniform sampler2D map; uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uFogColor; uniform float uOpacity;
varying vec2 vUv; varying float vAlpha; varying float vBright; varying float vFog;
void main(){
  vec4 t = texture2D(map, vUv);
  vec3 col = mix(uShade, uLit, t.r) * vBright;
  col = mix(col, uFogColor, vFog);
  float a = t.a * vAlpha * uOpacity * (1.0 - vFog*0.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function ribbon(points, width, close = false) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = Math.max(8, Math.round(curve.getLength() / 4));
  const pos = [], uv = [], idx = []; let len = 0, prev = null;
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    if (prev) len += p.distanceTo(prev); prev = p;
    const nx = -t.z, nz = t.x;
    pos.push(p.x + nx * width / 2, 0, p.z + nz * width / 2, p.x - nx * width / 2, 0, p.z - nz * width / 2);
    uv.push(0, len / 20, 1, len / 20);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const nrm = []; for (let i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function flatMat(map, color, order, offset) {
  const m = new THREE.MeshLambertMaterial({ map, color, polygonOffset: true, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset * 2, depthWrite: false });
  return m;
}

function airlinerGeometry(tailColor) {
  const parts = [];
  const add = (g, color, m) => { g.applyMatrix4(m); g.deleteAttribute('uv'); const c = new THREE.Color(color), col = []; for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
  add(new THREE.CylinderGeometry(2, 2, 28, 14, 1, true), '#f1f2f4', M(0, 3.3, -1, Math.PI / 2));
  add(new THREE.SphereGeometry(2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#f1f2f4', M(0, 3.3, -15, -Math.PI / 2, 0, 0, [1, 2.2, 1]));
  add(new THREE.ConeGeometry(2, 9, 14, 1, true), '#f1f2f4', M(0, 3.8, 17.5, Math.PI / 2, 0, 0));
  add(new THREE.BoxGeometry(0.3, 0.35, 28), '#2f5d8a', M(-2.0, 3.3, -1)); // cheat line
  add(new THREE.BoxGeometry(0.3, 0.35, 28), '#2f5d8a', M(2.0, 3.3, -1));
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(15.5, 0.35, 4.2), '#c3c8ce', M(s * 9.2, 2.0, 2.3, 0, s * 0.42, s * 0.08));
    add(new THREE.CylinderGeometry(1.0, 0.85, 3.8, 12), '#e2e4e7', M(s * 5.8, 1.3, -1.2, Math.PI / 2));
    add(new THREE.BoxGeometry(5.5, 0.22, 2.2), '#c3c8ce', M(s * 3.4, 4.6, 16.5, 0, s * 0.5, 0));
  }
  add(new THREE.BoxGeometry(0.35, 6.5, 4.4), tailColor, M(0, 8.2, 15.8, -0.45, 0, 0));
  return mergeGeometries(parts);
}

export function createWorld(scene) {
  const world = new THREE.Group(); world.matrixAutoUpdate = false; scene.add(world);
  const r = mulberry32(2024);

  // Lights (only the exterior and wings use lit materials)
  const hemi = new THREE.HemisphereLight(0xdde8ff, 0x6b7553, 1.2); world.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3df, 2.4); world.add(sun); world.add(sun.target);
  const sunDir = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

  // Sky dome (follows the aircraft, rendered at the far plane)
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: sunDir.clone() }, sunCol: { value: new THREE.Color(1, 0.95, 0.85) } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat); sky.renderOrder = 50; sky.frustumCulled = false; world.add(sky);

  // Ground: huge plane of tiling countryside, snapped to the tile grid around the aircraft
  const TILE = 8000;
  const gtex = TX.groundTexture(); gtex.repeat.set(25, 25);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 25, TILE * 25, 24, 24), new THREE.MeshLambertMaterial({ map: gtex }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);

  // ---------- Airport (reused for each airport; moved to the right frame) ----------
  const airport = new THREE.Group(); airport.matrixAutoUpdate = false; world.add(airport);
  const flats = [];
  const addFlat = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; airport.add(m); flats.push(m); return m; };
  const grassT = TX.grassTexture(); grassT.repeat.set(1400 / 14, 4600 / 14);
  const grassG = new THREE.PlaneGeometry(1400, 4600); grassG.rotateX(-Math.PI / 2); grassG.translate(-60, 0, -1300);
  addFlat(grassG, flatMat(grassT, '#ffffff', 1, 1), 1);
  const concT = TX.concreteTexture(); concT.repeat.set(70 / 16, 2000 / 16);
  const apronG = new THREE.PlaneGeometry(76, 2000); apronG.rotateX(-Math.PI / 2); apronG.translate(-228, 0, -880);
  addFlat(apronG, flatMat(concT, '#ffffff', 2, 2), 2);
  const taxiT = TX.taxiwayTexture();
  const taxiMat = flatMat(taxiT, '#ffffff', 3, 3);
  addFlat(mergeGeometries([
    ribbon([new THREE.Vector3(-180, 0, -1960), new THREE.Vector3(-180, 0, -1000), new THREE.Vector3(-180, 0, 40)], 23),
    ribbon(TAXI_OUT_PTS.slice(2, 9), 23), ribbon(TAXI_IN_PTS.slice(1), 23),
    ribbon([new THREE.Vector3(-22, 0, -2990), new THREE.Vector3(-100, 0, -2975), new THREE.Vector3(-170, 0, -2940), new THREE.Vector3(-180, 0, -2880), new THREE.Vector3(-180, 0, -1950)], 23)]), taxiMat, 3);
  const rwT = TX.runwayTexture();
  const rwG = new THREE.PlaneGeometry(45, 3060); rwG.rotateX(-Math.PI / 2); rwG.translate(0, 0, -1470);
  addFlat(rwG, flatMat(rwT, '#ffffff', 4, 4), 4);
  // perimeter + access roads
  const roadMat = flatMat(null, '#6d6f72', 2, 2);
  addFlat(mergeGeometries([[-520, -1300, 9, 4400], [420, -1300, 9, 4400], [-900, -900, 14, 6000]].map(([x, z, w, l]) => { const g = new THREE.PlaneGeometry(w, l); g.rotateX(-Math.PI / 2); g.translate(x, 0, z); return g; })), roadMat, 2);
  const lotG = new THREE.PlaneGeometry(120, 300); lotG.rotateX(-Math.PI / 2); lotG.translate(-400, 0, -200); addFlat(lotG, flatMat(concT, '#9a9a9a', 2, 2), 2);

  // Lights along runway/taxiways (one instanced draw call)
  const lights = [];
  for (let z = 0; z >= -2940; z -= 60) { lights.push([-23.5, z, '#fff6d8'], [23.5, z, '#fff6d8']); }
  for (let x = -21; x <= 21; x += 3) { lights.push([x, 2, '#3cff6a'], [x, -2942, '#ff4040']); }
  for (let z = 60; z <= 840; z += 30) for (let x = -6; x <= 6; x += 3) lights.push([x, z, '#fff6d8']);
  for (let x = -15; x <= 15; x += 2) lights.push([x, 300, '#fff6d8']);
  for (let z = -1950; z <= 40; z += 50) lights.push([-192.5, z, '#3c6cff'], [-167.5, z, '#3c6cff']);
  const lg = new THREE.BoxGeometry(0.45, 0.45, 0.45); lg.translate(0, 0.35, 0);
  const lightMesh = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const m4 = new THREE.Matrix4();
  lights.forEach(([x, z, c], i) => { m4.makeTranslation(x, 0, z); lightMesh.setMatrixAt(i, m4); lightMesh.setColorAt(i, new THREE.Color(c)); });
  airport.add(lightMesh);

  // Terminal buildings, jet bridges, tower, hangars: batched by material (few draw calls)
  const buckets = new Map();
  const addGeo = (g, mat) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(g); };
  const addBox = (w, h, d, x, y, z, mats, uScale = 1) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z);
    const ms = Array.isArray(mats) ? mats : Array(6).fill(mats);
    for (let f = 0; f < 6; f++) {
      const sub = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) { const a = g.attributes[name]; sub.setAttribute(name, new THREE.BufferAttribute(a.array.slice(f * 6 * a.itemSize, (f + 1) * 6 * a.itemSize), a.itemSize)); }
      if (uScale !== 1) { const uv = sub.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uScale); }
      addGeo(sub, ms[f]);
    }
  };
  const termT = TX.terminalTexture();
  const termMat = new THREE.MeshLambertMaterial({ map: termT });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#b9bbb6' });
  const greyMat = new THREE.MeshLambertMaterial({ color: '#c0bdb5' });
  for (const [z0, z1] of [[-420, 60], [-1880, -1480]]) { const len = z1 - z0; addBox(44, 15, len, -288, 7.5, (z0 + z1) / 2, [termMat, termMat, roofMat, roofMat, termMat, termMat], len / 60); }
  addBox(60, 22, 260, -340, 11, -1000, new THREE.MeshLambertMaterial({ color: '#cfcac0' }));
  const bridgeMat = new THREE.MeshLambertMaterial({ color: '#d4d6d8' });
  const gatesDep = [-360, -310, -260, -210, -160, -110, -60, -10, 40];
  const gatesArr = [-1850, -1800, -1750, -1700, -1650, -1600, -1550, -1500];
  for (const gz of [...gatesDep, ...gatesArr]) { addBox(26, 2.8, 2.6, -253, 4.6, gz + 4.2, bridgeMat); addBox(3, 4.5, 3, -241, 2.25, gz + 4.2, bridgeMat); }
  // tower
  addGeo(new THREE.CylinderGeometry(3.5, 4.5, 42, 10).translate(-360, 21, -820), new THREE.MeshLambertMaterial({ color: '#d7d3cb' }));
  addGeo(new THREE.CylinderGeometry(7.5, 6, 5, 10).translate(-360, 44.5, -820), new THREE.MeshLambertMaterial({ color: '#3f5869' }));
  addGeo(new THREE.CylinderGeometry(8, 8, 1, 10).translate(-360, 47.5, -820), roofMat);
  const hangMat = new THREE.MeshLambertMaterial({ map: TX.hangarTexture() }), hangSide = new THREE.MeshLambertMaterial({ color: '#aeb3b8' });
  for (const z of [-700, -1000, -1300]) addBox(70, 22, 60, 300, 11, z, [hangSide, hangMat, roofMat, roofMat, hangSide, hangSide]);
  for (const [x, z, w, h, d] of [[310, -2200, 80, 14, 40], [330, -2400, 60, 10, 50], [-330, -2300, 70, 12, 60], [-360, 300, 50, 9, 40]]) addBox(w, h, d, x, h / 2, z, greyMat);
  for (const [mat, list] of buckets) airport.add(new THREE.Mesh(mergeGeometries(list), mat));
  // airport name sign on the terminal roof (changes per airport)
  const [signC, signX] = TX.mkCanvas(1024, 128);
  const signTex = TX.toTex(signC, { wrap: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(90, 11), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  sign.position.set(-265.5, 20, -180); sign.rotation.y = Math.PI / 2; airport.add(sign);
  const sign2 = sign.clone(); sign2.position.z = -1680; airport.add(sign2);
  function setSign(name) { signX.clearRect(0, 0, 1024, 128); signX.fillStyle = 'rgba(30,50,80,0.92)'; signX.fillRect(0, 0, 1024, 128); signX.fillStyle = '#ffffff'; signX.font = 'bold 72px Arial'; signX.textAlign = 'center'; signX.textBaseline = 'middle'; signX.fillText(name, 512, 68); signTex.needsUpdate = true; }

  // parked airliners (generic livery, instanced)
  const planeSpots = [];
  for (const gz of gatesDep) if (gz !== GATE_DEP.z && r() < 0.8) planeSpots.push([-220, gz, Math.PI / 2]);
  for (const gz of gatesArr) if (gz !== GATE_ARR.z && r() < 0.7) planeSpots.push([-220, gz, Math.PI / 2]);
  planeSpots.push([300, -620, -Math.PI / 2 + 0.3], [-150, -2700, Math.PI]);
  const tails = ['#2f5d8a', '#8a2f3a', '#2f7a5d'];
  const planes = new THREE.InstancedMesh(airlinerGeometry('#ffffff'), new THREE.MeshLambertMaterial({ vertexColors: true }), planeSpots.length);
  planeSpots.forEach(([x, z, yaw], i) => { m4.compose(new THREE.Vector3(x - Math.sin(yaw) * 0, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)); planes.setMatrixAt(i, m4); planes.setColorAt(i, new THREE.Color('#ffffff')); });
  airport.add(planes);
  // tails get colour via a second small instanced mesh
  const tailG = new THREE.BoxGeometry(0.4, 6.4, 4.3); tailG.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 8.2, 15.8), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, 0, 0)), new THREE.Vector3(1, 1, 1)));
  const tailsM = new THREE.InstancedMesh(tailG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), planeSpots.length);
  planeSpots.forEach(([x, z, yaw], i) => { m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1.02, 1.02, 1.02)); tailsM.setMatrixAt(i, m4); tailsM.setColorAt(i, new THREE.Color(tails[i % 3])); });
  airport.add(tailsM);
  // service vehicles on the apron
  const veh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.2, 5).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 30);
  for (let i = 0; i < 30; i++) { const gz = [...gatesDep, ...gatesArr][i % 17]; m4.compose(new THREE.Vector3(-235 + r() * 30, 0, gz + 12 + r() * 14), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 3, 0)), new THREE.Vector3(1, 1, 1)); veh.setMatrixAt(i, m4); veh.setColorAt(i, new THREE.Color(['#f0c419', '#ffffff', '#e05a2b', '#5a7fa8'][i % 4])); }
  airport.add(veh);

  // trees and town buildings for parallax and sense of speed
  const inAirfield = (x, z) => x > -560 && x < 470 && z > -3500 && z < 1000;
  const treeSpots = [];
  while (treeSpots.length < 900) { const x = (r() - 0.5) * 4400, z = -1300 + (r() - 0.5) * 9000; if (!inAirfield(x, z) && !(x < -600 && x > -1700 && z > -2600 && z < 300)) treeSpots.push([x, z]); }
  for (let i = 0; i < 120; i++) { const z = 1050 + r() * 400, x = (r() - 0.5) * 900; treeSpots.push([x, z]); }
  const treeG = new THREE.ConeGeometry(4, 14, 6); treeG.translate(0, 7, 0);
  const trees = new THREE.InstancedMesh(treeG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), treeSpots.length);
  treeSpots.forEach(([x, z], i) => { const s = 0.7 + r() * 0.8; m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.8 + r() * 0.5), s)); trees.setMatrixAt(i, m4); trees.setColorAt(i, new THREE.Color().setHSL(0.25 + r() * 0.06, 0.35, 0.18 + r() * 0.08)); });
  airport.add(trees);
  const bldT = TX.buildingTexture();
  const bldG = new THREE.BoxGeometry(1, 1, 1); bldG.translate(0, 0.5, 0);
  const bspots = []; for (let i = 0; i < 420; i++) { const x = -650 - r() * 1050, z = -2550 + r() * 2800; bspots.push([x, z]); }
  const blds = new THREE.InstancedMesh(bldG, new THREE.MeshLambertMaterial({ map: bldT }), bspots.length);
  bspots.forEach(([x, z], i) => { const tall = r() < 0.08; m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (r() < 0.5 ? 0 : 0.2), 0)), new THREE.Vector3(10 + r() * 25, tall ? 30 + r() * 50 : 5 + r() * 12, 10 + r() * 25)); blds.setMatrixAt(i, m4); blds.setColorAt(i, new THREE.Color().setHSL(0.08 + r() * 0.05, 0.12, 0.62 + r() * 0.25)); });
  airport.add(blds);

  // ---------- Clouds: instanced billboards in one draw call ----------
  const CT = 70000, N_CL = 820, PER = 6, N = N_CL * PER;
  const cg = new THREE.InstancedBufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  cg.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(N * 3), par = new Float32Array(N * 4);
  let q = 0;
  for (let c = 0; c < N_CL; c++) {
    const cx = r() * CT, cz = r() * CT, cy = CLOUD_BASE + 120 + r() * (CLOUD_TOP - CLOUD_BASE - 320), big = 0.7 + r() * 0.8;
    for (let k = 0; k < PER; k++) {
      const y = cy + (r() - 0.3) * 260 * big;
      off[q * 3] = cx + (r() - 0.5) * 1300 * big; off[q * 3 + 1] = y; off[q * 3 + 2] = cz + (r() - 0.5) * 1300 * big;
      par[q * 4] = (300 + r() * 420) * big; par[q * 4 + 1] = Math.floor(r() * 4); par[q * 4 + 2] = 0.82 + 0.3 * clamp((y - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE), 0, 1); par[q * 4 + 3] = (r() - 0.5) * 0.4;
      q++;
    }
  }
  cg.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
  cg.setAttribute('params', new THREE.InstancedBufferAttribute(par, 4));
  cg.instanceCount = N;
  const cloudMat = new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
    uniforms: { map: { value: TX.cloudAtlas() }, uCenter: { value: new THREE.Vector2() }, uTile: { value: CT }, uFogNear: { value: 1000 }, uFogFar: { value: 50000 },
      uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.65, 0.68, 0.74) }, uFogColor: { value: new THREE.Color() }, uOpacity: { value: 1 } } });
  const clouds = new THREE.Mesh(cg, cloudMat); clouds.frustumCulled = false; clouds.renderOrder = 10; world.add(clouds);

  scene.fog = new THREE.Fog(0xcfd8e0, 500, 20000);

  // ---------- environment (sky colours, haze, light) as a function of altitude ----------
  const C = (h) => new THREE.Color(h);
  const ENV = [
    { low: { top: C('#6f93c2'), hor: C('#c9d6e2'), sun: 1.6, hemi: 1.05 }, high: { top: C('#2462c9'), hor: C('#c4daf0'), sun: 2.7, hemi: 1.3 }, sunCol: C('#fff3df'), sunDir: new THREE.Vector3(-0.45, 0.62, -0.64) },
    { low: { top: C('#7a95bb'), hor: C('#dccfbf'), sun: 1.5, hemi: 1.0 }, high: { top: C('#2a5fbf'), hor: C('#e2d8cc'), sun: 2.5, hemi: 1.2 }, sunCol: C('#ffd9a8'), sunDir: new THREE.Vector3(-0.75, 0.38, 0.2) },
  ];
  let envIdx = 0;
  const tmpTop = new THREE.Color(), tmpHor = new THREE.Color(), whiteout = C('#dfe4ea');
  const frameA = new THREE.Matrix4(), frameBm = new THREE.Matrix4();
  const acM = new THREE.Matrix4(), acQ = new THREE.Quaternion(), acE = new THREE.Euler(0, 0, 0, 'YXZ'), acP = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let currentFrame = -1;

  return {
    world,
    setLeg(leg, flight) {
      envIdx = leg.tod;
      const e = ENV[envIdx];
      sunDir.copy(e.sunDir).normalize();
      sun.position.copy(sunDir).multiplyScalar(1000); sun.color.copy(e.sunCol);
      skyMat.uniforms.sunDir.value.copy(sunDir); skyMat.uniforms.sunCol.value.copy(e.sunCol);
      frameBm.makeRotationY(flight.frameB.yaw).setPosition(flight.frameB.x, 0, flight.frameB.z);
      this.names = [`${leg.fromCity.toUpperCase()}  ${leg.from}`, `${leg.toCity.toUpperCase()}  ${leg.to}`];
      currentFrame = -1;
    },
    // returns info about the environment for cabin lighting
    update(st, turbOff) {
      // aircraft pose -> inverse world transform
      acP.set(st.x, st.alt + st.floorH + turbOff.dy, st.z);
      acE.set(st.pitch + turbOff.pitch, st.yaw, st.roll + turbOff.roll, 'YXZ');
      acQ.setFromEuler(acE); acM.compose(acP, acQ, one);
      world.matrix.copy(acM).invert(); world.matrixWorldNeedsUpdate = true;

      if (st.frame !== currentFrame) {
        currentFrame = st.frame;
        airport.matrix.copy(st.frame ? frameBm : frameA); airport.matrixWorldNeedsUpdate = true;
        setSign(this.names[st.frame]);
      }
      ground.position.set(Math.round(st.x / TILE) * TILE, 0, Math.round(st.z / TILE) * TILE);
      sky.position.copy(acP);
      cloudMat.uniforms.uCenter.value.set(st.x, st.z);

      // environment by altitude
      const e = ENV[envIdx], alt = st.alt;
      const above = smooth(CLOUD_TOP - 100, CLOUD_TOP + 900, alt);
      const hi = smooth(CLOUD_TOP, 10000, alt);
      tmpTop.copy(e.low.top).lerp(e.high.top, above); tmpTop.lerp(C('#1d4aa8'), hi * 0.5);
      tmpHor.copy(e.low.hor).lerp(e.high.hor, above);
      const inCloud = smooth(CLOUD_BASE - 80, CLOUD_BASE + 120, alt) * (1 - smooth(CLOUD_TOP - 150, CLOUD_TOP + 60, alt));
      const fogCol = tmpHor.clone().lerp(whiteout, inCloud);
      let near = lerp(600, 5000, hi), far = lerp(24000, 110000, smooth(0, 9000, alt));
      near = lerp(near, 20, inCloud * 0.97); far = lerp(far, 650, inCloud * 0.97);
      scene.fog.color.copy(fogCol); scene.fog.near = near; scene.fog.far = far;
      skyMat.uniforms.top.value.copy(tmpTop).lerp(whiteout, inCloud);
      skyMat.uniforms.horizon.value.copy(fogCol);
      const sunI = lerp(e.low.sun, e.high.sun, above) * (1 - 0.45 * inCloud);
      sun.intensity = sunI; hemi.intensity = lerp(e.low.hemi, e.high.hemi, above);
      const u = cloudMat.uniforms;
      u.uFogNear.value = inCloud > 0.01 ? near : lerp(3000, 8000, hi); u.uFogFar.value = inCloud > 0.01 ? far * 1.3 : far * 1.15; u.uFogColor.value.copy(fogCol);
      u.uLit.value.setRGB(1, 1, 1).multiplyScalar(lerp(0.93, 1.05, above) * (envIdx ? 1 : 1)); if (envIdx) u.uLit.value.lerp(C('#ffe6c8'), 0.35);
      u.uShade.value.setRGB(0.6, 0.64, 0.71).multiplyScalar(lerp(0.85, 1.0, above));
      return { inCloud, above, daylight: sunI };
    },
  };
}
