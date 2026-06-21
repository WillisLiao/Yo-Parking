export const Colors = {
  primary: '#0F766E',
  primaryDark: '#134E4A',
  secondary: '#14B8A6',
  accent: '#0369A1',
  surface: '#F0FDFA',
  muted: '#E8F0F3',
  border: '#99F6E4',
  foreground: '#134E4A',
  white: '#FFFFFF',
  black: '#000000',

  marker: {
    empty: '#22C55E',
    occupied: '#EF4444',
    uncertain: '#F59E0B',
  },

  badge: {
    newbie: '#EF4444',
    regular: '#F59E0B',
    reliable: '#22C55E',
    expert: '#3B82F6',
    guardian: '#8B5CF6',
  },

  dark: {
    background: '#0D1F1E',
    surface: '#1A2E2C',
    muted: '#243B39',
    foreground: '#CCFBF1',
    border: '#2D4A47',
  },
} as const;

export const BADGE_LABELS: Record<string, string> = {
  newbie: '新手',
  regular: '普通',
  reliable: '可靠',
  expert: '達人',
  guardian: '守護者',
};

export const BADGE_THRESHOLDS = {
  newbie: 0,
  regular: 31,
  reliable: 61,
  expert: 81,
  guardian: 100,
};

export const PROBABILITY_COLORS = (p: number): string => {
  if (p >= 0.65) return Colors.marker.empty;
  if (p >= 0.35) return Colors.marker.uncertain;
  return Colors.marker.occupied;
};

export const GPS_RADIUS = {
  reportKnownSpace: 100,
  createNewSpace: 30,
  confirmExisting: 150,
} as const;

export const RATE_LIMITS = {
  reportsPerHour: 5,
  minGapPerSpaceMinutes: 10,
  newSpacesPerDay: 3,
} as const;
