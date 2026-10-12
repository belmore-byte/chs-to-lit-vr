import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRButton } from 'three/addons/webxr/XRButton.js';

const statusEl = document.getElementById('status');
const enterVrBtn = document.getElementById('enter-vr');

let camera, scene, renderer, controls;
let controller1, controller2;
let raycaster = new THREE.Raycaster();
let tempMatrix = new THREE.Matrix4();

let phase = 0;
const phases = [
  "Arrive at Charleston International (CHS) - Terminal",
  "Check-in at kiosk / counter",
  "Proceed through TSA Security",
  "Walk to Gate / Boarding area",
  "Board the aircraft to Charlotte (CLT)",
  "In-flight: Takeoff from CHS",
  "Cruising / Landing at Charlotte (CLT)",
  "Connection: Deplane and transfer to next gate",
  "Board connecting flight to Little Rock (LIT)",
  "In-flight: Takeoff from CLT",
  "Cruising / Landing at Little Rock (LIT)",
  "Arrive at Little Rock National Airport - Welcome!"
];

const phaseMessages = [
  "Welcome to Charleston International Airport. Proceed to check-in.",
  "Check in complete. Boarding pass issued. Head to security.",
  "Security cleared. Proceed to your gate.",
  "At the gate. Boarding has begun. Proceed to the aircraft.",
  "Welcome aboard. Please take your seat. Preparing for departure.",
  "Taking off from Charleston... Climbing to altitude.",
  "Landing at Charlotte Douglas International. Prepare for connection.",
  "You are in the Charlotte terminal. Walk to your connecting gate.",
  "Boarding the flight to Little Rock. Welcome aboard.",
  "Taking off from Charlotte... En route to Little Rock.",
  "Landing at Bill and Hillary Clinton National Airport / Little Rock.",
  "You have arrived in Little Rock, Arkansas. Thank you for flying!"
];

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // sky blue

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.6, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  scene.add(directional);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(100, 100);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Simple airport terminal building
  const terminalGeo = new THREE.BoxGeometry(20, 8, 10);
  const terminalMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  const terminal = new THREE.Mesh(terminalGeo, terminalMat);
  terminal.position.set(0, 4, -15);
  scene.add(terminal);

  // Windows
  for (let i = -6; i <= 6; i += 3) {
    const winGeo = new THREE.PlaneGeometry(2, 2);
    const winMat = new THREE.MeshBasicMaterial({ color: 0x88ccff });
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(i, 5, -10.1);
    scene.add(win);
  }

  // Check-in counter
  const counterGeo = new THREE.BoxGeometry(8, 1.2, 1);
  const counterMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const counter = new THREE.Mesh(counterGeo, counterMat);
  counter.position.set(0, 0.6, -8);
  scene.add(counter);

  // Add some signs / text proxies
function addSign(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 24px Arial';
  ctx.fillText(text, 10, 40);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const geo = new THREE.PlaneGeometry(4, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

// Call after scene setup
addSign("CHS CHECK-IN", 0, 2.5, -8.5);
addSign("SECURITY", -8, 2, -12);
addSign("GATE A12", 6, 2.5, -12);

  // Simple airplane on the tarmac
  createSimplePlane(scene, 0, 1, -25);

  // Controllers for VR
  controller1 = renderer.xr.getController(0);
  controller1.addEventListener('selectstart', onSelect);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener('selectstart', onSelect);
  scene.add(controller2);

  // Pointer for non-VR
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1.6, 0);

  // XR Button
  const xrBtn = XRButton.createButton(renderer);
  document.body.appendChild(xrBtn);
  enterVrBtn.style.display = 'none'; // hide custom if XRButton works

  window.addEventListener('resize', onWindowResize);
  renderer.setAnimationLoop(animate);

  updateStatus();
  statusEl.textContent = phases[phase] + " - " + phaseMessages[phase];
}

function createSimplePlane(scene, x, y, z) {
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 8, 16),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  fuselage.rotation.z = Math.PI / 2;
  fuselage.position.set(x, y, z);
  scene.add(fuselage);

  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.2, 1.5),
    new THREE.MeshLambertMaterial({ color: 0xdddddd })
  );
  wing.position.set(x, y, z);
  scene.add(wing);

  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 1.5, 1),
    new THREE.MeshLambertMaterial({ color: 0xeeeeee })
  );
  tail.position.set(x + 3.5, y + 0.5, z);
  scene.add(tail);
}

function onSelect(event) {
  // Progress to next phase on trigger
  if (phase < phases.length - 1) {
    phase++;
    updatePhaseVisuals();
    updateStatus();
  }
}

function updatePhaseVisuals() {
  // Reset positions and change visuals based on phase
  camera.position.set(0, 1.6, 5);
  scene.background = new THREE.Color(0x87ceeb);

  if (phase === 0) {
    // Arrival - terminal
    statusEl.textContent = phases[phase] + " - " + phaseMessages[phase];
  } else if (phase === 1) {
    // Check-in - move closer to counter
    camera.position.set(0, 1.6, -5);
  } else if (phase === 2) {
    // Security
    scene.background = new THREE.Color(0xaaaaaa);
  } else if (phase === 3) {
    // Gate area
    camera.position.set(5, 1.6, -10);
  } else if (phase === 4 || phase === 8) {
    // Boarding / plane interior feel
    scene.background = new THREE.Color(0x222244);
    camera.position.set(0, 1.6, 0);
  } else if (phase === 5 || phase === 9) {
    // Takeoff
    scene.background = new THREE.Color(0x6699cc);
    camera.position.y = 3;
  } else if (phase === 6 || phase === 10) {
    // Landing
    scene.background = new THREE.Color(0x87ceeb);
    camera.position.y = 1.6;
  } else if (phase >= 11) {
    scene.background = new THREE.Color(0xffeeaa);
    camera.position.set(0, 1.6, 8);
  }
  updateStatus();
}

function updateStatus() {
  statusEl.textContent = `Phase ${phase + 1}/${phases.length}: ${phases[phase]}\n${phaseMessages[phase]}\n(Trigger/controller button or click to progress)`;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
}

// Keyboard for desktop testing
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    onSelect();
  }
});

// Click to progress in non-VR
document.addEventListener('click', (e) => {
  if (!renderer.xr.isPresenting) {
    onSelect();
  }
});

init();
