// On-screen touch controls for mobile: steer left/right, gas, brake, fire and
// swap power-up. Wires pointer events to the Input instance. Hidden on desktop
// unless a touch is detected.
export class TouchControls {
  constructor(container, input, audio) {
    this.container = container;
    this.input = input;
    this.audio = audio;
    this.enabled = false;
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="touch-btn steer-left" data-act="left">◀</div>
      <div class="touch-btn steer-right" data-act="right">▶</div>
      <div class="touch-btn brake" data-act="brake">FRENO</div>
      <div class="touch-btn gas" data-act="gas">GAS</div>
      <div class="touch-btn fire" data-act="fire">★</div>
      <div class="touch-btn swap" data-act="swap">⟳</div>
    `;
    this.btns = {};
    this.container.querySelectorAll('.touch-btn').forEach((el) => {
      const act = el.dataset.act;
      this.btns[act] = el;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._press(act, el, true); });
      el.addEventListener('pointerup', (e) => { e.preventDefault(); this._press(act, el, false); });
      el.addEventListener('pointercancel', (e) => { e.preventDefault(); this._press(act, el, false); });
      el.addEventListener('pointerleave', (e) => { this._press(act, el, false); });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  _press(act, el, down) {
    el.classList.toggle('pressed', down);
    switch (act) {
      case 'left': this.input.setTouchSteer(down ? -1 : (this.btns.right.classList.contains('pressed') ? 1 : 0)); break;
      case 'right': this.input.setTouchSteer(down ? 1 : (this.btns.left.classList.contains('pressed') ? -1 : 0)); break;
      case 'gas': this.input.setTouchThrottle(down ? 1 : 0); break;
      case 'brake': this.input.setTouchBrake(down ? 1 : 0); break;
      case 'fire': if (down) this.input.queueFire(); break;
      case 'swap': if (down) this.input.queueSwap(); break;
    }
  }

  show() { this.enabled = true; this.container.classList.remove('hidden'); }
  hide() {
    this.enabled = false;
    this.container.classList.add('hidden');
    // release any held inputs
    this.input.setTouchSteer(0); this.input.setTouchThrottle(0); this.input.setTouchBrake(0);
    this.container.querySelectorAll('.touch-btn').forEach((el) => el.classList.remove('pressed'));
  }
}
