import { supabase } from './supabase';
import type {
  Space,
  Profile,
  Report,
  LeaderboardEntry,
  WeeklyLeaderboardEntry,
  SavedLocation,
  HourlyPattern,
  FlagReason,
  SpaceComment,
  Achievement,
  DailyMission,
} from '../types';

// ─── Spaces ──────────────────────────────────────────────────────────────────────

export async function fetchNearbySpaces(lat: number, lng: number, radiusM = 500): Promise<Space[]> {
  const { data, error } = await supabase.rpc('get_nearby_spaces', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    location: { lat: row.lat, lng: row.lng },
    verified: row.verified ?? false,
  }));
}

export async function fetchSpaceDetail(spaceId: string): Promise<Space | null> {
  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .eq('id', spaceId)
    .single();
  if (error) throw error;
  if (!data) return null;
  return { ...data, location: { lat: data.lat, lng: data.lng }, verified: data.verified ?? false };
}

export async function submitReport(params: {
  lat: number;
  lng: number;
  status: 'empty' | 'occupied';
  spaceId?: string;
  note?: string;
}) {
  const { data, error } = await supabase.rpc('submit_report', {
    p_lat: params.lat,
    p_lng: params.lng,
    p_status: params.status,
    p_space_id: params.spaceId ?? null,
    p_note: params.note ?? null,
  });
  if (error) throw error;
  return data;
}

export async function fetchSpacePattern(spaceId: string): Promise<HourlyPattern[]> {
  const { data, error } = await supabase.rpc('get_space_pattern', { p_space_id: spaceId });
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    hour_of_day: Number(d.hour_of_day),
    avg_probability: Number(d.avg_probability),
    sample_count: Number(d.sample_count),
  }));
}

export async function fetchAreaPattern(lat: number, lng: number, radiusM = 500): Promise<HourlyPattern[]> {
  const { data, error } = await supabase.rpc('get_area_pattern', {
    p_lat: lat, p_lng: lng, p_radius_m: radiusM,
  });
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    hour_of_day: Number(d.hour_of_day),
    avg_probability: Number(d.avg_probability),
    sample_count: Number(d.sample_count),
  }));
}

export async function flagSpace(spaceId: string, reason: FlagReason, note?: string) {
  const { data, error } = await supabase.rpc('flag_space', {
    p_space_id: spaceId, p_reason: reason, p_note: note ?? null,
  });
  if (error) throw error;
  return data;
}

export async function updateSpaceNote(spaceId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('update_space_note', { p_space_id: spaceId, p_note: note });
  if (error) throw error;
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────────

export async function toggleBookmark(spaceId: string): Promise<{ bookmarked: boolean }> {
  const { data, error } = await supabase.rpc('toggle_bookmark', { p_space_id: spaceId });
  if (error) throw error;
  return data;
}

export async function fetchBookmarkedSpaces(): Promise<Space[]> {
  const { data, error } = await supabase.rpc('get_bookmarked_spaces');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    location: { lat: row.lat, lng: row.lng },
    verified: row.verified ?? false,
  }));
}

export async function isBookmarked(spaceId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_bookmarked', { p_space_id: spaceId });
  if (error) return false;
  return data ?? false;
}

// ─── Comments ────────────────────────────────────────────────────────────────────

export async function fetchSpaceComments(spaceId: string): Promise<SpaceComment[]> {
  const { data, error } = await supabase.rpc('get_space_comments', { p_space_id: spaceId });
  if (error) throw error;
  return data ?? [];
}

export async function addSpaceComment(spaceId: string, body: string) {
  const { data, error } = await supabase.rpc('add_space_comment', {
    p_space_id: spaceId, p_body: body,
  });
  if (error) throw error;
  return data;
}

export async function deleteSpaceComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_space_comment', { p_comment_id: commentId });
  if (error) throw error;
}

// ─── Achievements ────────────────────────────────────────────────────────────────

export async function fetchUserAchievements(userId: string): Promise<Achievement[]> {
  const { data, error } = await supabase.rpc('get_user_achievements', { p_user_id: userId });
  if (error) throw error;
  return data ?? [];
}

// ─── Daily missions ──────────────────────────────────────────────────────────────

export async function fetchDailyMissions(): Promise<DailyMission[]> {
  const { data, error } = await supabase.rpc('get_daily_missions');
  if (error) throw error;
  return data ?? [];
}

// ─── Profile ─────────────────────────────────────────────────────────────────────

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function fetchUserReports(userId: string): Promise<Report[]> {
  const { data, error } = await supabase
    .from('reports').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────────

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, badge, confirmed_reports, credibility')
    .order('confirmed_reports', { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, user_id: d.id }));
}

export async function fetchWeeklyLeaderboard(): Promise<WeeklyLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_weekly_leaderboard');
  if (error) throw error;
  return (data ?? []).map((d: any) => ({ ...d, weekly_confirmed: Number(d.weekly_confirmed) }));
}

// ─── Saved locations ─────────────────────────────────────────────────────────────

export async function fetchSavedLocations(userId: string): Promise<SavedLocation[]> {
  const { data, error } = await supabase
    .from('saved_locations')
    .select('id, user_id, label, lat, lng, radius_m, notify, created_at')
    .eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertSavedLocation(params: {
  userId: string; lat: number; lng: number; label?: string; radiusM?: number;
}): Promise<void> {
  const label = params.label ?? 'home';
  await supabase.from('saved_locations').delete()
    .eq('user_id', params.userId).eq('label', label);
  const { error } = await supabase.from('saved_locations').insert({
    user_id: params.userId, label,
    location: `SRID=4326;POINT(${params.lng} ${params.lat})`,
    radius_m: params.radiusM ?? 300,
  });
  if (error) throw error;
}

export async function deleteSavedLocation(id: string): Promise<void> {
  const { error } = await supabase.from('saved_locations').delete().eq('id', id);
  if (error) throw error;
}

export async function setSavedLocationNotify(id: string, notify: boolean): Promise<void> {
  const { error } = await supabase.from('saved_locations').update({ notify }).eq('id', id);
  if (error) throw error;
}

export async function removePushToken(userId: string, token: string): Promise<void> {
  await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
}
