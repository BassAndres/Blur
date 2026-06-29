// Entry point. Wires together the renderer, input, audio, menus and the race
// session; runs the main loop; and drives game flow (quick race, time trial,
// championship), fan rewards and unlocks.
import './styles.css';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { Screens } from './ui/screens.js';
import { TouchControls } from './ui/touch.js';
import { Race } from './game/race.js';
import { store } from './game/storage.js';
import { getTrack, TRACKS } from './tracks/index.js';
import { CARS } from './game/cars.js';

const POINTS = [15, 12, 10, 8, 6, 4, 2, 1, 1, 1, 1, 1];

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.uiRoot = document.getElementById('ui-root');
    this.touchRoot = document.getElementById('touch-controls');

    this.renderer = new Renderer(this.canvas);
    this.input = new Input();
    this.input.attach();

    this.screens = new Screens(this.uiRoot, { store, audio, onAction: (a, p) => this.onAction(a, p) });
    this.touch = new TouchControls(this.touchRoot, this.input, audio);

    this.race = null;
    this.mode = 'menu';     // menu | racing | paused | results
    this.championship = null;
    this.lastTime = performance.now();

    this.isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    this._applySettings();
    this._bindGlobalAudioUnlock();
    this.screens.main();
    requestAnimationFrame((t) => this.loop(t));
  }

  _applySettings() {
    const s = store.settings;
    audio.setMusic(s.music);
    audio.setSfx(s.sfx);
    this.renderer.setBloom(s.bloom);
    if (s.tilt && this.isTouch) this._enableTilt();
  }

  _enableTilt() {
    // iOS requires permission; Android grants automatically.
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') this.input.enableTilt(); }).catch(() => {});
    } else {
      this.input.enableTilt();
    }
  }

  _bindGlobalAudioUnlock() {
    const unlock = () => { audio.init(); audio.resume(); if (store.settings.music) audio.startMusic(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  // ---------------- flow ----------------
  onAction(action, payload) {
    switch (action) {
      case 'start-race': this.startRace({ mode: payload.mode, car: payload.car, track: payload.track }); break;
      case 'start-championship': this.startChampionship(payload.car); break;
      case 'resume': this.resumeRace(); break;
      case 'restart': this.restartRace(); break;
      case 'quit': this.quitToMenu(); break;
      case 'champ-next': this.championshipNext(); break;
      case 'champ-continue': this.championshipContinue(); break;
      case 'setting': this._onSetting(payload); break;
    }
  }

  _onSetting({ key, value }) {
    if (key === 'music') { value ? audio.startMusic() : audio.stopMusic(); audio.setMusic(value); }
    if (key === 'sfx') audio.setSfx(value);
    if (key === 'bloom') this.renderer.setBloom(value);
    if (key === 'tilt') { value ? this._enableTilt() : this.input.disableTilt(); }
  }

  startRace({ mode, car, track, fieldSize = 8, laps = null, champLabel = null }) {
    audio.init();
    this.screens.clear();
    if (this.race) { this.race.dispose(); this.race = null; }

    const trackDef = getTrack(track);
    this.race = new Race({
      renderer: this.renderer,
      input: this.input,
      audio,
      uiRoot: this.uiRoot,
      config: { trackDef, playerCarId: car, fieldSize: mode === 'timetrial' ? 1 : fieldSize, mode, laps, seed: (this.championship?.round || 0) + 1 },
    });
    this.race.onFinish = (results, player) => this.onRaceFinish(results, player);
    this.race.setPauseCallback(() => this.pauseRace());
    this.race.start();
    this._lastConfig = { mode, car, track, fieldSize, laps };
    this.mode = 'racing';
    if (this.isTouch) this.touch.show();
  }

  pauseRace() {
    if (this.mode !== 'racing') return;
    this.mode = 'paused';
    this.race.pause(true);
    this.touch.hide();
    this.screens.pause();
  }
  resumeRace() {
    if (this.mode !== 'paused') return;
    this.screens.clear();
    this.race.pause(false);
    this.mode = 'racing';
    if (this.isTouch) this.touch.show();
  }
  restartRace() {
    this.screens.clear();
    const cfg = this._lastConfig;
    if (this.championship) {
      // restart current championship round
      const r = this.championship.rounds[this.championship.round];
      this.startRace({ mode: 'championship', car: this.championship.car, track: r.track, laps: r.laps, fieldSize: 8 });
    } else {
      this.startRace(cfg);
    }
  }
  quitToMenu() {
    if (this.race) { this.race.dispose(); this.race = null; }
    this.touch.hide();
    this.championship = null;
    this.mode = 'menu';
    this.screens.main();
  }

  // ---------------- championship ----------------
  startChampionship(car) {
    const unlocked = TRACKS.filter((t) => store.isTrackUnlocked(t.id));
    const rounds = (unlocked.length >= 3 ? unlocked.slice(0, 4) : TRACKS.slice(0, 3)).map((t) => ({ track: t.id, laps: t.laps }));
    this.championship = { car, rounds, round: 0, points: {}, names: {} };
    const r = rounds[0];
    this.startRace({ mode: 'championship', car, track: r.track, laps: r.laps, fieldSize: 8 });
  }

  championshipNext() {
    // accumulate points from the just-finished race
    const c = this.championship;
    if (c.round >= c.rounds.length - 1) { this._showFinalStandings(); return; }
    this.screens.standings(this._standingsRows(), { round: c.round + 1, totalRounds: c.rounds.length, final: false });
    this.mode = 'results';
  }
  championshipContinue() {
    const c = this.championship;
    c.round++;
    const r = c.rounds[c.round];
    this.startRace({ mode: 'championship', car: c.car, track: r.track, laps: r.laps, fieldSize: 8 });
  }
  _showFinalStandings() {
    this.screens.standings(this._standingsRows(), { round: this.championship.rounds.length, totalRounds: this.championship.rounds.length, final: true });
    // bonus fans for champion
    const rows = this._standingsRows();
    const me = rows.findIndex((r) => r.isPlayer);
    const bonus = [3000, 1800, 1200, 800][me] ?? 400;
    store.addFans(bonus);
    store.syncUnlocks(CARS, TRACKS);
    this.championship = null;
    this.mode = 'results';
  }
  _standingsRows() {
    const pts = this.championship.points;
    return Object.keys(pts)
      .map((name) => ({ name, points: pts[name], isPlayer: name === 'TÚ' }))
      .sort((a, b) => b.points - a.points);
  }

  // ---------------- results / rewards ----------------
  onRaceFinish(results, player) {
    this.touch.hide();
    this.mode = 'results';

    const fieldSize = results.length;
    const place = results.find((r) => r.isPlayer).place;

    // record best times
    store.recordRace(this._lastConfig.track, player.finished ? player.finishTime : null, player.bestLap);

    // fans reward
    let fansEarned = 0;
    if (this._lastConfig.mode === 'timetrial') {
      fansEarned = 400 + Math.round(Math.max(0, (player.bestLap ? 60 - player.bestLap : 0)) * 30);
    } else {
      fansEarned = Math.max(80, (fieldSize - place + 1) * 90) + (place === 1 ? 500 : place === 2 ? 250 : place === 3 ? 120 : 0);
    }
    store.addFans(fansEarned);
    const newlyUnlocked = store.syncUnlocks(CARS, TRACKS);

    // championship bookkeeping
    let champ = null;
    if (this.championship) {
      const c = this.championship;
      for (const r of results) c.points[r.name] = (c.points[r.name] || 0) + (POINTS[r.place - 1] || 0);
      champ = { last: c.round >= c.rounds.length - 1 };
    }

    this.screens.results(results, { fansEarned, newlyUnlocked, championship: champ });
  }

  // ---------------- loop ----------------
  loop(t) {
    const dt = Math.min(0.05, (t - this.lastTime) / 1000) || 0;
    this.lastTime = t;

    if ((this.mode === 'racing') && this.race) {
      this.race.update(dt);
    }
    this.renderer.render();
    requestAnimationFrame((tt) => this.loop(tt));
  }
}

window.addEventListener('DOMContentLoaded', () => { window.__blur = new Game(); });
