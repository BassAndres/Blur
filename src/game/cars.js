// Playable car roster. Stats are arcade tuning values (0..1 relative). Each car
// builds a low-poly neon body procedurally (no external 3D assets).
import * as THREE from 'three';

export const CARS = [
  { id: 'pulse',  name: 'Pulse',   color: 0x19e6ff, locked: false, unlockFans: 0,
    topSpeed: 0.72, accel: 0.78, grip: 0.85, strength: 0.55 },
  { id: 'ember',  name: 'Ember',   color: 0xff5a1f, locked: false, unlockFans: 0,
    topSpeed: 0.80, accel: 0.70, grip: 0.72, strength: 0.62 },
  { id: 'venom',  name: 'Venom',   color: 0x39ff88, locked: false, unlockFans: 0,
    topSpeed: 0.76, accel: 0.74, grip: 0.80, strength: 0.58 },
  { id: 'lotus',  name: 'Spectre', color: 0xff2bd6, locked: true, unlockFans: 2500,
    topSpeed: 0.88, accel: 0.66, grip: 0.74, strength: 0.50 },
  { id: 'titan',  name: 'Titan',   color: 0xffe14d, locked: true, unlockFans: 6000,
    topSpeed: 0.70, accel: 0.72, grip: 0.78, strength: 0.92 },
  { id: 'apex',   name: 'Apex',    color: 0xffffff, locked: true, unlockFans: 12000,
    topSpeed: 0.95, accel: 0.86, grip: 0.88, strength: 0.60 },
];

export function getCar(id) { return CARS.find((c) => c.id === id) || CARS[0]; }

// Build a stylized low-poly car mesh. Returns a Group whose +Z is forward.
export function buildCarMesh(color, opts = {}) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, metalness: 0.6, roughness: 0.35 });
  const glowMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x081018, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x05060c, metalness: 0.4, roughness: 0.6 });

  // lower chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.2), bodyMat);
  chassis.position.y = 0.45; chassis.castShadow = true;
  g.add(chassis);

  // cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.9), glassMat);
  cabin.position.set(0, 0.92, -0.15); cabin.castShadow = true;
  g.add(cabin);

  // front nose (tapered)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.34, 1.0), bodyMat);
  nose.position.set(0, 0.4, 2.0);
  g.add(nose);

  // rear wing
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.5), darkMat);
  wing.position.set(0, 1.0, -2.05);
  g.add(wing);
  for (const sx of [-0.8, 0.8]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), darkMat);
    strut.position.set(sx, 0.8, -2.05);
    g.add(strut);
  }

  // underglow strip
  const glow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 4.3), glowMat);
  glow.position.y = 0.18;
  g.add(glow);

  // headlights / taillights
  for (const sx of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }));
    hl.position.set(sx, 0.45, 2.45);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2222, emissiveIntensity: 1.4 }));
    tl.position.set(sx, 0.55, -2.18);
    g.add(tl);
  }

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 });
  const wheels = [];
  const wx = 1.0, wz = 1.4;
  for (const [sx, sz] of [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.4, sz);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.glowMat = glowMat;
  return g;
}
