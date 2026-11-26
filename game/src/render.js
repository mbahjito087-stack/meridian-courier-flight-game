// Everything the player sees: the sky and valley, the runway and the rings,
// the aeroplane in frame, the lit instruments and the HUD, and every screen
// of the game. It draws only what the flight model and the world say —
// nothing is staged except the screenshot scenes, which fly the same sim.
import { CONFIG } from './config.js';
import { clamp, degToRad, lerp, smoothstep } from './random.js';
import { readouts } from './flight.js';

const TAU = Math.PI * 2;
const FEET = 3.28084;

// -- Projection ------------------------------------------------------------
// The camera rides just behind and above the aeroplane, looking along its
// heading. A world point is projected by its forward distance, its lateral
// offset and its height above the plane; the whole frame then rolls with
// the bank, around the aeroplane's place on the screen.

function makeCamera(plane, width, height) {
  const view = CONFIG.view;
  const cx = width * view.planeX;
  const cy = height * view.planeY;
  const pitchRad = degToRad(plane.pitch);
  const horizonY = clamp(cy + Math.tan(pitchRad) * view.focal, -height * 0.4, height * 1.2);
  const headingRad = degToRad(plane.heading);
  const fx = Math.sin(headingRad);
  const fz = Math.cos(headingRad);
  const rx = Math.cos(headingRad);
  const rz = -Math.sin(headingRad);
  const bankRad = degToRad(plane.bank);
  const cosB = Math.cos(bankRad);
  const sinB = Math.sin(bankRad);
  return {
    cx, cy, horizonY, fx, fz, rx, rz,
    project(x, y, z) {
      const dx = x - plane.x;
      const dy = y - plane.y - 4;
      const dz = z - plane.z;
      const d = dx * fx + dz * fz;
      if (d < 6) return null;
      const l = dx * rx + dz * rz;
      const px = cx + (l / d) * view.focal;
      const py = horizonY - (dy / d) * view.focal;
      // Roll the frame around the aeroplane's screen position.
      const ox = px - cx;
      const oy = py - cy;
      return {
        x: cx + ox * cosB - oy * sinB,
        y: cy + ox * sinB + oy * cosB,
        d,
      };
    },
  };
}

// -- Sky -------------------------------------------------------------------

function drawSky(ctx, view, plane, world, time) {
  const { width, height } = view;
  const horizonY = view.camera.horizonY;
  const grad = ctx.createLinearGradient(0, 0, 0, Math.max(horizonY, 1));
  const dawn = 0.25 + 0.75 * clamp(1 - Math.abs(plane.heading - 90) / 180, 0, 1);
  grad.addColorStop(0, '#2f5d9e');
  grad.addColorStop(0.55, '#7fb0dd');
  grad.addColorStop(1, '#cfe6f5');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, Math.max(horizonY, 1));

  // Sun, low in the east, drifting with the heading.
  const sunAngle = degToRad(90 - plane.heading);
  const sunX = width / 2 + Math.sin(sunAngle) * width * 0.42;
  const sunY = horizonY - Math.abs(Math.cos(sunAngle)) * height * 0.22 - 60;
  const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 130);
  glow.addColorStop(0, 'rgba(255, 236, 170, 0.95)');
  glow.addColorStop(0.25, 'rgba(255, 214, 120, 0.55)');
  glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 140, sunY - 140, 280, 280);
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 26, 0, TAU);
  ctx.fill();

  // Distant ridges, two layers, sliding with the heading (parallax).
  for (const ridge of world.ridges) {
    ctx.fillStyle = ridge.color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 2);
    const span = width * (1 + ridge.parallax * 2);
    const offset = ((plane.heading * ridge.parallax * 4) % span + span) % span;
    for (let i = 0; i <= 48; i += 1) {
      const px = (i / 48) * width;
      const peak = ridge.peaks[Math.floor(((px + offset) / span) * ridge.peaks.length) % ridge.peaks.length];
      const py = horizonY - peak * ridge.height * height - ridge.base * 0 + 4;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(width, horizonY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  void dawn;
  void time;
}

// -- Terrain ---------------------------------------------------------------

function drawTerrain(ctx, view, plane, world) {
  const { width, height } = view;
  const cam = view.camera;
  const horizonY = cam.horizonY;
  // Base ground: paint the valley floor first, so a band whose projection
  // misses a corner of the screen never leaves a black hole behind it.
  const base = hazeColor(world.groundColor(plane.x, plane.z), 0.25);
  ctx.fillStyle = base;
  ctx.fillRect(0, horizonY, width, height - horizonY);
  const bands = CONFIG.view.terrainBands;
  const maxD = CONFIG.world.viewDistance;
  // Depth bands, close together near the plane and sparse far away.
  const depths = [];
  for (let i = 0; i <= bands; i += 1) {
    depths.push(30 * Math.pow(maxD / 30, i / bands));
  }
  // Far band first so near bands paint over it.
  for (let b = bands - 1; b >= 0; b -= 1) {
    const dNear = depths[b];
    const dFar = depths[b + 1];
    const dMid = (dNear + dFar) / 2;
    const wx = plane.x + cam.fx * dMid;
    const wz = plane.z + cam.fz * dMid;
    // Ground colour at the middle of the band, hazed with distance.
    let color = world.groundColor(wx, wz);
    const haze = clamp(dMid / maxD, 0, 1);
    color = hazeColor(color, haze * 0.55);
    // Sample the ground's edge across the screen: the hills make it wavy.
    const samples = 14;
    const nearPts = [];
    const farPts = [];
    for (let s = 0; s <= samples; s += 1) {
      const lateral = -900 + (1800 * s) / samples;
      const nx = plane.x + cam.fx * dNear + cam.rx * lateral;
      const nz = plane.z + cam.fz * dNear + cam.rz * lateral;
      const fx = plane.x + cam.fx * dFar + cam.rx * lateral;
      const fz = plane.z + cam.fz * dFar + cam.rz * lateral;
      const pn = cam.project(nx, world.groundHeight(nx, nz), nz);
      const pf = cam.project(fx, world.groundHeight(fx, fz), fz);
      nearPts.push(pn ?? { x: lateral < 0 ? -80 : width + 80, y: height + 80, d: dNear });
      farPts.push(pf ?? { x: lateral < 0 ? -80 : width + 80, y: horizonY, d: dFar });
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(nearPts[0].x, nearPts[0].y);
    for (const p of nearPts) ctx.lineTo(p.x, p.y);
    for (let i = farPts.length - 1; i >= 0; i -= 1) ctx.lineTo(farPts[i].x, farPts[i].y);
    ctx.closePath();
    ctx.fill();
  }

  // The river: a ribbon following its centreline ahead of the plane.
  drawRiver(ctx, view, plane, world);
  // Crop fields: flat coloured quads on the valley floor.
  for (const f of world.fields) drawField(ctx, view, f);
  // The town's blocks, east of the runway.
  for (const b of world.town) drawBlock(ctx, view, plane, b);
  // The runway, with its threshold bars and centreline dashes.
  drawRunway(ctx, view, plane, world);
}

function hazeColor(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c) => Math.round(lerp(c, 0xcf, amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function drawRiver(ctx, view, plane, world) {
  const cam = view.camera;
  const pts = [];
  for (let d = 40; d < 2400; d += 80) {
    const z = plane.z + cam.fz * d;
    const x = world.riverXAt(z);
    const p = cam.project(x, 1.5, z);
    if (p) pts.push({ ...p, w: (world.river.width * CONFIG.view.focal) / d });
  }
  if (pts.length < 2) return;
  ctx.fillStyle = '#4a90c4';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const px = p.x - p.w / 2;
    if (i === 0) ctx.moveTo(px, p.y);
    else ctx.lineTo(px, p.y);
  }
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    ctx.lineTo(p.x + p.w / 2, p.y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawField(ctx, view, field) {
  const cam = view.camera;
  const corners = [
    [field.x - field.w / 2, field.z - field.d / 2],
    [field.x + field.w / 2, field.z - field.d / 2],
    [field.x + field.w / 2, field.z + field.d / 2],
    [field.x - field.w / 2, field.z + field.d / 2],
  ];
  const pts = corners.map(([x, z]) => cam.project(x, 1, z));
  if (pts.some((p) => p === null)) return;
  ctx.fillStyle = field.color;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawBlock(ctx, view, plane, block) {
  const cam = view.camera;
  const dx = block.x - plane.x;
  const dz = block.z - plane.z;
  const d = dx * cam.fx + dz * cam.fz;
  if (d < 30 || d > 2200) return;
  const base = cam.project(block.x, 0, block.z);
  if (!base) return;
  const scale = CONFIG.view.focal / d;
  const w = block.w * scale;
  const h = block.h * scale;
  const depth = block.d * scale * 0.6;
  // Front face, side face and roof: a little box with a coloured roof.
  ctx.fillStyle = block.wall;
  ctx.fillRect(base.x - w / 2, base.y - h, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(base.x + w / 2 - depth * 0.2, base.y - h, depth * 0.2, h);
  ctx.fillStyle = block.roof;
  ctx.beginPath();
  ctx.moveTo(base.x - w / 2 - 2, base.y - h);
  ctx.lineTo(base.x + w / 2 + 2, base.y - h);
  ctx.lineTo(base.x + w / 2 - depth * 0.3, base.y - h - depth * 0.45);
  ctx.lineTo(base.x - w / 2 - depth * 0.3, base.y - h - depth * 0.45);
  ctx.closePath();
  ctx.fill();
}

function drawRunway(ctx, view, plane, world) {
  const cam = view.camera;
  const r = world.runway;
  const corners = [
    [r.x - r.halfWidth, r.zMin],
    [r.x + r.halfWidth, r.zMin],
    [r.x + r.halfWidth, r.zMax],
    [r.x - r.halfWidth, r.zMax],
  ];
  const pts = corners.map(([x, z]) => cam.project(x, 0.4, z));
  if (pts.some((p) => p === null)) return;
  ctx.fillStyle = '#3c4148';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  // Edge lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[3].x, pts[3].y);
  ctx.moveTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.stroke();
  // Centreline dashes and threshold bars.
  ctx.fillStyle = '#f5f5f5';
  for (let z = r.zMin + 60; z < r.zMax - 20; z += 90) {
    const a = cam.project(r.x, 0.5, z);
    const b = cam.project(r.x, 0.5, z + 45);
    if (!a || !b) continue;
    const w = Math.max(1.5, (3.2 * CONFIG.view.focal) / a.d);
    ctx.fillRect(a.x - w / 2, Math.min(a.y, b.y), w, Math.abs(a.y - b.y) + 1);
  }
  // The big "09" numbers at the near threshold, drawn as two bars.
  for (const z of [r.zMin + 18, r.zMax - 18]) {
    for (const side of [-1, 1]) {
      const p = cam.project(r.x + side * 8, 0.5, z);
      if (!p) continue;
      const w = Math.max(2, (5 * CONFIG.view.focal) / p.d);
      ctx.fillRect(p.x - w / 2, p.y - w * 2, w, w * 4);
    }
  }
}

// -- Clouds and rings --------------------------------------------------------

function drawClouds(ctx, view, plane, world) {
  const cam = view.camera;
  for (const c of world.clouds) {
    const p = cam.project(c.x, c.y, c.z);
    if (!p || p.d > 2600) continue;
    const s = (c.scale * CONFIG.view.focal) / p.d;
    if (s < 4) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    for (let i = 0; i < c.puffs; i += 1) {
      const px = p.x + (i - c.puffs / 2) * s * 0.55;
      const py = p.y + Math.sin(i * 2.3) * s * 0.12;
      ctx.beginPath();
      ctx.ellipse(px, py, s * 0.55, s * 0.26, 0, 0, TAU);
      ctx.fill();
    }
  }
}

function drawRings(ctx, view, plane, mission) {
  const cam = view.camera;
  const rings = mission.rings;
  for (let i = mission.ringIndex; i < rings.length; i += 1) {
    const ring = rings[i];
    const p = cam.project(ring.x, ring.y, ring.z);
    if (!p || p.d > 2400) continue;
    const radius = (CONFIG.world.ringRadius * CONFIG.view.focal) / p.d;
    if (radius < 3) continue;
    const isNext = i === mission.ringIndex;
    const facing = Math.abs(Math.cos(degToRad(plane.heading - 0)));
    const squash = clamp(0.35 + 0.65 * facing, 0.35, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, squash);
    const glow = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius * 1.25);
    glow.addColorStop(0, 'rgba(255, 200, 60, 0)');
    glow.addColorStop(0.8, isNext ? 'rgba(255, 200, 60, 0.28)' : 'rgba(255, 200, 60, 0.12)');
    glow.addColorStop(1, 'rgba(255, 200, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.25, 0, TAU);
    ctx.fill();
    ctx.lineWidth = Math.max(3, radius * 0.14);
    ctx.strokeStyle = isNext ? '#ffcf3d' : '#e8b64a';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, radius * 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.86, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // The ring's number, floating above it.
    if (radius > 14) {
      ctx.fillStyle = isNext ? '#fff2b0' : 'rgba(255,255,255,0.75)';
      ctx.font = `bold ${Math.max(13, radius * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x, p.y - radius - 14);
    }
  }
}

// -- The aeroplane -----------------------------------------------------------

function drawPlane(ctx, view, plane, time) {
  const { width, height } = view;
  const px = width * CONFIG.view.planeX;
  const py = height * CONFIG.view.planeY;
  const bankRad = degToRad(plane.bank);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(bankRad);
  const s = Math.min(width, height) / 800;
  ctx.scale(s, s);
  // Soft shadow on the ground far below is skipped in the air; the plane is
  // the hero, drawn big and clean against the sky.
  // Wings: a low wing with red tips.
  ctx.fillStyle = '#d8433a';
  ctx.beginPath();
  ctx.moveTo(-150, 6);
  ctx.lineTo(-30, -6);
  ctx.lineTo(-26, 10);
  ctx.lineTo(-150, 22);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(150, 6);
  ctx.lineTo(30, -6);
  ctx.lineTo(26, 10);
  ctx.lineTo(150, 22);
  ctx.closePath();
  ctx.fill();
  // Wing roots in cream.
  ctx.fillStyle = '#f3e6c8';
  ctx.beginPath();
  ctx.moveTo(-34, -6);
  ctx.lineTo(34, -6);
  ctx.lineTo(30, 12);
  ctx.lineTo(-30, 12);
  ctx.closePath();
  ctx.fill();
  // Tailplane and fin (nearest the camera, so drawn low and wide).
  ctx.fillStyle = '#c23a30';
  ctx.beginPath();
  ctx.moveTo(-72, 52);
  ctx.lineTo(-14, 40);
  ctx.lineTo(-12, 52);
  ctx.lineTo(-72, 62);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(72, 52);
  ctx.lineTo(14, 40);
  ctx.lineTo(12, 52);
  ctx.lineTo(72, 62);
  ctx.closePath();
  ctx.fill();
  // Fuselage: a tapered body, cream with a red cheatline.
  ctx.fillStyle = '#f6ead0';
  ctx.beginPath();
  ctx.moveTo(-16, -58);
  ctx.quadraticCurveTo(-24, -10, -20, 46);
  ctx.quadraticCurveTo(-18, 58, 0, 58);
  ctx.quadraticCurveTo(18, 58, 20, 46);
  ctx.quadraticCurveTo(24, -10, 16, -58);
  ctx.quadraticCurveTo(0, -66, -16, -58);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d8433a';
  ctx.fillRect(-19, -6, 38, 7);
  // Canopy: dark glass ahead of the wing.
  ctx.fillStyle = '#22303e';
  ctx.beginPath();
  ctx.ellipse(0, -30, 10, 18, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-3, -36, 4, 8, -0.3, 0, TAU);
  ctx.fill();
  // Tail number.
  ctx.fillStyle = '#7a2a24';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N-7MC', 0, 40);
  // Propeller: a translucent disc at the nose, spinning.
  const prop = 0.5 + 0.5 * Math.sin(time * 40);
  ctx.fillStyle = `rgba(40, 48, 58, ${0.10 + prop * 0.08})`;
  ctx.beginPath();
  ctx.ellipse(0, -62, 26, 7, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(40,48,58,0.55)';
  ctx.beginPath();
  ctx.ellipse(0, -62, 4, 5, 0, 0, TAU);
  ctx.fill();
  // Navigation lights: red port, green starboard, white strobe on the tail.
  const strobe = Math.sin(time * 6) > 0.86;
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.arc(-150, 14, 4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#34d17b';
  ctx.beginPath();
  ctx.arc(150, 14, 4, 0, TAU);
  ctx.fill();
  if (strobe) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 58, 5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// -- Instruments and HUD -----------------------------------------------------

function drawPanel(ctx, view, plane, mission, score, timeLeft) {
  const { width, height } = view;
  const r = readouts(plane);
  const panelH = 148;
  const panelY = height - panelH;
  // Glass panel.
  const grad = ctx.createLinearGradient(0, panelY, 0, height);
  grad.addColorStop(0, 'rgba(12, 18, 28, 0.82)');
  grad.addColorStop(1, 'rgba(8, 12, 20, 0.94)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, panelY, width, panelH);
  ctx.fillStyle = 'rgba(120, 200, 255, 0.25)';
  ctx.fillRect(0, panelY, width, 2);

  const cx = width / 2;
  // --- Attitude indicator (centre) ---
  const attX = cx;
  const attY = panelY + 74;
  const attR = 52;
  ctx.save();
  ctx.beginPath();
  ctx.arc(attX, attY, attR, 0, TAU);
  ctx.clip();
  ctx.translate(attX, attY);
  ctx.rotate(degToRad(plane.bank));
  const pitchPx = clamp(plane.pitch, -20, 20) * 2.4;
  ctx.fillStyle = '#3d7ec2';
  ctx.fillRect(-attR - 4, -attR - 4 - pitchPx, attR * 2 + 8, attR + 4 + pitchPx);
  ctx.fillStyle = '#8a6b46';
  ctx.fillRect(-attR - 4, -pitchPx, attR * 2 + 8, attR + 4 + pitchPx);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-attR, -pitchPx);
  ctx.lineTo(attR, -pitchPx);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#9fd8ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(attX, attY, attR, 0, TAU);
  ctx.stroke();
  // Fixed wings marker.
  ctx.fillStyle = '#ffd76a';
  ctx.fillRect(attX - 34, attY - 2, 24, 4);
  ctx.fillRect(attX + 10, attY - 2, 24, 4);
  ctx.beginPath();
  ctx.arc(attX, attY, 4, 0, TAU);
  ctx.fill();
  label(ctx, 'ATTITUDE', attX, attY + attR + 12);

  // --- Airspeed tape (left, clear of the score block) ---
  tape(ctx, 210, panelY + 20, 56, 108, r.speedKts, 10, 'KT', '#7ee2a8');
  label(ctx, 'AIRSPEED · KT', 238, panelY + 138);
  // --- Altimeter tape (right) ---
  tape(ctx, width - 176, panelY + 20, 56, 108, r.altitudeFt, 100, 'FT', '#8ec9ff');
  label(ctx, 'ALTITUDE · FT', width - 148, panelY + 138);

  // --- Heading compass strip (above the attitude indicator) ---
  const compY = panelY + 12;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(cx - 150, compY - 8, 300, 26);
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let off = -2; off <= 2; off += 1) {
    const h = (r.headingDeg + off * 45 + 360) % 360;
    const name = off % 2 === 0 ? headings[Math.round(h / 45) % 8] : String(Math.round(h / 10) * 10);
    ctx.globalAlpha = off === 0 ? 1 : 0.55;
    ctx.fillText(name, cx + off * 62, compY + 5);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath();
  ctx.moveTo(cx - 7, compY - 12);
  ctx.lineTo(cx + 7, compY - 12);
  ctx.lineTo(cx, compY - 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(`${String(r.headingDeg).padStart(3, '0')}°`, cx, compY + 34);

  // --- Throttle and fuel (far right) ---
  const thX = width - 84;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(thX - 8, panelY + 22, 16, 96);
  const thH = 96 * clamp(plane.throttle, 0, 1);
  ctx.fillStyle = plane.engineOut ? '#888' : '#ffb03a';
  ctx.fillRect(thX - 8, panelY + 118 - thH, 16, thH);
  label(ctx, `THR ${r.throttlePct}%`, thX, panelY + 138);
  // Fuel gauge.
  const fuelX = width - 260;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(fuelX, panelY + 22, 12, 96);
  const fuelH = 96 * clamp(plane.fuel / CONFIG.plane.fuel, 0, 1);
  ctx.fillStyle = r.fuelPct < 25 ? '#ff5a4a' : '#7ee2a8';
  ctx.fillRect(fuelX, panelY + 118 - fuelH, 12, fuelH);
  label(ctx, `FUEL ${r.fuelPct}%`, fuelX + 6, panelY + 138);

  // --- Score, rings and time (far left) ---
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(`SCORE ${score}`, 24, panelY + 46);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = '#ffd76a';
  ctx.fillText(`RINGS ${mission.ringIndex}/${mission.rings.length}`, 24, panelY + 74);
  ctx.fillStyle = timeLeft < 60 ? '#ff8a7a' : '#cfe6f5';
  ctx.fillText(`TIME ${formatTime(timeLeft)}`, 24, panelY + 100);
  ctx.fillStyle = '#9fb6c9';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(plane.gear ? 'GEAR DOWN' : 'GEAR UP', 24, panelY + 122);
  ctx.fillText(plane.flaps ? 'FLAPS DOWN' : 'FLAPS UP', 110, panelY + 122);
  if (plane.engineOut) {
    ctx.fillStyle = '#ff5a4a';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('ENGINE OUT — GLIDE!', 24, panelY + 16);
  }
  if (plane.speed < CONFIG.plane.stallSpeed && !plane.onGround) {
    ctx.fillStyle = '#ff8a5a';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('STALL — NOSE DOWN, POWER UP', 220, panelY + 16);
  }
}

function label(ctx, text, x, y) {
  ctx.fillStyle = '#9fb6c9';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function tape(ctx, x, y, w, h, value, step, unit, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  const centre = y + h / 2;
  const pxPerUnit = h / (step * 6);
  const base = Math.round(value / step) * step;
  ctx.fillStyle = '#cfe6f5';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = base - step * 3; v <= base + step * 3; v += step) {
    const py = centre - (v - value) * pxPerUnit;
    if (py < y + 8 || py > y + h - 8) continue;
    ctx.globalAlpha = Math.abs(v - value) < step / 2 ? 1 : 0.6;
    ctx.fillText(String(v), x + w - 6, py);
  }
  ctx.globalAlpha = 1;
  // The readout box.
  ctx.fillStyle = '#0d1622';
  ctx.fillRect(x - 4, centre - 13, w + 8, 26);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 4, centre - 13, w + 8, 26);
  ctx.fillStyle = color;
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(value)), x + w / 2, centre + 1);
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawTopBar(ctx, view, mission, plane) {
  const { width } = view;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(8, 12, 20, 0.55)';
  const w = 460;
  ctx.fillRect(width / 2 - w / 2, 10, w, 34);
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(mission.name, width / 2, 33);
  // Next-ring pointer: a gold arrow when the ring is off frame.
  const next = mission.rings[mission.ringIndex];
  if (next) {
    const cam = view.camera;
    const p = cam.project(next.x, next.y, next.z);
    const r = readouts(plane);
    const distM = Math.hypot(next.x - plane.x, next.y - plane.y, next.z - plane.z);
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 15px system-ui, sans-serif';
    if (!p || p.x < 40 || p.x > width - 40 || p.y < 60 || p.y > view.height - 170) {
      const angle = Math.atan2(
        (p ? p.y : view.height / 2) - view.height / 2,
        (p ? p.x : width / 2) - width / 2,
      );
      const ax = width / 2 + Math.cos(angle) * 210;
      const ay = 300 + Math.sin(angle) * 120;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-10, -10);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillText(`RING ${mission.ringIndex + 1} · ${Math.round(distM)} m`, ax, ay + 26);
    } else {
      ctx.fillText(`RING ${mission.ringIndex + 1} · ${Math.round(distM)} m · ${r.altitudeFt} FT`, p.x, p.y - 46);
    }
  }
}

// -- Screens -----------------------------------------------------------------

function drawTitle(ctx, view, mission, time) {
  const { width, height } = view;
  const bob = Math.sin(time * 0.8) * 4;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText('M A K E . F U N   P R E S E N T S', width / 2, 150 + bob);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.fillText('MERIDIAN', width / 2, 240 + bob);
  ctx.fillText('COURIER', width / 2, 322 + bob);
  ctx.fillStyle = '#cfe6f5';
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText('Fly the valley. Thread the rings. Bring her home.', width / 2, 372 + bob);
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 22px system-ui, sans-serif';
  const pulse = 0.65 + 0.35 * Math.sin(time * 3);
  ctx.globalAlpha = pulse;
  ctx.fillText('—  PRESS ENTER TO FLY  —', width / 2, 470);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#9fb6c9';
  ctx.font = '17px system-ui, sans-serif';
  ctx.fillText('Arrows or WASD fly · W / S throttle · F flaps · G gear · P pause · M sound', width / 2, 520);
  ctx.fillText('Mouse: hold and drag to steer · A autopilot · R restart', width / 2, 546);
  ctx.fillText(`${mission.name}  ·  ${mission.rings.length} rings  ·  land on Meridian Field`, width / 2, 600);
}

function drawBrief(ctx, view, mission) {
  const { width, height } = view;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.62)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('M I S S I O N   B R I E F I N G', width / 2, 190);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText(mission.name, width / 2, 250);
  ctx.fillStyle = '#cfe6f5';
  ctx.font = '22px system-ui, sans-serif';
  wrapText(ctx, mission.brief, width / 2, 300, 760, 32);
  ctx.fillStyle = '#eaf6ff';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(`${mission.rings.length} golden rings, then a landing on runway 09`, width / 2, 400);
  ctx.fillText(`Time limit ${formatTime(mission.timeLimit)}  ·  100 points a ring  ·  up to 500 for the landing`, width / 2, 432);
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('—  PRESS ENTER TO TAKE OFF  —', width / 2, 510);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawEnd(ctx, view, title, lines, accent) {
  const { width, height } = view;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.55)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText(title, width / 2, 260);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px system-ui, sans-serif';
  let y = 320;
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += 38;
  }
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText('—  PRESS ENTER FOR THE NEXT SORTIE · R TO FLY AGAIN  —', width / 2, y + 40);
}

// -- The frame ---------------------------------------------------------------

/**
 * Draw one frame. `game` carries the plane, the world, the mission state,
 * the score, the screen name and the clock; `time` is seconds since load.
 */
export function drawFrame(ctx, game, time) {
  const { width, height } = game.view;
  const view = { width, height, camera: makeCamera(game.plane, width, height) };
  game.view.camera = view.camera;
  const horizonY = view.camera.horizonY;
  drawSky(ctx, view, game.plane, game.world, time);
  // Below the horizon: the valley. Above it: only sky and clouds.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Math.max(0, horizonY - 2), width, height);
  ctx.clip();
  drawTerrain(ctx, view, game.plane, game.world);
  ctx.restore();
  drawClouds(ctx, view, game.plane, game.world);
  if (game.screen === 'fly' || game.screen === 'pause' || game.screen === 'landed' || game.screen === 'crashed') {
    drawRings(ctx, view, game.plane, game.mission);
  }
  if (game.screen !== 'title') drawPlane(ctx, view, game.plane, time);
  if (game.screen === 'fly' || game.screen === 'pause') {
    drawTopBar(ctx, view, game.mission, game.plane);
    drawPanel(ctx, view, game.plane, game.mission, game.score, game.timeLeft);
  }
  if (game.screen === 'title') drawTitle(ctx, view, game.mission, time);
  if (game.screen === 'brief') drawBrief(ctx, view, game.mission);
  if (game.screen === 'pause') {
    ctx.fillStyle = 'rgba(8, 14, 24, 0.5)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', width / 2, height / 2 - 10);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#cfe6f5';
    ctx.fillText('P to resume · R to restart the sortie', width / 2, height / 2 + 30);
  }
  if (game.screen === 'landed') {
    drawEnd(ctx, view, 'MISSION COMPLETE', game.endLines, '#7ee2a8');
  }
  if (game.screen === 'crashed') {
    drawEnd(ctx, view, game.endTitle || 'CRASHED', game.endLines, '#ff8a7a');
  }
  // The vignette that holds the frame together.
  const vig = ctx.createRadialGradient(width / 2, height / 2, height * 0.45, width / 2, height / 2, height * 0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);
  void FEET;
}
