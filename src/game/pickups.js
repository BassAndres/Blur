// Pickup field: glowing pads arranged in 3-lane fans along the track. Driving
// over an active pad grants a (position-weighted) power-up, then the pad goes
// dormant and respawns after a delay — like Blur's power-up pickups.
import * as THREE from 'three';
import { rollPowerup } from './powerups.js';

export class PickupField {
  constructor(track, scene, effects, audio, rng) {
    this.track = track;
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.rng = rng;
    this.pads = [];
    this.group = new THREE.Group();
    this.respawnTime = 6;
    this._build();
    scene.add(this.group);
  }

  _build() {
    const len = this.track.length;
    const spacing = 70;
    const count = Math.floor(len / spacing);
    const laneOff = this.track.halfWidth * 0.55;
    const geo = new THREE.BoxGeometry(2.2, 0.3, 2.2);
    for (let i = 0; i < count; i++) {
      const u = (i / count + 0.04) % 1;
      for (const lane of [-laneOff, 0, laneOff]) {
        const p = this.track.pointAt(u, lane);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x19e6ff, emissiveIntensity: 1.4, transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, 0.6, p.z);
        this.group.add(mesh);
        this.pads.push({ mesh, u, lane, active: true, cd: 0, pos: new THREE.Vector3(p.x, 0.6, p.z) });
      }
    }
  }

  update(dt, vehicles) {
    const t = performance.now() / 1000;
    for (const pad of this.pads) {
      if (pad.active) {
        pad.mesh.rotation.y += dt * 1.5;
        pad.mesh.position.y = 0.6 + Math.sin(t * 3 + pad.u * 40) * 0.15;
        for (const v of vehicles) {
          if (!v.alive || v.respawnTime > 0) continue;
          if (v.inventory.length >= v.maxInventory) continue;
          if (v.pos.distanceToSquared(pad.pos) < 6.25) { // ~2.5m
            const type = rollPowerup(this.rng, v.place, vehicles.length);
            v.addPowerup(type);
            pad.active = false;
            pad.cd = this.respawnTime;
            pad.mesh.visible = false;
            if (v.isPlayer) { this.audio.pickup(); this.effects.pickupFlash(pad.pos, 0x39ff88); }
            break;
          }
        }
      } else {
        pad.cd -= dt;
        if (pad.cd <= 0) { pad.active = true; pad.mesh.visible = true; }
      }
    }
  }
}
