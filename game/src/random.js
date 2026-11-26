// A tiny deterministic random-number source (mulberry32) plus the small
// helpers the world builder and the autopilot share. Every world is built
// from one seed, so the same seed always draws the same valley, and the
// screenshot scenes are reproducible frame for frame.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random float in [min, max). */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** A random integer in [min, max]. */
export function rangeInt(rng, min, max) {
  return Math.floor(range(rng, min, max + 1));
}

/** Pick one element of an array. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/** Clamp a value into [min, max]. */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between a and b. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Wrap an angle in degrees into [-180, 180). */
export function wrapAngleDeg(angle) {
  let a = angle % 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** The smallest signed turn, in degrees, from `from` to `to`. */
export function angleDeltaDeg(from, to) {
  return wrapAngleDeg(to - from);
}

/** Degrees to radians. */
export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/** A smooth 0..1 step between two edges. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
