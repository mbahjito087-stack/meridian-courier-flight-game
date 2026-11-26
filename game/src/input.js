// Keyboard and mouse: the pilot's stick, throttle and switches. Keyboard
// is the primary control; holding the mouse button turns the pointer into a
// virtual stick (drag up to climb, left and right to bank). Every key the
// game uses is listed here, so the help line on the title screen never lies.
import { clamp } from './random.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { down: false, x: 0, y: 0, active: false };
    this.pressed = new Set();
    this.canvas = canvas;
    this.attach(canvas);
  }

  attach(canvas) {
    window.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.key)) {
        event.preventDefault();
      }
      if (!event.repeat) this.pressed.add(event.key.toLowerCase());
      this.keys.add(event.key.toLowerCase());
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase());
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this.mouse.active = false;
    });
    canvas.addEventListener('pointerdown', (event) => {
      this.mouse.down = true;
      this.mouse.active = true;
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.mouse.down) return;
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
    });
    const release = () => {
      this.mouse.down = false;
      this.mouse.active = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  /** A key pressed since the last frame was read (edge-triggered). */
  wasPressed(key) {
    return this.pressed.has(key.toLowerCase());
  }

  /** Clear the edge-triggered set; the loop calls this every frame. */
  endFrame() {
    this.pressed.clear();
  }

  down(key) {
    return this.keys.has(key.toLowerCase());
  }

  /**
   * The pilot's stick for this frame: roll and pitch in -1..1. Arrows fly;
   * A and D bank as well. Holding the mouse button turns the pointer into
   * a virtual stick (drag up to climb, left and right to bank). Throttle
   * lives on W and S (and Shift / Ctrl) and is kept by the game loop.
   */
  readStick() {
    let roll = 0;
    let pitch = 0;
    if (this.down('arrowleft') || this.down('a')) roll -= 1;
    if (this.down('arrowright') || this.down('d')) roll += 1;
    if (this.down('arrowup')) pitch += 1;
    if (this.down('arrowdown')) pitch -= 1;
    if (this.mouse.down && roll === 0 && pitch === 0) {
      const rect = this.canvas.getBoundingClientRect();
      const nx = (this.mouse.x - rect.left) / rect.width - 0.5;
      const ny = (this.mouse.y - rect.top) / rect.height - 0.5;
      roll = clamp(nx * 3.2, -1, 1);
      pitch = clamp(-ny * 3.2, -1, 1);
    }
    return { roll, pitch };
  }
}
