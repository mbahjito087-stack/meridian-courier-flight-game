// Meridian Courier: the game loop, the screens and the scoring. It wires
// the flight model, the world, the renderer, the sound and the input
// together, and nothing else — the rules live in flight.js, the looks in
// render.js, the scenes in shots.js.
import { CONFIG } from './config.js';
import { clamp } from './random.js';
import { freshControls, freshPlane, readouts, stepPlane } from './flight.js';
import { drawFrame } from './render.js';
import { SoundBank } from './audio.js';
import { Input } from './input.js';
import { aimPoint, autopilotControls, finalControls, freshGame, stageShot } from './shots.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const SEED = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const SHOT = params.get('shot');
const MISSION = Number.parseInt(params.get('mission') ?? '0', 10) || 0;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = CONFIG.view.width;
canvas.height = CONFIG.view.height;

const input = new Input(canvas);
const sound = new SoundBank();

// The game state: either a staged screenshot scene or a fresh sortie.
const game = SHOT ? stageShot(SHOT, SEED, MISSION) : freshGame(SEED, MISSION);
let throttle = 0.72;
let flaps = false;
let gear = true;
let accumulated = 0;
let lastTime = performance.now();
let time = 0;

/** Start (or restart) the current sortie from the runway. */
function startSortie(missionIndex) {
  const keepScore = game.score;
  const fresh = freshGame(game.seed, missionIndex);
  game.world = fresh.world;
  game.plane = fresh.plane;
  game.mission = fresh.mission;
  game.missionIndex = missionIndex;
  game.timeLeft = fresh.timeLeft;
  game.sortieScore = 0;
  game.score = keepScore;
  game.screen = 'brief';
  throttle = 0.72;
  flaps = false;
  gear = true;
}

/** Score a landing: a base for getting down, more the gentler it was. */
function landingScore(sink) {
  const smooth = clamp(1 - sink / CONFIG.plane.landingMaxSink, 0, 1);
  return Math.round(CONFIG.score.landingBase + CONFIG.score.landingSmooth * smooth);
}

/** Drain the flight model's events into score, sound and screens. */
function handleEvents(events) {
  for (const event of events) {
    if (event.type === 'ring') {
      const gained = CONFIG.score.ring + Math.round(CONFIG.score.ringStyle * event.style);
      game.sortieScore += gained;
      game.score += gained;
      sound.ring(event.style);
    } else if (event.type === 'takeoff') {
      sound.blip(520, 0.1, 0.08);
    } else if (event.type === 'touchdown') {
      const gained = landingScore(event.sink);
      game.sortieScore += gained;
      game.score += gained;
      sound.thud(clamp(1 - event.sink / CONFIG.plane.landingMaxSink, 0.2, 1));
      const ringsLeft = game.mission.rings.length - game.mission.ringIndex;
      if (ringsLeft === 0) {
        const timeBonus = Math.round(game.timeLeft * CONFIG.score.timeBonusPerSecond);
        game.sortieScore += timeBonus;
        game.score += timeBonus;
        game.screen = 'landed';
        game.endTitle = 'MISSION COMPLETE';
        game.endLines = [
          `${game.mission.name} — all ${game.mission.rings.length} rings flown, wheels down on Meridian Field.`,
          `Landing ${gained} · time bonus ${timeBonus} · sortie ${game.sortieScore} · total ${game.score}`,
          'The courier is on time. The valley is quiet again.',
        ];
      } else {
        game.screen = 'landed';
        game.endTitle = 'LANDED EARLY';
        game.endLines = [
          `Wheels down on Meridian Field — but ${ringsLeft} ring${ringsLeft === 1 ? '' : 's'} still to fly.`,
          `Landing ${gained} · sortie ${game.sortieScore} · total ${game.score}`,
          'A safe landing beats a bold one. Fly the full course next time.',
        ];
      }
    } else if (event.type === 'crash') {
      sound.warn();
      game.screen = 'crashed';
      game.endTitle = 'CRASHED';
      const where = event.reason === 'terrain' ? 'into the valley floor' : event.reason;
      game.endLines = [
        `The courier went down ${where}.`,
        `Rings flown ${game.mission.ringIndex}/${game.mission.rings.length} · sortie ${game.sortieScore} · total ${game.score}`,
        'The valley keeps what it catches. Fly her again.',
      ];
    } else if (event.type === 'engine-out') {
      sound.warn();
    }
  }
}

/** One fixed step of the simulation, from the pilot's controls. */
function stepGame(dt) {
  if (game.screen !== 'fly') return;
  // Throttle: W and S (or Shift / Ctrl) move it; it stays where it is left.
  if (input.down('w') || input.down('shift')) throttle = clamp(throttle + 0.55 * dt, 0, 1);
  if (input.down('s') || input.down('control')) throttle = clamp(throttle - 0.55 * dt, 0, 1);
  if (input.wasPressed('f')) flaps = !flaps;
  if (input.wasPressed('g')) gear = !gear;
  if (input.wasPressed('a')) game.autopilot = !game.autopilot;

  let controls;
  if (game.autopilot) {
    const next = game.mission.rings[game.mission.ringIndex];
    if (!next) {
      // No rings left: line up on the runway, then fly the final.
      const far = game.plane.z > 900 || game.plane.y > 90 || Math.abs(game.plane.x) > 80;
      const auto = far
        ? autopilotControls(game.plane, { x: 0, y: 70, z: 1100 }, true)
        : finalControls(game.plane);
      controls = { ...freshControls(), ...auto, flaps: auto.flaps, gear: auto.gear };
      throttle = auto.throttle;
    } else {
      const prev = game.mission.ringIndex === 0
        ? { x: 0, z: -580 }
        : game.mission.rings[game.mission.ringIndex - 1];
      const aim = aimPoint(game.plane, next, prev);
      const auto = autopilotControls(game.plane, aim, false);
      controls = { ...freshControls(), ...auto, flaps: auto.flaps, gear: auto.gear };
      throttle = auto.throttle;
    }
  } else {
    const stick = input.readStick();
    controls = { ...freshControls(), roll: stick.roll, pitch: stick.pitch, throttle, flaps, gear };
  }
  const events = [];
  stepPlane(game.plane, controls, game.world, game.mission, dt, events);
  handleEvents(events);
  game.timeLeft -= dt;
  if (game.timeLeft <= 0 && game.screen === 'fly') {
    game.timeLeft = 0;
    game.screen = 'crashed';
    game.endTitle = 'OUT OF TIME';
    game.endLines = [
      'The courier flew on without you — the sortie window closed.',
      `Rings flown ${game.mission.ringIndex}/${game.mission.rings.length} · sortie ${game.sortieScore} · total ${game.score}`,
      'Faster hands next time. The rings will still be there.',
    ];
  }
  sound.update(game.plane, game.screen === 'fly');
}

/** Screen keys: Enter, P, R, M. Checked once a frame, not per step. */
function handleScreenKeys() {
  if (input.wasPressed('enter')) {
    sound.ensure();
    if (game.screen === 'title') {
      game.screen = 'brief';
    } else if (game.screen === 'brief') {
      game.screen = 'fly';
    } else if (game.screen === 'landed') {
      startSortie((game.missionIndex + 1) % CONFIG.missions.length);
    } else if (game.screen === 'crashed') {
      startSortie(game.missionIndex);
    }
  }
  if (input.wasPressed('p') && (game.screen === 'fly' || game.screen === 'pause')) {
    game.screen = game.screen === 'fly' ? 'pause' : 'fly';
  }
  if (input.wasPressed('r') && game.screen !== 'title') {
    startSortie(game.missionIndex);
  }
  if (input.wasPressed('m')) {
    sound.ensure();
    sound.toggleMute();
  }
  if (input.wasPressed(' ') && game.screen === 'title') {
    sound.ensure();
    game.screen = 'brief';
  }
}

function frame(now) {
  const dt = clamp((now - lastTime) / 1000, 0, 0.1);
  lastTime = now;
  time += dt;
  handleScreenKeys();
  if (game.screen === 'fly') {
    accumulated += dt;
    while (accumulated >= STEP) {
      stepGame(STEP);
      accumulated -= STEP;
      if (game.screen !== 'fly') break;
    }
  }
  drawFrame(ctx, game, time);
  // The status line, for screen readers.
  const r = readouts(game.plane);
  const status = document.getElementById('status');
  if (status) {
    status.textContent =
      `${game.mission.name}. Altitude ${r.altitudeFt} feet, speed ${r.speedKts} knots, ` +
      `heading ${r.headingDeg} degrees. Rings ${game.mission.ringIndex} of ${game.mission.rings.length}. ` +
      `Score ${game.score}.`;
  }
  input.endFrame();
  window.requestAnimationFrame(frame);
}

// A staged screenshot scene draws one frame and stops: the shot is the
// frame, taken by the maker's browser, not a game the player is in.
if (SHOT) {
  drawFrame(ctx, game, 3.2);
  window.__meridian = { game, stage: SHOT };
} else {
  window.__meridian = { game };
  window.requestAnimationFrame(frame);
}
