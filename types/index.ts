export type SpaceStatus = 'empty' | 'occupied';

export type Badge = 'newbie' | 'regular' | 'reliable' | 'expert' | 'guardian';

export type FlagReason = 'wrong_location' | 'always_occupied' | 'spam' | 'other';

export interface Space {
  id: string;
  location: { lat: number; lng: number };
  status: SpaceStatus;
  probability: number;
  report_count: number;
  last_updated: string;
  last_reported_by: string | null;
  distance_m?: number;
  notes?: string | null;
  verified: boolean;
  verified_at?: string | null;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  credibility: number;
  total_reports: number;
  confirmed_reports: number;
  false_reports: number;
  report_weight_cap: number;
  badge: Badge;
  streak_days: number;
  last_report_date: string | null;
}

export interface Report {
  id: string;
  space_id: string;
  user_id: string;
  reported_status: SpaceStatus;
  credibility_snap: number;
  created_at: string;
  confirmed: boolean | null;
  weight: number;
  consensus_result: 'correct' | 'wrong' | 'expired' | 'pending' | null;
  scored_at?: string | null;
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  badge: Badge;
  confirmed_reports: number;
  credibility: number;
}

export interface WeeklyLeaderboardEntry {
  user_id: string;
  display_name: string | null;
  badge: Badge;
  weekly_confirmed: number;
  credibility: number;
}

export interface ConsensusWindow {
  id: string;
  space_id: string;
  window_start: string;
  window_end: string;
  scored: boolean;
}

export interface SavedLocation {
  id: string;
  user_id: string;
  label: string;
  lat: number;
  lng: number;
  radius_m: number;
  notify: boolean;
  created_at: string;
}

export interface SpaceFlag {
  id: string;
  space_id: string;
  user_id: string;
  reason: FlagReason;
  note: string | null;
  created_at: string;
}

export interface HourlyPattern {
  hour_of_day: number;
  avg_probability: number;
  sample_count: number;
}
