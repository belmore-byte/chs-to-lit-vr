// Everything outside the aircraft. The world group is moved by the inverse of the aircraft pose,
// so the cabin (and the user) stay still and the world moves past the windows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { mulberry32, smooth, lerp, clamp, D2R } from './util.js';
import { TAXI_OUT_PTS, TAXI_IN_PTS, GATE_DEP, GATE_ARR, CLOUD_BASE, CLOUD_TOP } from './flight.js';
import { MT, REG, buildMacro, buildChsRegion, cirrusTexture } from './terrain.js';

export const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
export const SKY_FS = `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir;
uniform float uStars; uniform float uMoon; uniform float uGlow; uniform float uSunDisc; uniform vec3 uCityGlow; varying vec3 vDir;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){ vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5));
  col += uCityGlow * (1.0 - smoothstep(-0.05, 0.12, h));
  float s = max(dot(d, sunDir), 0.0);
  col += sunCol * (pow(s, 900.0) * 3.0 * uSunDisc + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.06);
  col += sunCol * uGlow * (pow(s, 3.0) * 0.45 + 0.12) * (1.0 - smoothstep(-0.02, 0.32, h));
  if (uStars > 0.0) {
    vec3 p = d * 210.0; vec3 ip = floor(p); float rr = h3(ip);
    if (rr > 0.982) {
      vec3 c = ip + 0.5 + 0.5 * (vec3(h3(ip + 1.7), h3(ip + 3.1), h3(ip + 5.3)) - 0.5);
      float b = smoothstep(0.42, 0.0, length(p - c)) * (0.25 + 0.75 * (rr - 0.982) / 0.018);
      col += vec3(0.9, 0.93, 1.0) * b * uStars * smoothstep(0.03, 0.3, h);
    }
  }
  float m = dot(d, moonDir);
  col += uMoon * (smoothstep(0.99993, 0.99996, m) * vec3(1.0, 0.97, 0.88) * 1.5 + pow(max(m, 0.0), 400.0) * vec3(0.10, 0.12, 0.16) + pow(max(m, 0.0), 30.0) * vec3(0.02, 0.025, 0.035));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const CLOUD_VS = `attribute vec3 offset; attribute vec4 params;
uniform vec2 uCenter; uniform float uTile; uniform float uFogNear; uniform float uFogFar; uniform vec3 uSunDir; uniform float uFlat;
varying vec2 vUv; varying float vAlpha; varying float vBright; varying float vFog; varying float vSun;
void main(){
  vec3 c = offset;
  c.x = uCenter.x + mod(c.x - uCenter.x + uTile*0.5, uTile) - uTile*0.5;
  c.z = uCenter.y + mod(c.z - uCenter.y + uTile*0.5, uTile) - uTile*0.5;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float size = params.x; float r = params.w;
  vec2 p = position.xy;
  vec2 pr = vec2(p.x*cos(r) - p.y*sin(r), p.x*sin(r) + p.y*cos(r));
  mv.xy += pr * size * vec2(1.0, uFlat);
  float dist = length(mv.xyz);
  // soft fade as we fly into a puff (gradual whiteout instead of popping)
  vAlpha = smoothstep(size*0.25, size*1.3, dist);
  float e = max(abs(c.x-uCenter.x), abs(c.z-uCenter.y));
  vAlpha *= 1.0 - smoothstep(uTile*0.3, uTile*0.48, e);
  vFog = smoothstep(uFogNear, uFogFar, dist);
  vUv = (p*0.5+0.5)*0.5 + vec2(mod(params.y,2.0), floor(params.y/2.0))*0.5;
  vBright = params.z;
  vec3 vd = normalize((modelMatrix * vec4(c, 1.0)).xyz - cameraPosition);
  vSun = pow(max(dot(vd, uSunDir), 0.0), 6.0);
  gl_Position = projectionMatrix * mv;
}`;
const CLOUD_FS = `uniform sampler2D map; uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uFogColor; uniform float uOpacity; uniform vec3 uRim;
varying vec2 vUv; varying float vAlpha; varying float vBright; varying float vFog; varying float vSun;
void main(){
  vec4 t = texture2D(map, vUv);
  vec3 col = mix(uShade, uLit, t.r) * vBright;
  col += uRim * vSun * (1.0 - t.a) * 1.6;
  col = mix(col, uFogColor, vFog);
  float a = t.a * vAlpha * uOpacity * (1.0 - vFog*0.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;
// Ground: land-cover masks + tiling field detail, water with sky reflection and sun/moon glint, towns that light up at night
const GROUND_VS = `uniform vec3 uOffset; varying vec2 vW; varying float vDist;
void main(){ vW = position.xz + uOffset.xz; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;
const GROUND_FS = `uniform sampler2D detail; uniform sampler2D macro; uniform sampler2D region;
uniform float uMT; uniform float uDT; uniform float uRegionOn; uniform vec3 uRegion;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uSkyHor; uniform vec3 uCam; uniform float uNight; uniform float uTime;
uniform vec3 fogCol; uniform float fogNear; uniform float fogFar;
varying vec2 vW; varying float vDist;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 wp = vW;
  vec3 det = texture2D(detail, wp / uDT).rgb;
  vec3 mac = texture2D(macro, wp / uMT).rgb;
  float forest = mac.r, urban = mac.g, water = mac.b, marsh = 0.0;
  if (uRegionOn > 0.5) {
    vec2 ruv = (wp - uRegion.xy) / uRegion.z + 0.5;
    float inside = smoothstep(0.0, 0.06, min(min(ruv.x, ruv.y), min(1.0 - ruv.x, 1.0 - ruv.y)));
    if (inside > 0.0) {
      vec3 rg = texture2D(region, ruv).rgb;
      water = mix(water, rg.r, inside); marsh = rg.g * inside; urban = mix(urban, rg.b, inside);
    }
  }
  float fw = max(length(fwidth(wp)), 0.01);
  float far = smoothstep(5.0, 22.0, fw);
  vec3 col = det;
  col = mix(col, vec3(0.040, 0.066, 0.030) * (0.75 + 0.5 * det.g / max(det.r, 0.02) * 0.5), clamp(forest * 1.2, 0.0, 1.0) * 0.92);
  // salt marsh: golden-green with darker mud streaks
  vec3 mcol = mix(vec3(0.20, 0.19, 0.075), vec3(0.13, 0.15, 0.06), smoothstep(0.3, 0.7, det.g * 2.0));
  col = mix(col, mcol, clamp(marsh * 1.3, 0.0, 1.0) * 0.95);
  // suburbs: street grid + roofs + yards, averaged out when far away (no shimmer)
  vec2 cell = floor(wp / 26.0); float hh = h2(cell);
  vec2 gf = fract(wp / 104.0); float street = max(step(gf.x, 0.08), step(gf.y, 0.08));
  vec3 roof = mix(vec3(0.16, 0.15, 0.14), vec3(0.42, 0.40, 0.36), hh);
  roof = mix(roof, vec3(0.06, 0.09, 0.04), step(0.62, hh) * 0.8);
  vec3 urb = mix(roof, vec3(0.13), street);
  urb = mix(urb, vec3(0.17, 0.17, 0.15), far);
  col = mix(col, urb, clamp(urban * 1.15, 0.0, 1.0) * 0.9);
  // lighting (flat ground, Lambert-like)
  vec3 lit = col * (uSunCol * max(uSunDir.y, 0.0) + uAmb) * 0.3183;
  // water (rivers, lakes, harbor, ocean)
  float wm = smoothstep(0.35, 0.6, water);
  vec3 vd = normalize(vec3(wp.x, 0.0, wp.y) - uCam);
  float fres = pow(1.0 - abs(vd.y), 4.0);
  vec3 wcol = vec3(0.012, 0.03, 0.04) * (uSunCol * max(uSunDir.y, 0.0) + uAmb) * 0.5 + uSkyHor * (0.18 + 0.6 * fres);
  vec3 rv = reflect(vd, vec3(0.0, 1.0, 0.0));
  float rip = 0.85 + 0.15 * sin(wp.x * 0.07 + uTime * 0.6) * sin(wp.y * 0.05 - uTime * 0.4);
  wcol += uSunCol * pow(max(dot(rv, uSunDir), 0.0), mix(400.0, 60.0, far)) * 1.4 * rip;
  float sand = smoothstep(0.15, 0.32, water) * (1.0 - smoothstep(0.32, 0.5, water)) * (1.0 - marsh);
  lit = mix(lit, vec3(0.42, 0.37, 0.26) * (uSunCol * max(uSunDir.y, 0.0) + uAmb) * 0.3183, sand * 0.8);
  lit = mix(lit, wcol, wm);
  // night: town lights (sparkle up close, warm glow when far)
  if (uNight > 0.0) {
    float sp = step(0.8, h2(floor(wp / 13.0) + 7.0)) * (0.6 + 0.8 * h2(floor(wp / 13.0)));
    float u2 = smoothstep(0.08, 1.0, urban);
    float mottle = 0.55 + 0.9 * h2(floor(wp / 160.0) + 3.0) * h2(floor(wp / 61.0) + 11.0);
    float glow = mix(sp * step(0.3, urban), 0.13 * mottle * u2, far) * u2 * (1.0 - wm);
    lit += vec3(1.0, 0.55, 0.22) * glow * uNight * 0.8;
  }
  float f = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(lit, fogCol, f), 1.0);
  #include <colorspace_fragment>
}`;
// Point lights (runway/taxiway/approach/city): additive soft sprites, size from physical size + distance
const PT_VS = `attribute vec4 pcol; attribute vec2 pinfo;
uniform float uWrap; uniform float uTile; uniform vec2 uCenter; uniform float uTime; uniform float uViewH; uniform float uIntensity;
uniform float uFogFar; uniform float uMinPx; uniform float uRegionOn; uniform vec3 uRegion; uniform vec2 uShift;
varying vec3 vCol; varying float vA; varying float vHard;
void main(){
  vec3 c = position;
  if (uWrap > 0.5) {
    c.x = uCenter.x + mod(c.x - uCenter.x + uTile*0.5, uTile) - uTile*0.5;
    c.z = uCenter.y + mod(c.z - uCenter.y + uTile*0.5, uTile) - uTile*0.5;
    c.xz += uShift;
  }
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float d = length(mv.xyz);
  float px = pinfo.x * projectionMatrix[1][1] * uViewH * 0.5 / d;
  float a = pcol.a * uIntensity;
  if (pinfo.y >= 10.0) a *= 0.08 + 1.6 * smoothstep(0.1, 0.0, abs(fract(uTime * 0.75 - pinfo.y) - 0.5));
  else if (pinfo.y >= 0.0) a *= smoothstep(0.07, 0.0, fract(uTime * 2.0 - pinfo.y)) * 3.0;
  if (uRegionOn > 0.5 && uWrap > 0.5) { vec2 ruv = (c.xz - uRegion.xy) / uRegion.z + 0.5; if (ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0) a = 0.0; }
  float size = max(px * 5.0, uMinPx);
  a *= min(1.0, px * 5.0 / uMinPx * 0.7 + 0.5);
  a *= 1.0 - smoothstep(uFogFar * 0.5, uFogFar, d);
  vCol = pcol.rgb; vA = a; vHard = clamp((size - 2.5) / 6.0, 0.0, 1.0);
  gl_PointSize = a > 0.003 ? min(size, 64.0) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const PT_FS = `varying vec3 vCol; varying float vA; varying float vHard;
void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
  float f = mix(1.1 - 0.6 * r2, exp(-r2 * 5.0) + 0.6 * exp(-r2 * 40.0), vHard);
  gl_FragColor = vec4(vCol * f * vA, 1.0); }`;

export function pointCloud(list, { wrap = false, tile = 0, minPx = 1.6 } = {}) {
  // list: flat array of [x, y, z, r, g, b, intensity, size, flash]
  const n = list.length / 9, pos = new Float32Array(n * 3), col = new Float32Array(n * 4), inf = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const o = i * 9; pos.set([list[o], list[o + 1], list[o + 2]], i * 3);
    const c = new THREE.Color(list[o + 3], list[o + 4], list[o + 5]); col.set([c.r, c.g, c.b, list[o + 6]], i * 4); inf.set([list[o + 7], list[o + 8]], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('pcol', new THREE.BufferAttribute(col, 4)); g.setAttribute('pinfo', new THREE.BufferAttribute(inf, 2));
  const m = new THREE.ShaderMaterial({ vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uWrap: { value: wrap ? 1 : 0 }, uTile: { value: tile }, uCenter: { value: new THREE.Vector2() }, uTime: { value: 0 }, uViewH: { value: 720 }, uIntensity: { value: 1 },
      uFogFar: { value: 1e6 }, uMinPx: { value: minPx }, uRegionOn: { value: 0 }, uRegion: { value: new THREE.Vector3(0, 0, REG) }, uShift: { value: new THREE.Vector2() } } });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 12;
  return p;
}

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

export { airlinerGeometry };
export function createWorld(scene) {
  const world = new THREE.Group(); world.matrixAutoUpdate = false; scene.add(world);
  const r = mulberry32(2024);
  const nightMats = [], floodMats = [];

  // Lights (only the exterior and wings use lit materials)
  const hemi = new THREE.HemisphereLight(0xdde8ff, 0x6b7553, 1.2); world.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3df, 2.4); world.add(sun); world.add(sun.target);
  const sunDir = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

  // Sky dome (follows the aircraft, rendered at the far plane): gradient, sun glow, stars, moon
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: sunDir.clone() }, sunCol: { value: new THREE.Color(1, 0.95, 0.85) },
      moonDir: { value: new THREE.Vector3(0.35, 0.42, -0.84).normalize() }, uStars: { value: 0 }, uMoon: { value: 0 }, uGlow: { value: 0 }, uSunDisc: { value: 1 }, uCityGlow: { value: new THREE.Color(0, 0, 0) } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat); sky.renderOrder = 50; sky.frustumCulled = false; world.add(sky);

  // Ground: one big plane, shaded by land-cover masks (fields, forests, towns, water, Lowcountry marsh at CHS)
  const TILE = 8000;
  const macro = buildMacro(), chs = buildChsRegion();
  const gU = { detail: { value: TX.groundTexture() }, macro: { value: macro.tex }, region: { value: chs.tex }, uMT: { value: MT }, uDT: { value: TILE }, uRegionOn: { value: 1 }, uRegion: { value: new THREE.Vector3(0, 0, REG) },
    uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() }, uCam: { value: new THREE.Vector3() }, uNight: { value: 0 }, uTime: { value: 0 },
    fogCol: { value: new THREE.Color() }, fogNear: { value: 1000 }, fogFar: { value: 20000 }, uOffset: { value: new THREE.Vector3() } };
  const groundG = new THREE.PlaneGeometry(TILE * 25, TILE * 25, 24, 24); groundG.rotateX(-Math.PI / 2);
  const groundMat = new THREE.ShaderMaterial({ vertexShader: GROUND_VS, fragmentShader: GROUND_FS, uniforms: gU, extensions: { derivatives: true } });
  const ground = new THREE.Mesh(groundG, groundMat); ground.frustumCulled = false; world.add(ground);

  // night lights on the ground: generic towns/roads (wrap with the macro tile) + Charleston area
  const toList = (arr, ox, oz) => {
    const out = [], rr = mulberry32(9);
    for (let i = 0; i < arr.length; i += 3) {
      const kind = arr[i + 2], c = kind === 2 ? [1.0, 0.62, 0.25] : kind === 1 ? [0.85, 0.9, 1.0] : (rr() < 0.7 ? [1.0, 0.7, 0.38] : [1.0, 0.86, 0.62]);
      out.push(arr[i] + ox, 1, arr[i + 1] + oz, c[0], c[1], c[2], kind === 2 ? 0.75 : 0.45 + rr() * 0.6, kind === 2 ? 1.6 : 1.2 + rr() * 1.2, -1);
    }
    return out;
  };
  // shuffle so a partial drawRange is an even subsample
  const ml = macro.lights.slice(), sr = mulberry32(55);
  for (let i = ml.length / 3 - 1; i > 0; i--) { const j = Math.floor(sr() * (i + 1)); for (let k = 0; k < 3; k++) { const t = ml[i * 3 + k]; ml[i * 3 + k] = ml[j * 3 + k]; ml[j * 3 + k] = t; } }
  const cityLights = pointCloud(toList(ml, 0, 0), { wrap: true, tile: MT, minPx: 2.0 }); world.add(cityLights);
  // the wrapped tile covers +-16 km; 8 neighbour copies (one-third subsample, a bit brighter) reach +-48 km
  const cityRing = [];
  for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
    if (!gx && !gz) continue;
    const g = new THREE.BufferGeometry(); for (const k of ['position', 'pcol', 'pinfo']) g.setAttribute(k, cityLights.geometry.attributes[k]); g.setDrawRange(0, Math.floor(ml.length / 9));
    const m = cityLights.material.clone(); m.uniforms.uShift.value.set(gx * MT, gz * MT);
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 12; world.add(p); cityRing.push(p);
  }
  const chsLights = pointCloud(toList(chs.lights, 0, 0), { minPx: 2.0 }); world.add(chsLights);

  // ---------- Airport (reused for each airport; moved to the right frame) ----------
  const airport = new THREE.Group(); airport.matrixAutoUpdate = false; world.add(airport);
  const flats = [];
  const addFlat = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; airport.add(m); flats.push(m); return m; };
  const grassT = TX.grassTexture(); grassT.repeat.set(1400 / 14, 4600 / 14);
  const grassG = new THREE.PlaneGeometry(1400, 4600); grassG.rotateX(-Math.PI / 2); grassG.translate(-60, 0, -1300);
  addFlat(grassG, flatMat(grassT, '#ffffff', 1, 1), 1);
  const concT = TX.concreteTexture(); concT.repeat.set(70 / 16, 2000 / 16);
  const apronG = new THREE.PlaneGeometry(76, 2000); apronG.rotateX(-Math.PI / 2); apronG.translate(-228, 0, -880);
  const apronMat = flatMat(concT, '#ffffff', 2, 2); addFlat(apronG, apronMat, 2); floodMats.push([apronMat, new THREE.Color('#6a4a22')]);
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

  const m4 = new THREE.Matrix4();
  // Airfield lighting as additive point sprites (one draw call): edge, centerline, threshold/end, approach + rabbit, taxiway blue, apron floods, road lights
  const AL = [];
  const L = (x, z, hex, inten, size, flash = -1, y = 0.5) => { const c = new THREE.Color(hex); AL.push(x, y, z, c.r, c.g, c.b, inten, size, flash); };
  for (let z = 0; z >= -2940; z -= 30) { L(-23.5, z, '#fff1cf', 1.0, 0.7); L(23.5, z, z < -2340 ? '#ffc04a' : '#fff1cf', 1.0, 0.7); }
  for (let z = -8; z >= -2932; z -= 15) { const d = -2940 - z; L(0, z, d > -300 ? '#ff3b30' : (d > -900 && Math.round(z / 15) % 2) ? '#ff3b30' : '#ffffff', 0.75, 0.45, -1, 0.1); }
  for (let x = -21; x <= 21; x += 3) { L(x, 2, '#3cff6a', 1.0, 0.6); L(x, -2942, '#ff3b30', 1.0, 0.6); }
  for (let z = 60; z <= 840; z += 30) { for (let x = -6; x <= 6; x += 3) L(x, z, '#fff3d8', 1.1, 0.7, -1, 1 + z * 0.006); L(0, z, '#ffffff', 1.6, 1.0, (840 - z) / 780 * 0.45, 1.6 + z * 0.006); }
  for (let x = -15; x <= 15; x += 2) L(x, 300, '#fff3d8', 1.1, 0.7, -1, 2.8);
  for (const x of [-35, -32, 32, 35]) for (let k = 0; k < 2; k++) L(x, -320 - k * 8, k ? '#ffffff' : '#ff3b30', 1.2, 0.8); // PAPI-ish
  const taxiEdge = (pts, w) => { const cv = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), n = Math.max(2, Math.round(cv.getLength() / 30)); for (let i = 0; i <= n; i++) { const p = cv.getPointAt(i / n), t = cv.getTangentAt(i / n); for (const sd of [-1, 1]) L(p.x - t.z * sd * (w / 2 + 1), p.z + t.x * sd * (w / 2 + 1), '#2f63ff', 0.9, 0.45, -1, 0.35); } };
  taxiEdge([new THREE.Vector3(-180, 0, -1960), new THREE.Vector3(-180, 0, -1000), new THREE.Vector3(-180, 0, 40)], 23);
  taxiEdge(TAXI_OUT_PTS.slice(2, 9), 23); taxiEdge(TAXI_IN_PTS.slice(1), 23);
  for (let z = 40; z >= -1940; z -= 60) for (const x of [-262, -200]) L(x, z, '#ffcf8a', 1.4, 2.6, -1, 18); // apron flood poles
  for (let z = 900; z >= -3500; z -= 50) { L(-520, z, '#ffb056', 0.9, 1.0, -1, 9); L(-900, z, '#ffb056', 0.9, 1.0, -1, 9); }
  L(-360, -820, '#3cff7a', 2.0, 2.5, 10.0, 50); L(-360, -820, '#ffffff', 2.0, 2.5, 10.5, 50.2); // rotating beacon
  const airLights = pointCloud(AL, { minPx: 2.2 });
  airport.add(airLights);
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
  const termMat = new THREE.MeshLambertMaterial({ map: termT, emissive: '#ffffff', emissiveMap: TX.terminalNightTexture(), emissiveIntensity: 0 });
  nightMats.push([termMat, 1.0]);
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
  const planeMat = new THREE.MeshLambertMaterial({ vertexColors: true }); floodMats.push([planeMat, new THREE.Color('#3a3226')]);
  const planes = new THREE.InstancedMesh(airlinerGeometry('#ffffff'), planeMat, planeSpots.length);
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
  const bldMat = new THREE.MeshLambertMaterial({ map: bldT, emissive: '#ffffff', emissiveMap: TX.buildingNightTexture(), emissiveIntensity: 0 }); nightMats.push([bldMat, 0.9]);
  const blds = new THREE.InstancedMesh(bldG, bldMat, bspots.length);
  bspots.forEach(([x, z], i) => { const tall = r() < 0.08; m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (r() < 0.5 ? 0 : 0.2), 0)), new THREE.Vector3(10 + r() * 25, tall ? 30 + r() * 50 : 5 + r() * 12, 10 + r() * 25)); blds.setMatrixAt(i, m4); blds.setColorAt(i, new THREE.Color().setHSL(0.08 + r() * 0.05, 0.12, 0.62 + r() * 0.25)); });
  airport.add(blds);

  // ---------- Clouds: instanced billboards, two layers (cumulus + broken mid-level deck), one draw call each ----------
  const cloudAtlasTex = TX.cloudAtlas();
  function cloudLayer(seed, nCl, per, yMin, yMax, spread, sizeMin, sizeVar, flat) {
    const rr = mulberry32(seed), CT = 70000, N = nCl * per;
    const cg = new THREE.InstancedBufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    cg.setIndex([0, 1, 2, 0, 2, 3]);
    const off = new Float32Array(N * 3), par = new Float32Array(N * 4);
    let q = 0;
    for (let c = 0; c < nCl; c++) {
      const cx = rr() * CT, cz = rr() * CT, cy = yMin + rr() * (yMax - yMin), big = 0.7 + rr() * 0.8;
      for (let k = 0; k < per; k++) {
        const y = cy + (rr() - 0.3) * (yMax - yMin) * 0.35 * big;
        off[q * 3] = cx + (rr() - 0.5) * spread * big; off[q * 3 + 1] = y; off[q * 3 + 2] = cz + (rr() - 0.5) * spread * big;
        par[q * 4] = (sizeMin + rr() * sizeVar) * big; par[q * 4 + 1] = Math.floor(rr() * 4); par[q * 4 + 2] = 0.8 + 0.32 * clamp((y - yMin) / (yMax - yMin), 0, 1); par[q * 4 + 3] = (rr() - 0.5) * 0.4;
        q++;
      }
    }
    cg.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
    cg.setAttribute('params', new THREE.InstancedBufferAttribute(par, 4));
    cg.instanceCount = N;
    const mat = new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
      uniforms: { map: { value: cloudAtlasTex }, uCenter: { value: new THREE.Vector2() }, uTile: { value: CT }, uFogNear: { value: 1000 }, uFogFar: { value: 50000 }, uSunDir: { value: sunDir }, uFlat: { value: flat },
        uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.65, 0.68, 0.74) }, uFogColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uRim: { value: new THREE.Color() } } });
    const mesh = new THREE.Mesh(cg, mat); mesh.frustumCulled = false; mesh.renderOrder = 10; world.add(mesh);
    return mat;
  }
  const cloudMat = cloudLayer(2025, 820, 6, CLOUD_BASE + 120, CLOUD_TOP - 200, 1300, 300, 420, 1.0);
  const midMat = cloudLayer(4049, 260, 5, 3700, 3950, 2600, 700, 700, 0.55);
  // high cirrus veil (one textured plane far above, world-locked texture)
  const cirrusTex = cirrusTexture(); cirrusTex.repeat.set(6, 6);
  const cirrusMat = new THREE.MeshBasicMaterial({ map: cirrusTex, transparent: true, depthWrite: false, opacity: 0.55, fog: false, side: THREE.DoubleSide });
  const cirrus = new THREE.Mesh(new THREE.PlaneGeometry(240000, 240000), cirrusMat); cirrus.rotation.x = -Math.PI / 2; cirrus.renderOrder = 9; world.add(cirrus);

  scene.fog = new THREE.Fog(0xcfd8e0, 500, 20000);

  // ---------- environments: per time-of-day, sky colours, haze and light as a function of altitude ----------
  const C = (h) => new THREE.Color(h);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
  const DAY = [
    { low: { top: C('#6f93c2'), hor: C('#c9d6e2'), sun: 1.6, hemi: 1.05 }, high: { top: C('#2462c9'), hor: C('#c4daf0'), sun: 2.7, hemi: 1.3 }, sunCol: C('#fff3df'), sunDir: V3(-0.45, 0.62, -0.64),
      night: 0, glow: 0, lit: C('#ffffff'), shade: C('#9aa3b5'), rim: C('#fff6e8'), white: C('#dfe4ea'), hemiSky: C('#dde8ff'), hemiGnd: C('#6b7553'), lights: 0.18, city: 0, cityGlow: C('#000000') },
    { low: { top: C('#7a95bb'), hor: C('#dccfbf'), sun: 1.5, hemi: 1.0 }, high: { top: C('#2a5fbf'), hor: C('#e2d8cc'), sun: 2.5, hemi: 1.2 }, sunCol: C('#ffd9a8'), sunDir: V3(-0.75, 0.38, 0.2),
      night: 0, glow: 0.1, lit: C('#fff1df'), shade: C('#a39ea8'), rim: C('#ffe6c4'), white: C('#e2e0dc'), hemiSky: C('#e6e4f0'), hemiGnd: C('#6b6a50'), lights: 0.18, city: 0, cityGlow: C('#000000') },
  ];
  const SUNSET = { low: { top: C('#3d5a92'), hor: C('#f0a066'), sun: 1.25, hemi: 0.75 }, high: { top: C('#1f3c7c'), hor: C('#f5b07a'), sun: 1.6, hemi: 0.9 }, sunCol: C('#ff9a52'), sunDir: V3(-0.92, 0.075, -0.25),
    night: 0.35, glow: 1, lit: C('#ffc596'), shade: C('#6e5f80'), rim: C('#ffb46e'), white: C('#c8b4ac'), hemiSky: C('#ffc9a8'), hemiGnd: C('#4d4a40'), lights: 0.55, city: 0.35, cityGlow: C('#000000') };
  const NIGHT = { low: { top: C('#070b16'), hor: C('#1a2134'), sun: 0.32, hemi: 0.22 }, high: { top: C('#03060d'), hor: C('#121a2c'), sun: 0.38, hemi: 0.22 }, sunCol: C('#a9bde6'), sunDir: V3(0.35, 0.42, -0.84),
    night: 1, glow: 0, lit: C('#47506a'), shade: C('#151a25'), rim: C('#9fb2d6'), white: C('#2a3140'), hemiSky: C('#3a4a70'), hemiGnd: C('#141820'), lights: 1, city: 1, cityGlow: C('#2a1d12') };
  let E = DAY[0], todIdx = 0, legTod = 0;
  const tmpTop = new THREE.Color(), tmpHor = new THREE.Color(), fogCol = new THREE.Color();
  const frameA = new THREE.Matrix4(), frameBm = new THREE.Matrix4();
  const acM = new THREE.Matrix4(), acQ = new THREE.Quaternion(), acE = new THREE.Euler(0, 0, 0, 'YXZ'), acP = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let currentFrame = -1, legIdx = 0, time = 0;
  const allPts = [airLights, cityLights, chsLights, ...cityRing];
  function applyEnv() {
    E = todIdx === 0 ? DAY[legTod] : todIdx === 1 ? SUNSET : NIGHT;
    sunDir.copy(E.sunDir);
    sun.position.copy(sunDir).multiplyScalar(1000); sun.color.copy(E.sunCol);
    hemi.color.copy(E.hemiSky); hemi.groundColor.copy(E.hemiGnd);
    skyMat.uniforms.sunDir.value.copy(sunDir); skyMat.uniforms.sunCol.value.copy(E.sunCol);
    skyMat.uniforms.uStars.value = E.night >= 1 ? 1 : 0; skyMat.uniforms.uMoon.value = E.night >= 1 ? 1 : 0; skyMat.uniforms.uGlow.value = E.glow; skyMat.uniforms.uSunDisc.value = E.night >= 1 ? 0 : 1;
    skyMat.uniforms.uCityGlow.value.copy(E.cityGlow);
    for (const [m, k] of nightMats) m.emissiveIntensity = E.night * k;
    for (const [m, c] of floodMats) m.emissive.copy(c).multiplyScalar(E.night >= 1 ? 1 : E.night * 0.3);
    cityLights.visible = chsLights.visible = E.city > 0; for (const p of cityRing) p.visible = E.city > 0;
    for (const p of allPts) p.material.uniforms.uIntensity.value = p === airLights ? E.lights : E.city * (E.night >= 1 ? (cityRing.includes(p) ? 2.4 : 1.8) : 0.45);
    gU.uNight.value = E.city;
    cirrusMat.color.copy(E.night >= 1 ? C('#2b3346') : todIdx === 1 ? C('#ffc9a0') : C('#ffffff'));
  }

  return {
    world, get env() { return E; }, get tod() { return todIdx; },
    setTod(i) { todIdx = i; applyEnv(); },
    setLeg(leg, flight, idx) {
      legTod = leg.tod; legIdx = idx ?? 0; applyEnv();
      frameBm.makeRotationY(flight.frameB.yaw).setPosition(flight.frameB.x, 0, flight.frameB.z);
      this.names = [`${leg.fromCity.toUpperCase()}  ${leg.from}`, `${leg.toCity.toUpperCase()}  ${leg.to}`];
      currentFrame = -1;
    },
    // returns info about the environment for cabin lighting
    update(st, turbOff, { dt = 0.016, viewH = 720, flash = 0 } = {}) {
      time += dt;
      acP.set(st.x, st.alt + st.floorH + turbOff.dy, st.z);
      acE.set(st.pitch + turbOff.pitch, st.yaw, st.roll + turbOff.roll, 'YXZ');
      acQ.setFromEuler(acE); acM.compose(acP, acQ, one);
      world.matrix.copy(acM).invert(); world.matrixWorldNeedsUpdate = true;

      if (st.frame !== currentFrame) {
        currentFrame = st.frame;
        airport.matrix.copy(st.frame ? frameBm : frameA); airport.matrixWorldNeedsUpdate = true;
        setSign(this.names[st.frame]);
      }
      // Lowcountry region only exists around CHS (leg 1 departure frame)
      const regionOn = legIdx === 0 ? 1 : 0;
      gU.uRegionOn.value = regionOn; chsLights.visible = regionOn && E.city > 0; for (const p of [cityLights, ...cityRing]) p.material.uniforms.uRegionOn.value = regionOn;
      ground.position.set(Math.round(st.x / TILE) * TILE, 0, Math.round(st.z / TILE) * TILE);
      gU.uOffset.value.copy(ground.position);
      sky.position.copy(acP);
      for (const m of [cloudMat, midMat]) m.uniforms.uCenter.value.set(st.x, st.z);
      for (const p of [cityLights, ...cityRing]) p.material.uniforms.uCenter.value.set(st.x, st.z);
      cirrus.position.set(st.x, 11500, st.z); cirrusTex.offset.set(st.x / 40000, -st.z / 40000);

      // environment by altitude
      const alt = st.alt;
      const above = smooth(CLOUD_TOP - 100, CLOUD_TOP + 900, alt);
      const hi = smooth(CLOUD_TOP, 10000, alt);
      tmpTop.copy(E.low.top).lerp(E.high.top, above); if (!E.night) tmpTop.lerp(C('#1d4aa8'), hi * 0.5 * (todIdx === 0 ? 1 : 0.3));
      tmpHor.copy(E.low.hor).lerp(E.high.hor, above);
      const inCloud = smooth(CLOUD_BASE - 80, CLOUD_BASE + 120, alt) * (1 - smooth(CLOUD_TOP - 150, CLOUD_TOP + 60, alt));
      const white = E.white.clone(); if (flash > 0) white.lerp(C('#c9d2e2'), flash * (E.night >= 1 ? 0.55 : 0.1));
      fogCol.copy(tmpHor).lerp(white, inCloud);
      let near = lerp(600, 5000, hi), far = lerp(24000, 110000, smooth(0, 9000, alt));
      if (E.night >= 1) { near *= 2; far *= 1.6; }
      near = lerp(near, 20, inCloud * 0.97); far = lerp(far, 650, inCloud * 0.97);
      scene.fog.color.copy(fogCol); scene.fog.near = near; scene.fog.far = far;
      skyMat.uniforms.top.value.copy(tmpTop).lerp(white, inCloud);
      skyMat.uniforms.horizon.value.copy(fogCol);
      skyMat.uniforms.uStars.value = E.night >= 1 ? (1 - inCloud) * (0.55 + 0.45 * above) : 0;
      const sunI = lerp(E.low.sun, E.high.sun, above) * (1 - 0.45 * inCloud);
      sun.intensity = sunI; hemi.intensity = lerp(E.low.hemi, E.high.hemi, above);
      // ground uniforms
      gU.uSunCol.value.copy(E.sunCol).multiplyScalar(sunI); gU.uAmb.value.copy(E.hemiSky).lerp(E.hemiGnd, 0.35).multiplyScalar(hemi.intensity);
      gU.uSkyHor.value.copy(tmpHor).multiplyScalar(E.night >= 1 ? 0.6 : 0.75); gU.uCam.value.copy(acP); gU.uTime.value = time;
      gU.fogCol.value.copy(fogCol); gU.fogNear.value = near; gU.fogFar.value = far;
      // clouds
      for (const m of [cloudMat, midMat]) {
        const u = m.uniforms;
        u.uFogNear.value = inCloud > 0.01 ? near : lerp(3000, 8000, hi); u.uFogFar.value = inCloud > 0.01 ? far * 1.3 : far * 1.15; u.uFogColor.value.copy(fogCol);
        u.uLit.value.copy(E.lit).multiplyScalar(lerp(0.93, 1.05, above)); u.uShade.value.copy(E.shade).multiplyScalar(lerp(0.85, 1.0, above));
        u.uRim.value.copy(E.rim).multiplyScalar(E.night >= 1 ? 0.12 : 0.35);
        if (flash > 0 && E.night >= 1) u.uLit.value.lerp(C('#cfd8ea'), flash * 0.25 * inCloud);
      }
      cirrusMat.opacity = 0.5 * smooth(1500, 6000, alt) + 0.12;
      // point lights
      for (const p of allPts) { const u = p.material.uniforms; u.uTime.value = time; u.uViewH.value = viewH; u.uFogFar.value = Math.max(far * 1.2, 20000) * (1 - 0.85 * inCloud); }
      airLights.material.uniforms.uFogFar.value = Math.max(far * 1.5, 30000) * (1 - 0.9 * inCloud);
      return { inCloud, above, daylight: sunI, night: E.night };
    },
  };
}
