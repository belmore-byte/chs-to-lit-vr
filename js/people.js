// Low-poly people (seated passengers, standing travellers, crew, officers): 4 instanced draw calls per crowd.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LD = new THREE.Vector3(0.2, 0.85, 0.5).normalize();
function part(geo, m) {
  geo.applyMatrix4(m); geo = geo.index ? geo.toNonIndexed() : geo; geo.computeVertexNormals();
  const n = geo.attributes.normal, col = [];
  for (let i = 0; i < n.count; i++) { const s = 0.62 + 0.3 * Math.max(0, n.getX(i) * LD.x + n.getY(i) * LD.y + n.getZ(i) * LD.z) + 0.08 * n.getY(i); col.push(s, s, s); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.deleteAttribute('uv');
  return geo;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const box = (w, h, d, m) => part(new THREE.BoxGeometry(w, h, d), m);
const cyl = (r0, r1, h, m, s = 8) => part(new THREE.CylinderGeometry(r0, r1, h, s), m);

// Figures face -Z. Origin at floor (stand) or seat-pan height 0.45 above floor (sit, y = 0 is floor).
export function personGeometries(pose = 'stand', { armsUp = false } = {}) {
  const top = [], legs = [], skin = [], hair = [];
  if (pose === 'stand') {
    top.push(box(0.36, 0.56, 0.22, M(0, 1.2, 0)), box(0.38, 0.12, 0.24, M(0, 1.43, 0)));
    if (armsUp) { top.push(box(0.09, 0.32, 0.1, M(-0.23, 1.62, 0, 0, 0, 0.35)), box(0.09, 0.32, 0.1, M(0.23, 1.62, 0, 0, 0, -0.35))); skin.push(box(0.08, 0.1, 0.06, M(-0.3, 1.85, 0)), box(0.08, 0.1, 0.06, M(0.3, 1.85, 0))); }
    else { top.push(box(0.09, 0.52, 0.1, M(-0.23, 1.18, 0, 0, 0, 0.05)), box(0.09, 0.52, 0.1, M(0.23, 1.18, 0, 0, 0, -0.05))); skin.push(box(0.08, 0.1, 0.06, M(-0.25, 0.88, 0)), box(0.08, 0.1, 0.06, M(0.25, 0.88, 0))); }
    legs.push(box(0.16, 0.9, 0.18, M(-0.095, 0.47, 0)), box(0.16, 0.9, 0.18, M(0.095, 0.47, 0)), box(0.36, 0.14, 0.22, M(0, 0.95, 0)));
    legs.push(box(0.13, 0.07, 0.26, M(-0.095, 0.035, -0.04)), box(0.13, 0.07, 0.26, M(0.095, 0.035, -0.04)));
    skin.push(cyl(0.05, 0.055, 0.1, M(0, 1.53, 0)), part(new THREE.SphereGeometry(0.105, 10, 8), M(0, 1.66, 0.0, 0, 0, 0, 0.95, 1.15, 1.05)));
    hair.push(part(new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 1.675, 0.015, -0.35, 0, 0, 1, 1.05, 1.06)));
  } else {
    top.push(box(0.38, 0.55, 0.22, M(0, 0.80, 0.08, -0.12)), box(0.4, 0.12, 0.24, M(0, 1.02, 0.1, -0.12)));
    top.push(box(0.09, 0.30, 0.1, M(-0.24, 0.78, 0.04, 0.3)), box(0.09, 0.30, 0.1, M(0.24, 0.78, 0.04, 0.3)), box(0.09, 0.09, 0.28, M(-0.22, 0.62, -0.1)), box(0.09, 0.09, 0.28, M(0.22, 0.62, -0.1)));
    legs.push(box(0.17, 0.15, 0.46, M(-0.1, 0.55, -0.12)), box(0.17, 0.15, 0.46, M(0.1, 0.55, -0.12)), box(0.14, 0.48, 0.15, M(-0.1, 0.25, -0.36)), box(0.14, 0.48, 0.15, M(0.1, 0.25, -0.36)));
    skin.push(cyl(0.05, 0.055, 0.1, M(0, 1.12, 0.12)), part(new THREE.SphereGeometry(0.105, 10, 8), M(0, 1.25, 0.12, 0, 0, 0, 0.95, 1.15, 1.05)), box(0.08, 0.06, 0.1, M(-0.22, 0.62, -0.27)), box(0.08, 0.06, 0.1, M(0.22, 0.62, -0.27)));
    hair.push(part(new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 1.265, 0.135, -0.35, 0, 0, 1, 1.05, 1.06)));
  }
  return { top: mergeGeometries(top), legs: mergeGeometries(legs), skin: mergeGeometries(skin), hair: mergeGeometries(hair) };
}

const SKIN = ['#f1c7a5', '#e0ac85', '#c68d63', '#a26b45', '#7a4b2e', '#5a3622', '#f4d2b8'];
const HAIR = ['#2b1d14', '#3b2a1e', '#1c1a19', '#6b4a2e', '#a4825a', '#8d8d8d', '#c9b48a', '#d8d4cc'];
const SHIRT = ['#3d5a80', '#7a2e3a', '#2f4f4f', '#c9b79c', '#444a52', '#6b8e5a', '#8a6d9c', '#d0d3d6', '#1f2a3a', '#b5543c', '#e3d9c6'];
const PANTS = ['#2b3442', '#3a3a3a', '#5a5248', '#24324a', '#6f6a5f', '#1d1f24'];

// spots: [{x,y,z,yaw,shirt?,pants?}] ; mkMat(color) -> material
export function makeCrowd(spots, pose, mkMat, rand, opts = {}) {
  const geos = personGeometries(pose, opts);
  const group = new THREE.Group();
  const meshes = {};
  const pick = (a) => a[Math.floor(rand() * a.length)];
  for (const key of ['top', 'legs', 'skin', 'hair']) {
    const im = new THREE.InstancedMesh(geos[key], mkMat(), Math.max(1, spots.length));
    im.count = spots.length; im.frustumCulled = false; meshes[key] = im; group.add(im);
  }
  const cols = spots.map((s) => ({ top: new THREE.Color(s.shirt || pick(SHIRT)), legs: new THREE.Color(s.pants || pick(PANTS)), skin: new THREE.Color(s.skin || pick(SKIN)), hair: new THREE.Color(s.hair || pick(HAIR)) }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  function setPose(i, s) {
    e.set(0, s.yaw || 0, 0); q.setFromEuler(e); p.set(s.x, s.y || 0, s.z);
    m4.compose(p, q, s.scale ? new THREE.Vector3(s.scale, s.scale, s.scale) : one);
    for (const key in meshes) meshes[key].setMatrixAt(i, m4);
  }
  spots.forEach((s, i) => { setPose(i, s); for (const key in meshes) meshes[key].setColorAt(i, cols[i][key]); });
  for (const key in meshes) { meshes[key].instanceMatrix.needsUpdate = true; if (meshes[key].instanceColor) meshes[key].instanceColor.needsUpdate = true; }
  return {
    group, spots,
    update() { spots.forEach((s, i) => setPose(i, s)); for (const key in meshes) meshes[key].instanceMatrix.needsUpdate = true; },
  };
}
