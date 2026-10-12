// Flight model: precomputes a deterministic trajectory for one leg (time -> pose, engine, gear...)
import * as THREE from 'three';
import { ss, smooth, pulse, lerp, clamp, D2R, unwrap } from './util.js';

export const LEGS = [
  { code: 'CHS-CLT', from: 'CHS', to: 'CLT', fromCity: 'Charleston', toCity: 'Charlotte', realMin: 55,
    cruiseFt: 24000, turn1: 35, turn2: -30, greeting: 'morning', tod: 0 },
  { code: 'CLT-LIT', from: 'CLT', to: 'LIT', fromCity: 'Charlotte', toCity: 'Little Rock', realMin: 110,
    cruiseFt: 32000, turn1: -30, turn2: 25, greeting: 'afternoon', tod: 1 },
];

// Airport layout (local frame, runway runs north = -Z, threshold at z=0, terminal to the west)
const V = (x, z) => new THREE.Vector3(x, 0, z);
export const GATE_DEP = { x: -220, z: -60 };
export const GATE_ARR = { x: -220, z: -1700 };
export const TAXI_OUT_PTS = [V(-180, -100), V(-180, -30), V(-180, 40), V(-170, 76), V(-135, 90), V(-60, 90), V(-22, 84), V(-4, 60), V(0, 32), V(0, 20)];
export const TAXI_IN_PTS = [V(0, -1480), V(0, -1525), V(-16, -1578), V(-62, -1630), V(-128, -1670), V(-180, -1694), V(-220, -1700)];
export const TOUCHDOWN_Z = -400;
export const EXIT_Z = -1480;

export const CLOUD_BASE = 900, CLOUD_TOP = 1700;

const F = { t: 0, x: 1, alt: 2, z: 3, yaw: 4, pitch: 5, roll: 6, speed: 7, n1: 8, gear: 9, flaps: 10, spoil: 11, rev: 12, ground: 13, frame: 14, phase: 15 };

function trapPos(x, a) { // normalized distance for trapezoid speed profile
  const v = 1 / (1 - a);
  if (x < a) return 0.5 * v * x * x / a;
  if (x < 1 - a) return 0.5 * v * a + v * (x - a);
  return 1 - 0.5 * v * (1 - x) * (1 - x) / a;
}
// flap lever moves in detents; each transition takes ~3 s (like the real thing)
function stages(tau, list, from) { let v = from; for (const [t0, val] of list) { v = lerp(v, val, smooth(t0, t0 + 3, tau)); } return v; }
function trapVel(x, a) { const v = 1 / (1 - a); return x < a ? v * x / a : x < 1 - a ? v : v * (1 - x) / a; }

export function buildFlight(leg, { longCruise = false } = {}) {
  const dt = 0.1;
  const rows = [];
  const phases = [];
  const s = { x: GATE_DEP.x, z: GATE_DEP.z, alt: 0, yaw: Math.PI / 2, pitch: 0, roll: 0, speed: 0, n1: 0, gear: 1, flaps: 0, spoil: 0, rev: 0, ground: 1, frame: 0 };
  let t = 0;
  const rec = () => rows.push([t, s.x, s.alt, s.z, s.yaw, s.pitch, s.roll, s.speed, s.n1, s.gear, s.flaps, s.spoil, s.rev, s.ground, s.frame, phases.length - 1]);
  const phase = (key, name) => { if (phases.length) phases[phases.length - 1].end = t; phases.push({ key, name, start: t }); };
  const run = (dur, fn) => { const n = Math.round(dur / dt); for (let i = 0; i < n; i++) { fn(i * dt, i / n); rec(); t += dt; } };
  const runUntil = (cond, fn, max) => { let tau = 0; while (!cond() && tau < max) { fn(tau); rec(); t += dt; tau += dt; } };
  const move = () => { s.x += -Math.sin(s.yaw) * s.speed * dt; s.z += -Math.cos(s.yaw) * s.speed * dt; };

  // 1. Boarding at the gate
  phase('board', 'Boarding');
  run(15, () => {});

  // 2. Pushback: quarter-circle backwards, nose swings from west to south
  phase('push', 'Pushback');
  const C = { x: -220, z: -100 }, R = 40, TP = 16;
  run(TP, (tau, x) => {
    const u = ss(x), a = (1 - u) * Math.PI / 2;
    s.x = C.x + R * Math.cos(a); s.z = C.z + R * Math.sin(a);
    s.yaw = Math.PI / 2 + u * Math.PI / 2;
    s.speed = R * (Math.PI / 2) * 6 * x * (1 - x) / TP;
    s.n1 = 22 * smooth(4, 13, tau);
  });

  // 3. Taxi to the runway
  phase('taxi', 'Taxi');
  const taxiOut = new THREE.CatmullRomCurve3(TAXI_OUT_PTS, false, 'centripetal');
  const L1 = taxiOut.getLength(), T1 = 38;
  run(T1, (tau, x) => {
    const f = trapPos(x, 0.16);
    const p = taxiOut.getPointAt(Math.min(1, f)), tg = taxiOut.getTangentAt(Math.min(1, f));
    s.x = p.x; s.z = p.z;
    s.yaw = unwrap(Math.atan2(-tg.x, -tg.z), s.yaw);
    s.speed = L1 / T1 * trapVel(x, 0.16);
    s.n1 = 22 + 7 * pulse(tau, 0, 1.5, 3, 6);
    s.flaps = stages(tau, [[10, 0.35]], 0);
  });

  // 4. Takeoff roll
  phase('takeoff', 'Takeoff roll');
  s.speed = 0;
  runUntil(() => s.speed >= 74, (tau) => {
    s.n1 = tau < 3 ? 22 : tau < 6 ? lerp(22, 48, smooth(3, 6, tau)) : lerp(48, 93, smooth(6, 10, tau));
    const acc = 2.9 * smooth(5, 10, tau) * (1 - 0.18 * clamp(s.speed / 80, 0, 1));
    s.speed += acc * dt; move();
  }, 80);

  // 5. Rotation & initial climb
  phase('liftoff', 'Liftoff & initial climb');
  let vs = 0;
  run(25, (tau) => {
    s.pitch = D2R * (Math.min(13, 13 * ss(tau / 4.6)) - 2 * smooth(12, 25, tau));
    if (s.pitch > 7 * D2R) vs = Math.min(14, vs + 4.0 * dt);
    s.alt += vs * dt; s.ground = s.alt < 0.05 ? 1 : 0;
    s.speed = Math.min(92, s.speed + (tau < 3 ? 2.2 : 1.0) * dt);
    s.n1 = lerp(93, 86, smooth(17, 21, tau));
    s.gear = 1 - smooth(7, 15, tau);
    move();
  });

  // 6. Climb (through the cloud layer) with a gentle banked turn
  phase('climb', 'Climb');
  const A0 = s.alt, CR = leg.cruiseFt / 3.28084, TC = leg.cruiseFt > 28000 ? 66 : 60, turn1 = leg.turn1 * D2R;
  run(TC, (tau, x) => {
    s.alt = A0 + 13 * TC * x * (1 - x) * (1 - x) + (CR - A0) * ss(x);
    s.speed = 92 + 140 * ss(x);
    s.pitch = D2R * (11 - 7.5 * ss(x));
    s.flaps = stages(tau, [[4, 0.15], [13, 0]], 0.35);
    const p1 = pulse(tau, 3, 7.5, 15, 19.5), p2 = pulse(tau, 30, 34.5, 42, 46.5);
    s.roll = Math.sign(turn1) * D2R * (20 * p1 + 17 * p2);
    s.yaw += (turn1 * 0.55 / 11.5 * p1 + turn1 * 0.45 / 11.5 * p2) * dt;
    s.n1 = lerp(86, 82, x);
    move();
  });

  // 7. Cruise
  phase('cruise', 'Cruise');
  const TCr = longCruise ? 300 : 45;
  run(TCr, (tau) => {
    s.speed = 230; s.roll = 0;
    s.pitch = D2R * lerp(3, 2.5, smooth(0, 5, tau));
    s.n1 = lerp(82, 76, smooth(0, 6, tau));
    if (tau > TCr * 0.5) s.frame = 1;
    move();
  });

  // 8. Descent (back through the clouds), speed brakes, gear down
  phase('descent', 'Descent');
  const D0 = s.alt, TD = 52, turn2 = leg.turn2 * D2R;
  run(TD, (tau, x) => {
    s.alt = D0 + (200 - D0) * ss(x) + 4.5 * TD * x * x * (1 - x);
    s.speed = 230 - 158 * ss(x);
    s.pitch = D2R * (tau < 34 ? lerp(2.5, -0.5, smooth(0, 8, tau)) : lerp(-0.5, 2.5, smooth(36, 50, tau)));
    s.spoil = 0.35 * pulse(tau, 5, 8, 18, 22);
    s.flaps = stages(tau, [[27, 0.15], [35, 0.35], [44, 0.6]], 0);
    s.gear = smooth(41, 47, tau);
    s.n1 = tau < 38 ? lerp(76, 32, smooth(0, 6, tau)) : lerp(32, 55, smooth(38, 48, tau));
    const p = pulse(tau, 12, 16, 30, 34);
    s.roll = Math.sign(turn2) * 18 * D2R * p;
    s.yaw += turn2 / 18 * p * dt;
    move();
  });

  // 9. Final approach + flare
  phase('approach', 'Final approach');
  runUntil(() => s.alt <= 0, (tau) => {
    s.speed = lerp(72, 69, smooth(0, 30, tau));
    s.flaps = stages(tau, [[1, 1.0]], 0.6); s.gear = 1; s.roll = 0;
    if (s.alt > 14) { vs = -4.5; s.pitch = 2.5 * D2R; s.n1 = 55; }
    else { vs = -Math.max(0.9, 0.32 * s.alt); s.pitch = D2R * lerp(4.6, 2.5, s.alt / 14); s.n1 = lerp(30, 55, s.alt / 14); }
    s.alt = Math.max(0, s.alt + vs * dt); move();
  }, 150);
  s.alt = 0; s.ground = 1;
  const yawF = s.yaw;
  // Destination airport frame: touchdown point corresponds to local (0, TOUCHDOWN_Z)
  const frameB = { x: s.x + (-TOUCHDOWN_Z) * Math.sin(yawF) * 1, z: s.z + (-TOUCHDOWN_Z) * Math.cos(yawF), yaw: yawF };
  // (Ry(yaw)*(0,-400) = (-400 sin, -400 cos)  => T = P - that)
  frameB.x = s.x + 400 * Math.sin(yawF) * (-TOUCHDOWN_Z / 400);
  frameB.z = s.z + 400 * Math.cos(yawF) * (-TOUCHDOWN_Z / 400);
  const toWorld = (lx, lz) => ({
    x: lx * Math.cos(yawF) + lz * Math.sin(yawF) + frameB.x,
    z: -lx * Math.sin(yawF) + lz * Math.cos(yawF) + frameB.z,
  });

  // 10. Touchdown & rollout: choose braking so we slow to taxi speed right at the exit
  phase('landing', 'Touchdown & rollout');
  const v0 = s.speed, rollDist = TOUCHDOWN_Z - EXIT_Z;
  const simRoll = (dec) => { let v = v0, d = 0, tau = 0; while (v > 14 && tau < 90) { v = Math.max(14, v - dec * smooth(0.5, 2.5, tau) * dt); d += v * dt; tau += dt; } return d; };
  let lo = 0.5, hi = 6;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (simRoll(mid) > rollDist) lo = mid; else hi = mid; }
  const decel = (lo + hi) / 2;
  runUntil(() => s.speed <= 14.0001, (tau) => {
    s.pitch = D2R * 4.6 * (1 - smooth(0.5, 4, tau));
    s.spoil = smooth(0.3, 1.2, tau);
    s.rev = pulse(tau, 1.5, 3, 11, 14);
    s.n1 = 30 + 45 * s.rev;
    s.speed = Math.max(14, s.speed - decel * smooth(0.5, 2.5, tau) * dt);
    move();
  }, 90);

  // 11. Taxi to the gate
  phase('taxiin', 'Taxi to gate');
  const inPts = TAXI_IN_PTS.map((p) => { const w = toWorld(p.x, p.z); return V(w.x, w.z); });
  inPts[0] = V(s.x, s.z);
  const taxiIn = new THREE.CatmullRomCurve3(inPts, false, 'centripetal');
  const L2 = taxiIn.getLength();
  let d = 0, v = s.speed;
  runUntil(() => L2 - d < 0.05, (tau) => {
    const rem = L2 - d;
    const vt = Math.min(9, Math.sqrt(2 * 0.6 * Math.max(0, rem)));
    v += clamp(vt - v, -1.2 * dt, 0.6 * dt); v = Math.max(v, 0.15);
    d = Math.min(L2, d + v * dt);
    const u = d / L2, p = taxiIn.getPointAt(u), tg = taxiIn.getTangentAt(u);
    s.x = p.x; s.z = p.z; s.speed = v; s.pitch = 0;
    s.yaw = unwrap(Math.atan2(-tg.x, -tg.z), s.yaw);
    s.spoil = 1 - smooth(2, 5, tau); s.rev = 0;
    s.flaps = stages(tau, [[4, 0]], 1);
    s.n1 = 24;
  }, 120);

  // 12. At the gate, engines spool down
  phase('gate', 'Arrived at gate');
  run(10, (tau) => { s.speed = 0; s.n1 = 24 * (1 - smooth(2, 8, tau)); });
  phases[phases.length - 1].end = t;

  const duration = t - dt;
  const phaseStart = (key) => phases.find((p) => p.key === key).start;
  // when do we cross the cloud layer (for captions + whiteout)
  const firstTime = (from, pred) => { for (const r of rows) if (r[0] >= from && pred(r)) return r[0]; return null; };
  const cloudIn = firstTime(phaseStart('liftoff'), (r) => r[F.alt] >= CLOUD_BASE);
  const cloudOut = firstTime(phaseStart('liftoff'), (r) => r[F.alt] >= CLOUD_TOP);
  const cloudIn2 = firstTime(phaseStart('descent'), (r) => r[F.alt] <= CLOUD_TOP);
  const ft10k = firstTime(phaseStart('liftoff'), (r) => r[F.alt] >= 3048);

  function sample(time, out = {}) {
    const f = clamp(time / dt, 0, rows.length - 1.0001);
    const i = Math.floor(f), k = f - i;
    const a = rows[i], b = rows[Math.min(rows.length - 1, i + 1)];
    out.t = time;
    out.x = lerp(a[1], b[1], k); out.alt = lerp(a[2], b[2], k); out.z = lerp(a[3], b[3], k);
    out.yaw = lerp(a[4], b[4], k); out.pitch = lerp(a[5], b[5], k); out.roll = lerp(a[6], b[6], k);
    out.speed = lerp(a[7], b[7], k); out.n1 = lerp(a[8], b[8], k); out.gear = lerp(a[9], b[9], k);
    out.flaps = lerp(a[10], b[10], k); out.spoil = lerp(a[11], b[11], k); out.rev = lerp(a[12], b[12], k);
    out.ground = a[13]; out.frame = a[14]; out.phase = a[15];
    return out;
  }

  return { leg, dt, rows, phases, duration, frameB, sample, phaseStart, cloudIn, cloudOut, cloudIn2, ft10k, longCruise };
}

// Scripted announcements, tips and sounds for a leg. t is absolute leg time.
export function buildEvents(fl, opts) {
  const leg = fl.leg, P = fl.phaseStart, ev = [];
  const add = (t, e) => { if (t != null) ev.push({ t, ...e }); };
  const cap = (t, who, text, extra = {}) => add(t, { who, text, ...extra });
  const to = leg.toCity, night = opts.tod === 2, greet = opts.tod >= 1 ? 'evening' : leg.greeting;
  const b = P('board'), pu = P('push'), tx = P('taxi'), to0 = P('takeoff'), lo = P('liftoff'), cl = P('climb'), cr = P('cruise'),
    de = P('descent'), ap = P('approach'), la = P('landing'), ti = P('taxiin'), ga = P('gate');

  cap(b + 0.5, 'crew', `Welcome aboard. Please stow your carry-on items and take your seat. We'll be on our way to ${to} shortly.`);
  add(b + 6, { snd: 'door' });
  cap(b + 6.5, 'crew', 'Boarding is complete and the cabin door is closed. Flight attendants, arm doors and cross-check.');
  add(b + 11.5, { snd: 'ding', sign: true });
  cap(b + 12, 'tip', 'The seatbelt sign just came on with a chime. Chimes are routine signals for the crew - you will hear several.');

  cap(pu + 1, 'captain', `Good ${greet}, folks, this is your captain. Flight time to ${to} is about ${leg.realMin} minutes, and we're expecting a smooth ride. Sit back and relax.`);
  cap(pu + 9, 'tip', 'That rising whine is the engines starting up. Completely normal.');

  cap(tx + 2, 'crew', 'Flight attendants, prepare for departure.');
  add(tx + 11, { snd: 'flaps' });
  cap(tx + 9, 'crew', 'Please make sure your seatbelt is fastened low and tight, your seat back is upright and your tray table is stowed. Take a moment to locate your nearest exit.');
  if (night) cap(tx + 19, 'crew', "We'll be dimming the cabin lights for departure. If you'd like to read, your reading light is in the panel above you.");
  add(tx + 21.5, { snd: 'ding' });
  cap(tx + 27.5, 'tip', 'Feel the small bumps? That is just the wheels rolling over joints in the pavement.');
  cap(tx + 32, 'captain', 'Flight attendants, please be seated for departure.');

  cap(to0 + 1, 'tip', 'Lined up on the runway. Try a slow breath out as the engines spool up.');
  cap(to0 + 13, 'tip', 'The rumble and the gentle push into your seat are the plane accelerating - exactly what is supposed to happen.');

  cap(lo + 1.5, 'tip', "The nose is lifting - we're airborne. Notice the ground gently falling away below the wing.");
  add(lo + 7, { snd: 'gearUp' });
  cap(lo + 9, 'tip', 'That thunk and whir was the landing gear folding up into the plane. Normal.');
  cap(lo + 18, 'tip', 'The engines just got a little quieter. That is the planned power reduction for the climb.');

  add(cl + 4, { snd: 'flaps' });
  add(cl + 13, { snd: 'flaps' });
  cap(cl + 13.5, 'tip', 'The wing panels sliding back in are the flaps retracting in stages as we speed up.');
  if (fl.cloudIn) cap(fl.cloudIn - 2, 'tip', 'Climbing into the clouds. The view turns white for a little while and it may feel slightly bumpy - clouds are just water vapor.');
  cap(cl + 5, 'tip', 'We are making a gentle banked turn. The tilted horizon outside is a normal, comfortable turn - the cabin stays steady.');
  if (night) cap(cl + 47, 'tip', 'Look for the clusters of city lights below. Every one of them is a town carrying on as usual.');
  if (fl.ft10k) add(fl.ft10k, { snd: 'ding' });

  cap(cr + 2, 'captain', `Ladies and gentlemen, we've reached our cruising altitude of ${leg.cruiseFt.toLocaleString('en-US')} feet. It's nice and smooth up here - enjoy the view.`, { snd: 'bingbong' });
  const turb = opts.turbulence > 0;
  if (!turb) add(cr + 9, { snd: 'ding', sign: false });
  else {
    add(cr + 9, { snd: 'ding', sign: false });
    add(cr + 14, { snd: 'ding', sign: true });
    cap(cr + 14.5, 'captain', "We're expecting a little light chop for the next few minutes. Please return to your seats and keep your seatbelts fastened.");
    cap(cr + 24, 'tip', 'Bumps can feel big, but airliners are built to handle far more than this. Let your body move with the seat and breathe out slowly.');
    cap(cr + 35, 'captain', "That's the worst of the bumps behind us. Thanks for your patience.");
  }
  if (fl.longCruise) {
    cap(cr + 60, 'crew', "We'll be coming through the cabin shortly with drinks and snacks.");
    cap(cr + 110, 'tip', 'Notice how steady cruise feels. Look down at the fields and clouds sliding slowly by.');
    cap(cr + 180, 'captain', `Just an update from the flight deck: we're on time and the weather in ${to} looks good.`);
    cap(cr + 250, 'tip', 'Try the breathing guide from the menu: in for 4 seconds, out for 6.');
  }

  cap(de + 1, 'captain', `We've started our descent into ${to}. We'll have you on the ground in about twenty minutes. Weather there is fair.`, { snd: 'bingbong' });
  cap(de + 7, 'tip', 'Panels lifting on top of the wing are speed brakes. They help us descend and are completely normal.');
  add(de + 14, { snd: 'ding', sign: true });
  cap(de + 14.5, 'crew', 'Flight attendants, please prepare the cabin for landing.');
  if (fl.cloudIn2) cap(fl.cloudIn2 - 1, 'tip', 'Descending through the clouds again. A few bumps here are normal.');
  add(de + 30, { snd: 'flaps' });
  add(de + 41, { snd: 'gearDown' });
  cap(de + 43, 'tip', 'That rumble and thump is the landing gear coming down - a good sound to hear.');

  cap(ap + 2, 'crew', night ? 'We have dimmed the cabin lights for landing. Flight attendants, please take your seats.' : 'Flight attendants, please take your seats for landing.');
  cap(ap + 18, 'tip', 'Final approach. Breathe in for four... and out for six...');
  add(la, { snd: 'touchdown' });
  cap(la + 3, 'tip', "That roar is reverse thrust helping us slow down. We're on the ground - well done.");
  cap(la + 14, 'crew', `Welcome to ${to}. Please remain seated with your seatbelt fastened until the captain turns off the seatbelt sign.`);
  cap(ti + 12, 'tip', 'Taxiing to the gate. Notice how ordinary all of this has been.');
  add(ga + 1, { snd: 'ding', sign: false });
  cap(ga + 1.5, 'crew', leg.to === 'CLT'
    ? "We've arrived at the gate in Charlotte. If you're connecting to Little Rock, your next flight is a short walk away. Thank you for flying with us."
    : "We've arrived at the gate in Little Rock. Welcome to Arkansas, and thank you for flying with us!");
  ev.sort((a, b) => a.t - b.t);
  return ev;
}
