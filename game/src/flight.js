// The flight model: one aeroplane, its state and the rules that move it.
// An arcade model with a real shape — speed chases the throttle, lift
// fails below the stall, the bank turns the nose, and the ground is always
// there. It knows nothing about the screen; the renderer reads its state.
import { CONFIG } from './config.js';
import { angleDeltaDeg, clamp, degToRad, wrapAngleDeg } from './random.js';

const G = 9.81;
const KNOTS = 1.94384;
const FEET = 3.28084;

/** A fresh aeroplane parked at the runway threshold, engine warm. */
export function freshPlane(world) {
  const r = world.runway;
  return {
    x: r.x,
    z: r.zMin + 40,
    y: 0,
    heading: 0,
    pitch: 0,
    bank: 0,
    speed: 0,
    throttle: 0,
    fuel: CONFIG.plane.fuel,
    flaps: false,
    gear: true,
    verticalSpeed: 0,
    onGround: true,
    engineOut: false,
    // Style: how cleanly the last ring was flown (0..1), for the score.
    lastRingStyle: 0,
  };
}

/** What the pilot is asking for this step: -1..1 roll and pitch, throttle. */
export function freshControls() {
  return { roll: 0, pitch: 0, throttle: 0.72, flaps: false, gear: true };
}

/**
 * Advance the aeroplane one step. `controls` carries the pilot's stick and
 * throttle; `events` collects what happened (ring, touchdown, crash, ...).
 * Returns the same events array, for the caller to drain.
 */
export function stepPlane(plane, controls, world, mission, dt, events) {
  const P = CONFIG.plane;
  const rings = mission.rings;

  // -- Throttle and speed --------------------------------------------------
  const targetThrottle = plane.engineOut ? 0 : clamp(controls.throttle, 0, 1);
  plane.throttle += clamp(targetThrottle - plane.throttle, -dt * 0.8, dt * 0.8);
  const targetSpeed = P.idleSpeed + (P.cruiseSpeed - P.idleSpeed) * plane.throttle;
  const drag = plane.flaps ? 0.35 : 0;
  const speedTarget = Math.max(P.idleSpeed * 0.6, targetSpeed - drag * 22);
  // The speed chases its target: power pulls it up fast, drag lets it down slow.
  const chase = speedTarget > plane.speed ? P.accelRate : P.accelRate * 0.6;
  plane.speed += clamp(speedTarget - plane.speed, -chase * dt, chase * dt);
  plane.speed = clamp(plane.speed, 0, P.maxSpeed);

  // -- Attitude ------------------------------------------------------------
  const bankTarget = controls.roll * P.maxBank;
  plane.bank += clamp(bankTarget - plane.bank, -P.bankRate * dt, P.bankRate * dt);
  const pitchTarget = controls.pitch * (controls.pitch > 0 ? P.maxPitchUp : -P.maxPitchDown);
  plane.pitch += clamp(pitchTarget - plane.pitch, -P.pitchRate * dt, P.pitchRate * dt);

  // -- Turning -------------------------------------------------------------
  const bankRad = degToRad(plane.bank);
  const turnRate = (G * Math.tan(bankRad)) / Math.max(plane.speed, 12);
  plane.heading = wrapAngleDeg(plane.heading + (turnRate * 180) / Math.PI * dt);

  // -- Lift, sink and climb ------------------------------------------------
  const stallFactor = clamp(plane.speed / P.stallSpeed, 0, 1);
  const lift = stallFactor * stallFactor;
  const pitchRad = degToRad(plane.pitch);
  let climb = plane.speed * Math.sin(pitchRad) * lift;
  if (plane.speed < P.stallSpeed) {
    climb -= P.stallSink * (1 - stallFactor);
    // A stalled wing drops the nose for the pilot.
    plane.pitch += (P.maxPitchDown * 0.4 - plane.pitch) * dt * 0.5;
  }
  plane.verticalSpeed = climb;
  plane.y += climb * dt;

  // -- Position ------------------------------------------------------------
  const headingRad = degToRad(plane.heading);
  const forward = plane.speed * Math.cos(pitchRad);
  plane.x += Math.sin(headingRad) * forward * dt;
  plane.z += Math.cos(headingRad) * forward * dt;

  // -- Fuel -----------------------------------------------------------------
  if (!plane.engineOut) {
    const burn = P.fuelBurnIdle + (P.fuelBurnFull - P.fuelBurnIdle) * plane.throttle;
    plane.fuel = Math.max(0, plane.fuel - burn * dt);
    if (plane.fuel <= 0) {
      plane.engineOut = true;
      events.push({ type: 'engine-out' });
    }
  }

  // -- Flaps and gear -------------------------------------------------------
  plane.flaps = controls.flaps;
  plane.gear = controls.gear;

  // -- Rings ----------------------------------------------------------------
  const next = rings[mission.ringIndex ?? 0];
  if (next) {
    const dx = plane.x - next.x;
    const dy = plane.y - next.y;
    const dz = plane.z - next.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < CONFIG.world.ringHit) {
      // Style: dead centre scores the bonus.
      plane.lastRingStyle = clamp(1 - dist / CONFIG.world.ringHit, 0, 1);
      mission.ringIndex = (mission.ringIndex ?? 0) + 1;
      events.push({ type: 'ring', index: next.index, style: plane.lastRingStyle });
    }
  }

  // -- Ground ---------------------------------------------------------------
  const ground = world.groundHeight(plane.x, plane.z);
  const clearance = plane.y - ground;
  const onRunway = world.isRunway(plane.x, plane.z);
  if (plane.onGround) {
    plane.y = ground;
    plane.verticalSpeed = 0;
    // Rolling takeoff: the wing lifts her off once she is fast enough.
    if (plane.speed > P.stallSpeed + 6 && plane.pitch > 2) {
      plane.onGround = false;
      events.push({ type: 'takeoff' });
    }
  } else if (clearance <= 0) {
    plane.y = ground;
    if (onRunway) {
      const sink = -plane.verticalSpeed;
      const fast = plane.speed > P.landingMaxSpeed;
      const slow = plane.speed < P.landingMinSpeed;
      if (sink <= P.landingMaxSink && !fast && !slow) {
        plane.onGround = true;
        plane.verticalSpeed = 0;
        events.push({ type: 'touchdown', sink, speed: plane.speed });
      } else {
        events.push({
          type: 'crash',
          reason: fast ? 'too fast for the runway' : slow ? 'stalled onto the runway' : 'a hard landing',
        });
      }
    } else {
      events.push({ type: 'crash', reason: 'terrain' });
    }
  }

  // -- Runway rollout --------------------------------------------------------
  // On the ground the wheels roll: a little resistance on the takeoff roll,
  // hard braking once the pilot has cut the power after landing.
  if (plane.onGround && plane.speed > 0) {
    const braking = plane.throttle < 0.2 ? P.touchdownRoll * 22 : 0.3;
    plane.speed = Math.max(0, plane.speed - braking * dt);
    // A little steering on the ground, from the bank.
    plane.heading = wrapAngleDeg(plane.heading + plane.bank * 0.06 * dt);
  }

  return events;
}

/** Readouts for the HUD and the instruments, in pilot units. */
export function readouts(plane) {
  return {
    altitudeFt: Math.round(plane.y * FEET),
    speedKts: Math.round(plane.speed * KNOTS),
    headingDeg: Math.round((plane.heading + 360) % 360),
    verticalSpeedFpm: Math.round(plane.verticalSpeed * FEET * 60),
    fuelPct: Math.round((plane.fuel / CONFIG.plane.fuel) * 100),
    throttlePct: Math.round(plane.throttle * 100),
  };
}
