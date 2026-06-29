// In-race HUD rendered as a DOM overlay (cheap + crisp on mobile). Shows race
// position, lap, timers, speedometer, health, the power-up inventory (up to 3),
// a live minimap, the start countdown and transient center messages.
import { POWERUPS } from './powerups.js';
import { formatTime, posLabel } from '../engine/util.js';

export class HUD {
  constructor(root, track) {
    this.track = track;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="pos"><div class="big" data-pos>1º</div><div class="small">de <span data-total>8</span></div></div>
      <div class="lap"><div class="big"><span data-lap>1</span>/<span data-laps>3</span></div><div class="small">VUELTA</div></div>
      <div class="timer" data-timer>00:00.00</div>
      <canvas class="minimap" data-minimap width="130" height="130"></canvas>
      <div class="speedo"><span class="num" data-speed>0</span><span class="unit"> KM/H</span></div>
      <div class="health-wrap"><div class="label">BLINDAJE</div><div class="health"><span data-health style="width:100%"></span></div></div>
      <div class="inventory" data-inv></div>
      <div class="countdown hidden" data-count></div>
      <div class="center-msg" data-msg></div>
    `;
    root.appendChild(this.el);
    this.$ = (sel) => this.el.querySelector(sel);
    this.posEl = this.$('[data-pos]');
    this.totalEl = this.$('[data-total]');
    this.lapEl = this.$('[data-lap]');
    this.lapsEl = this.$('[data-laps]');
    this.timerEl = this.$('[data-timer]');
    this.speedEl = this.$('[data-speed]');
    this.healthEl = this.$('[data-health]');
    this.invEl = this.$('[data-inv]');
    this.countEl = this.$('[data-count]');
    this.msgEl = this.$('[data-msg]');
    this.miniCanvas = this.$('[data-minimap]');
    this.miniCtx = this.miniCanvas.getContext('2d');
    this._msgTimer = 0;

    this.lapsEl.textContent = track.laps;
    this._buildMinimapPath();
  }

  _buildMinimapPath() {
    // Precompute normalized track outline for the minimap.
    const pts = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i <= 80; i++) {
      const p = this.track.pointAt(i / 80, 0);
      pts.push(p);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this._mini = { pts, minX, maxX, minZ, maxZ };
  }

  _miniXY(x, z) {
    const m = this._mini;
    const pad = 12, size = 130 - pad * 2;
    const w = (m.maxX - m.minX) || 1, h = (m.maxZ - m.minZ) || 1;
    const s = size / Math.max(w, h);
    const ox = pad + (size - w * s) / 2, oy = pad + (size - h * s) / 2;
    return [ox + (x - m.minX) * s, oy + (z - m.minZ) * s];
  }

  setCountdown(text) {
    if (text == null) { this.countEl.classList.add('hidden'); return; }
    this.countEl.classList.remove('hidden');
    this.countEl.textContent = text;
  }

  flash(text, time = 1.4) {
    this.msgEl.textContent = text;
    this.msgEl.classList.add('show');
    this._msgTimer = time;
  }

  update(dt, player, vehicles) {
    if (this._msgTimer > 0) { this._msgTimer -= dt; if (this._msgTimer <= 0) this.msgEl.classList.remove('show'); }

    this.posEl.textContent = posLabel(player.place);
    this.totalEl.textContent = vehicles.length;
    this.lapEl.textContent = Math.min(this.track.laps, player.lap + 1);
    this.timerEl.textContent = formatTime(player.currentLapTime());
    this.speedEl.textContent = Math.round(player.speedKmh);
    this.speedEl.classList.toggle('boost', player.nitroTime > 0);
    this.healthEl.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;

    this._renderInventory(player);
    this._renderMinimap(player, vehicles);
  }

  _renderInventory(player) {
    const inv = player.inventory;
    let html = '';
    for (let i = 0; i < player.maxInventory; i++) {
      const type = inv[i];
      if (type) {
        const pu = POWERUPS[type];
        const active = i === player.activeSlot;
        html += `<div class="pu-slot ${active ? 'active' : ''}" style="border-color:#${pu.color.toString(16).padStart(6,'0')};box-shadow:${active ? `0 0 16px #${pu.color.toString(16).padStart(6,'0')}` : 'none'}">${pu.glyph}<span class="pu-name">${pu.name}</span></div>`;
      } else {
        html += `<div class="pu-slot" style="opacity:0.35"></div>`;
      }
    }
    this.invEl.innerHTML = html;
  }

  _renderMinimap(player, vehicles) {
    const ctx = this.miniCtx;
    ctx.clearRect(0, 0, 130, 130);
    ctx.fillStyle = 'rgba(5,8,20,0.55)';
    ctx.beginPath(); ctx.roundRect(0, 0, 130, 130, 10); ctx.fill();
    // track path
    ctx.strokeStyle = 'rgba(25,230,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    this._mini.pts.forEach((p, i) => { const [x, y] = this._miniXY(p.x, p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
    // cars
    for (const v of vehicles) {
      const [x, y] = this._miniXY(v.pos.x, v.pos.z);
      ctx.beginPath();
      ctx.fillStyle = v.isPlayer ? '#39ff88' : `#${v.carDef.color.toString(16).padStart(6, '0')}`;
      ctx.arc(x, y, v.isPlayer ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  destroy() { this.el.remove(); }
}
