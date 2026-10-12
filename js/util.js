// Small shared helpers
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ss = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export const smooth = (e0, e1, x) => ss((x - e0) / (e1 - e0));
// 0 -> 1 -> 0 envelope: ramps up between a..b, holds, ramps down c..d
export const pulse = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));
export const D2R = Math.PI / 180;
export function unwrap(a, ref) {
  while (a - ref > Math.PI) a -= 2 * Math.PI;
  while (a - ref < -Math.PI) a += 2 * Math.PI;
  return a;
}
// smooth pseudo-random noise in [-1,1] built from sines (cheap, deterministic)
export function wobble(t, s) {
  return Math.sin(t * 1.31 + s) * 0.45 + Math.sin(t * 2.71 + s * 1.7) * 0.3 + Math.sin(t * 5.13 + s * 2.3) * 0.25;
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
