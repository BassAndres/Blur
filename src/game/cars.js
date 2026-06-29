// Playable car roster + a detailed, fully procedural sports-car mesh builder.
// The body is an extruded side-profile with beveled edges, finished with a
// metallic clear-coat paint material; wheels have rims + brake discs; glass is
// tinted; lights are emissive (player cars also cast real headlight spotlights).
// All geometry is generated in code — no external 3D assets.
import * as THREE from 'three';

export const CARS = [
  { id: 'pulse',  name: 'Pulse',   color: 0x19a0ff, locked: false, unlockFans: 0,
    topSpeed: 0.72, accel: 0.78, grip: 0.85, strength: 0.55 },
  { id: 'ember',  name: 'Ember',   color: 0xff4a1f, locked: false, unlockFans: 0,
    topSpeed: 0.80, accel: 0.70, grip: 0.72, strength: 0.62 },
  { id: 'venom',  name: 'Venom',   color: 0x27e85f, locked: false, unlockFans: 0,
    topSpeed: 0.76, accel: 0.74, grip: 0.80, strength: 0.58 },
  { id: 'lotus',  name: 'Spectre', color: 0xc02bff, locked: true, unlockFans: 2500,
    topSpeed: 0.88, accel: 0.66, grip: 0.74, strength: 0.50 },
  { id: 'titan',  name: 'Titan',   color: 0xffd11a, locked: true, unlockFans: 6000,
    topSpeed: 0.70, accel: 0.72, grip: 0.78, strength: 0.92 },
  { id: 'apex',   name: 'Apex',    color: 0xe8eef7, locked: true, unlockFans: 12000,
    topSpeed: 0.95, accel: 0.86, grip: 0.88, strength: 0.60 },
];

export function getCar(id) { return CARS.find((c) => c.id === id) || CARS[0]; }

// ---- side profile of the car (X = length forward, Y = height) ----
function carProfile() {
  const s = new THREE.Shape();
  s.moveTo(2.30, 0.18);
  s.lineTo(2.34, 0.42);          // front bumper
  s.quadraticCurveTo(2.20, 0.58, 1.70, 0.60);   // hood front
  s.lineTo(0.95, 0.66);          // hood
  s.quadraticCurveTo(0.55, 0.70, 0.30, 1.02);   // windshield
  s.lineTo(-0.55, 1.16);         // roof
  s.quadraticCurveTo(-1.25, 1.14, -1.55, 0.78); // rear glass
  s.lineTo(-2.05, 0.66);         // decklid
  s.lineTo(-2.30, 0.52);         // tail
  s.lineTo(-2.32, 0.20);         // rear bumper
  s.lineTo(2.30, 0.18);
  return s;
}

function buildWheel(quality) {
  const g = new THREE.Group();
  const seg = quality === 'mobile' ? 16 : 24;
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 0.34, seg),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85, metalness: 0.1 })
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);
  // rim
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.30, 0.30, 0.36, seg),
    new THREE.MeshStandardMaterial({ color: 0xced3da, metalness: 1, roughness: 0.28 })
  );
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  // spokes
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.35 });
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.5, 0.09), spokeMat);
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    g.add(spoke);
  }
  // brake disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.06, seg),
    new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.8, roughness: 0.4 })
  );
  disc.rotation.z = Math.PI / 2;
  g.add(disc);
  return g;
}

// Build a stylized but detailed sports car. Returns a Group; +Z is forward.
export function buildCarMesh(color, opts = {}) {
  const quality = opts.quality || 'high';
  const g = new THREE.Group();
  const col = new THREE.Color(color);

  // metallic clear-coat paint (clearcoat is GPU-heavier, so plain metal on mobile)
  const paint = quality === 'mobile'
    ? new THREE.MeshStandardMaterial({ color: col, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.2 })
    : new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.9, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.3 });

  // ---- body (extruded profile) ----
  const shape = carProfile();
  const width = 1.86;
  const bevel = 0.14;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: quality === 'mobile' ? 2 : 4, steps: 1,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);   // center on width
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, paint);
  body.rotation.y = -Math.PI / 2;                   // length X -> forward +Z
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // ---- cabin / glass greenhouse ----
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0f18, metalness: 0.1, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.4, transparent: true, opacity: 0.86 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.5, 1, 1, 1), glassMat);
  cabin.position.set(0, 0.92, 0.05);
  cabin.scale.set(1, 1, 1);
  g.add(cabin);
  // windshield slope
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.46, 0.7), glassMat);
  wind.position.set(0, 0.86, 0.78); wind.rotation.x = -0.5;
  g.add(wind);

  // ---- accents: splitter, diffuser, sills (carbon) ----
  const carbon = new THREE.MeshStandardMaterial({ color: 0x16181d, metalness: 0.5, roughness: 0.55 });
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.5), carbon);
  splitter.position.set(0, 0.16, 2.18); g.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 0.4), carbon);
  diffuser.position.set(0, 0.26, -2.18); g.add(diffuser);
  for (const sx of [-0.95, 0.95]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 2.6), carbon);
    sill.position.set(sx, 0.28, 0); g.add(sill);
  }

  // ---- rear wing ----
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.46), carbon);
  wing.position.set(0, 1.0, -2.0); g.add(wing);
  for (const sx of [-0.78, 0.78]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.12), carbon);
    strut.position.set(sx, 0.82, -2.0); g.add(strut);
  }

  // ---- mirrors ----
  for (const sx of [-0.85, 0.85]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), carbon);
    stalk.position.set(sx, 0.78, 0.55); g.add(stalk);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.18), paint);
    cap.position.set(sx + Math.sign(sx) * 0.16, 0.8, 0.55); g.add(cap);
  }

  // ---- underglow ----
  const glowMat = new THREE.MeshBasicMaterial({ color: col });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.04, 4.0), glowMat);
  glow.position.y = 0.1; g.add(glow);

  // ---- lights ----
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff0ff, emissiveIntensity: 2.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1818, emissiveIntensity: 2.4 });
  for (const sx of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), headMat);
    hl.position.set(sx, 0.5, 2.3); g.add(hl);
  }
  // continuous tail light bar
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.05), tailMat);
  tail.position.set(0, 0.6, -2.28); g.add(tail);

  // exhaust tips
  for (const sx of [-0.45, 0.45]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 1, roughness: 0.3 }));
    ex.rotation.x = Math.PI / 2; ex.position.set(sx, 0.32, -2.3); g.add(ex);
  }

  // ---- wheels ----
  const wheels = [];
  const frontWheels = [];
  const wx = 0.92, wzF = 1.42, wzR = -1.46;
  for (const [sx, sz, front] of [[-wx, wzF, true], [wx, wzF, true], [-wx, wzR, false], [wx, wzR, false]]) {
    const w = buildWheel(quality);
    w.position.set(sx, 0.42, sz);
    g.add(w);
    wheels.push(w);
    if (front) frontWheels.push(w);
  }

  // ---- real headlight spotlights (player only, to keep perf in check) ----
  if (opts.headlights) {
    for (const sx of [-0.55, 0.55]) {
      const sp = new THREE.SpotLight(0xeaf4ff, 6, 60, Math.PI / 7, 0.4, 1.5);
      sp.position.set(sx, 0.5, 2.2);
      sp.target.position.set(sx, 0, 14);
      sp.castShadow = false;
      g.add(sp); g.add(sp.target);
    }
  }

  g.userData.wheels = wheels;
  g.userData.frontWheels = frontWheels;
  g.userData.glowMat = glowMat;
  g.userData.paint = paint;
  return g;
}
