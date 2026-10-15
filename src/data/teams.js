// 2025 F1 grid: 10 teams, 20 drivers. carId = teamIndex*2 + driverSlot.
const d = (id, name, number, nationality, skill, base, accent) => ({
  id,
  name,
  code: id.toUpperCase(),
  number,
  nationality,
  skill,
  helmet: { base, accent },
});

export const TEAMS = [
  {
    id: 'mclaren', name: 'McLaren Formula 1 Team', shortName: 'McLaren', car: 'MCL39', country: 'GBR', strength: 1.0,
    livery: { primary: '#FF8000', secondary: '#0B0B0F', accent: '#47C7FC', wing: '#FF8000', rim: '#1a1a1a', pattern: 'solid' },
    drivers: [
      d('nor', 'Lando Norris', 4, 'GBR', 0.96, '#FF8000', '#0B0B0F'),
      d('pia', 'Oscar Piastri', 81, 'AUS', 0.95, '#FF8000', '#47C7FC'),
    ],
  },
  {
    id: 'ferrari', name: 'Scuderia Ferrari HP', shortName: 'Ferrari', car: 'SF-25', country: 'ITA', strength: 0.93,
    livery: { primary: '#E8002D', secondary: '#FFEB00', accent: '#FFFFFF', wing: '#E8002D', rim: '#1a1a1a', pattern: 'stripe' },
    drivers: [
      d('lec', 'Charles Leclerc', 16, 'MON', 0.96, '#E8002D', '#FFEB00'),
      d('ham', 'Lewis Hamilton', 44, 'GBR', 0.95, '#E8002D', '#FFFFFF'),
    ],
  },
  {
    id: 'redbull', name: 'Red Bull Racing', shortName: 'Red Bull', car: 'RB21', country: 'AUT', strength: 0.92,
    livery: { primary: '#1E41FF', secondary: '#121F45', accent: '#FFD800', wing: '#1E41FF', rim: '#1a1a1a', pattern: 'split' },
    drivers: [
      d('ver', 'Max Verstappen', 1, 'NED', 0.99, '#1E41FF', '#FFD800'),
      d('tsu', 'Yuki Tsunoda', 22, 'JPN', 0.9, '#121F45', '#FFD800'),
    ],
  },
  {
    id: 'mercedes', name: 'Mercedes-AMG Petronas', shortName: 'Mercedes', car: 'W16', country: 'GER', strength: 0.9,
    livery: { primary: '#27F4D2', secondary: '#0B0B0F', accent: '#C0C0C0', wing: '#27F4D2', rim: '#1a1a1a', pattern: 'stripe' },
    drivers: [
      d('rus', 'George Russell', 63, 'GBR', 0.95, '#27F4D2', '#0B0B0F'),
      d('ant', 'Kimi Antonelli', 12, 'ITA', 0.88, '#27F4D2', '#C0C0C0'),
    ],
  },
  {
    id: 'williams', name: 'Williams Racing', shortName: 'Williams', car: 'FW47', country: 'GBR', strength: 0.78,
    livery: { primary: '#1868DB', secondary: '#FFFFFF', accent: '#00A0DE', wing: '#1868DB', rim: '#1a1a1a', pattern: 'chevron' },
    drivers: [
      d('alb', 'Alexander Albon', 23, 'THA', 0.9, '#1868DB', '#FFFFFF'),
      d('sai', 'Carlos Sainz', 55, 'ESP', 0.92, '#1868DB', '#00A0DE'),
    ],
  },
  {
    id: 'astonmartin', name: 'Aston Martin Aramco', shortName: 'Aston Martin', car: 'AMR25', country: 'GBR', strength: 0.74,
    livery: { primary: '#229971', secondary: '#0B0B0F', accent: '#CEDC00', wing: '#229971', rim: '#1a1a1a', pattern: 'solid' },
    drivers: [
      d('alo', 'Fernando Alonso', 14, 'ESP', 0.94, '#229971', '#CEDC00'),
      d('str', 'Lance Stroll', 18, 'CAN', 0.86, '#229971', '#0B0B0F'),
    ],
  },
  {
    id: 'racingbulls', name: 'Racing Bulls', shortName: 'Racing Bulls', car: 'VCARB 02', country: 'ITA', strength: 0.72,
    livery: { primary: '#6692FF', secondary: '#FFFFFF', accent: '#1B2A5C', wing: '#6692FF', rim: '#1a1a1a', pattern: 'split' },
    drivers: [
      d('had', 'Isack Hadjar', 6, 'FRA', 0.87, '#6692FF', '#1B2A5C'),
      d('law', 'Liam Lawson', 30, 'NZL', 0.88, '#6692FF', '#FFFFFF'),
    ],
  },
  {
    id: 'haas', name: 'Haas F1 Team', shortName: 'Haas', car: 'VF-25', country: 'USA', strength: 0.7,
    livery: { primary: '#E6E8EA', secondary: '#E6002B', accent: '#0B0B0F', wing: '#E6E8EA', rim: '#1a1a1a', pattern: 'stripe' },
    drivers: [
      d('oco', 'Esteban Ocon', 31, 'FRA', 0.89, '#E6E8EA', '#E6002B'),
      d('bea', 'Oliver Bearman', 87, 'GBR', 0.88, '#E6E8EA', '#0B0B0F'),
    ],
  },
  {
    id: 'alpine', name: 'BWT Alpine F1 Team', shortName: 'Alpine', car: 'A525', country: 'FRA', strength: 0.66,
    livery: { primary: '#0093CC', secondary: '#FF87BC', accent: '#FFFFFF', wing: '#0093CC', rim: '#1a1a1a', pattern: 'split' },
    drivers: [
      d('gas', 'Pierre Gasly', 10, 'FRA', 0.91, '#0093CC', '#FF87BC'),
      d('col', 'Franco Colapinto', 43, 'ARG', 0.87, '#0093CC', '#FFFFFF'),
    ],
  },
  {
    id: 'sauber', name: 'Kick Sauber', shortName: 'Sauber', car: 'C45', country: 'SUI', strength: 0.65,
    livery: { primary: '#52E252', secondary: '#0B0B0F', accent: '#FFFFFF', wing: '#52E252', rim: '#1a1a1a', pattern: 'chevron' },
    drivers: [
      d('hul', 'Nico Hulkenberg', 27, 'GER', 0.9, '#52E252', '#0B0B0F'),
      d('bor', 'Gabriel Bortoleto', 5, 'BRA', 0.85, '#52E252', '#FFFFFF'),
    ],
  },
];

export const ALL_DRIVERS = TEAMS.flatMap((t) => t.drivers);

const teamById = new Map(TEAMS.map((t, i) => [t.id, { team: t, index: i }]));
const driverById = new Map();
for (const t of TEAMS) for (const dr of t.drivers) driverById.set(dr.id, { driver: dr, team: t });

/** Team by id; undefined if unknown. */
export function getTeam(id) {
  return teamById.get(id)?.team;
}
/** {driver, team} by driver id; undefined if unknown. */
export function getDriver(driverId) {
  return driverById.get(driverId);
}
/** 0..9 (TEAMS order); -1 if unknown. */
export function teamIndex(id) {
  const e = teamById.get(id);
  return e ? e.index : -1;
}
/** carId = teamIndex*2 + driverSlot. */
export function carIdFor(teamId, driverSlot) {
  return teamIndex(teamId) * 2 + driverSlot;
}
/** 3-letter code from the last word of a name: letters only, uppercased, padded with 'X'; fallback 'PLR'. */
export function makeDriverCode(name) {
  const words = String(name ?? '').trim().split(/\s+/);
  const last = words[words.length - 1] || '';
  const letters = last.normalize('NFD').replace(/[^A-Za-z]/g, '');
  if (!letters) return 'PLR';
  return letters.slice(0, 3).toUpperCase().padEnd(3, 'X');
}
