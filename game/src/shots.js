// The autopilot and the screenshot scenes. The autopilot flies the real
// flight model toward a target — a ring, or the runway — the same way a
// player would, only steadier. The screenshot scenes run it forward from a
// fresh world for a fixed number of steps, so each `?shot=` frame is what a
// real sortie looks like at that moment, and the same seed always gives the
// same frame.
import { CONFIG } from './config.js';
import { angleDeltaDeg, clamp } from './random.js';
import { freshControls, freshPlane, stepPlane } from './flight.js';
import { World } from './world.js';

const STEP = 1 / 60;

/**
 * The autopilot's stick for one step: bank toward the aim point's bearing,
 * pitch toward its altitude, throttle to hold the right speed. `aim` is the
 * point to steer at — usually the target, or a point before it on the
 * approach line, so the aeroplane lines up and flies straight through.
 * `landing` true flies a gentle final.
 */
export function autopilotControls(plane, aim, landing) {
  const dx = aim.x - plane.x;
  const dz = aim.z - plane.z;
  const dy = aim.y - plane.y;
  const dist = Math.hypot(dx, dz);
  const desiredHeading = (Math.atan2(dx, dz) * 180) / Math.PI;
  const headingErr = angleDeltaDeg(plane.heading, desiredHeading);
  // Bank toward the target, gentler when close to a ring, so the aeroplane
  // does not orbit a point it overshot: a tight turn at cruise speed is
  // 200 m wide. On final approach the full bank stays, for alignment.
  const bankScale = dist < 250 && !landing ? 0.55 : 1;
  const roll = clamp((headingErr / 25) * bankScale, -1, 1);
  let pitch = clamp(dy / 40, -0.9, 1);
  // Never dive at the ground: keep the nose up when low and slow — except
  // on final approach, where the glide slope is the descent.
  if (!landing && plane.y < 60 && plane.speed < 40) pitch = Math.max(pitch, 0.15);
  let throttle = 0.78;
  if (landing) {
    // A 3-degree glide slope to the aim point, and no descent below 55 m
    // until the aeroplane is lined up with the runway, heading south.
    const wantSpeed = 34;
    throttle = clamp(0.35 + (wantSpeed - plane.speed) * 0.06, 0.15, 0.9);
    const glideAlt = aim.y + dist * 0.055;
    const southErr = Math.abs(((plane.heading - 180 + 540) % 360) - 180);
    const aligned = Math.abs(plane.x) < 28 && southErr < 25;
    const wantAlt = !aligned && plane.y < 55 ? Math.max(glideAlt, 55) : glideAlt;
    pitch = clamp((wantAlt - plane.y) / 40, -0.45, 0.5);
  }
  // Stall protection always wins: power up, nose down.
  if (plane.speed < CONFIG.plane.stallSpeed + 4) {
    throttle = 1;
    pitch = Math.min(pitch, -0.1);
  }
  return { roll, pitch, throttle, flaps: landing && dist < 900, gear: true };
}

/**
 * The point to steer at: the target itself when close, or a point 250 m
 * before it on the line from `from`, so the aeroplane arrives lined up
 * instead of circling a point it overshot.
 */
export function aimPoint(plane, target, from) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const dist = Math.hypot(target.x - plane.x, target.z - plane.z);
  if (dist <= 300) return target;
  return {
    x: target.x - (dx / len) * 250,
    y: target.y,
    z: target.z - (dz / len) * 250,
  };
}

/**
 * The final: fly down the runway centreline, heading south, and sink
 * gently onto it. This steers to a line, not a point — a point target is
 * what made the aeroplane circle the threshold forever. The descent only
 * starts once the aeroplane is lined up and over the runway's north half.
 */
export function finalControls(plane) {
  // On the ground: cut the power, stop steering, let the brakes work.
  if (plane.onGround) return { roll: 0, pitch: 0, throttle: 0, flaps: true, gear: true };
  const centreErr = plane.x;
  const desiredHeading = 180 + clamp(-centreErr * 0.25, -30, 30);
  const headingErr = angleDeltaDeg(plane.heading, desiredHeading);
  const roll = clamp(headingErr / 20, -1, 1);
  const linedUp = Math.abs(centreErr) < 30 && Math.abs(angleDeltaDeg(plane.heading, 180)) < 30;
  const overRunway = plane.z < 900;
  let pitch;
  if ((linedUp && overRunway) || plane.y < 20) {
    // Sink at about 3 m/s onto the runway.
    pitch = -0.38;
  } else {
    // Hold 60 m while lining up.
    pitch = clamp((60 - plane.y) / 40, -0.2, 0.6);
  }
  // Stall protection always wins: power up, nose down.
  let throttle = clamp(0.35 + (34 - plane.speed) * 0.06, 0.15, 0.9);
  if (plane.speed < CONFIG.plane.stallSpeed + 4) {
    throttle = 1;
    pitch = Math.min(pitch, -0.1);
  }
  return { roll, pitch, throttle, flaps: true, gear: true };
}

/** The landing targets: a long final from the north, the threshold, the touchdown point. */
function landingTargets() {
  return [
    { x: 0, z: 2000, y: 180, kind: 'point', landing: true },
    { x: 0, z: 1200, y: 110, kind: 'point', landing: true },
    { x: 0, z: 1100, y: 70, kind: 'point', landing: true },
    { x: 0, z: 500, y: 0, kind: 'final', landing: true },
  ];
}

/** Ring targets carry their ring number, so the pilot only moves on once flown. */
function ringTargets(rings) {
  return rings.map((r) => ({ ...r, kind: 'ring', ring: r.index }));
}

/** Fly the autopilot until `done(plane, mission)` or the step budget ends. */
function flyForward(game, targets, done, maxSteps) {
  const events = [];
  let targetIndex = 0;
  let airborne = false;
  for (let step = 0; step < maxSteps; step += 1) {
    const target = targets[Math.min(targetIndex, targets.length - 1)];
    const landing = target.landing === true;
    const from = targetIndex === 0 ? { x: 0, z: -580 } : targets[targetIndex - 1];
    const aim = aimPoint(game.plane, target, from);
    const controls =
      target.kind === 'final'
        ? finalControls(game.plane)
        : autopilotControls(game.plane, aim, landing);
    const before = game.mission.ringIndex;
    stepPlane(game.plane, { ...freshControls(), ...controls }, game.world, game.mission, STEP, events);
    if (!game.plane.onGround) airborne = true;
    if (game.mission.ringIndex !== before) {
      // A ring was flown: count it, as the game would.
      game.score += CONFIG.score.ring;
    }
    const dx = target.x - game.plane.x;
    const dz = target.z - game.plane.z;
    const dist = Math.hypot(dx, dz);
    if (target.kind === 'ring') {
      // Move on once the ring is flown, or once the plane has passed it.
      const ring = game.mission.rings[target.ring];
      const passed = ring && game.plane.z > ring.z + 120;
      if (game.mission.ringIndex > target.ring || passed) targetIndex += 1;
    } else if (dist < 130 && targetIndex < targets.length - 1) {
      targetIndex += 1;
    }
    if (airborne && done(game.plane, game.mission, events)) return { events, steps: step + 1 };
    if (events.some((e) => e.type === 'crash')) return { events, steps: step + 1 };
  }
  return { events, steps: maxSteps };
}

/** A fresh game state for one sortie, before any screen is drawn. */
export function freshGame(seed, missionIndex) {
  const world = new World(seed);
  const missionDef = CONFIG.missions[missionIndex % CONFIG.missions.length];
  return {
    seed,
    world,
    plane: freshPlane(world),
    mission: {
      ...missionDef,
      rings: missionDef.rings.map((r, i) => ({ ...r, index: i })),
      ringIndex: 0,
    },
    missionIndex,
    score: 0,
    sortieScore: 0,
    timeLeft: missionDef.timeLimit,
    screen: 'title',
    endLines: [],
    endTitle: '',
    autopilot: false,
    view: { width: CONFIG.view.width, height: CONFIG.view.height },
  };
}

/**
 * Stage a screenshot scene and return the game state to draw. `name` is
 * start, play, ring or land; any other name is start. The scenes fly the
 * real sim, so the frame shows the game as it is really played.
 */
export function stageShot(name, seed, missionIndex = 0) {
  const game = freshGame(seed, missionIndex);
  if (name === 'start') {
    // Parked on the runway at dawn, engine warm, title screen up.
    game.plane.throttle = 0.35;
    game.screen = 'title';
    return game;
  }
  if (name === 'play') {
    // Take off, climb out and fly toward the second ring.
    game.screen = 'fly';
    const targets = ringTargets(game.mission.rings.slice(0, 2));
    const result = flyForward(game, targets, (plane) => plane.y > 130 && plane.z > 800, 60 * 60);
    void result;
    return game;
  }
  if (name === 'ring') {
    // Threading the third ring low over the river, town below.
    game.screen = 'fly';
    const targets = ringTargets(game.mission.rings.slice(0, 3));
    flyForward(game, targets, (plane, mission) => mission.ringIndex >= 2 && plane.z > 1500, 60 * 90);
    return game;
  }
  // land: fly the whole sortie — every ring, then the landing — and stop
  // on the runway with the mission-complete screen up.
  game.screen = 'fly';
  const course = [...ringTargets(game.mission.rings), ...landingTargets()];
  const result = flyForward(
    game,
    course,
    (plane) => plane.onGround && plane.speed < 6,
    60 * 600,
  );
  if (game.plane.onGround && game.plane.speed < 8) {
    game.screen = 'landed';
    const ringsDone = game.mission.ringIndex;
    game.sortieScore = ringsDone * CONFIG.score.ring + 420;
    game.score += 420;
    game.endLines = [
      `${game.mission.name} — all ${ringsDone} rings flown, wheels down on Meridian Field.`,
      `Sortie score ${game.sortieScore} · total ${game.score}`,
      'The courier is on time. The valley is quiet again.',
    ];
  } else {
    game.screen = 'fly';
    game.endLines = [`Autopilot stopped after ${result.steps} steps.`];
  }
  return game;
}
