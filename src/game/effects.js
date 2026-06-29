// Lightweight VFX: expanding shockrings, explosions and spark bursts. Entities
// are short-lived meshes added to the scene and faded out, then disposed.
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  _add(mesh, life, update) {
    mesh.userData._t = 0;
    mesh.userData._life = life;
    mesh.userData._update = update;
    this.scene.add(mesh);
    this.items.push(mesh);
  }

  ring(pos, color = 0x19e6ff, maxR = 8, life = 0.5) {
    const geo = new THREE.RingGeometry(0.5, 0.8, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.2, pos.z);
    this._add(m, life, (mesh, t01) => {
      const s = 1 + t01 * maxR;
      mesh.scale.set(s, s, s);
      mesh.material.opacity = 0.9 * (1 - t01);
    });
  }

  explosion(pos, color = 0xff7a1f) {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    core.position.copy(pos); core.position.y = 0.8;
    this._add(core, 0.45, (m, t01) => {
      const s = 1 + t01 * 4;
      m.scale.set(s, s, s);
      m.material.opacity = 1 - t01;
    });
    this.ring(pos, color, 10, 0.5);
    this.sparks(pos, color, 16);
    const light = new THREE.PointLight(color, 6, 20);
    light.position.set(pos.x, 1.2, pos.z);
    this._add(light, 0.3, (m, t01) => { m.intensity = 6 * (1 - t01); });
  }

  sparks(pos, color = 0xffffff, count = 10) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = 0.8; arr[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 10;
      vel.push(new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.5, transparent: true, opacity: 1 });
    const pts = new THREE.Points(geo, mat);
    pts.userData._vel = vel;
    this._add(pts, 0.6, (m, t01, dt) => {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const v = m.userData._vel[i];
        v.y -= 18 * dt;
        p.array[i * 3] += v.x * dt;
        p.array[i * 3 + 1] = Math.max(0.1, p.array[i * 3 + 1] + v.y * dt);
        p.array[i * 3 + 2] += v.z * dt;
      }
      p.needsUpdate = true;
      m.material.opacity = 1 - t01;
    });
  }

  pickupFlash(pos, color = 0x39ff88) { this.ring(pos, color, 4, 0.35); }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const m = this.items[i];
      m.userData._t += dt;
      const t01 = Math.min(1, m.userData._t / m.userData._life);
      m.userData._update(m, t01, dt);
      if (m.userData._t >= m.userData._life) {
        this.scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
