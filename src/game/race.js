// Race session: owns the track, all vehicles (player + AI), pickups, power-ups,
// effects and HUD. Runs the countdown, per-frame simulation, chase camera, race
// positions, car-to-car collisions and finish/standings, then reports results.
import * as THREE from 'three';
import { Track } from './track.js';
import { Vehicle } from './vehicle.js';
import { AIController } from './ai.js';
import { PickupField } from './pickups.js';
import { PowerupSystem } from './powerups.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { CARS, getCar } from './cars.js';
import { makeRng, clamp, damp } from '../engine/util.js';

const AI_NAMES = ['Nyx', 'Volt', 'Razor', 'Echo', 'Blitz', 'Saint', 'Kobra', 'Drift', 'Onyx', 'Flux'];

export class Race {
  constructor({ renderer, input, audio, uiRoot, config }) {
    this.renderer = renderer;
    this.scene = renderer.scene;
    this.camera = renderer.camera;
    this.input = input;
    this.audio = audio;
    this.config = config;       // { trackDef, playerCarId, fieldSize, mode, laps }
    this.rng = makeRng(((config.trackDef.id || 'x').length * 97 + (config.seed || 7)) | 0);

    this.state = 'countdown';   // countdown | racing | finished
    this.countdown = 3.999;
    this.elapsed = 0;
    this.raceEndTimer = -1;
    this.onFinish = null;
    this.paused = false;

    // build world
    this.track = new Track(config.trackDef);
    if (this.track.laps != null && config.laps) this.track.laps = config.laps;
    this.scene.add(this.track.build());

    this.effects = new Effects(this.scene);
    this.powerups = new PowerupSystem(this.scene, this.effects, this.audio);
    this.pickups = new PickupField(this.track, this.scene, this.effects, this.audio, this.rng);

    this.vehicles = [];
    this.ai = [];
    this._buildField();

    this.hud = new HUD(uiRoot, this.track);
    this.hud.setCountdown('3');

    this._camPos = new THREE.Vector3().copy(this.camera.position);
    this._tmp = new THREE.Vector3();
  }

  _buildField() {
    const isTimeTrial = this.config.mode === 'timetrial';
    const field = isTimeTrial ? 1 : (this.config.fieldSize || 8);
    const starts = this.track.startPositions;

    // player
    const pCar = getCar(this.config.playerCarId);
    const player = new Vehicle(pCar, { isPlayer: true, name: 'TÚ' });
    player.placeAt(starts[0]);
    this.scene.add(player.mesh);
    this.vehicles.push(player);
    this.player = player;

    // AI opponents (varied cars + skill)
    const pool = CARS.filter((c) => c.id !== pCar.id);
    for (let i = 1; i < field; i++) {
      const car = pool[(i - 1) % pool.length];
      const v = new Vehicle(car, { name: AI_NAMES[(i - 1) % AI_NAMES.length] });
      v.placeAt(starts[i % starts.length]);
      this.scene.add(v.mesh);
      this.vehicles.push(v);
      const skill = clamp(0.55 + this.rng() * 0.4, 0, 1);
      this.ai.push(new AIController(v, this.track, makeRng((i * 131 + 7) | 0), skill));
    }
    this._updatePositions();
  }

  start() {
    this.audio.startEngine();
    for (const v of this.vehicles) v.startRaceTimer();
  }

  pause(p) { this.paused = p; }

  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05); // clamp big frame gaps

    if (this.state === 'countdown') {
      const prev = Math.ceil(this.countdown - 1);
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 1);
      if (n !== prev) {
        if (n >= 1) { this.hud.setCountdown(String(n)); this.audio.countdownTick(); }
      }
      if (this.countdown <= 1 && this.state === 'countdown') {
        this.state = 'racing';
        this.hud.setCountdown('¡YA!');
        this.audio.countdownGo();
        for (const v of this.vehicles) v.startRaceTimer();
        setTimeout(() => this.hud.setCountdown(null), 700);
      }
      // let cars settle visually but no driving yet
      this._updateCameraAndHud(dt, false);
      return;
    }

    this.elapsed += dt;

    // --- player input ---
    const c = this.input.update();
    if (c.pausePressed && this._onPause) this._onPause();
    if (!this.player.finished && this.player.respawnTime <= 0) {
      if (c.swapPressed) { this.player.cycleInventory(); this.audio.ui(); }
      if (c.firePressed && this.player.inventory.length > 0) {
        const type = this.player.takeActive();
        const backwards = c.brake > 0.5 && c.throttle === 0; // hold brake to fire backward variant
        this.powerups.fire(type, this.player, this.vehicles, backwards);
      }
    }
    const playerControls = this.player.finished
      ? { steer: 0, throttle: 0, brake: 1, handbrake: false }
      : { steer: c.steer, throttle: c.throttle, brake: c.brake, handbrake: c.handbrake };

    // --- simulate vehicles ---
    this.player.update(dt, playerControls, this.track);
    for (let i = 0; i < this.ai.length; i++) {
      const ctrl = this.ai[i].update(dt, this.vehicles, this.powerups, this.player);
      this.ai[i].v.update(dt, ctrl, this.track);
    }

    this._resolveCarCollisions();
    this.powerups.update(dt, this.vehicles);
    this.pickups.update(dt, this.vehicles);
    this.effects.update(dt);
    this._updatePositions();
    this._checkFinish(dt);

    // engine audio follows player
    this.audio.updateEngine(this.player.speed01, playerControls.throttle);

    this._updateCameraAndHud(dt, true);
  }

  _resolveCarCollisions() {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (!a.alive || !b.alive || a.respawnTime > 0 || b.respawnTime > 0) continue;
        const d = a.pos.distanceTo(b.pos);
        const minD = 3.4;
        if (d < minD && d > 0.001) {
          const n = this._tmp.copy(b.pos).sub(a.pos).setY(0).normalize();
          const overlap = (minD - d) / 2;
          a.pos.addScaledVector(n, -overlap);
          b.pos.addScaledVector(n, overlap);
          // momentum exchange weighted by mass
          const relVel = b.vel.clone().sub(a.vel).dot(n);
          if (relVel < 0) {
            const imp = -relVel * 0.6;
            a.vel.addScaledVector(n, -imp * (b.mass / (a.mass + b.mass)));
            b.vel.addScaledVector(n, imp * (a.mass / (a.mass + b.mass)));
            // contact damage to the lighter/slower one
            const dmg = Math.min(8, Math.abs(relVel) * 0.6);
            if (a.mass < b.mass) a.damage(dmg, n.clone().negate()); else if (b.mass < a.mass) b.damage(dmg, n);
            if (a.isPlayer || b.isPlayer) this.audio.hit();
          }
        }
      }
    }
  }

  _updatePositions() {
    const sorted = [...this.vehicles].sort((x, y) => {
      // finished cars rank by finish time, then by distance
      if (x.finished && y.finished) return x.finishTime - y.finishTime;
      if (x.finished) return -1;
      if (y.finished) return 1;
      return y.totalDist - x.totalDist;
    });
    sorted.forEach((v, i) => { v.place = i + 1; });
    this.standings = sorted;
  }

  _checkFinish(dt) {
    for (const v of this.vehicles) {
      if (!v.finished && v.lap >= this.track.laps) {
        v.finished = true;
        v.finishTime = this.elapsed;
        if (v.isPlayer) {
          this.audio.finish();
          this.hud.flash(this.player.place === 1 ? '¡GANASTE!' : `TERMINASTE ${this.player.place}º`, 3);
          this.raceEndTimer = 3.5; // give a moment, then results
        } else if (this.player.finished) {
          // ok
        }
      }
    }
    if (this.raceEndTimer > 0) {
      this.raceEndTimer -= dt;
      if (this.raceEndTimer <= 0 && this.state !== 'finished') {
        this.state = 'finished';
        this._finishRace();
      }
    }
  }

  _finishRace() {
    // assign finish times to unfinished by extrapolating distance order
    this._updatePositions();
    const results = this.standings.map((v, i) => ({
      place: i + 1,
      name: v.name,
      isPlayer: v.isPlayer,
      car: v.carDef.name,
      color: v.carDef.color,
      time: v.finished ? v.finishTime : null,
      bestLap: v.bestLap,
      finished: v.finished,
    }));
    if (this.onFinish) this.onFinish(results, this.player);
  }

  _updateCameraAndHud(dt, racing) {
    const p = this.player;
    const fwd = this._tmp.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const back = this.input.state.lookBack;
    const dir = back ? fwd.clone().negate() : fwd;
    const speedZoom = 1 + p.speed01 * 0.25;
    const desired = new THREE.Vector3()
      .copy(p.pos)
      .addScaledVector(dir, -11 * speedZoom)
      .add(new THREE.Vector3(0, 5.2 + p.speed01 * 1.2, 0));
    // smooth follow
    this._camPos.x = damp(this._camPos.x, desired.x, 6, dt);
    this._camPos.y = damp(this._camPos.y, desired.y, 6, dt);
    this._camPos.z = damp(this._camPos.z, desired.z, 6, dt);

    // camera shake on impact
    let shake = 0;
    if (p.shakeTime > 0) shake = p.shakeTime * 0.6;
    this.camera.position.copy(this._camPos);
    if (shake > 0) this.camera.position.add(new THREE.Vector3((this.rng() - 0.5) * shake, (this.rng() - 0.5) * shake, (this.rng() - 0.5) * shake));

    const look = new THREE.Vector3().copy(p.pos).addScaledVector(dir, 8).add(new THREE.Vector3(0, 1.5, 0));
    this.camera.lookAt(look);
    // FOV kick with nitro
    const targetFov = 62 + (p.nitroTime > 0 ? 12 : 0) + p.speed01 * 6;
    this.camera.fov = damp(this.camera.fov, targetFov, 5, dt);
    this.camera.updateProjectionMatrix();

    this.hud.update(dt, this.player, this.vehicles);
  }

  setPauseCallback(fn) { this._onPause = fn; }

  dispose() {
    this.audio.stopEngine();
    this.hud.destroy();
    // remove everything we added
    this.scene.remove(this.track.group);
    this.scene.remove(this.pickups.group);
    for (const v of this.vehicles) this.scene.remove(v.mesh);
    this.powerups.reset();
  }
}
