// Track definitions: closed loops as arrays of [x, z] control points (meters).
// Each is hand-shaped to give a distinct neon-city feel. `width` is full road
// width; `laps` default race length; neon colors tint the edge walls/pylons.

export const TRACKS = [
  {
    id: 'downtown',
    name: 'Downtown Neon',
    locked: false,
    width: 18,
    laps: 3,
    tension: 0.5,
    neonA: 0x19e6ff,
    neonB: 0xff2bd6,
    points: [
      [0, 0], [60, -10], [120, -40], [160, -110], [150, -190],
      [90, -240], [10, -250], [-70, -230], [-120, -170], [-130, -90],
      [-100, -20], [-50, 10],
    ],
  },
  {
    id: 'harbor',
    name: 'Harbor Drift',
    locked: false,
    width: 17,
    laps: 3,
    tension: 0.5,
    neonA: 0x39ff88,
    neonB: 0x19e6ff,
    points: [
      [0, 0], [80, 20], [150, 0], [200, -60], [190, -140],
      [240, -200], [200, -270], [110, -280], [60, -220], [20, -250],
      [-60, -230], [-110, -160], [-90, -80], [-130, -20], [-80, 30],
    ],
  },
  {
    id: 'skyline',
    name: 'Skyline Loop',
    locked: true,
    unlockFans: 4000,
    width: 16,
    laps: 4,
    tension: 0.55,
    neonA: 0xffe14d,
    neonB: 0xff2bd6,
    points: [
      [0, 0], [70, -30], [110, -100], [90, -170], [140, -230],
      [110, -300], [30, -320], [-50, -300], [-60, -230], [-120, -200],
      [-160, -120], [-120, -50], [-150, 20], [-90, 60], [-30, 30],
    ],
  },
  {
    id: 'canyon',
    name: 'Velocity Canyon',
    locked: true,
    unlockFans: 9000,
    width: 19,
    laps: 4,
    tension: 0.45,
    neonA: 0xff5a1f,
    neonB: 0x19e6ff,
    points: [
      [0, 0], [90, -5], [180, -30], [250, -100], [240, -200],
      [280, -290], [210, -360], [100, -370], [30, -320], [-40, -350],
      [-130, -310], [-170, -210], [-140, -120], [-190, -50], [-130, 30], [-50, 20],
    ],
  },
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
