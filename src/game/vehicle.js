// Arcade vehicle physics. Velocity-vector model with grip-based drift, nitro,
// damage/HP and respawn. Cars are kept on the road by projecting onto the track
// spline and clamping the lateral offset against the walls.
import * as THREE from 'three';
import { clamp, damp, angleDelta } from '../engine/util.js';
import { buildCarMesh } from './cars.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Vehicle {
  constructor(carDef, { isPlayer = false, name = 'CPU' } = {}) {
    this.carDef = carDef;
    this.isPlayer = isPlayer;
    this.name = name;

    // Derived tuning from arcade stats (0..1)
    this.maxSpeed = 36 + carDef.topSpeed * 44;       // m/s  (~130..288 km/h)
    this.engineForce = 26 + carDef.accel * 30;        // m/s^2
    this.brakeForce = 46;
    this.baseGrip = 5.5 + carDef.grip * 7;            // lateral kill rate /s
    this.turnRate = 1.9 + carDef.grip * 0.7;          // rad/s authority
    this.mass = 0.7 + carDef.strength * 0.8;          // affects knockback
    this.maxHp = 80 + carDef.strength * 80;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = this.maxHp;
    this.alive = true;

    // race progress
    this.u = 0;            // current curve param
    this.lap = 0;
    this.totalDist = 0;
    this.place = 1;
    this.finished = false;
    this.finishTime = null;
    this.lapTimes = [];
    this.bestLap = null;
    this._lapStart = 0;
    this._lastU = 0;
    this._checkpointHalf = false;  // crossed midpoint this lap (anti-cheat for finish)

    // power-ups (Blur-style inventory of up to 3)
    this.inventory = [];
    this.activeSlot = 0;
    this.maxInventory = 3;

    // effects/state timers
    this.nitroTime = 0;
    this.shieldTime = 0;
    this.spinTime = 0;       // spun out / stunned
    this.respawnTime = 0;
    this.shakeTime = 0;
    this.driftAmount = 0;    // 0..1 for visuals/audio
    this.boostPad = 0;

    this.mesh = buildCarMesh(carDef.color, { isPlayer });
    this._tmpFwd = new THREE.Vector3();
  }

  get forwardSpeed() {
    this._tmpFwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return this.vel.dot(this._tmpFwd);
  }
  get speedKmh() { return Math.max(0, this.forwardSpeed) * 3.6; }
  get speed01() { return clamp(Math.abs(this.forwardSpeed) / this.maxSpeed, 0, 1); }

  placeAt(start) {
    this.pos.set(start.x, 0, start.z);
    this.yaw = start.yaw;
    this.u = start.u;
    this._lastU = start.u;
    this.vel.set(0, 0, 0);
    this.syncMesh();
  }

  // controls: { steer, throttle, brake, handbrake } ; track for constraint
  update(dt, controls, track) {
    if (this.respawnTime > 0) {
      this.respawnTime -= dt;
      if (this.respawnTime <= 0) this._completeRespawn(track);
      this.syncMesh();
      return;
    }

    const fwd = this._tmpFwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let fSpeed = this.vel.dot(fwd);

    // stun / spinout disables driving but keeps sliding
    const stunned = this.spinTime > 0;
    if (stunned) {
      this.spinTime -= dt;
      this.yaw += 6 * dt; // visible spin
      controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    }

    // --- longitudinal ---
    const nitro = this.nitroTime > 0;
    if (nitro) this.nitroTime -= dt;
    const padBoost = this.boostPad > 0;
    if (this.boostPad > 0) this.boostPad -= dt;

    const topNow = this.maxSpeed * (nitro ? 1.42 : padBoost ? 1.2 : 1);
    if (controls.throttle > 0 && fSpeed < topNow) {
      this.vel.addScaledVector(fwd, this.engineForce * controls.throttle * (nitro ? 1.6 : 1) * dt);
    }
    if (controls.brake > 0) {
      if (fSpeed > 0.5) this.vel.addScaledVector(fwd, -this.brakeForce * controls.brake * dt);
      else this.vel.addScaledVector(fwd, -this.engineForce * 0.5 * controls.brake * dt); // reverse
    }
    // drag + rolling resistance
    const dragK = 0.9 + this.speed01 * 0.7;
    this.vel.addScaledVector(this.vel, -dragK * dt * 0.06);
    if (controls.throttle === 0 && controls.brake === 0) {
      // engine braking
      this.vel.addScaledVector(fwd, -Math.sign(fSpeed) * Math.min(Math.abs(fSpeed), 6) * dt);
    }

    // --- steering / yaw ---
    fSpeed = this.vel.dot(fwd);
    const speedFactor = clamp(Math.abs(fSpeed) / 12, 0, 1);   // need some speed to turn
    const reverse = fSpeed < -0.5 ? -1 : 1;
    let turn = controls.steer * this.turnRate * (0.35 + 0.65 * speedFactor) * reverse;
    // tighter rotation while drifting
    if (controls.handbrake) turn *= 1.5;
    this.yaw += turn * dt;

    // --- grip: kill lateral velocity (drift feel) ---
    const newFwd = this._tmpFwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const fComp = newFwd.clone().multiplyScalar(this.vel.dot(newFwd));
    const latVec = this.vel.clone().sub(fComp);
    let grip = this.baseGrip;
    if (controls.handbrake) grip *= 0.18;        // handbrake = slide
    if (Math.abs(controls.steer) > 0.6 && this.speed01 > 0.6) grip *= 0.7; // natural drift in hard corners
    const latKill = clamp(grip * dt, 0, 1);
    this.driftAmount = clamp(latVec.length() / 12, 0, 1);
    latVec.multiplyScalar(1 - latKill);
    this.vel.copy(fComp).add(latVec);

    // integrate
    this.pos.addScaledVector(this.vel, dt);

    // --- keep on track ---
    this._constrainToTrack(track);
    // progress + lap timing
    this._updateProgress(track);

    // timers
    if (this.shieldTime > 0) this.shieldTime -= dt;
    if (this.shakeTime > 0) this.shakeTime -= dt;

    this.syncMesh();
  }

  _constrainToTrack(track) {
    const proj = track.project(this.pos, this._lastU);
    this.u = proj.u;
    const limit = track.halfWidth - 1.1;
    if (Math.abs(proj.lateral) > limit) {
      const over = Math.abs(proj.lateral) - limit;
      const sign = Math.sign(proj.lateral);
      // push back onto road
      this.pos.addScaledVector(proj.side, -sign * over);
      // remove outward velocity component + scrape speed
      const outVel = this.vel.dot(proj.side);
      if (Math.sign(outVel) === sign) {
        this.vel.addScaledVector(proj.side, -outVel * 1.4);
      }
      this.vel.multiplyScalar(0.92);
      if (this.isPlayer) this.shakeTime = Math.max(this.shakeTime, 0.12);
    }
  }

  _updateProgress(track) {
    const du = this.u - this._lastU;
    // crossed roughly the midpoint -> mark, used to validate a real lap
    if (this.u > 0.45 && this.u < 0.55) this._checkpointHalf = true;
    // detect finish-line crossing (u wraps high->low) with checkpoint guard
    if (du < -0.5 && this._checkpointHalf) {
      this._checkpointHalf = false;
      if (this.lap > 0 || this.totalDist > track.length * 0.5) {
        const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        const lapTime = t - this._lapStart;
        this._lapStart = t;
        this.lapTimes.push(lapTime);
        if (this.bestLap == null || lapTime < this.bestLap) this.bestLap = lapTime;
      }
      this.lap++;
    } else if (du > 0.5) {
      // wrapped backwards (drove in reverse over the line) — undo
      this.lap = Math.max(0, this.lap - 1);
    }
    this._lastU = this.u;
    this.totalDist = track.totalDistanceFor(this.lap, this.u);
  }

  startRaceTimer() {
    this._lapStart = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }
  currentLapTime() {
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    return t - this._lapStart;
  }

  // ---------- combat ----------
  damage(amount, fromDir = null) {
    if (this.shieldTime > 0) { this.shieldTime = Math.max(0, this.shieldTime - 0.4); return false; }
    this.hp -= amount;
    this.shakeTime = 0.3;
    if (fromDir) this.vel.addScaledVector(fromDir, amount * 0.05 / this.mass);
    if (this.hp <= 0) { this._destroy(); return true; }
    return false;
  }

  knockback(dir, force) {
    this.vel.addScaledVector(dir, force / this.mass);
  }

  spinOut(time = 1.4) { if (this.shieldTime <= 0) this.spinTime = Math.max(this.spinTime, time); }

  _destroy() {
    this.hp = 0;
    this.respawnTime = 2.0;
    this.vel.set(0, 0, 0);
    this.spinTime = 0;
  }
  _completeRespawn(track) {
    const back = (this.u - 0.004 + 1) % 1;
    const p = track.pointAt(back, 0);
    this.pos.set(p.x, 0, p.z);
    this.yaw = track.headingAt(this.u);
    this.vel.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.maxSpeed * 0.25);
    this.hp = this.maxHp;
    this.shieldTime = 2.0; // brief invuln
  }

  giveBoost(time = 1.4) { this.nitroTime = Math.max(this.nitroTime, time); }

  // ---------- inventory ----------
  addPowerup(type) {
    if (this.inventory.length >= this.maxInventory) return false;
    this.inventory.push(type);
    return true;
  }
  cycleInventory() {
    if (this.inventory.length > 1) this.activeSlot = (this.activeSlot + 1) % this.inventory.length;
  }
  takeActive() {
    if (this.inventory.length === 0) return null;
    const slot = clamp(this.activeSlot, 0, this.inventory.length - 1);
    const type = this.inventory.splice(slot, 1)[0];
    this.activeSlot = clamp(this.activeSlot, 0, Math.max(0, this.inventory.length - 1));
    return type;
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    // bank/lean into the slide: sign from lateral velocity relative to heading
    const right = this._tmpFwd.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const latSign = Math.sign(this.vel.dot(right)) || 0;
    const lean = clamp(this.driftAmount, 0, 1) * 0.18;
    this.mesh.rotation.z = -lean * latSign;
    // blink/hide briefly right after being destroyed
    this.mesh.visible = !(this.respawnTime > 1.2);
    // spin wheels
    const wheels = this.mesh.userData.wheels;
    if (wheels) { const spin = this.forwardSpeed * 0.1; for (const w of wheels) w.rotation.x += spin; }
    // shield visual
    if (this._shieldMesh) this._shieldMesh.visible = this.shieldTime > 0;
  }
}
