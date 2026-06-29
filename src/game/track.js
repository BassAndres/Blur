// Track: builds drivable road geometry from a closed Catmull-Rom spline and
// provides projection helpers used for lap timing, race position, AI lines and
// keeping cars on the road. Tracks are flat on the XZ plane (arcade style).
import * as THREE from 'three';
import { clamp } from '../engine/util.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Track {
  /** @param {object} def track definition from src/tracks */
  constructor(def, quality = 'high') {
    this.def = def;
    this.quality = quality;
    this.name = def.name;
    this.halfWidth = def.width / 2;
    this.laps = def.laps ?? 3;
    this.colorA = new THREE.Color(def.neonA ?? 0x19e6ff);
    this.colorB = new THREE.Color(def.neonB ?? 0xff2bd6);

    const pts = def.points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', def.tension ?? 0.5);
    this.length = this.curve.getLength();

    // Dense sample table for projection / progress queries.
    this.samples = Math.max(400, Math.floor(this.length / 2));
    this._table = [];
    for (let i = 0; i < this.samples; i++) {
      const u = i / this.samples;
      const pos = this.curve.getPointAt(u);
      const tan = this.curve.getTangentAt(u).normalize();
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      this._table.push({ u, pos, tan, side });
    }

    this.group = new THREE.Group();
    this.startPositions = [];
  }

  // World point at curve param u with a lateral lane offset (meters, +right).
  pointAt(u, lateral = 0) {
    u = ((u % 1) + 1) % 1;
    const p = this.curve.getPointAt(u);
    if (lateral !== 0) {
      const tan = this.curve.getTangentAt(u).normalize();
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      p.addScaledVector(side, lateral);
    }
    return p;
  }

  tangentAt(u) { return this.curve.getTangentAt(((u % 1) + 1) % 1).normalize(); }
  headingAt(u) { const t = this.tangentAt(u); return Math.atan2(t.x, t.z); }

  // Project a world position to nearest curve sample. Uses a local search window
  // around hintU (the car's last known u) for speed, with fallback to full scan.
  project(pos, hintU = null) {
    let bestI = 0, bestD = Infinity;
    if (hintU != null) {
      const center = Math.floor((((hintU % 1) + 1) % 1) * this.samples);
      const win = 40;
      for (let k = -win; k <= win; k++) {
        const i = ((center + k) % this.samples + this.samples) % this.samples;
        const d = this._table[i].pos.distanceToSquared(pos);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      // if we hit the window edge, the hint was stale — do a full scan.
      const edge = Math.abs(((bestI - center + this.samples) % this.samples + this.samples) % this.samples);
      if (edge < win - 2 || edge > this.samples - win + 2) {
        return this._finishProject(pos, bestI, bestD);
      }
    }
    for (let i = 0; i < this.samples; i++) {
      const d = this._table[i].pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return this._finishProject(pos, bestI, bestD);
  }

  _finishProject(pos, bestI, bestD) {
    const s = this._table[bestI];
    // signed lateral offset (+ to the right of travel direction)
    const rel = new THREE.Vector3().subVectors(pos, s.pos);
    const lateral = rel.dot(s.side);
    return { u: s.u, index: bestI, lateral, dist: Math.sqrt(bestD), tan: s.tan, side: s.side, center: s.pos };
  }

  // ---------- geometry ----------
  build() {
    const N = this.samples;
    const roadPos = [];
    const roadIdx = [];
    const wallLPos = [];
    const wallRPos = [];
    const wallLIdx = [];
    const wallRIdx = [];
    const wallH = 1.6;
    const hw = this.halfWidth;

    for (let i = 0; i <= N; i++) {
      const s = this._table[i % N];
      const l = new THREE.Vector3().copy(s.pos).addScaledVector(s.side, -hw);
      const r = new THREE.Vector3().copy(s.pos).addScaledVector(s.side, hw);
      roadPos.push(l.x, 0, l.z, r.x, 0, r.z);
      // walls (slightly outside the road)
      const lo = new THREE.Vector3().copy(s.pos).addScaledVector(s.side, -hw - 0.2);
      const ro = new THREE.Vector3().copy(s.pos).addScaledVector(s.side, hw + 0.2);
      wallLPos.push(lo.x, 0, lo.z, lo.x, wallH, lo.z);
      wallRPos.push(ro.x, 0, ro.z, ro.x, wallH, ro.z);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      roadIdx.push(a, c, b, b, c, d);
      wallLIdx.push(a, b, c, b, d, c);
      wallRIdx.push(a, c, b, b, c, d);
    }

    // Road surface
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
    roadGeo.setIndex(roadIdx);
    roadGeo.computeVertexNormals();
    // wet-look asphalt: reflective enough to catch the neon environment
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x0b0e18, roughness: 0.36, metalness: 0.55, envMapIntensity: 0.9 });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    this.group.add(road);

    // Neon edge walls
    const wallLGeo = new THREE.BufferGeometry();
    wallLGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallLPos, 3));
    wallLGeo.setIndex(wallLIdx);
    wallLGeo.computeVertexNormals();
    const wallRGeo = new THREE.BufferGeometry();
    wallRGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallRPos, 3));
    wallRGeo.setIndex(wallRIdx);
    wallRGeo.computeVertexNormals();
    const wallMatL = new THREE.MeshStandardMaterial({ color: this.colorA, emissive: this.colorA, emissiveIntensity: 1.4, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    const wallMatR = new THREE.MeshStandardMaterial({ color: this.colorB, emissive: this.colorB, emissiveIntensity: 1.4, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    this.group.add(new THREE.Mesh(wallLGeo, wallMatL));
    this.group.add(new THREE.Mesh(wallRGeo, wallMatR));

    // Center dashed line
    this._buildCenterLine();
    // Finish line
    this._buildFinish();
    // Decorative neon pylons along the track
    this._buildPylons();
    // Ground plane + grid
    this._buildEnvironment();
    // start positions (grid) just behind the finish line
    this._computeStartGrid();

    return this.group;
  }

  _buildCenterLine() {
    const N = this.samples;
    const positions = [];
    for (let i = 0; i < N; i += 4) {
      const s = this._table[i % N];
      const s2 = this._table[(i + 2) % N];
      positions.push(s.pos.x, 0.05, s.pos.z, s2.pos.x, 0.05, s2.pos.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const m = new THREE.LineDashedMaterial({ color: 0x55607a, dashSize: 2, gapSize: 2 });
    const line = new THREE.LineSegments(g, m);
    line.computeLineDistances();
    this.group.add(line);
  }

  _buildFinish() {
    const s = this._table[0];
    const geo = new THREE.PlaneGeometry(this.halfWidth * 2, 4);
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#0a0a0a';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(this.halfWidth, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.3 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    const heading = this.headingAt(0);
    m.rotation.z = -heading;
    m.position.set(s.pos.x, 0.06, s.pos.z);
    this.group.add(m);

    // overhead start gantry
    const barGeo = new THREE.BoxGeometry(this.halfWidth * 2 + 2, 0.4, 0.4);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: this.colorA, emissiveIntensity: 1.2 });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(s.pos.x, 5, s.pos.z);
    bar.rotation.y = heading;
    this.group.add(bar);
  }

  _buildPylons() {
    const N = this.samples;
    const geo = new THREE.CylinderGeometry(0.18, 0.18, 4, 6);
    for (let i = 0; i < N; i += 18) {
      const s = this._table[i % N];
      for (const sgn of [-1, 1]) {
        const mat = new THREE.MeshStandardMaterial({ color: sgn < 0 ? this.colorA : this.colorB, emissive: sgn < 0 ? this.colorA : this.colorB, emissiveIntensity: 1.6 });
        const m = new THREE.Mesh(geo, mat);
        const p = new THREE.Vector3().copy(s.pos).addScaledVector(s.side, sgn * (this.halfWidth + 1.4));
        m.position.set(p.x, 2, p.z);
        this.group.add(m);
      }
    }
  }

  _buildEnvironment() {
    // dark, faintly reflective ground (catches neon)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: 0x05060f, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.4 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.group.add(ground);

    const grid = new THREE.GridHelper(6000, 300, 0x14305a, 0x0a1530);
    grid.position.y = -0.05;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.group.add(grid);

    this._buildCity();
    this._buildStars();
  }

  // Neon-lit skyline of buildings placed just outside the track loop.
  _buildCity() {
    const N = this.samples;
    const palette = [0x19e6ff, 0xff2bd6, 0x39ff88, 0xffe14d, 0xff5a1f, 0x9b6bff];
    const facadeMat = new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.7, metalness: 0.4, envMapIntensity: 0.5 });
    const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(1337);
    const mobile = this.quality === 'mobile';
    const step = mobile ? 18 : 10;
    const skip = mobile ? 0.62 : 0.45;

    for (let i = 0; i < N; i += step) {
      const s = this._table[i % N];
      for (const sgn of [-1, 1]) {
        if (rng() < skip) continue;
        const dist = this.halfWidth + 16 + rng() * 90;
        const base = new THREE.Vector3().copy(s.pos).addScaledVector(s.side, sgn * dist);
        const w = 8 + rng() * 16;
        const d = 8 + rng() * 16;
        const h = 18 + rng() * 90;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMat);
        b.position.set(base.x, h / 2, base.z);
        b.rotation.y = rng() * Math.PI;
        b.castShadow = false; b.receiveShadow = true;
        this.group.add(b);
        // glowing crown / sign
        const col = palette[(i + (sgn > 0 ? 1 : 0)) % palette.length];
        const crown = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.9, 1.2 + rng() * 2.5, d * 0.9),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.8 })
        );
        crown.position.set(base.x, h + 1, base.z);
        crown.rotation.y = b.rotation.y;
        this.group.add(crown);
        // vertical neon strip
        if (rng() < 0.5) {
          const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, h * 0.7, 0.5),
            new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.4 })
          );
          strip.position.set(base.x + Math.sign(sgn) * w * 0.45, h * 0.45, base.z);
          this.group.add(strip);
        }
      }
    }
  }

  _buildStars() {
    const count = 900;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1400 + Math.random() * 800;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.4 + 0.05;
      arr[i * 3] = Math.cos(th) * Math.sin(ph) * r;
      arr[i * 3 + 1] = Math.cos(ph) * r * 0.8 + 120;
      arr[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9fc4ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8 }));
    this.group.add(stars);
  }

  _computeStartGrid() {
    // 2-wide staggered grid behind finish line (u slightly < 1)
    this.startPositions = [];
    const back = 6; // meters between rows
    const laneOff = this.halfWidth * 0.45;
    for (let i = 0; i < 12; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2 === 0 ? -laneOff : laneOff;
      const dist = this.length - 8 - row * back;
      const u = (dist / this.length) % 1;
      const pos = this.pointAt(u, col);
      this.startPositions.push({ x: pos.x, z: pos.z, yaw: this.headingAt(u), u });
    }
  }

  totalDistanceFor(lap, u) { return lap * this.length + u * this.length; }
}
