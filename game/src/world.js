// The valley the game flies in: its terrain height, its river, its town,
// its runway and the clouds above it. Everything is a pure function of
// world coordinates and one seed, so the terrain the renderer draws, the
// terrain the flight model can crash into and the screenshot scenes all
// agree, and the same seed always builds the same valley.
import { CONFIG } from './config.js';
import { clamp, mulberry32, range, rangeInt } from './random.js';

// -- Value noise -----------------------------------------------------------
// A small deterministic 2D value-noise field: a grid of hashed heights,
// smoothly interpolated, layered into two octaves for rolling hills.

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise2(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Rolling hill height, 0..1, before the valley shaping is applied. */
function hills(x, z, seed) {
  const n1 = noise2(x * CONFIG.world.hillScale, z * CONFIG.world.hillScale, seed);
  const n2 = noise2(x * CONFIG.world.hillScale * 3.1 + 40, z * CONFIG.world.hillScale * 3.1 + 17, seed + 7);
  return n1 * 0.72 + n2 * 0.28;
}

// -- The world ---------------------------------------------------------------

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.runway = { ...CONFIG.world.runway };
    this.river = { ...CONFIG.world.river };
    this.clouds = this.buildClouds();
    this.town = this.buildTown();
    this.fields = this.buildFields();
    this.ridges = this.buildRidges();
  }

  // -- Terrain ------------------------------------------------------------

  /** Height of the ground at world (x, z), in metres. */
  groundHeight(x, z) {
    const w = CONFIG.world;
    // Distance from the valley centreline (the runway's axis).
    const valley = Math.abs(x - this.runway.x);
    // The valley floor is flat near the runway; hills rise away from it.
    const rise = clamp((valley - 90) / 700, 0, 1);
    const hill = hills(x, z, this.seed) * w.hillAmplitude * (0.25 + 0.75 * rise);
    // A long ridge line far to the east and west frames the valley.
    const ridge = Math.max(0, (valley - 1400) / 900) * w.ridgeAmplitude * (0.4 + 0.6 * hills(x * 0.5, z * 0.5, this.seed + 31));
    // The runway strip itself is graded flat.
    const onRunway =
      Math.abs(x - this.runway.x) < this.runway.halfWidth + 26 &&
      z > this.runway.zMin - 60 &&
      z < this.runway.zMax + 60;
    if (onRunway) return 0;
    // The river carves a shallow channel.
    const riverX = this.riverXAt(z);
    const riverDip = Math.max(0, 1 - Math.abs(x - riverX) / (this.river.width * 1.6)) * 6;
    return Math.max(0, hill + ridge - riverDip);
  }

  /** The river's centreline x at a given z (it meanders down the valley). */
  riverXAt(z) {
    const r = this.river;
    return r.baseX + Math.sin(z * 0.0011) * r.meander + Math.sin(z * 0.00037 + 2.1) * r.meander * 0.5;
  }

  /** Whether a world point is water (the river's ribbon). */
  isWater(x, z) {
    return Math.abs(x - this.riverXAt(z)) < this.river.width / 2;
  }

  /** Whether a world point is on the runway strip. */
  isRunway(x, z) {
    const r = this.runway;
    return Math.abs(x - r.x) < r.halfWidth && z >= r.zMin && z <= r.zMax;
  }

  /** The colour the ground shows at (x, z): fields, meadow, rock or water. */
  groundColor(x, z) {
    if (this.isWater(x, z)) return '#3f7fb8';
    const h = this.groundHeight(x, z);
    if (h > 150) return '#8a7a63';
    if (h > 80) return '#7d8f57';
    // Patchwork fields: a coarse grid, each cell coloured by its hash.
    const cell = Math.floor(x / 260) + Math.floor(z / 260) * 7;
    const tone = hash2(cell, 3, this.seed);
    if (tone < 0.22) return '#b9a44e';
    if (tone < 0.45) return '#7fae4e';
    if (tone < 0.62) return '#5d9b4a';
    if (tone < 0.8) return '#a8b45a';
    return '#6fa055';
  }

  // -- Dressing ------------------------------------------------------------

  buildClouds() {
    const clouds = [];
    for (let i = 0; i < CONFIG.world.clouds; i += 1) {
      clouds.push({
        x: range(this.rng, -1800, 1800),
        z: range(this.rng, -800, 5200),
        y: range(this.rng, 300, CONFIG.world.cloudCeiling),
        scale: range(this.rng, 60, 170),
        speed: range(this.rng, 1.5, 4),
        puffs: rangeInt(this.rng, 3, 5),
      });
    }
    return clouds;
  }

  buildTown() {
    const t = CONFIG.world.town;
    const blocks = [];
    for (let i = 0; i < t.blocks; i += 1) {
      blocks.push({
        x: t.x + range(this.rng, -t.spread, t.spread),
        z: t.z + range(this.rng, -t.spread, t.spread),
        w: range(this.rng, 14, 34),
        d: range(this.rng, 14, 30),
        h: range(this.rng, 8, 26),
        roof: this.rng() < 0.5 ? '#b4503c' : '#5d6b7a',
        wall: this.rng() < 0.5 ? '#e8dcc0' : '#cfc4a8',
      });
    }
    return blocks;
  }

  buildFields() {
    // A few big crop fields with a distinct colour, drawn as flat quads.
    const fields = [];
    const spots = [
      { x: 320, z: 900, w: 420, d: 300, color: '#c2a44a' },
      { x: -420, z: 1500, w: 380, d: 260, color: '#8fbf52' },
      { x: 420, z: 2100, w: 460, d: 320, color: '#d8b45e' },
      { x: -380, z: 2600, w: 400, d: 280, color: '#6fae4e' },
      { x: 360, z: 3200, w: 420, d: 300, color: '#b3923f' },
      { x: -300, z: 4200, w: 380, d: 260, color: '#93c25a' },
    ];
    for (const s of spots) fields.push(s);
    return fields;
  }

  buildRidges() {
    // Two distant ridge lines, drawn as silhouettes behind the terrain.
    const ridges = [];
    for (let layer = 0; layer < 2; layer += 1) {
      const peaks = [];
      const rng = mulberry32(this.seed + 100 + layer * 17);
      for (let i = 0; i <= 24; i += 1) {
        peaks.push(range(rng, 0.12, 1));
      }
      ridges.push({
        peaks,
        base: layer === 0 ? 0.30 : 0.42,
        height: layer === 0 ? 0.16 : 0.10,
        color: layer === 0 ? '#7d92b5' : '#9db0cc',
        parallax: layer === 0 ? 0.25 : 0.12,
      });
    }
    return ridges;
  }

  // -- Missions ------------------------------------------------------------

  /** The rings of a mission, as world points with a running number. */
  ringsFor(missionIndex) {
    const mission = CONFIG.missions[missionIndex % CONFIG.missions.length];
    return mission.rings.map((r, i) => ({ ...r, index: i }));
  }
}
