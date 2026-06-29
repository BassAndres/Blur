// Unified input: keyboard (desktop), on-screen touch buttons (mobile), and
// optional device-tilt steering. Produces a normalized control state each frame.
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.state = {
      steer: 0,        // -1 (left) .. +1 (right)
      throttle: 0,     // 0..1
      brake: 0,        // 0..1
      handbrake: false,
      firePressed: false,   // edge-triggered (consume with consumeFire)
      swapPressed: false,   // edge-triggered
      lookBack: false,
      pausePressed: false,
    };
    this.keys = {};
    this.useTilt = false;
    this.tiltSteer = 0;
    this._touchSteer = 0;
    this._touchThrottle = 0;
    this._touchBrake = 0;
    this._fireQueued = false;
    this._swapQueued = false;
    this._pauseQueued = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onTilt = this._onTilt.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.disableTilt();
  }

  _onKeyDown(e) {
    if (e.repeat) {
      // still let arrow/space repeats be ignored for edge actions
    }
    const k = e.key.toLowerCase();
    this.keys[k] = true;
    if (k === ' ' || k === 'enter') { if (!e.repeat) this._fireQueued = true; }
    if (k === 'shift') { if (!e.repeat) this._swapQueued = true; }
    if (k === 'q') { if (!e.repeat) this._swapQueued = true; }
    if (k === 'escape' || k === 'p') { if (!e.repeat) this._pauseQueued = true; }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  }

  _onKeyUp(e) {
    this.keys[e.key.toLowerCase()] = false;
  }

  // ---- touch button hooks (called by the touch UI) ----
  setTouchSteer(v) { this._touchSteer = clamp(v, -1, 1); }
  setTouchThrottle(v) { this._touchThrottle = clamp(v, 0, 1); }
  setTouchBrake(v) { this._touchBrake = clamp(v, 0, 1); }
  queueFire() { this._fireQueued = true; }
  queueSwap() { this._swapQueued = true; }
  queuePause() { this._pauseQueued = true; }

  // ---- tilt steering ----
  enableTilt() {
    this.useTilt = true;
    window.addEventListener('deviceorientation', this._onTilt);
  }
  disableTilt() {
    this.useTilt = false;
    window.removeEventListener('deviceorientation', this._onTilt);
  }
  _onTilt(e) {
    // gamma: left-right tilt in degrees when held in landscape.
    const g = e.gamma || 0;
    // map roughly -35..+35 deg to -1..1
    this.tiltSteer = clamp(g / 35, -1, 1);
  }

  // Build the per-frame control state from all sources.
  update() {
    const k = this.keys;
    let steer = 0;
    if (k['arrowleft'] || k['a']) steer -= 1;
    if (k['arrowright'] || k['d']) steer += 1;
    steer += this._touchSteer;
    if (this.useTilt) steer += this.tiltSteer;
    this.state.steer = clamp(steer, -1, 1);

    let throttle = 0;
    if (k['arrowup'] || k['w']) throttle = 1;
    throttle = Math.max(throttle, this._touchThrottle);
    this.state.throttle = throttle;

    let brake = 0;
    if (k['arrowdown'] || k['s']) brake = 1;
    brake = Math.max(brake, this._touchBrake);
    this.state.brake = brake;

    this.state.handbrake = !!k[' '] && false; // space is fire; handbrake via touch only
    this.state.lookBack = !!k['c'];

    this.state.firePressed = this._fireQueued;
    this.state.swapPressed = this._swapQueued;
    this.state.pausePressed = this._pauseQueued;
    this._fireQueued = false;
    this._swapQueued = false;
    this._pauseQueued = false;
    return this.state;
  }
}
