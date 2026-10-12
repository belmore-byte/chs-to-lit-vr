// CHS -> CLT -> LIT : a calm, realistic passenger-seat flight for gentle exposure practice (WebXR / Quest 2)
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { LEGS, buildFlight, buildEvents } from './flight.js';
import { createCabin, SEAT_X, EYE_Y, EYE_Z, FLOOR_H } from './cabin.js';
import { createWorld } from './world.js';
import { FlightAudio } from './audio.js';
import { Menu, InfoScreen, Caption, BreathGuide, Card, Prompt } from './ui.js';
import { createTerminal } from './terminal.js';
import { clamp, wobble, pulse, fmtTime, lerp, smooth } from './util.js';

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
const settings = { turbulence: 1, longCruise: false, voice: true, breathing: false, tod: 0, security: true, move: 'teleport' };
const state = { legIdx: 0, flight: null, events: [], evIdx: 0, simT: 0, running: false, started: false, mode: 'flight', sign: false, connT: 0, inXR: false, didTerminal: false };
const TURB = ['Off', 'Light', 'Moderate'], TOD = ['Day', 'Sunset', 'Night'];
const terminal = createTerminal({ audio, say: (who, text, delay = 0) => later(delay, () => { caption.show(who, text, clockT); if (who === 'pa') audio.play('pa'); if (who !== 'tip') speak(text, who); }), onDone: () => finishTerminal() });

// ---------- UI ----------
const eye = new THREE.Vector3(SEAT_X, EYE_Y, EYE_Z);
const menuItems = [
  { label: () => (state.mode === 'done' ? 'Fly again' : state.running ? 'Pause' : (state.started ? 'Resume' : 'Start')), action: () => { if (state.mode === 'done') { loadLeg(0); startExperience(true); } else togglePause(); }, active: () => state.running },
  { label: () => (state.mode === 'terminal' ? 'Skip to\nnext step' : 'Skip to\nnext phase'), action: () => skipPhase() },
  { label: () => 'Time of day\n' + TOD[settings.tod], action: () => setTod((settings.tod + 1) % 3), active: () => settings.tod === 2 },
  { label: () => 'Turbulence\n' + TURB[settings.turbulence], action: () => setTurbulence((settings.turbulence + 1) % 3) },
  { label: () => 'Leg\n' + LEGS[state.legIdx].from + ' \u2192 ' + LEGS[state.legIdx].to, action: () => { leaveTerminal(); loadLeg((state.legIdx + 1) % 2); } },
  { label: () => 'Airport & security\n' + (settings.security ? 'Include' : 'Skip (start seated)'), action: () => toggleSecurity(), active: () => settings.security },
  { label: () => 'Movement (airport)\n' + (settings.move === 'teleport' ? 'Teleport' : 'Smooth'), action: () => { settings.move = settings.move === 'teleport' ? 'smooth' : 'teleport'; } },
  { label: () => 'Window shade\n' + (cabin.shadeOpen ? 'Up (open)' : 'Down (closed)'), action: () => cabin.setShade(!cabin.shadeOpen) },
  { label: () => 'Breathing guide\n' + (settings.breathing ? 'On' : 'Off'), action: () => toggleBreathing(), active: () => settings.breathing },
  { label: () => 'Cruise length\n' + (settings.longCruise ? 'Long (5 min)' : 'Short'), action: () => toggleLongCruise(), active: () => settings.longCruise },
  { label: () => 'Voice\n' + (settings.voice ? 'On' : 'Off'), action: () => { settings.voice = !settings.voice; if (!settings.voice) stopSpeech(); } },
  { label: 'Recenter\nview', action: () => recenter() },
  { label: 'Restart\nfrom CHS', action: () => { leaveTerminal(); loadLeg(0); startExperience(true); } },
];
const menu = new Menu(menuItems);
const SEAT_UI = {};
menu.mesh.position.set(-0.80, 0.98, -0.20); menu.mesh.lookAt(eye); scene.add(menu.mesh);
const info = new InfoScreen();
info.mesh.position.set(0, 0.13, 0.0875); cabin.ifeAnchor.add(info.mesh);
const caption = new Caption();
caption.mesh.position.set(SEAT_X + 0.1, 1.45, -1.2); caption.mesh.lookAt(eye); scene.add(caption.mesh);
const breath = new BreathGuide();
breath.group.position.set(-0.9, 1.17, -0.72); breath.group.lookAt(eye); scene.add(breath.group);
const promptP = new Prompt();
const card = new Card(); scene.add(card.mesh);
for (const [k, o] of [['menu', menu.mesh], ['caption', caption.mesh], ['breath', breath.group]]) SEAT_UI[k] = { p: o.position.clone(), q: o.quaternion.clone(), o };
const fader = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: '#05070c', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
fader.renderOrder = 1000; fader.visible = false; camera.add(fader);
let fadeTarget = 0;
// comfort vignette (shown while moving in the airport)
const vigTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 40, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); return t; })();
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: vigTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
vignette.position.z = -0.1; vignette.renderOrder = 999; vignette.visible = false; camera.add(vignette);
let vigTarget = 0;
// airport UI anchor: lazily follows your head so prompts/captions stay comfortable
const uiAnchor = new THREE.Group(); terminal.scene.add(uiAnchor);
uiAnchor.add(promptP.mesh); promptP.mesh.position.set(0, -0.3, -0.95); promptP.mesh.rotation.x = -0.3;
terminal.onPrompt = (p) => { promptP.show(p); };
terminal.onStep = (id) => { eyeTarget = id === 'gate' ? 1.2 : 1.62; };
let eyeTarget = 1.62, eyeCur = 1.62, xrEyeOff = 0, camBaseY = 1.2;

// ---------- deferred actions (pausable) ----------
const laterQ = [];
function later(sec, fn) { if (sec <= 0) fn(); else laterQ.push({ t: sec, fn }); }

// ---------- flight control ----------
function loadLeg(i) {
  state.legIdx = i;
  state.flight = buildFlight(LEGS[i], { longCruise: settings.longCruise });
  state.events = buildEvents(state.flight, { ...settings });
  world.setLeg(LEGS[i], state.flight, i);
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
  if (state.mode === 'terminal') { terminal.skip(); return; }
  if (state.mode === 'connection') { endConnection(); return; }
  if (state.mode === 'done') return;
  const p = currentPhase(), ph = state.flight.phases;
  if (p < ph.length - 1) jumpTo(ph[p + 1].start + 0.01); else jumpTo(state.flight.duration);
  menu.draw();
}
function togglePause() {
  if (!state.started) { startExperience(true); return; }
  state.running = !state.running; audio.setPaused(!state.running);
  if (!state.running) stopSpeech();
  menu.draw();
}
function setTurbulence(v) {
  settings.turbulence = v;
  state.events = buildEvents(state.flight, { ...settings });
  state.evIdx = state.events.findIndex((e) => e.t > state.simT); if (state.evIdx < 0) state.evIdx = state.events.length;
  menu.draw();
}
function setTod(i) {
  settings.tod = i; world.setTod(i); terminal.setTod(world.env, i);
  state.events = buildEvents(state.flight, { ...settings });
  state.evIdx = state.events.findIndex((e) => e.t > state.simT); if (state.evIdx < 0) state.evIdx = state.events.length;
  menu.draw();
}
function toggleSecurity() {
  settings.security = !settings.security;
  if (!settings.security && state.mode === 'terminal') finishTerminal(true);
  menu.draw();
}
function toggleBreathing() { settings.breathing = !settings.breathing; breath.group.visible = settings.breathing; breath.t = 0; menu.draw(); }
function toggleLongCruise() {
  settings.longCruise = !settings.longCruise;
  const fl = state.flight, p = currentPhase(), tau = state.simT - fl.phases[p].start;
  state.flight = buildFlight(LEGS[state.legIdx], { longCruise: settings.longCruise });
  state.events = buildEvents(state.flight, { ...settings });
  world.setLeg(LEGS[state.legIdx], state.flight, state.legIdx);
  const np = state.flight.phases[p];
  jumpTo(np.start + Math.min(tau, np.end - np.start - 0.1));
  menu.draw();
}
function startExperience(fresh = false) {
  audio.init();
  const first = !state.started;
  state.started = true; state.running = true; audio.setPaused(false);
  document.getElementById('overlay')?.classList.add('hidden');
  if ((first || fresh) && settings.security && state.legIdx === 0 && state.mode === 'flight' && state.simT < 1) enterTerminal();
  menu.draw();
}
// ---------- airport (pre-flight) ----------
function reparentUI(toTerminal) {
  if (toTerminal) {
    uiAnchor.add(caption.mesh); caption.mesh.position.set(0, 0.12, -1.2); caption.mesh.rotation.set(0, 0, 0);
    uiAnchor.add(menu.mesh); menu.mesh.position.set(0.62, -0.42, -0.62); menu.mesh.rotation.set(-0.45, -0.75, 0, 'YXZ');
    uiAnchor.add(breath.group); breath.group.position.set(-0.45, -0.02, -0.9); breath.group.rotation.set(0, 0.35, 0);
  } else {
    for (const k in SEAT_UI) { const u = SEAT_UI[k]; scene.add(u.o); u.o.position.copy(u.p); u.o.quaternion.copy(u.q); }
  }
}
function enterTerminal() {
  state.mode = 'terminal'; state.didTerminal = true;
  terminal.scene.add(dolly); reparentUI(true);
  dolly.rotation.set(0, 0, 0); dolly.position.set(0, 0, 3);
  yaw = 0; pitch = -0.05; eyeTarget = eyeCur = 1.62;
  if (state.inXR) { placeHeadAt(0, 3, 0); }
  audio.setScene(true);
  terminal.start(world.env, settings.tod);
  caption.clear();
}
function placeHeadAt(x, z, faceYaw = null) {
  camera.updateMatrixWorld(true);
  if (faceYaw !== null) { const d = new THREE.Vector3(); camera.getWorldDirection(d); rotateDollyAboutHead(faceYaw - Math.atan2(-d.x, -d.z)); }
  const head = new THREE.Vector3(); camera.getWorldPosition(head);
  dolly.position.x += x - head.x; dolly.position.z += z - head.z; dolly.updateMatrixWorld(true);
  camBaseY = camera.position.y; xrEyeOff = clamp(eyeTarget - camBaseY, 0, 0.8);
}
function finishTerminal(immediate = false) {
  if (state.mode !== 'terminal') return;
  const go = () => {
    leaveTerminal();
    state.mode = 'flight'; jumpTo(0); state.running = true; audio.setPaused(false); fadeTarget = 0;
    menu.draw();
  };
  if (immediate) { go(); return; }
  fadeTarget = 1; later(1.3, go);
}
function leaveTerminal() {
  if (dolly.parent === scene) return;
  scene.add(dolly); reparentUI(false); promptP.show(null);
  dolly.position.set(SEAT_X, 0, EYE_Z); dolly.rotation.set(0, 0, 0); yaw = 0.35; pitch = -0.05;
  audio.setScene(false); vigTarget = 0;
  if (state.mode === 'terminal') state.mode = 'flight';
  if (state.inXR) recenterIn = 2;
}
terminal.head = () => { const h = new THREE.Vector3(); camera.getWorldPosition(h); return h; };
terminal.moveBy = (dx, dz) => { dolly.position.x += dx; dolly.position.z += dz; };

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
    u.rate = 0.98; u.pitch = who === 'captain' ? 0.85 : who === 'officer' ? 0.92 : 1.08; u.volume = 0.9;
    const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
    if (vs.length) u.voice = vs[(who === 'captain' || who === 'officer') ? 0 : Math.min(1, vs.length - 1)];
    speechSynthesis.speak(u);
  } catch (e) { /* speech is optional */ }
}
let clockT = 0;
function fire(e) {
  if (e.snd) audio.play(e.snd);
  if (e.text && (e.who === 'captain' || e.who === 'crew')) audio.play('pa');
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
  if (state.mode === 'terminal') { if (promptP.mesh.visible) targets.push(promptP.mesh); targets.push(...terminal.targets()); }
  else targets.push(cabin.shadeHit);
  if (breath.group.visible) targets.push(breath.disc, breath.ring);
  if (card.mesh.visible) targets.push(card.mesh);
  const hits = rc.intersectObjects(targets, false);
  return hits[0] || null;
}
function activate(hit) {
  audio.init();
  if (hit.object === menu.mesh) { const i = menu.hitIndex(hit.uv); if (i >= 0) { audio.play('click'); menuItems[i].action(); menu.draw(); } }
  else if (hit.object === promptP.mesh) { if (promptP.hitButton(hit.uv)) { audio.play('click'); terminal.button(); } }
  else if (hit.object === cabin.shadeHit) { cabin.setShade(!cabin.shadeOpen); menu.draw(); }
  else if (hit.object === breath.disc || hit.object === breath.ring) toggleBreathing();
  else if (hit.object === card.mesh && state.mode === 'connection') endConnection();
  else if (state.mode === 'terminal') terminal.hit(hit.object);
}

// snap turn + recenter (rotation only on explicit user input)
const snapLatch = {};
function rotateDollyAboutHead(angle) {
  const head = new THREE.Vector3(); camera.getWorldPosition(head);
  dolly.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(head);
  dolly.rotation.y += angle; dolly.updateMatrixWorld(true);
}
function recenter() {
  if (state.mode === 'terminal') {
    if (!state.inXR) { yaw = 0; pitch = 0; return; }
    const h = terminal.head(); placeHeadAt(h.x, h.z, 0); return;
  }
  if (!state.inXR) { yaw = 0.35; pitch = -0.05; return; }
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const headYaw = Math.atan2(-d.x, -d.z);
  rotateDollyAboutHead(-headYaw);
  const head = new THREE.Vector3(); camera.updateMatrixWorld(true); camera.getWorldPosition(head);
  dolly.position.add(eye.clone().sub(head)); dolly.updateMatrixWorld(true);
}
let recenterIn = 0, termHead = new THREE.Vector3(0, 1.6, 3);
renderer.xr.addEventListener('sessionstart', () => { state.inXR = true; recenterIn = 30; menu.mesh.visible = true; startExperience(); });
renderer.xr.addEventListener('sessionend', () => {
  state.inXR = false; dolly.rotation.set(0, 0, 0);
  if (state.mode === 'terminal') dolly.position.set(termHead.x, 0, termHead.z); else dolly.position.set(SEAT_X, 0, EYE_Z);
  camera.position.set(0, EYE_Y, 0); camera.quaternion.identity();
});
// teleport arc
const arcN = 40, arcPos = new Float32Array(arcN * 3);
const arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: '#7fd7ff', transparent: true, opacity: 0.9 })); arcLine.frustumCulled = false; arcLine.visible = false; terminal.scene.add(arcLine);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7fd7ff', transparent: true, opacity: 0.85, depthWrite: false })); ring.visible = false; terminal.scene.add(ring);
const tele = { active: null, target: null };
function teleportAim(c) {
  const o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
  tmpM.identity().extractRotation(c.matrixWorld);
  const v = new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM).multiplyScalar(7.5);
  let p = o.clone(), hit = null, n = 0;
  for (let i = 0; i < arcN; i++) {
    arcPos.set([p.x, p.y, p.z], i * 3); n = i + 1;
    const nx = p.clone().addScaledVector(v, 0.035); v.y -= 9.8 * 0.035;
    const fy = terminal.floorAt(nx.x, nx.z);
    if (nx.y <= fy) { hit = new THREE.Vector3(nx.x, fy, nx.z); arcPos.set([hit.x, hit.y, hit.z], (i + 1 < arcN ? i + 1 : i) * 3); n = Math.min(arcN, i + 2); break; }
    p = nx;
  }
  for (let i = n; i < arcN; i++) arcPos.set([arcPos[(n - 1) * 3], arcPos[(n - 1) * 3 + 1], arcPos[(n - 1) * 3 + 2]], i * 3);
  arcGeo.attributes.position.needsUpdate = true; arcLine.visible = true;
  const ok = hit && terminal.walkable(hit.x, hit.z) !== null && hit.distanceTo(o) < 14;
  tele.target = ok ? hit : null;
  ring.visible = !!hit; if (hit) { ring.position.copy(hit).add(new THREE.Vector3(0, 0.02, 0)); ring.material.color.set(ok ? '#7fd7ff' : '#ff6b6b'); }
  arcLine.material.color.set(ok ? '#7fd7ff' : '#ff6b6b');
}
function handleXRInput(dt) {
  const session = renderer.xr.getSession(); if (!session) return;
  let moving = false;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const x = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0), y = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] || 0);
    const key = src.handedness;
    const aiming = state.mode === 'terminal' && settings.move === 'teleport' && (tele.active === key || (!tele.active && y < -0.6));
    if (!aiming && Math.abs(x) > 0.75 && !snapLatch[key]) { snapLatch[key] = true; rotateDollyAboutHead(x > 0 ? -Math.PI / 6 : Math.PI / 6); }
    else if (Math.abs(x) < 0.3) snapLatch[key] = false;
    if (state.mode === 'terminal' && !terminal.moving && state.running) {
      const c = controllers.find((cc) => cc.userData.hand === key) || controllers[0];
      if (settings.move === 'teleport') {
        if (y < -0.6 && (!tele.active || tele.active === key)) { tele.active = key; teleportAim(c); }
        else if (tele.active === key && Math.abs(y) < 0.3) {
          if (tele.target) { const h = terminal.head(); fader.material.opacity = 0.9; terminal.moveBy(tele.target.x - h.x, tele.target.z - h.z); audio.play('whoosh'); }
          tele.active = null; tele.target = null; arcLine.visible = ring.visible = false;
        }
      } else if (Math.abs(y) > 0.25 && key === 'left' || (Math.abs(y) > 0.25 && session.inputSources.length === 1)) {
        const d = new THREE.Vector3(); camera.getWorldDirection(d); d.y = 0; d.normalize();
        const sp = -y * 1.4 * dt, h = terminal.head(), nx = h.x + d.x * sp, nz = h.z + d.z * sp;
        if (terminal.walkable(nx, nz) !== null) { terminal.moveBy(d.x * sp, d.z * sp); moving = true; }
      }
    }
  }
  if (state.mode !== 'terminal' && (arcLine.visible || ring.visible)) { arcLine.visible = ring.visible = false; tele.active = null; }
  vigTarget = (moving || terminal.moving) && state.mode === 'terminal' ? 0.85 : 0;
  let hov = -1, pHov = false;
  for (const c of controllers) {
    const hit = pick(rayFrom(c));
    c.userData.line.scale.z = hit ? hit.distance : 1.5;
    c.userData.dot.visible = !!hit; if (hit) c.userData.dot.position.set(0, 0, -hit.distance);
    if (hit && hit.object === menu.mesh) hov = menu.hitIndex(hit.uv);
    if (hit && hit.object === promptP.mesh && promptP.hitButton(hit.uv)) pHov = true;
  }
  menu.setHover(hov); promptP.setHover(pHov);
}
function armsUp() {
  if (!state.inXR) return false;
  const head = terminal.head(); let n = 0;
  for (const c of controllers) { const p = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld); if (p.y > head.y - 0.02) n++; }
  return n >= 2;
}

// ---------- desktop controls ----------
let yaw = 0.35, pitch = -0.05, lean = false;
const el = renderer.domElement;
let drag = null;
const mouse = new THREE.Vector2();
const keys = {};
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
    promptP.setHover(!!(hit && hit.object === promptP.mesh && promptP.hitButton(hit.uv)));
    el.style.cursor = hit ? 'pointer' : 'grab';
  }
});
el.addEventListener('pointerup', (e) => { if (drag && drag.moved < 6) { const hit = mousePick(e); if (hit) activate(hit); } drag = null; });
window.addEventListener('keyup', (e) => { keys[e.key] = false; });
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'n') skipPhase();
  else if (k === 't') setTurbulence((settings.turbulence + 1) % 3);
  else if (k === 'd') setTod((settings.tod + 1) % 3);
  else if (k === 's') { cabin.setShade(!cabin.shadeOpen); menu.draw(); }
  else if (k === 'b') toggleBreathing();
  else if (k === 'l') lean = !lean;
  else if (k === '1') { leaveTerminal(); loadLeg(0); }
  else if (k === '2') { leaveTerminal(); loadLeg(1); }
  else if (k === 'r') { leaveTerminal(); loadLeg(0); startExperience(true); }
  else if (k === 'enter' || k === 'c') { if (state.mode === 'terminal') terminal.button(); }
  else if (k === 'm') { menu.mesh.visible = !menu.mesh.visible; }
  if (k.startsWith('arrow')) e.preventDefault();
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

document.getElementById('startBtn')?.addEventListener('click', () => startExperience(true));
const vrButton = VRButton.createButton(renderer);
vrButton.addEventListener('click', () => audio.init());
document.body.appendChild(vrButton);

// ---------- crew schedule (flight attendant walk-throughs, cart pass) ----------
function crewAt(fl, t) {
  const P = fl.phaseStart, ph = (k) => [P(k), fl.phases.find((p) => p.key === k).end];
  const out = { faOn: false, faZ: -9, faYaw: Math.PI, cartOn: false, cartZ: 0, walk: 0 };
  const walkSeg = (t0, t1, z0, z1) => { if (t >= t0 && t <= t1) { const u = (t - t0) / (t1 - t0); out.faOn = true; out.faZ = lerp(z0, z1, u); out.faYaw = z1 > z0 ? Math.PI : 0; out.walk = t; return true; } return false; };
  const [b0, b1] = ph('board'); const [x0] = ph('taxi'); const [c0, c1] = ph('cruise'); const [d0] = ph('descent');
  if (walkSeg(b0, b1, -9.5, 5.5)) return out;
  if (walkSeg(x0 + 4, x0 + 28, 5.5, -9.5)) return out;
  if (walkSeg(d0 + 15, d0 + 33, -9.5, 5.5)) return out;
  // cart pass during cruise: moves aft a row at a time with pauses, FA behind it facing the passengers
  const cs = c0 + (fl.longCruise ? 40 : 11), ce = Math.min(c1 - 2, cs + (fl.longCruise ? 200 : 32));
  if (t >= cs && t <= ce) {
    const u = (t - cs) / (ce - cs), rows = fl.longCruise ? 18 : 11, z0 = -9.0;
    const k = u * rows, step = Math.floor(k), f = k - step, moveF = smooth(0.65, 1.0, f);
    const z = z0 + (step + moveF) * 0.79;
    out.cartOn = true; out.cartZ = z; out.faOn = true; out.faZ = z - 0.8; out.faYaw = Math.PI; out.walk = moveF > 0 && moveF < 1 ? t : 0;
  }
  return out;
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const st = {};
let infoT = 0, envInfo = { inCloud: 0, above: 0, night: 0 };
const turbOff = { dy: 0, pitch: 0, roll: 0 };
let dimS = 0, snapDim = false;
const tintDay = new THREE.Color(), tintDim = new THREE.Color(0.07, 0.08, 0.14), tintMid = new THREE.Color(0.22, 0.23, 0.33), tint = new THREE.Color();
const dSize = new THREE.Vector2();
function tick() {
  const dt = Math.min(0.1, clock.getDelta());
  clockT += dt;
  if (recenterIn > 0 && --recenterIn === 0) recenter();
  const T = state.mode === 'terminal';
  if (state.inXR) handleXRInput(dt);
  else {
    if (T) {
      eyeCur += (eyeTarget - eyeCur) * Math.min(1, dt * 2.5);
      camera.position.set(0, eyeCur, 0); camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const fw = (keys.ArrowUp || keys.w ? 1 : 0) - (keys.ArrowDown ? 1 : 0), sd = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      if ((fw || sd) && !terminal.moving && state.running) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), sp = 1.4 * dt, h = terminal.head();
        const mx = (fx * fw + -fz * sd) * sp, mz = (fz * fw + fx * sd) * sp;
        if (terminal.walkable(h.x + mx, h.z + mz) !== null) terminal.moveBy(mx, mz);
      }
    } else { camera.position.set(lean ? -0.2 : 0, lean ? EYE_Y - 0.03 : EYE_Y, lean ? -0.05 : 0); camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
  }
  for (let i = laterQ.length - 1; i >= 0; i--) { if (!state.running && state.started) continue; laterQ[i].t -= dt; if (laterQ[i].t <= 0) { const f = laterQ[i].fn; laterQ.splice(i, 1); f(); } }

  vignette.visible = vignette.material.opacity > 0.01 || vigTarget > 0;
  vignette.material.opacity += (vigTarget - vignette.material.opacity) * Math.min(1, dt * 6);
  fader.visible = fader.material.opacity > 0.005 || fadeTarget > 0;
  fader.material.opacity += (fadeTarget - fader.material.opacity) * Math.min(1, dt * (T ? 4 : 2));
  if (!fadeTarget && fader.material.opacity < 0.01) { fader.material.opacity = 0; fader.visible = false; }
  caption.update(clockT, dt);
  breath.update(dt);

  if (T) {
    // ---------- airport ----------
    if (state.running) terminal.update(dt, { armsUp: armsUp() });
    const h = terminal.head(); termHead.copy(h);
    if (state.inXR) { xrEyeOff += (clamp(eyeTarget - camBaseY, 0, 0.8) - xrEyeOff) * Math.min(1, dt * 2); }
    dolly.position.y = terminal.floorAt(h.x, h.z) + (state.inXR ? xrEyeOff : 0);
    // UI follows the head lazily (yaw only)
    const d = new THREE.Vector3(); camera.getWorldDirection(d); const hy = Math.atan2(-d.x, -d.z);
    let dy = hy - uiAnchor.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    if (Math.abs(dy) > 0.45 || terminal.moving) uiAnchor.rotation.y += dy * Math.min(1, dt * 2.2);
    uiAnchor.position.lerp(h, Math.min(1, dt * 6));
    // carried bag at your side
    const cb = terminal.carried; if (cb.parent !== terminal.scene) terminal.scene.add(cb);
    cb.position.set(h.x, terminal.floorAt(h.x, h.z), h.z); cb.rotation.y = uiAnchor.rotation.y;
    if (!state.inXR) vigTarget = terminal.moving ? 0.6 : 0;
    renderer.getDrawingBufferSize(dSize);
    renderer.render(terminal.scene, camera);
    return;
  }

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
  st.floorH = FLOOR_H; st.phaseKey = fl.phases[st.phase].key;

  // turbulence & ground bumps (subtle; scaled by the Turbulence setting)
  const TL = settings.turbulence, tscale = TL === 0 ? 0 : TL === 1 ? 1 : 2;
  const crs = fl.phaseStart('cruise');
  let A = (st.ground ? 0 : 0.18) + envInfo.inCloud * 0.8 + pulse(state.simT, crs + 15, crs + 17, crs + 31, crs + 34);
  A *= tscale;
  const G = st.ground && st.speed > 0.5 ? (0.25 + clamp(st.speed / 70, 0, 1)) * (TL === 0 ? 0 : TL === 1 ? 1 : 1.4) : 0;
  const tt = clockT;
  turbOff.dy = A * 1.4 * wobble(tt * 0.9, 11);
  turbOff.pitch = A * 0.003 * wobble(tt * 0.7, 13);
  turbOff.roll = A * 0.005 * wobble(tt * 0.55, 17);
  cabin.group.position.y = A * 0.005 * wobble(tt * 1.3, 1) + G * 0.0022 * wobble(tt * 9.0, 3);
  cabin.group.rotation.z = A * 0.0012 * wobble(tt * 0.9, 5) + G * 0.0006 * wobble(tt * 7.0, 8);
  cabin.group.rotation.x = A * 0.0008 * wobble(tt * 1.1, 7);
  st.flex = st.ground ? -0.06 + G * 0.012 * wobble(tt * 6, 2) : 0.34 * clamp(st.speed / 90, 0, 1) + A * 0.07 * wobble(tt * 2.1, 4) + 0.02 * wobble(tt * 1.3, 9);

  renderer.getDrawingBufferSize(dSize);
  envInfo = world.update(st, turbOff, { dt, viewH: state.inXR ? 1832 : dSize.y, flash: cabin.flash || 0 });
  // cabin lighting: bright for boarding, dimmed (blue mood light) for takeoff/landing at night, half-dim in cruise
  const n = envInfo.night, key = st.phaseKey;
  let dimT = 0;
  if (n > 0) {
    if (key === 'taxi') dimT = state.simT > fl.phaseStart('taxi') + 21 ? 1 : 0;
    else if (['takeoff', 'liftoff', 'approach', 'landing', 'taxiin'].includes(key)) dimT = 1;
    else if (key === 'climb') dimT = st.alt > 3048 ? 0.6 : 1;
    else if (key === 'cruise') dimT = 0.6;
    else if (key === 'descent') dimT = st.alt < 3048 ? 1 : 0.6;
  }
  dimS += (dimT - dimS) * Math.min(1, dt * 0.6); if (snapDim) { dimS = dimT; snapDim = false; }
  const k = 0.9 + 0.1 * envInfo.above - 0.06 * envInfo.inCloud;
  tintDay.setRGB(k, k * 0.99, k * 0.97);
  tint.copy(tintDay).lerp(dimS > 0.8 ? tintDim : tintMid, n * Math.min(1, dimS / 0.6) * (n >= 1 ? 1 : 0.6));
  if (dimS > 0.6) tint.lerp(tintDim, n * (dimS - 0.6) / 0.4 * (n >= 1 ? 1 : 0.6));
  st.cabinTint = tint; st.night = n; st.dim = dimS; st.reading = n >= 1 ? Math.min(1, dimS * 1.3) : n * dimS;
  cabin.setCrew(crewAt(fl, state.simT));
  cabin.update(dt, st);
  audio.update(st, dt, A, !state.running);

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
world.setTod(settings.tod);
caption.show('crew', 'Welcome. Press Start (or Enter VR) when you are ready. You will begin in the airport, then board the plane. The menu is on your right.', 0);
caption.until = 1e9;
renderer.setAnimationLoop(tick);

// hooks for automated testing / debugging
window.APP = {
  state, settings, LEGS, terminal,
  jumpPhase(key, off = 0) { snapDim = true; if (state.mode === 'terminal') leaveTerminal(); state.mode = 'flight'; jumpTo(state.flight.phaseStart(key) + off); },
  jump(t) { jumpTo(t); },
  setView(y, p) { yaw = y; pitch = p; },
  setLean(v) { lean = v; },
  setLeg(i) { leaveTerminal(); loadLeg(i); },
  setTod, setMove(m) { settings.move = m; },
  start: startExperience, pause() { state.running = false; }, resume() { state.running = true; },
  enterTerminal, finishTerminal,
  termStep(i) { // jump the airport to step i (for screenshots)
    if (state.mode !== 'terminal') enterTerminal();
    for (let k = 0; k < 40 && terminal.stepIdx < i; k++) { terminal.skip(); for (let j = 0; j < 400 && terminal.moving; j++) terminal.update(0.05); }
  },
  termUpdate(sec) { for (let t = 0; t < sec; t += 0.05) terminal.update(0.05); },
  termHit(name) { const t = terminal.targets(); if (t[0]) terminal.hit(t[0]); },
  sample() { return state.flight.sample(state.simT); },
  phases() { return state.flight.phases; },
  skip: skipPhase, setTurbulence, toggleBreathing, setShade: (o) => cabin.setShade(o), finishTrip, startConnection,
  showCaption(w, t) { caption.show(w, t, clockT); },
  renderer, dolly, camera, cabin, menu,
  stats() { const i = renderer.info.render; return { calls: i.calls, tris: i.triangles, pts: i.points }; },
};
