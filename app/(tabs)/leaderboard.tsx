import { useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchLeaderboard, fetchWeeklyLeaderboard } from '../../lib/queries';
import { Colors, BADGE_LABELS } from '../../constants/colors';
import { useAuthStore } from '../../store/authStore';
import type { LeaderboardEntry, WeeklyLeaderboardEntry, Badge } from '../../types';

type Mode = 'weekly' | 'alltime';

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <MaterialCommunityIcons name="medal" size={22} color="#F59E0B" />;
  if (rank === 2) return <MaterialCommunityIcons name="medal" size={22} color="#94A3B8" />;
  if (rank === 3) return <MaterialCommunityIcons name="medal" size={22} color="#92400E" />;
  return (
    <Text className="text-base font-bold w-6 text-center" style={{ color: Colors.foreground, opacity: 0.4 }}>
      {rank}
    </Text>
  );
}

function LeaderboardRow({
  userId,
  displayName,
  badge,
  score,
  scoreLabel,
  rank,
}: {
  userId: string;
  displayName: string | null;
  badge: Badge;
  score: number;
  scoreLabel: string;
  rank: number;
}) {
  const { user } = useAuthStore();
  const isMe = userId === user?.id;
  const badgeColor = Colors.badge[badge] ?? Colors.primary;

  return (
    <View
      className="flex-row items-center gap-3 p-4 rounded-2xl mb-2"
      style={{
        backgroundColor: isMe ? Colors.primary + '10' : 'white',
        borderWidth: isMe ? 1.5 : 0,
        borderColor: isMe ? Colors.primary : 'transparent',
      }}
    >
      <View className="w-7 items-center">
        <RankMedal rank={rank} />
      </View>

      <View
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: Colors.primary }}
      >
        <Text className="text-white font-bold">
          {(displayName ?? '?')[0].toUpperCase()}
        </Text>
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-semibold" style={{ color: Colors.primaryDark }}>
            {displayName ?? '匿名用戶'}
          </Text>
          {isMe && (
            <Text className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: Colors.primary + '20', color: Colors.primary }}>
              你
            </Text>
          )}
        </View>
        <Text className="text-xs mt-0.5" style={{ color: badgeColor }}>
          {BADGE_LABELS[badge]}
        </Text>
      </View>

      <View className="items-end">
        <Text className="font-bold text-base" style={{ color: Colors.primaryDark }}>
          {score}
        </Text>
        <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>
          {scoreLabel}
        </Text>
      </View>
    </View>
  );
}

export default function LeaderboardScreen() {
  const [mode, setMode] = useState<Mode>('weekly');

  const { data: allTime, isLoading: loadingAll } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: fetchLeaderboard,
    staleTime: 5 * 60_000,
  });

  const { data: weekly, isLoading: loadingWeekly } = useQuery({
    queryKey: ['leaderboard-weekly'],
    queryFn: fetchWeeklyLeaderboard,
    staleTime: 5 * 60_000,
  });

  const isLoading = mode === 'weekly' ? loadingWeekly : loadingAll;

  const rows =
    mode === 'weekly'
      ? (weekly ?? []).map((e: WeeklyLeaderboardEntry) => ({
          userId: e.user_id,
          displayName: e.display_name,
          badge: e.badge as Badge,
          score: e.weekly_confirmed,
          scoreLabel: '本週正確',
        }))
      : (allTime ?? []).map((e: LeaderboardEntry) => ({
          userId: e.user_id,
          displayName: e.display_name,
          badge: e.badge as Badge,
          score: e.confirmed_reports,
          scoreLabel: '正確回報',
        }));

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={(e) => e.userId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View className="py-4 gap-3 mb-2">
            <View className="gap-1">
              <Text className="text-2xl font-bold" style={{ color: Colors.primaryDark }}>
                排行榜
              </Text>
              <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.55 }}>
                最準確的回報者
              </Text>
            </View>

            {/* Mode toggle */}
            <View
              className="flex-row rounded-xl p-1"
              style={{ backgroundColor: Colors.muted }}
            >
              {(['weekly', 'alltime'] as Mode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMode(m)}
                  className="flex-1 py-2 rounded-lg items-center"
                  style={{
                    backgroundColor: mode === m ? Colors.primary : 'transparent',
                  }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: mode === m ? 'white' : Colors.foreground }}
                  >
                    {m === 'weekly' ? '本週' : '總排行'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <LeaderboardRow {...item} rank={index + 1} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View className="items-center py-16 gap-2">
              <MaterialCommunityIcons name="trophy-outline" size={48} color={Colors.muted} />
              <Text style={{ color: Colors.foreground, opacity: 0.5 }}>
                {mode === 'weekly' ? '本週還沒有回報紀錄' : '還沒有排行資料'}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
