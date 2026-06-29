// Persistence for progression (fans currency, unlocked cars/tracks, best lap
// times, championship progress) and settings. Backed by localStorage.
const KEY = 'blur.save.v1';

const DEFAULT = {
  fans: 0,
  unlockedCars: ['pulse', 'ember', 'venom'],
  unlockedTracks: ['downtown', 'harbor'],
  bestTimes: {},        // trackId -> seconds
  bestLaps: {},         // trackId -> seconds
  settings: { music: true, sfx: true, bloom: true, tilt: false },
  championships: {},    // seriesId -> { completed: bool, points }
};

export class Storage {
  constructor() { this.data = this._load(); }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      const parsed = JSON.parse(raw);
      return { ...structuredClone(DEFAULT), ...parsed, settings: { ...DEFAULT.settings, ...(parsed.settings || {}) } };
    } catch (e) { return structuredClone(DEFAULT); }
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {} }

  addFans(n) { this.data.fans += Math.max(0, Math.round(n)); this.save(); }
  get fans() { return this.data.fans; }

  isCarUnlocked(id) { return this.data.unlockedCars.includes(id); }
  isTrackUnlocked(id) { return this.data.unlockedTracks.includes(id); }

  unlockCar(id) { if (!this.data.unlockedCars.includes(id)) { this.data.unlockedCars.push(id); this.save(); } }
  unlockTrack(id) { if (!this.data.unlockedTracks.includes(id)) { this.data.unlockedTracks.push(id); this.save(); } }

  // Auto-unlock anything affordable by current fans; returns newly unlocked names.
  syncUnlocks(cars, tracks) {
    const newly = [];
    for (const c of cars) if (c.locked && c.unlockFans && this.data.fans >= c.unlockFans && !this.isCarUnlocked(c.id)) { this.unlockCar(c.id); newly.push(c.name); }
    for (const t of tracks) if (t.locked && t.unlockFans && this.data.fans >= t.unlockFans && !this.isTrackUnlocked(t.id)) { this.unlockTrack(t.id); newly.push(t.name); }
    return newly;
  }

  recordRace(trackId, totalTime, bestLap) {
    if (totalTime != null && (this.data.bestTimes[trackId] == null || totalTime < this.data.bestTimes[trackId])) this.data.bestTimes[trackId] = totalTime;
    if (bestLap != null && (this.data.bestLaps[trackId] == null || bestLap < this.data.bestLaps[trackId])) this.data.bestLaps[trackId] = bestLap;
    this.save();
  }

  get settings() { return this.data.settings; }
  setSetting(k, v) { this.data.settings[k] = v; this.save(); }
}

export const store = new Storage();
