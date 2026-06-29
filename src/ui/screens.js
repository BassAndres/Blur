// Front-end menu system (DOM overlays): main menu, mode/car/track selection,
// garage/unlocks, settings, pause and results/standings. Each builder returns a
// detached element; the manager swaps the visible screen and runs callbacks.
import { CARS } from '../game/cars.js';
import { TRACKS } from '../tracks/index.js';
import { formatTime, posLabel } from '../engine/util.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class Screens {
  constructor(root, { store, audio, onAction }) {
    this.root = root;
    this.store = store;
    this.audio = audio;
    this.onAction = onAction;     // (action, payload) => void
    this.current = null;
    // transient selection state for the flow
    this.sel = { mode: 'quick', car: this._firstUnlockedCar(), track: this._firstUnlockedTrack() };
  }

  _firstUnlockedCar() { return (CARS.find((c) => this.store.isCarUnlocked(c.id)) || CARS[0]).id; }
  _firstUnlockedTrack() { return (TRACKS.find((t) => this.store.isTrackUnlocked(t.id)) || TRACKS[0]).id; }

  _show(el) {
    if (this.current) this.current.remove();
    this.current = el;
    el.classList.add('fade');
    this.root.appendChild(el);
  }
  clear() { if (this.current) { this.current.remove(); this.current = null; } }

  _btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = `btn ${cls || ''}`;
    b.textContent = label;
    b.addEventListener('click', () => { this.audio.ui(); onClick(); });
    return b;
  }

  _fansBadge() {
    const d = document.createElement('div');
    d.className = 'fans-badge';
    d.textContent = `★ ${this.store.fans.toLocaleString()} FANS`;
    return d;
  }

  // ---------------- main menu ----------------
  main() {
    const s = document.createElement('div');
    s.className = 'screen';
    s.appendChild(this._fansBadge());
    const title = document.createElement('div'); title.className = 'title'; title.textContent = 'BLUR';
    const sub = document.createElement('div'); sub.className = 'subtitle'; sub.textContent = 'Carreras de combate neón';
    s.append(title, sub);
    const menu = document.createElement('div'); menu.className = 'menu';
    menu.append(
      this._btn('Carrera rápida', '', () => { this.sel.mode = 'quick'; this.modeSelect(); }),
      this._btn('Campeonato', 'magenta', () => { this.sel.mode = 'championship'; this.carSelect(); }),
      this._btn('Contrarreloj', '', () => { this.sel.mode = 'timetrial'; this.carSelect(); }),
      this._btn('Garaje', 'ghost', () => this.garage()),
      this._btn('Ajustes', 'ghost', () => this.settings()),
    );
    s.appendChild(menu);
    const hint = document.createElement('div'); hint.className = 'hint';
    hint.textContent = 'Teclado: ↑↓←→ / WASD · Espacio: power-up · Shift: cambiar · P: pausa';
    s.appendChild(hint);
    this._show(s);
  }

  // ---------------- mode select (quick race options) ----------------
  modeSelect() {
    const s = document.createElement('div'); s.className = 'screen';
    s.appendChild(this._title('CARRERA RÁPIDA'));
    const menu = document.createElement('div'); menu.className = 'menu';
    menu.append(
      this._btn('Elegir auto', '', () => this.carSelect()),
      this._btn('Volver', 'ghost', () => this.main()),
    );
    s.appendChild(menu);
    this._show(s);
  }

  _title(text) { const d = document.createElement('div'); d.className = 'title'; d.style.fontSize = 'clamp(32px,9vw,72px)'; d.textContent = text; return d; }
  _subtitle(text) { const d = document.createElement('div'); d.className = 'subtitle'; d.textContent = text; return d; }

  // ---------------- car select ----------------
  carSelect() {
    const s = document.createElement('div'); s.className = 'screen';
    s.appendChild(this._fansBadge());
    s.appendChild(this._title('ELEGÍ TU AUTO'));
    const grid = document.createElement('div'); grid.className = 'card-grid';
    for (const c of CARS) {
      const unlocked = this.store.isCarUnlocked(c.id);
      const card = document.createElement('div');
      card.className = 'card' + (this.sel.car === c.id ? ' selected' : '') + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="swatch" style="background:linear-gradient(135deg, ${hex(c.color)}, #05060f)"></div>
        <h3>${c.name}</h3>
        ${this._statBar('Vel', c.topSpeed)}
        ${this._statBar('Acel', c.accel)}
        ${this._statBar('Agarre', c.grip)}
        ${this._statBar('Fuerza', c.strength)}
        ${unlocked ? '' : `<div class="stat">🔒 ${c.unlockFans.toLocaleString()} fans</div>`}
      `;
      if (unlocked) card.addEventListener('click', () => { this.audio.ui(); this.sel.car = c.id; this.carSelect(); });
      grid.appendChild(card);
    }
    s.appendChild(grid);
    const row = document.createElement('div'); row.className = 'row';
    row.append(
      this._btn('Continuar', 'magenta', () => { if (this.sel.mode === 'championship') this._startChampionship(); else this.trackSelect(); }),
      this._btn('Volver', 'ghost', () => this.main()),
    );
    s.appendChild(row);
    this._show(s);
  }

  _statBar(label, v) {
    return `<div class="stat">${label}<div class="bar"><span style="width:${Math.round(v * 100)}%"></span></div></div>`;
  }

  // ---------------- track select ----------------
  trackSelect() {
    const s = document.createElement('div'); s.className = 'screen';
    s.appendChild(this._fansBadge());
    s.appendChild(this._title('ELEGÍ PISTA'));
    const grid = document.createElement('div'); grid.className = 'card-grid';
    for (const t of TRACKS) {
      const unlocked = this.store.isTrackUnlocked(t.id);
      const best = this.store.data.bestTimes[t.id];
      const card = document.createElement('div');
      card.className = 'card' + (this.sel.track === t.id ? ' selected' : '') + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="swatch" style="background:linear-gradient(135deg, ${hex(t.neonA)}, ${hex(t.neonB)})"></div>
        <h3>${t.name}</h3>
        <div class="stat">${t.laps} vueltas</div>
        <div class="stat">Mejor: ${best ? formatTime(best) : '--:--.--'}</div>
        ${unlocked ? '' : `<div class="stat">🔒 ${t.unlockFans.toLocaleString()} fans</div>`}
      `;
      if (unlocked) card.addEventListener('click', () => { this.audio.ui(); this.sel.track = t.id; this.trackSelect(); });
      grid.appendChild(card);
    }
    s.appendChild(grid);
    const row = document.createElement('div'); row.className = 'row';
    row.append(
      this._btn('¡A correr!', 'magenta', () => this.onAction('start-race', { mode: this.sel.mode, car: this.sel.car, track: this.sel.track })),
      this._btn('Volver', 'ghost', () => this.carSelect()),
    );
    s.appendChild(row);
    this._show(s);
  }

  _startChampionship() {
    this.onAction('start-championship', { car: this.sel.car });
  }

  // ---------------- garage / unlocks ----------------
  garage() {
    const s = document.createElement('div'); s.className = 'screen';
    s.appendChild(this._fansBadge());
    s.appendChild(this._title('GARAJE'));
    s.appendChild(this._subtitle('Ganá fans para desbloquear autos y pistas'));
    const grid = document.createElement('div'); grid.className = 'card-grid';
    for (const c of CARS) {
      const unlocked = this.store.isCarUnlocked(c.id);
      const can = !unlocked && this.store.fans >= c.unlockFans;
      const card = document.createElement('div');
      card.className = 'card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="swatch" style="background:linear-gradient(135deg, ${hex(c.color)}, #05060f)"></div>
        <h3>${c.name}</h3>
        <div class="stat">${unlocked ? '✓ Desbloqueado' : `🔒 ${c.unlockFans.toLocaleString()} fans`}</div>
      `;
      if (can) {
        const b = this._btn('Desbloquear', 'small', () => { this.store.unlockCar(c.id); this.audio.pickup(); this.garage(); });
        card.appendChild(b);
      }
      grid.appendChild(card);
    }
    s.appendChild(grid);
    s.appendChild(this._btn('Volver', 'ghost', () => this.main()));
    this._show(s);
  }

  // ---------------- settings ----------------
  settings() {
    const s = document.createElement('div'); s.className = 'screen';
    s.appendChild(this._title('AJUSTES'));
    const opts = [
      ['music', 'Música'], ['sfx', 'Efectos de sonido'], ['bloom', 'Brillo neón (bloom)'], ['tilt', 'Dirección por inclinación'],
    ];
    for (const [key, label] of opts) {
      const row = document.createElement('div'); row.className = 'settings-row';
      const l = document.createElement('span'); l.textContent = label;
      const toggle = document.createElement('div');
      toggle.className = 'toggle' + (this.store.settings[key] ? ' on' : '');
      toggle.innerHTML = '<div class="knob"></div>';
      toggle.addEventListener('click', () => {
        const v = !this.store.settings[key];
        this.store.setSetting(key, v);
        toggle.classList.toggle('on', v);
        this.audio.ui();
        this.onAction('setting', { key, value: v });
      });
      row.append(l, toggle);
      s.appendChild(row);
    }
    const reset = this._btn('Borrar progreso', 'small ghost', () => {
      if (confirm('¿Borrar todo el progreso (fans y desbloqueos)?')) { localStorage.removeItem('blur.save.v1'); location.reload(); }
    });
    s.appendChild(reset);
    s.appendChild(this._btn('Volver', 'ghost', () => this.main()));
    this._show(s);
  }

  // ---------------- pause ----------------
  pause() {
    const s = document.createElement('div'); s.className = 'screen';
    s.style.background = 'rgba(5,6,15,0.82)';
    s.appendChild(this._title('PAUSA'));
    const menu = document.createElement('div'); menu.className = 'menu';
    menu.append(
      this._btn('Continuar', '', () => this.onAction('resume')),
      this._btn('Reiniciar', 'ghost', () => this.onAction('restart')),
      this._btn('Salir al menú', 'magenta', () => this.onAction('quit')),
    );
    s.appendChild(menu);
    this._show(s);
  }

  // ---------------- results ----------------
  results(results, { fansEarned, newlyUnlocked, championship }) {
    const s = document.createElement('div'); s.className = 'screen';
    const player = results.find((r) => r.isPlayer);
    s.appendChild(this._title(player && player.place === 1 ? '¡VICTORIA!' : `${posLabel(player ? player.place : 1)} LUGAR`));
    if (fansEarned != null) {
      const f = document.createElement('div'); f.className = 'subtitle';
      f.style.color = 'var(--neon-yellow)';
      f.textContent = `+${fansEarned.toLocaleString()} FANS`;
      s.appendChild(f);
    }

    const table = document.createElement('table'); table.className = 'results-table';
    table.innerHTML = '<tr><th>Pos</th><th>Piloto</th><th>Auto</th><th>Tiempo</th><th>Mejor vuelta</th></tr>';
    for (const r of results) {
      const tr = document.createElement('tr');
      if (r.isPlayer) tr.className = 'you';
      tr.innerHTML = `<td>${r.place}</td><td>${r.name}</td><td>${r.car}</td><td>${r.finished ? formatTime(r.time) : 'DNF'}</td><td>${r.bestLap ? formatTime(r.bestLap) : '--'}</td>`;
      table.appendChild(tr);
    }
    s.appendChild(table);

    if (newlyUnlocked && newlyUnlocked.length) {
      const u = document.createElement('div'); u.className = 'subtitle'; u.style.color = 'var(--neon-green)';
      u.textContent = '¡Desbloqueado! ' + newlyUnlocked.join(', ');
      s.appendChild(u);
    }

    const row = document.createElement('div'); row.className = 'row';
    if (championship) {
      row.append(
        this._btn(championship.last ? 'Ver clasificación final' : 'Siguiente carrera', 'magenta', () => this.onAction('champ-next')),
        this._btn('Salir al menú', 'ghost', () => this.onAction('quit')),
      );
    } else {
      row.append(
        this._btn('Revancha', 'magenta', () => this.onAction('restart')),
        this._btn('Menú', 'ghost', () => this.onAction('quit')),
      );
    }
    s.appendChild(row);
    this._show(s);
  }

  // ---------------- championship standings ----------------
  standings(rows, { round, totalRounds, final }) {
    const s = document.createElement('div'); s.className = 'screen';
    s.appendChild(this._title(final ? 'CAMPEONATO FINAL' : `CLASIFICACIÓN`));
    s.appendChild(this._subtitle(final ? 'Resultado del campeonato' : `Tras carrera ${round}/${totalRounds}`));
    const wrap = document.createElement('div'); wrap.className = 'standings';
    rows.forEach((r, i) => {
      const line = document.createElement('div');
      line.className = 'line' + (r.isPlayer ? ' you' : '');
      line.innerHTML = `<span>${i + 1}. ${r.name}</span><span>${r.points} pts</span>`;
      wrap.appendChild(line);
    });
    s.appendChild(wrap);
    const row = document.createElement('div'); row.className = 'row';
    if (final) row.append(this._btn('Volver al menú', 'magenta', () => this.onAction('quit')));
    else row.append(this._btn('Continuar', 'magenta', () => this.onAction('champ-continue')));
    s.appendChild(row);
    this._show(s);
  }
}
