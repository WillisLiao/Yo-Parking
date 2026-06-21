import { View, Text, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { fetchProfile, fetchUserReports, fetchUserAchievements, fetchDailyMissions, fetchBookmarkedSpaces } from '../../lib/queries';
import { useAuthStore } from '../../store/authStore';
import { Colors, BADGE_LABELS } from '../../constants/colors';
import { CredibilityGauge } from '../../components/ui/CredibilityGauge';
import type { Report, DailyMission, Achievement, Badge } from '../../types';

function formatTimeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小時前`;
  return `${Math.floor(diff / 1440)} 天前`;
}

function ReportItem({ report }: { report: Report }) {
  const statusColor = report.reported_status === 'empty' ? Colors.marker.empty : Colors.marker.occupied;
  const resultIcon =
    report.consensus_result === 'correct'
      ? { name: 'check-circle' as const, color: Colors.marker.empty }
      : report.consensus_result === 'wrong'
      ? { name: 'close-circle' as const, color: Colors.marker.occupied }
      : { name: 'clock-outline' as const, color: Colors.marker.uncertain };

  return (
    <View className="flex-row items-center gap-3 p-4 rounded-2xl mb-2" style={{ backgroundColor: 'white' }}>
      <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: statusColor + '20' }}>
        <MaterialCommunityIcons
          name={report.reported_status === 'empty' ? 'motorbike' : 'car-brake-parking'}
          size={18} color={statusColor} />
      </View>
      <View className="flex-1">
        <Text className="font-semibold" style={{ color: Colors.primaryDark }}>
          回報「{report.reported_status === 'empty' ? '有空' : '停滿'}」
        </Text>
        <Text className="text-xs mt-0.5" style={{ color: Colors.foreground, opacity: 0.5 }}>
          {formatTimeAgo(report.created_at)}
        </Text>
      </View>
      <MaterialCommunityIcons name={resultIcon.name} size={20} color={resultIcon.color} />
    </View>
  );
}

function MissionCard({ mission }: { mission: DailyMission }) {
  const pct = Math.min(100, (mission.progress / mission.goal) * 100);
  return (
    <View className="flex-row items-center gap-3 p-3 rounded-xl mb-2"
      style={{
        backgroundColor: mission.completed ? Colors.marker.empty + '10' : 'white',
        borderWidth: 1,
        borderColor: mission.completed ? Colors.marker.empty + '40' : Colors.border,
      }}>
      <View className="w-9 h-9 rounded-full items-center justify-center"
        style={{ backgroundColor: mission.completed ? Colors.marker.empty + '20' : Colors.primary + '15' }}>
        <MaterialCommunityIcons
          name={mission.icon as any} size={18}
          color={mission.completed ? Colors.marker.empty : Colors.primary} />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold" style={{ color: Colors.primaryDark }}>{mission.title}</Text>
          <Text className="text-xs font-semibold"
            style={{ color: mission.completed ? Colors.marker.empty : Colors.foreground, opacity: mission.completed ? 1 : 0.5 }}>
            {mission.progress}/{mission.goal}
          </Text>
        </View>
        <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: Colors.muted }}>
          <View className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: mission.completed ? Colors.marker.empty : Colors.primary }} />
        </View>
      </View>
      {mission.completed && (
        <MaterialCommunityIcons name="check-circle" size={18} color={Colors.marker.empty} />
      )}
    </View>
  );
}

function AchievementPill({ item }: { item: Achievement }) {
  const earned = item.earned_at != null;
  return (
    <View className="items-center gap-1 mr-3" style={{ width: 64 }}>
      <View className="w-12 h-12 rounded-2xl items-center justify-center"
        style={{ backgroundColor: earned ? Colors.primary + '15' : Colors.muted, opacity: earned ? 1 : 0.5 }}>
        <MaterialCommunityIcons name={item.icon as any} size={22}
          color={earned ? Colors.primary : Colors.foreground} />
      </View>
      <Text className="text-xs text-center leading-tight" style={{ color: Colors.primaryDark, opacity: earned ? 1 : 0.4 }}
        numberOfLines={2}>
        {item.title}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, reset } = useAuthStore();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user!.id),
    enabled: !!user?.id,
  });

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['user-reports', user?.id],
    queryFn: () => fetchUserReports(user!.id),
    enabled: !!user?.id,
  });

  const { data: achievements = [] } = useQuery({
    queryKey: ['achievements', user?.id],
    queryFn: () => fetchUserAchievements(user!.id),
    enabled: !!user?.id,
  });

  const { data: missions = [] } = useQuery({
    queryKey: ['daily-missions'],
    queryFn: fetchDailyMissions,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const { data: bookmarks = [] } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: fetchBookmarkedSpaces,
    enabled: !!user?.id,
  });

  async function signOut() {
    Alert.alert('登出', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出', style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          reset();
          router.replace('/auth');
        },
      },
    ]);
  }

  if (profileLoading || !profile) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: Colors.surface }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const earnedCount = achievements.filter((a) => a.earned_at != null).length;
  const missionsCompleted = missions.filter((m) => m.completed).length;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top']}>
      <FlatList
        data={reports ?? []}
        keyExtractor={(r) => r.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View className="gap-4 mb-4">
            {/* Header */}
            <View className="flex-row items-center justify-between pt-2 pb-1">
              <Text className="text-2xl font-bold" style={{ color: Colors.primaryDark }}>我的帳號</Text>
              <View className="flex-row">
                <TouchableOpacity onPress={() => router.push('/settings')} className="p-2">
                  <MaterialCommunityIcons name="cog-outline" size={22} color={Colors.foreground} />
                </TouchableOpacity>
                <TouchableOpacity onPress={signOut} className="p-2">
                  <MaterialCommunityIcons name="logout" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>

            {/* User card */}
            <View className="flex-row items-center gap-3 p-4 rounded-2xl" style={{ backgroundColor: 'white' }}>
              <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: Colors.primary }}>
                <Text className="text-2xl font-bold text-white">
                  {(profile.display_name ?? user?.email ?? '?')[0].toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-semibold text-base" style={{ color: Colors.primaryDark }}>
                  {profile.display_name ?? user?.email}
                </Text>
                <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>
                  {BADGE_LABELS[profile.badge]}
                </Text>
              </View>
              {(profile.streak_days ?? 0) > 0 && (
                <View className="flex-row items-center gap-1 px-2 py-1 rounded-full"
                  style={{ backgroundColor: (profile.streak_days >= 7 ? '#F59E0B' : Colors.primary) + '15' }}>
                  <MaterialCommunityIcons name="fire" size={14}
                    color={profile.streak_days >= 7 ? '#F59E0B' : Colors.primary} />
                  <Text className="text-xs font-bold"
                    style={{ color: profile.streak_days >= 7 ? '#F59E0B' : Colors.primary }}>
                    {profile.streak_days}天
                  </Text>
                </View>
              )}
            </View>

            {/* Credibility */}
            <View className="p-5 rounded-2xl gap-4" style={{ backgroundColor: 'white' }}>
              <Text className="font-semibold text-base" style={{ color: Colors.primaryDark }}>可信賴度</Text>
              <CredibilityGauge score={profile.credibility} badge={profile.badge} />
            </View>

            {/* Stats row */}
            <View className="flex-row gap-3">
              {[
                { label: '總回報', value: profile.total_reports },
                { label: '正確', value: profile.confirmed_reports, color: Colors.marker.empty },
                { label: '收藏', value: bookmarks.length },
              ].map((s) => (
                <View key={s.label} className="flex-1 p-4 rounded-2xl items-center gap-1" style={{ backgroundColor: 'white' }}>
                  <Text className="text-2xl font-bold" style={{ color: (s as any).color ?? Colors.primaryDark }}>
                    {s.value}
                  </Text>
                  <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.6 }}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Daily missions */}
            <View className="p-4 rounded-2xl gap-3" style={{ backgroundColor: 'white' }}>
              <View className="flex-row items-center justify-between">
                <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>今日任務</Text>
                <Text className="text-xs font-semibold" style={{ color: Colors.primary }}>
                  {missionsCompleted}/{missions.length} 完成
                </Text>
              </View>
              {missions.map((m) => <MissionCard key={m.id} mission={m} />)}
            </View>

            {/* Achievements preview */}
            {achievements.length > 0 && (
              <View className="p-4 rounded-2xl gap-3" style={{ backgroundColor: 'white' }}>
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>
                    成就 {earnedCount}/{achievements.length}
                  </Text>
                  <TouchableOpacity onPress={() => router.push('/achievements')}>
                    <Text className="text-xs font-semibold" style={{ color: Colors.primary }}>查看全部 →</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={achievements.slice(0, 6)}
                  keyExtractor={(a) => a.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => <AchievementPill item={item} />}
                />
              </View>
            )}

            {/* Bookmarks quick access */}
            {bookmarks.length > 0 && (
              <TouchableOpacity
                onPress={() => router.push('/nearby-list')}
                className="flex-row items-center justify-between p-4 rounded-2xl"
                style={{ backgroundColor: 'white' }}>
                <View className="flex-row items-center gap-2">
                  <MaterialCommunityIcons name="bookmark-multiple-outline" size={20} color={Colors.primary} />
                  <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>
                    收藏的車位（{bookmarks.length}）
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.muted} />
              </TouchableOpacity>
            )}

            <Text className="font-semibold text-base mt-2" style={{ color: Colors.primaryDark }}>最近的回報</Text>
          </View>
        }
        renderItem={({ item }) => <ReportItem report={item} />}
        ListEmptyComponent={
          reportsLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <View className="items-center py-12 gap-2">
              <MaterialCommunityIcons name="map-marker-off-outline" size={40} color={Colors.muted} />
              <Text style={{ color: Colors.foreground, opacity: 0.5 }}>還沒有回報紀錄，去地圖上試試看！</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
