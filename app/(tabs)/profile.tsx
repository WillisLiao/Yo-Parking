import { View, Text, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { fetchProfile, fetchUserReports } from '../../lib/queries';
import { useAuthStore } from '../../store/authStore';
import { Colors, BADGE_LABELS } from '../../constants/colors';
import { CredibilityGauge } from '../../components/ui/CredibilityGauge';
import type { Report } from '../../types';

function formatTimeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小時前`;
  return `${Math.floor(diff / 1440)} 天前`;
}

function ReportItem({ report }: { report: Report }) {
  const statusLabel = report.reported_status === 'empty' ? '有空' : '停滿';
  const statusColor =
    report.reported_status === 'empty' ? Colors.marker.empty : Colors.marker.occupied;

  const resultIcon =
    report.consensus_result === 'correct'
      ? { name: 'check-circle' as const, color: Colors.marker.empty }
      : report.consensus_result === 'wrong'
      ? { name: 'close-circle' as const, color: Colors.marker.occupied }
      : { name: 'clock-outline' as const, color: Colors.marker.uncertain };

  return (
    <View
      className="flex-row items-center gap-3 p-4 rounded-2xl mb-2"
      style={{ backgroundColor: 'white' }}
    >
      <View
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: statusColor + '20' }}
      >
        <MaterialCommunityIcons
          name={report.reported_status === 'empty' ? 'motorbike' : 'car-brake-parking'}
          size={18}
          color={statusColor}
        />
      </View>
      <View className="flex-1">
        <Text className="font-semibold" style={{ color: Colors.primaryDark }}>
          回報「{statusLabel}」
        </Text>
        <Text className="text-xs mt-0.5" style={{ color: Colors.foreground, opacity: 0.5 }}>
          {formatTimeAgo(report.created_at)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name={resultIcon.name}
        size={20}
        color={resultIcon.color}
      />
    </View>
  );
}

function StreakBadge({ days }: { days: number }) {
  if (days === 0) return null;
  const isWeekPlus = days >= 7;
  return (
    <View
      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full"
      style={{
        backgroundColor: isWeekPlus ? '#F59E0B20' : Colors.primary + '15',
      }}
    >
      <MaterialCommunityIcons
        name="fire"
        size={16}
        color={isWeekPlus ? '#F59E0B' : Colors.primary}
      />
      <Text
        className="text-sm font-bold"
        style={{ color: isWeekPlus ? '#F59E0B' : Colors.primary }}
      >
        {days} 天連續回報
      </Text>
      {isWeekPlus && (
        <MaterialCommunityIcons name="star-four-points" size={12} color="#F59E0B" />
      )}
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

  async function signOut() {
    Alert.alert('登出', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出',
        style: 'destructive',
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
              <Text className="text-2xl font-bold" style={{ color: Colors.primaryDark }}>
                我的帳號
              </Text>
              <View className="flex-row">
                <TouchableOpacity onPress={() => router.push('/settings')} className="p-2">
                  <MaterialCommunityIcons name="cog-outline" size={22} color={Colors.foreground} />
                </TouchableOpacity>
                <TouchableOpacity onPress={signOut} className="p-2">
                  <MaterialCommunityIcons name="logout" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>

            {/* User info */}
            <View className="flex-row items-center gap-3 p-4 rounded-2xl" style={{ backgroundColor: 'white' }}>
              <View
                className="w-14 h-14 rounded-full items-center justify-center"
                style={{ backgroundColor: Colors.primary }}
              >
                <Text className="text-2xl font-bold text-white">
                  {(profile.display_name ?? user?.email ?? '?')[0].toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-semibold text-base" style={{ color: Colors.primaryDark }}>
                  {profile.display_name ?? user?.email}
                </Text>
                <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>
                  {BADGE_LABELS[profile.badge]} · 加入 Yo車位
                </Text>
              </View>
            </View>

            {/* Streak */}
            {(profile.streak_days ?? 0) > 0 && (
              <View className="items-start">
                <StreakBadge days={profile.streak_days ?? 0} />
              </View>
            )}

            {/* Credibility gauge */}
            <View className="p-5 rounded-2xl gap-4" style={{ backgroundColor: 'white' }}>
              <Text className="font-semibold text-base" style={{ color: Colors.primaryDark }}>
                可信賴度
              </Text>
              <CredibilityGauge score={profile.credibility} badge={profile.badge} />
            </View>

            {/* Stats */}
            <View className="flex-row gap-3">
              {[
                { label: '總回報', value: profile.total_reports },
                { label: '正確', value: profile.confirmed_reports, color: Colors.marker.empty },
                { label: '不準確', value: profile.false_reports, color: Colors.marker.occupied },
              ].map((s) => (
                <View
                  key={s.label}
                  className="flex-1 p-4 rounded-2xl items-center gap-1"
                  style={{ backgroundColor: 'white' }}
                >
                  <Text
                    className="text-2xl font-bold"
                    style={{ color: s.color ?? Colors.primaryDark }}
                  >
                    {s.value}
                  </Text>
                  <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.6 }}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>

            <Text className="font-semibold text-base mt-2" style={{ color: Colors.primaryDark }}>
              最近的回報
            </Text>
          </View>
        }
        renderItem={({ item }) => <ReportItem report={item} />}
        ListEmptyComponent={
          reportsLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <View className="items-center py-12 gap-2">
              <MaterialCommunityIcons name="map-marker-off-outline" size={40} color={Colors.muted} />
              <Text style={{ color: Colors.foreground, opacity: 0.5 }}>
                還沒有回報紀錄，去地圖上試試看！
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
