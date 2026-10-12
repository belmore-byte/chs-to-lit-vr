// CHS -> CLT -> LIT : a calm, realistic passenger-seat flight for gentle exposure practice (WebXR / Quest 2)
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { LEGS, buildFlight, buildEvents } from './flight.js';
import { createCabin, SEAT_X, EYE_Y, EYE_Z, FLOOR_H } from './cabin.js';
import { createWorld } from './world.js';
import { FlightAudio } from './audio.js';
import { Menu, InfoScreen, Caption, BreathGuide, Card } from './ui.js';
import { clamp, wobble, pulse, fmtTime } from './util.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 300000);
const dolly = new THREE.Group();
dolly.position.set(SEAT_X, 0, EYE_Z);
camera.position.set(0, EYE_Y, 0);
dolly.add(camera); scene.add(dolly);

const cabin = createCabin(); scene.add(cabin.group);
const world = createWorld(scene);
const audio = new FlightAudio();

// ---------- settings + state ----------
const settings = { turbulence: 1, longCruise: false, voice: true, breathing: false };
const state = { legIdx: 0, flight: null, events: [], evIdx: 0, simT: 0, running: false, started: false, mode: 'flight', sign: false, connT: 0, inXR: false };
const TURB = ['Off', 'Light', 'Moderate'];

// ---------- UI ----------
const eye = new THREE.Vector3(SEAT_X, EYE_Y, EYE_Z);
const menuItems = [
  { label: () => (state.mode === 'done' ? 'Fly again' : state.running ? 'Pause' : (state.started ? 'Resume' : 'Start flight')), action: () => { if (state.mode === 'done') { loadLeg(0); startExperience(); } else togglePause(); }, active: () => state.running },
  { label: 'Skip to\nnext phase', action: () => skipPhase() },
  { label: () => 'Turbulence\n' + TURB[settings.turbulence], action: () => setTurbulence((settings.turbulence + 1) % 3) },
  { label: () => 'Leg\n' + LEGS[state.legIdx].from + ' \u2192 ' + LEGS[state.legIdx].to, action: () => { loadLeg((state.legIdx + 1) % 2); } },
  { label: () => 'Window shade\n' + (cabin.shadeOpen ? 'Up (open)' : 'Down (closed)'), action: () => cabin.setShade(!cabin.shadeOpen) },
  { label: () => 'Breathing guide\n' + (settings.breathing ? 'On' : 'Off'), action: () => toggleBreathing(), active: () => settings.breathing },
  { label: () => 'Cruise length\n' + (settings.longCruise ? 'Long (5 min)' : 'Short'), action: () => toggleLongCruise(), active: () => settings.longCruise },
  { label: () => 'Voice announcements\n' + (settings.voice ? 'On' : 'Off'), action: () => { settings.voice = !settings.voice; if (!settings.voice) stopSpeech(); } },
  { label: 'Recenter\nseat view', action: () => recenter() },
  { label: 'Restart\nfrom CHS', action: () => { loadLeg(0); startExperience(); } },
];
const menu = new Menu(menuItems);
menu.mesh.position.set(-0.84, 0.98, -0.16); menu.mesh.lookAt(eye); scene.add(menu.mesh);
const info = new InfoScreen();
info.mesh.position.set(0, 0.13, 0.0875); cabin.ifeAnchor.add(info.mesh);
const caption = new Caption();
caption.mesh.position.set(SEAT_X + 0.1, 1.45, -1.2); caption.mesh.lookAt(eye); scene.add(caption.mesh);
const breath = new BreathGuide();
breath.group.position.set(-0.9, 1.17, -0.72); breath.group.lookAt(eye); scene.add(breath.group);
const card = new Card(); scene.add(card.mesh);
const fader = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: '#05070c', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
fader.renderOrder = 1000; fader.visible = false; camera.add(fader);
let fadeTarget = 0;

// ---------- flight control ----------
function loadLeg(i) {
  state.legIdx = i;
  state.flight = buildFlight(LEGS[i], { longCruise: settings.longCruise });
  state.events = buildEvents(state.flight, settings);
  world.setLeg(LEGS[i], state.flight);
  state.mode = 'flight'; card.mesh.visible = false; fadeTarget = 0;
  menu.mat.depthTest = true; menu.mesh.renderOrder = 20;
  jumpTo(0);
  menu.draw();
}
function jumpTo(t) {
  state.simT = clamp(t, 0, state.flight.duration);
  state.evIdx = state.events.findIndex((e) => e.t > state.simT); if (state.evIdx < 0) state.evIdx = state.events.length;
  let sign = false; for (const e of state.events) { if (e.t > state.simT) break; if (e.sign !== undefined) sign = e.sign; }
  setSign(sign); caption.clear(); stopSpeech();
}
function setSign(on) { state.sign = on; cabin.setSign(on); }
function currentPhase() { return state.flight.sample(state.simT).phase; }
function skipPhase() {
  if (state.mode === 'connection') { endConnection(); return; }
  if (state.mode === 'done') return;
  const p = currentPhase(), ph = state.flight.phases;
  if (p < ph.length - 1) jumpTo(ph[p + 1].start + 0.01); else jumpTo(state.flight.duration);
  menu.draw();
}
function togglePause() {
  if (!state.started) { startExperience(); return; }
  state.running = !state.running; audio.setPaused(!state.running);
  if (!state.running) stopSpeech();
  menu.draw();
}
function setTurbulence(v) {
  settings.turbulence = v;
  state.events = buildEvents(state.flight, settings);
  state.evIdx = state.events.findIndex((e) => e.t > state.simT); if (state.evIdx < 0) state.evIdx = state.events.length;
  menu.draw();
}
function toggleBreathing() { settings.breathing = !settings.breathing; breath.group.visible = settings.breathing; breath.t = 0; menu.draw(); }
function toggleLongCruise() {
  settings.longCruise = !settings.longCruise;
  const fl = state.flight, p = currentPhase(), tau = state.simT - fl.phases[p].start;
  state.flight = buildFlight(LEGS[state.legIdx], { longCruise: settings.longCruise });
  state.events = buildEvents(state.flight, settings);
  world.setLeg(LEGS[state.legIdx], state.flight);
  const np = state.flight.phases[p];
  jumpTo(np.start + Math.min(tau, np.end - np.start - 0.1));
  menu.draw();
}
function startExperience() {
  audio.init();
  state.started = true; state.running = true; audio.setPaused(false);
  document.getElementById('overlay')?.classList.add('hidden');
  menu.draw();
}
function placeCard() {
  // put the card ~1.1 m in front of where the user is currently looking (horizontal)
  const hp = new THREE.Vector3(), d = new THREE.Vector3();
  camera.getWorldPosition(hp); camera.getWorldDirection(d); d.y = 0; if (d.lengthSq() < 1e-4) d.set(0, 0, -1); d.normalize();
  card.mesh.position.copy(hp).addScaledVector(d, 1.1); card.mesh.lookAt(hp);
  card.mesh.visible = true;
}
function startConnection() {
  state.mode = 'connection'; state.connT = 14; fadeTarget = 0.92;
  menu.mat.depthTest = false; menu.mesh.renderOrder = 1002;
  placeCard(); drawConnection(); stopSpeech();
}
function drawConnection() {
  card.draw('Connection in Charlotte', ["You've landed at CLT. Take your time.", 'Walking to your connecting gate...', 'Next: Charlotte (CLT) \u2192 Little Rock (LIT)'], `Boarding in ${Math.ceil(state.connT)} s  \u00b7  Skip to continue now`);
}
function endConnection() {
  menu.mat.depthTest = true; menu.mesh.renderOrder = 20;
  loadLeg(1); state.running = true; audio.setPaused(false);
}
function finishTrip() {
  state.mode = 'done'; state.running = false; fadeTarget = 0.7;
  menu.mat.depthTest = false; menu.mesh.renderOrder = 1002;
  placeCard();
  card.draw('Welcome to Little Rock', ['Both flights complete: CHS \u2192 CLT \u2192 LIT.', 'That took courage. Notice how you feel now.', 'Every practice flight makes the next one easier.'], 'Use the menu to fly a leg again');
  menu.draw();
}

// ---------- captions + speech ----------
function stopSpeech() { try { window.speechSynthesis?.cancel(); } catch (e) { /* ignore */ } }
function speak(text, who) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.98; u.pitch = who === 'captain' ? 0.85 : 1.08; u.volume = 0.9;
    const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
    if (vs.length) u.voice = vs[who === 'captain' ? 0 : Math.min(1, vs.length - 1)];
    speechSynthesis.speak(u);
  } catch (e) { /* speech is optional */ }
}
let clockT = 0;
function fire(e) {
  if (e.snd) audio.play(e.snd);
  if (e.sign !== undefined) setSign(e.sign);
  if (e.text) { caption.show(e.who, e.text, clockT); if (e.who !== 'tip') speak(e.text, e.who); }
}

// ---------- XR controllers ----------
const raycaster = new THREE.Raycaster();
const tmpM = new THREE.Matrix4();
const controllers = [];
const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
const factory = new XRControllerModelFactory();
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.8 }));
  line.scale.z = 1.5; c.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' })); dot.visible = false; c.add(dot);
  c.userData = { line, dot };
  c.addEventListener('selectstart', () => { const hit = pick(rayFrom(c)); if (hit) activate(hit); });
  c.addEventListener('squeezestart', () => { menu.mesh.visible = !menu.mesh.visible; });
  c.addEventListener('connected', (e) => { c.userData.hand = e.data.handedness; line.visible = e.data.targetRayMode !== 'gaze'; });
  dolly.add(c); controllers.push(c);
  const grip = renderer.xr.getControllerGrip(i);
  try { grip.add(factory.createControllerModel(grip)); } catch (e) { /* model is cosmetic */ }
  dolly.add(grip);
}
function rayFrom(c) {
  tmpM.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
  return raycaster;
}
function pick(rc) {
  const targets = [];
  if (menu.mesh.visible) targets.push(menu.mesh);
  targets.push(cabin.shadeHit);
  if (breath.group.visible) targets.push(breath.disc, breath.ring);
  if (card.mesh.visible) targets.push(card.mesh);
  const hits = rc.intersectObjects(targets, false);
  return hits[0] || null;
}
function activate(hit) {
  audio.init();
  if (hit.object === menu.mesh) { const i = menu.hitIndex(hit.uv); if (i >= 0) { audio.play('click'); menuItems[i].action(); menu.draw(); } }
  else if (hit.object === cabin.shadeHit) { cabin.setShade(!cabin.shadeOpen); menu.draw(); }
  else if (hit.object === breath.disc || hit.object === breath.ring) toggleBreathing();
  else if (hit.object === card.mesh && state.mode === 'connection') endConnection();
}

// snap turn + recenter (rotation only on explicit user input)
const snapLatch = {};
function rotateDollyAboutHead(angle) {
  const head = new THREE.Vector3(); camera.getWorldPosition(head);
  dolly.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(head);
  dolly.rotation.y += angle; dolly.updateMatrixWorld(true);
}
function recenter() {
  if (!state.inXR) { yaw = 0.35; pitch = -0.05; return; }
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const headYaw = Math.atan2(-d.x, -d.z);
  rotateDollyAboutHead(-headYaw);
  const head = new THREE.Vector3(); camera.updateMatrixWorld(true); camera.getWorldPosition(head);
  dolly.position.add(eye.clone().sub(head)); dolly.updateMatrixWorld(true);
}
let recenterIn = 0;
renderer.xr.addEventListener('sessionstart', () => { state.inXR = true; recenterIn = 30; menu.mesh.visible = true; startExperience(); });
renderer.xr.addEventListener('sessionend', () => {
  state.inXR = false; dolly.position.set(SEAT_X, 0, EYE_Z); dolly.rotation.set(0, 0, 0);
  camera.position.set(0, EYE_Y, 0); camera.quaternion.identity();
});
function handleXRInput() {
  const session = renderer.xr.getSession(); if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const x = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0);
    const key = src.handedness;
    if (Math.abs(x) > 0.75 && !snapLatch[key]) { snapLatch[key] = true; rotateDollyAboutHead(x > 0 ? -Math.PI / 6 : Math.PI / 6); }
    else if (Math.abs(x) < 0.3) snapLatch[key] = false;
  }
  for (const c of controllers) {
    const hit = pick(rayFrom(c));
    c.userData.line.scale.z = hit ? hit.distance : 1.5;
    c.userData.dot.visible = !!hit; if (hit) c.userData.dot.position.set(0, 0, -hit.distance);
    if (hit && hit.object === menu.mesh) c.userData.menuHover = menu.hitIndex(hit.uv); else c.userData.menuHover = -1;
  }
  const h = controllers.map((c) => c.userData.menuHover).find((v) => v >= 0);
  menu.setHover(h === undefined ? -1 : h);
}

// ---------- desktop controls ----------
let yaw = 0.35, pitch = -0.05, lean = false;
const el = renderer.domElement;
let drag = null;
const mouse = new THREE.Vector2();
function mousePick(e) {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera); return pick(raycaster);
}
el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; el.setPointerCapture(e.pointerId); });
el.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    yaw += dx * 0.004; pitch = clamp(pitch + dy * 0.004, -1.3, 1.3);
  } else if (!state.inXR) {
    const hit = mousePick(e); menu.setHover(hit && hit.object === menu.mesh ? menu.hitIndex(hit.uv) : -1);
    el.style.cursor = hit ? 'pointer' : 'grab';
  }
});
el.addEventListener('pointerup', (e) => { if (drag && drag.moved < 6) { const hit = mousePick(e); if (hit) activate(hit); } drag = null; });
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'n') skipPhase();
  else if (k === 't') setTurbulence((settings.turbulence + 1) % 3);
  else if (k === 's') { cabin.setShade(!cabin.shadeOpen); menu.draw(); }
  else if (k === 'b') toggleBreathing();
  else if (k === 'l') lean = !lean;
  else if (k === '1') loadLeg(0);
  else if (k === '2') loadLeg(1);
  else if (k === 'r') { loadLeg(0); startExperience(); }
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

document.getElementById('startBtn')?.addEventListener('click', () => startExperience());
const vrButton = VRButton.createButton(renderer);
vrButton.addEventListener('click', () => audio.init());
document.body.appendChild(vrButton);

// ---------- main loop ----------
const clock = new THREE.Clock();
const st = {};
let infoT = 0, envInfo = { inCloud: 0, above: 0 };
const turbOff = { dy: 0, pitch: 0, roll: 0 };
function tick() {
  const dt = Math.min(0.1, clock.getDelta());
  clockT += dt;
  if (recenterIn > 0 && --recenterIn === 0) recenter();
  if (state.inXR) handleXRInput();
  else { camera.position.set(lean ? -0.2 : 0, lean ? EYE_Y - 0.03 : EYE_Y, lean ? -0.05 : 0); camera.rotation.set(pitch, yaw, 0, 'YXZ'); }

  const fl = state.flight;
  if (state.mode === 'flight' && state.running) {
    state.simT += dt;
    while (state.evIdx < state.events.length && state.events[state.evIdx].t <= state.simT) fire(state.events[state.evIdx++]);
    if (state.simT >= fl.duration) { if (state.legIdx === 0) startConnection(); else finishTrip(); }
  } else if (state.mode === 'connection' && state.running) {
    const before = Math.ceil(state.connT); state.connT -= dt;
    if (Math.ceil(state.connT) !== before) drawConnection();
    if (state.connT <= 0) endConnection();
  }
  fl.sample(Math.min(state.simT, fl.duration), st);
  st.floorH = FLOOR_H;

  // turbulence & ground bumps (subtle; scaled by the Turbulence setting)
  const T = settings.turbulence, tscale = T === 0 ? 0 : T === 1 ? 1 : 2;
  const crs = fl.phaseStart('cruise');
  let A = (st.ground ? 0 : 0.18) + envInfo.inCloud * 0.7 + pulse(state.simT, crs + 15, crs + 17, crs + 31, crs + 34);
  A *= tscale;
  const G = st.ground && st.speed > 0.5 ? (0.25 + clamp(st.speed / 70, 0, 1)) * (T === 0 ? 0 : T === 1 ? 1 : 1.4) : 0;
  const tt = clockT;
  turbOff.dy = A * 1.4 * wobble(tt * 0.9, 11);
  turbOff.pitch = A * 0.003 * wobble(tt * 0.7, 13);
  turbOff.roll = A * 0.005 * wobble(tt * 0.55, 17);
  cabin.group.position.y = A * 0.005 * wobble(tt * 1.3, 1) + G * 0.0022 * wobble(tt * 9.0, 3);
  cabin.group.rotation.z = A * 0.0012 * wobble(tt * 0.9, 5) + G * 0.0006 * wobble(tt * 7.0, 8);
  cabin.group.rotation.x = A * 0.0008 * wobble(tt * 1.1, 7);

  envInfo = world.update(st, turbOff);
  st.cabinLight = 0.9 + 0.1 * envInfo.above - 0.06 * envInfo.inCloud;
  cabin.update(dt, st);
  audio.update(st, dt, A, !state.running);

  caption.update(clockT, dt);
  breath.update(dt);
  fader.visible = fader.material.opacity > 0.005 || fadeTarget > 0;
  fader.material.opacity += (fadeTarget - fader.material.opacity) * Math.min(1, dt * 2);
  if (!fadeTarget && fader.material.opacity < 0.01) { fader.material.opacity = 0; fader.visible = false; }

  infoT -= dt;
  if (infoT <= 0) {
    infoT = 0.25;
    const leg = LEGS[state.legIdx], ft = st.alt * 3.28084;
    info.draw({
      from: leg.from, to: leg.to, progress: clamp(state.simT / fl.duration, 0, 1),
      phase: fl.phases[st.phase].name,
      alt: st.alt < 1 ? 'On ground' : (ft < 1000 ? Math.round(ft / 10) * 10 : Math.round(ft / 100) * 100).toLocaleString('en-US') + ' ft',
      spd: Math.round(st.speed * 1.944) + ' kt', rem: fmtTime(fl.duration - state.simT), belt: state.sign,
      paused: state.started && !state.running && state.mode === 'flight', turb: 'Turbulence: ' + TURB[settings.turbulence],
    });
  }
  renderer.render(scene, camera);
}

loadLeg(0);
caption.show('crew', 'Welcome aboard. Press Start (or Enter VR) when you are ready. The menu is on your right; the window is on your left.', 0);
caption.until = 1e9;
renderer.setAnimationLoop(tick);

// hooks for automated testing / debugging
window.APP = {
  state, settings, LEGS,
  jumpPhase(key, off = 0) { jumpTo(state.flight.phaseStart(key) + off); },
  jump(t) { jumpTo(t); },
  setView(y, p) { yaw = y; pitch = p; },
  setLean(v) { lean = v; },
  setLeg(i) { loadLeg(i); },
  start: startExperience, pause() { state.running = false; },
  sample() { return state.flight.sample(state.simT); },
  phases() { return state.flight.phases; },
  skip: skipPhase, setTurbulence, toggleBreathing, setShade: (o) => cabin.setShade(o), finishTrip, startConnection,
  showCaption(w, t) { caption.show(w, t, clockT); },
  renderer, dolly, camera, cabin,
  stats() { const i = renderer.info.render; return { calls: i.calls, tris: i.triangles }; },
};
