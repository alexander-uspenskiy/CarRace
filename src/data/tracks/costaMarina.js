// Costa Marina Street Circuit — original circuit. Control points describe a CLOSED loop (clockwise seen from above,
// sim y = south) in travel direction; control point 0 is the start/finish line, on a long straight.
export const costaMarina = {
  id: 'costa-marina',
  name: 'Costa Marina Street Circuit',
  country: 'Spain',
  blurb: 'Coastal street circuit: a long seafront blast, tight 90-degree street corners and a flowing run beside the sea.',
  rating: { speed: 3, technical: 4 },
  controlPoints: [
    [-138, -280.8], [-80.3, -280.8], [-2.8, -280.8], [74.8, -280.8], [152.3, -280.8], [229.8, -280.8],
    [307.3, -280.8], [384.9, -280.8], [462.4, -280.8], [491.9, -275.1], [517.3, -259], [534.9, -234.6],
    [542.3, -205.5], [545.1, -157], [548, -108.6], [546.2, -94.6], [539.3, -82.2], [528.5, -73.1],
    [515.1, -68.7], [456.5, -60.9], [398, -53.1], [385.6, -49.2], [375.2, -41.3], [368.1, -30.4],
    [365.1, -17.8], [360.9, 48.5], [356.8, 114.8], [353.7, 127.5], [346.6, 138.5], [336.1, 146.3],
    [323.6, 150.1], [250, 159.3], [176.4, 168.5], [102.8, 177.7], [25.3, 201.2], [-31.8, 229.7],
    [-88.8, 258.2], [-159.4, 280.8], [-233.5, 280.6], [-283.6, 272.7], [-333.7, 264.8], [-356.1, 257.3],
    [-374.7, 242.7], [-387.3, 222.8], [-392.7, 199.8], [-396.1, 142.1], [-399.5, 84.4], [-403, 70.6],
    [-411.3, 59], [-423.4, 51.3], [-437.4, 48.6], [-510, 48.6], [-521.7, 46.8], [-532.3, 41.4],
    [-540.7, 33], [-546.1, 22.4], [-548, 10.6], [-548, -59.8], [-548, -130.3], [-548, -200.8],
    [-544, -225.5], [-532.7, -247.8], [-515, -265.5], [-492.7, -276.8], [-468, -280.8], [-390.4, -280.8],
    [-312.9, -280.8], [-235.4, -280.8], [-157.8, -280.8],
  ],
  width: 13.5,
  runoff: 5,
  kerbWidth: 1.2,
  lengthHint: 2980,
  referenceLapTime: 71, // initial guess (estimated from a speed-profile model); effective value = calibration.js override when present
  theme: {
    sky: ['#2f93ff', '#dbf1ff'], fog: '#d6ecf7', grass: '#6f8f4a', asphalt: '#4a4b50',
    kerbA: '#0050b4', kerbB: '#ffffff', sunDir: [0.6, 0.8, -0.2],
    scenery: ['palms', 'buildings', 'grandstands'], treeDensity: 0.35,
  },
  seed: 4242,
};
