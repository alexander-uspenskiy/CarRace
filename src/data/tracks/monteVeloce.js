// Monte Veloce GP — original circuit. Control points describe a CLOSED loop (clockwise seen from above,
// sim y = south) in travel direction; control point 0 is the start/finish line, on a long straight.
export const monteVeloce = {
  id: 'monte-veloce',
  name: 'Monte Veloce GP',
  country: 'Italy',
  blurb: 'A flat-out temple of speed: a kilometre-long main straight, flowing sweepers and two quick chicanes.',
  rating: { speed: 5, technical: 2 },
  controlPoints: [
    [-287.4, -350.7], [-222.5, -350.7], [-145.5, -350.7], [-68.5, -350.7], [8.4, -350.7], [85.4, -350.7],
    [162.4, -350.7], [239.4, -350.7], [316.4, -350.7], [393.4, -350.7], [470.3, -350.7], [488.7, -348.6],
    [506.1, -342.3], [552.3, -319.2], [569.7, -312.9], [588.1, -310.7], [606.1, -310.7], [659.2, -302.2],
    [707, -277.5], [744.7, -239.1], [768.5, -190.9], [776, -137.6], [774.7, -68.3], [773.5, 1],
    [772.2, 70.2], [760.2, 137.8], [728.1, 198.3], [678.8, 246.1], [617.3, 276.3], [549.3, 297.3],
    [481.4, 318.4], [413.5, 339.4], [348.8, 350.7], [283.4, 345.5], [215.7, 331.3], [147.9, 317.1],
    [80.2, 303], [12.5, 288.8], [-55.2, 274.6], [-80.5, 273], [-105.2, 278.5], [-143.1, 292.7],
    [-161.1, 297.4], [-179.6, 298.3], [-247.6, 294.6], [-315.6, 291], [-383.6, 287.3], [-451.7, 283.7],
    [-519.7, 280.1], [-587.7, 276.4], [-641.6, 264], [-688, 233.9], [-721.4, 189.9], [-737.8, 137.1],
    [-747.4, 63.1], [-756.9, -10.9], [-766.5, -84.9], [-776, -159], [-773.6, -216.4], [-752.2, -269.8],
    [-714.3, -312.9], [-664.1, -341], [-607.4, -350.7], [-530.4, -350.7], [-453.5, -350.7], [-376.5, -350.7],
    [-299.5, -350.7],
  ],
  width: 15,
  runoff: 12,
  kerbWidth: 1.4,
  lengthHint: 4010,
  referenceLapTime: 66, // initial guess (estimated from a speed-profile model); effective value = calibration.js override when present
  theme: {
    sky: ['#4f9cff', '#d4e9ff'], fog: '#cfe3f5', grass: '#3f7d2e', asphalt: '#3a3b3f',
    kerbA: '#e10600', kerbB: '#ffffff', sunDir: [-0.4, 0.8, 0.3],
    scenery: ['trees', 'grandstands'], treeDensity: 0.6,
  },
  seed: 1337,
};
