// AI driver: produces a controls object for a Vehicle each frame. Follows the
// track via a look-ahead target on the spline (with a per-driver lane offset and
// noise), brakes for sharp corners, rubber-bands its top speed toward the player
// to keep races close, and opportunistically fires power-ups.
import * as THREE from 'three';
import { clamp, angleDelta } from '../engine/util.js';

export class AIController {
  constructor(vehicle, track, rng, skill = 0.7) {
    this.v = vehicle;
    this.track = track;
    this.rng = rng;
    this.skill = skill;                 // 0..1
    this.lane = (rng() - 0.5) * track.halfWidth * 0.9;
    this.laneTimer = rng() * 3;
    this.fireCd = 1 + rng() * 2;
    this._steerSmooth = 0;
  }

  update(dt, vehicles, powerups, player) {
    const v = this.v;
    if (v.finished || v.respawnTime > 0) return { steer: 0, throttle: v.finished ? 0 : 1, brake: 0, handbrake: false };

    // wander the preferred lane a bit
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) { this.laneTimer = 2 + this.rng() * 3; this.lane = (this.rng() - 0.5) * this.track.halfWidth * 0.9; }

    // look-ahead target: further ahead at higher speed
    const lead = 0.006 + v.speed01 * 0.012;
    const aimU = (v.u + lead) % 1;
    const aim = this.track.pointAt(aimU, this.lane);
    const toAim = aim.clone().sub(v.pos).setY(0);
    const desiredYaw = Math.atan2(toAim.x, toAim.z);
    let steer = clamp(angleDelta(v.yaw, desiredYaw) * 2.2, -1, 1);
    // skill adds steadiness; low skill wobbles
    steer += (this.rng() - 0.5) * (1 - this.skill) * 0.25;
    this._steerSmooth = this._steerSmooth + (steer - this._steerSmooth) * clamp(dt * 12, 0, 1);
    steer = clamp(this._steerSmooth, -1, 1);

    // corner severity (compare heading now vs further ahead) -> brake
    const farU = (v.u + 0.03) % 1;
    const headNow = this.track.headingAt(v.u);
    const headFar = this.track.headingAt(farU);
    const curve = Math.abs(angleDelta(headNow, headFar));
    let throttle = 1;
    let brake = 0;
    const cornerLimit = 0.5 + this.skill * 0.5;
    if (curve > cornerLimit && v.speed01 > 0.55) { throttle = 0.3; brake = clamp((curve - cornerLimit) * 1.5, 0, 0.8); }

    // rubber-banding: scale effective throttle by relative position to player
    if (player && player !== v && !player.finished) {
      const gap = v.totalDist - player.totalDist; // + ahead of player
      if (gap > 40) throttle *= 0.9;               // ease off when way ahead
      else if (gap < -40) v.boostPad = Math.max(v.boostPad, 0.2); // small catch-up nudge
    }

    // use power-ups
    this.fireCd -= dt;
    if (this.fireCd <= 0 && v.inventory.length > 0) {
      this._maybeFire(vehicles, powerups, player);
      this.fireCd = 1.2 + this.rng() * 2.5;
    }

    return { steer, throttle, brake, handbrake: false };
  }

  _maybeFire(vehicles, powerups, player) {
    const v = this.v;
    const type = v.inventory[0];
    // defensive items: use proactively
    if (type === 'repair' && v.hp < v.maxHp * 0.5) { powerups.fire(v.takeActive(), v, vehicles); return; }
    if (type === 'nitro') { powerups.fire(v.takeActive(), v, vehicles); return; }
    if (type === 'shield') {
      // pop shield if someone is close behind
      const behind = vehicles.some((o) => o !== v && o.alive && o.totalDist < v.totalDist && Math.abs(o.totalDist - v.totalDist) < 25);
      if (behind || this.rng() < 0.3) powerups.fire(v.takeActive(), v, vehicles);
      return;
    }
    // offensive items: fire if there's a target ahead within range
    const ahead = vehicles.find((o) => o !== v && o.alive && o.totalDist > v.totalDist && o.totalDist - v.totalDist < 60);
    if (ahead || type === 'mine') powerups.fire(v.takeActive(), v, vehicles);
    else if (this.rng() < 0.4) powerups.fire(v.takeActive(), v, vehicles);
  }
}
