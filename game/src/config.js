// Meridian Courier — tuning constants for the flight model, the world and the
// presentation. One place holds every number a designer would want to tune,
// so the sim, the renderer and the screenshot scenes all read the same values.
export const CONFIG = {
  // -- The aeroplane -------------------------------------------------------
  plane: {
    // Speeds in metres per second; the HUD shows knots (m/s * 1.944).
    stallSpeed: 28,
    maxSpeed: 95,
    // Target speed at full throttle, and at idle (glide).
    cruiseSpeed: 72,
    idleSpeed: 24,
    // How fast the speed chases its target, per second (up), and how fast
    // drag pulls it back down (a fraction of the same rate).
    accelRate: 4.0,
    // Pitch limits in degrees; positive pitch climbs.
    maxPitchUp: 16,
    maxPitchDown: -14,
    pitchRate: 26,
    // Bank limits in degrees; the turn rate follows from the bank.
    maxBank: 62,
    bankRate: 70,
    // Sink (m/s) added when the wing is not making enough lift.
    stallSink: 9,
    // Fuel: units, and burn per second at idle / full throttle.
    fuel: 100,
    fuelBurnIdle: 0.08,
    fuelBurnFull: 0.26,
    // Landing: vertical speed (m/s) a touchdown may have, and the speed band.
    landingMaxSink: 4.5,
    landingMinSpeed: 24,
    landingMaxSpeed: 62,
    touchdownRoll: 0.35,
  },

  // -- The world -----------------------------------------------------------
  world: {
    // The valley runs north-south (the z axis); the runway sits near the origin.
    runway: {
      x: 0,
      zMin: -620,
      zMax: 620,
      halfWidth: 16,
      headingDeg: 0,
      name: 'MERIDIAN FIELD',
    },
    // River: a meandering ribbon west of the runway.
    river: { baseX: -150, meander: 60, width: 26 },
    // Town: a cluster of small blocks east of the runway's south end.
    town: { x: 150, z: 320, blocks: 26, spread: 170 },
    // Terrain: rolling hills, calmer near the valley floor and the runway.
    hillAmplitude: 90,
    hillScale: 0.0016,
    ridgeAmplitude: 320,
    // Rings: how wide a golden ring is, and how close counts as flying through.
    ringRadius: 20,
    ringHit: 17,
    // Clouds drift slowly and never collide with anything.
    clouds: 26,
    cloudCeiling: 420,
    // How far the renderer draws terrain, in metres.
    viewDistance: 2600,
  },

  // -- Missions ------------------------------------------------------------
  // Each sortie: rings to fly through in order, then land on the runway.
  // Ring positions are world coordinates (x east, z north, y altitude).
  missions: [
    {
      name: 'SORTIE 1 · THE VALLEY RUN',
      brief:
        'Five rings down the valley, then bring her home to Meridian Field. ' +
        'Mind your fuel — the courier does not wait.',
      rings: [
        { x: 30, z: 500, y: 150 },
        { x: -60, z: 1100, y: 190 },
        { x: 90, z: 1700, y: 170 },
        { x: -40, z: 2300, y: 220 },
        { x: 60, z: 2900, y: 200 },
      ],
      timeLimit: 300,
    },
    {
      name: 'SORTIE 2 · THE RIVER BEND',
      brief:
        'Follow the river west, thread the low rings, then a long final ' +
        'over the town. Low and slow wins the style points.',
      rings: [
        { x: -120, z: 600, y: 130 },
        { x: -260, z: 1200, y: 150 },
        { x: -180, z: 1900, y: 120 },
        { x: 40, z: 2500, y: 210 },
        { x: -90, z: 3100, y: 170 },
        { x: 30, z: 3600, y: 190 },
      ],
      timeLimit: 360,
    },
    {
      name: 'SORTIE 3 · THE RIDGE CROSSING',
      brief:
        'Over the ridge, through the high rings, and home before the ' +
        'light goes. The wind is up and the fuel gauge is honest.',
      rings: [
        { x: 120, z: 700, y: 240 },
        { x: 320, z: 1400, y: 280 },
        { x: 180, z: 2100, y: 260 },
        { x: -160, z: 2700, y: 300 },
        { x: -40, z: 3300, y: 240 },
        { x: 90, z: 3900, y: 210 },
        { x: 0, z: 4400, y: 180 },
      ],
      timeLimit: 420,
    },
  ],

  // -- Scoring -------------------------------------------------------------
  score: {
    ring: 100,
    ringStyle: 25,
    landingBase: 300,
    landingSmooth: 200,
    timeBonusPerSecond: 2,
  },

  // -- Presentation --------------------------------------------------------
  view: {
    width: 1280,
    height: 800,
    // Camera focal length in pixels; bigger narrows the view.
    focal: 760,
    // Where the aeroplane sits on screen (fractions of the canvas).
    planeX: 0.5,
    planeY: 0.66,
    // How far ahead the terrain strips reach, in bands.
    terrainBands: 46,
  },
};
