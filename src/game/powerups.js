// Power-up system. Defines the eight Blur-style power-ups, their HUD glyphs, and
// the world entities they spawn (energy bolts, homing missiles, mines, shock
// strikes, shockwaves). Effects are applied to Vehicle instances.
import * as THREE from 'three';

export const POWERUPS = {
  bolt:   { name: 'Bolt',   glyph: '⚡', color: 0x19e6ff, weight: 22, desc: 'Tres disparos de energía hacia adelante' },
  shunt:  { name: 'Shunt',  glyph: '🎯', color: 0xff5a1f, weight: 14, desc: 'Misil teledirigido al rival de adelante' },
  mine:   { name: 'Mine',   glyph: '💣', color: 0xff3b3b, weight: 16, desc: 'Suelta una mina detrás' },
  shock:  { name: 'Shock',  glyph: '🌩', color: 0xffe14d, weight: 12, desc: 'Rayos sobre los autos de adelante' },
  shield: { name: 'Shield', glyph: '🛡', color: 0x39ff88, weight: 14, desc: 'Escudo defensivo' },
  nitro:  { name: 'Nitro',  glyph: '🔥', color: 0xff2bd6, weight: 16, desc: 'Turbo de velocidad' },
  barge:  { name: 'Barge',  glyph: '💥', color: 0x9b6bff, weight: 12, desc: 'Onda de empuje a los costados' },
  repair: { name: 'Repair', glyph: '✚', color: 0x39ffd2, weight: 10, desc: 'Repara tu auto' },
};

export const POWERUP_IDS = Object.keys(POWERUPS);

// Position-weighted pickup: cars further back get better odds at offensive items
// (mirrors Blur's catch-up design). place is 1..N.
export function rollPowerup(rng, place, total) {
  const back = total > 1 ? (place - 1) / (total - 1) : 0; // 0 leader .. 1 last
  const weights = POWERUP_IDS.map((id) => {
    let w = POWERUPS[id].weight;
    if (id === 'shunt' || id === 'shock' || id === 'barge') w *= 0.5 + back * 1.5;
    if (id === 'nitro') w *= 0.6 + back * 1.2;
    if (id === 'shield' || id === 'mine') w *= 1.3 - back * 0.4;
    return w;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let i = 0; i < POWERUP_IDS.length; i++) { r -= weights[i]; if (r <= 0) return POWERUP_IDS[i]; }
  return POWERUP_IDS[0];
}

export class PowerupSystem {
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.entities = []; // projectiles, mines
  }

  reset() {
    for (const e of this.entities) this.scene.remove(e.mesh);
    this.entities = [];
  }

  // Fire `type` from `owner` against the field of `vehicles`.
  fire(type, owner, vehicles, backwards = false) {
    switch (type) {
      case 'bolt': return this._fireBolt(owner, vehicles);
      case 'shunt': return this._fireShunt(owner, vehicles, backwards);
      case 'mine': return this._dropMine(owner);
      case 'shock': return this._fireShock(owner, vehicles);
      case 'shield': owner.shieldTime = 6; this.audio.shield(); this._attachShield(owner); return;
      case 'nitro': owner.giveBoost(2.0); this.audio.nitro(); return;
      case 'barge': return this._barge(owner, vehicles);
      case 'repair': owner.hp = Math.min(owner.maxHp, owner.hp + owner.maxHp * 0.5); this.audio.repair(); this.effects.pickupFlash(owner.pos, 0x39ffd2); return;
    }
  }

  _fwd(owner) { return new THREE.Vector3(Math.sin(owner.yaw), 0, Math.cos(owner.yaw)); }

  _nearestAhead(owner, vehicles, behind = false) {
    let best = null, bestDist = Infinity;
    for (const v of vehicles) {
      if (v === owner || !v.alive || v.respawnTime > 0) continue;
      const ahead = v.totalDist - owner.totalDist;
      const ok = behind ? ahead < 0 : ahead > 0;
      if (ok && Math.abs(ahead) < bestDist) { bestDist = Math.abs(ahead); best = v; }
    }
    return best;
  }

  _fireBolt(owner, vehicles) {
    this.audio.fireBolt();
    const target = this._nearestAhead(owner, vehicles);
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 8, 8),
        new THREE.MeshBasicMaterial({ color: POWERUPS.bolt.color })
      );
      const light = new THREE.PointLight(POWERUPS.bolt.color, 2, 8);
      mesh.add(light);
      const fwd = this._fwd(owner);
      mesh.position.copy(owner.pos).addScaledVector(fwd, 3).add(new THREE.Vector3(0, 0.7, 0));
      this.scene.add(mesh);
      this.entities.push({
        kind: 'bolt', mesh, owner, target,
        vel: fwd.clone().multiplyScalar(60).add(new THREE.Vector3((i - 1) * 4, 0, 0)),
        life: 2.5, damage: 18,
      });
    }
  }

  _fireShunt(owner, vehicles, backwards) {
    const target = this._nearestAhead(owner, vehicles, backwards);
    this.audio.fireMissile();
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 8), new THREE.MeshStandardMaterial({ color: POWERUPS.shunt.color, emissive: POWERUPS.shunt.color, emissiveIntensity: 1.5 }));
    body.rotation.x = Math.PI / 2;
    mesh.add(body);
    mesh.add(new THREE.PointLight(POWERUPS.shunt.color, 3, 10));
    const fwd = this._fwd(owner).multiplyScalar(backwards ? -1 : 1);
    mesh.position.copy(owner.pos).addScaledVector(fwd, 3.5).add(new THREE.Vector3(0, 0.7, 0));
    this.scene.add(mesh);
    this.entities.push({ kind: 'shunt', mesh, owner, target, vel: fwd.clone().multiplyScalar(40), life: 6, damage: 45, homing: true });
  }

  _dropMine(owner) {
    this.audio.dropMine();
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.6, 0),
      new THREE.MeshStandardMaterial({ color: POWERUPS.mine.color, emissive: POWERUPS.mine.color, emissiveIntensity: 1.2 })
    );
    const fwd = this._fwd(owner);
    mesh.position.copy(owner.pos).addScaledVector(fwd, -4).add(new THREE.Vector3(0, 0.5, 0));
    this.scene.add(mesh);
    this.entities.push({ kind: 'mine', mesh, owner, arm: 0.6, life: 18, damage: 40 });
  }

  _fireShock(owner, vehicles) {
    this.audio.shock();
    // hits up to 3 cars directly ahead
    const ahead = vehicles
      .filter((v) => v !== owner && v.alive && v.respawnTime <= 0 && v.totalDist > owner.totalDist)
      .sort((a, b) => (a.totalDist - owner.totalDist) - (b.totalDist - owner.totalDist))
      .slice(0, 3);
    for (const v of ahead) {
      this.effects.explosion(v.pos, POWERUPS.shock.color);
      v.spinOut(1.3);
      v.damage(28, this._fwd(owner));
    }
    if (ahead.length === 0) {
      // nobody ahead: small self-area flash
      this.effects.ring(owner.pos, POWERUPS.shock.color, 6, 0.4);
    }
  }

  _barge(owner, vehicles) {
    this.audio.barge();
    this.effects.ring(owner.pos, POWERUPS.barge.color, 12, 0.5);
    const R = 12;
    for (const v of vehicles) {
      if (v === owner || !v.alive) continue;
      const d = v.pos.distanceTo(owner.pos);
      if (d < R) {
        const dir = v.pos.clone().sub(owner.pos).setY(0).normalize();
        v.knockback(dir, (R - d) * 3);
        v.damage(14, dir);
        if (d < 6) v.spinOut(0.8);
      }
    }
    // destroy nearby hostile entities (projectiles/mines)
    for (const e of this.entities) {
      if (e.owner !== owner && e.mesh.position.distanceTo(owner.pos) < R) e.dead = true;
    }
  }

  _attachShield(owner) {
    if (!owner._shieldMesh) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(3, 16, 12),
        new THREE.MeshBasicMaterial({ color: POWERUPS.shield.color, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
      );
      owner.mesh.add(m);
      owner._shieldMesh = m;
    }
    owner._shieldMesh.visible = true;
  }

  update(dt, vehicles) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.life -= dt;
      let remove = e.dead || e.life <= 0;

      if (!remove) {
        if (e.kind === 'bolt') {
          if (e.target && e.target.alive && e.target.respawnTime <= 0) {
            const to = e.target.pos.clone().sub(e.mesh.position).setY(0).normalize();
            e.vel.lerp(to.multiplyScalar(e.vel.length()), 0.04);
          }
          e.mesh.position.addScaledVector(e.vel, dt);
          remove = this._collide(e, vehicles, 1.8);
        } else if (e.kind === 'shunt') {
          if (e.target && e.target.alive && e.target.respawnTime <= 0) {
            const to = e.target.pos.clone().sub(e.mesh.position).setY(0).normalize();
            e.vel.lerp(to.multiplyScalar(Math.min(70, e.vel.length() + 30 * dt)), 0.08);
            e.mesh.lookAt(e.target.pos.x, e.mesh.position.y, e.target.pos.z);
          }
          e.mesh.position.addScaledVector(e.vel, dt);
          remove = this._collide(e, vehicles, 2.2, true);
        } else if (e.kind === 'mine') {
          if (e.arm > 0) e.arm -= dt;
          e.mesh.rotation.y += dt * 2;
          if (e.arm <= 0) {
            for (const v of vehicles) {
              if (v === e.owner && e.life > 17) continue; // don't blow up on the dropper immediately
              if (!v.alive || v.respawnTime > 0) continue;
              if (v.pos.distanceTo(e.mesh.position) < 2.6) {
                this.effects.explosion(e.mesh.position, POWERUPS.mine.color);
                this.audio.explosion();
                v.spinOut(1.2);
                v.damage(e.damage, v.pos.clone().sub(e.mesh.position).setY(0).normalize());
                remove = true; break;
              }
            }
          }
        }
      }

      if (remove) {
        if (e.kind === 'shunt' && !e.dead) { /* explosion handled in _collide */ }
        this.scene.remove(e.mesh);
        this.entities.splice(i, 1);
      }
    }
  }

  _collide(e, vehicles, radius, explode = false) {
    for (const v of vehicles) {
      if (v === e.owner || !v.alive || v.respawnTime > 0) continue;
      if (v.pos.distanceTo(e.mesh.position) < radius) {
        const dir = e.vel.clone().setY(0).normalize();
        if (explode) { this.effects.explosion(v.pos, e.mesh.children[0]?.material?.color?.getHex?.() || 0xff5a1f); this.audio.explosion(); v.spinOut(1.3); }
        else { this.effects.sparks(v.pos, POWERUPS.bolt.color, 8); this.audio.hit(); }
        v.damage(e.damage, dir);
        return true;
      }
    }
    return false;
  }
}
