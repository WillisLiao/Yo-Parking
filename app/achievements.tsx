import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchUserAchievements } from '../lib/queries';
import { useAuthStore } from '../store/authStore';
import { Colors } from '../constants/colors';
import type { Achievement } from '../types';

function AchievementCard({ item }: { item: Achievement }) {
  const earned = item.earned_at != null;
  const earnedDate = earned
    ? new Date(item.earned_at!).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
    : null;

  return (
    <View
      className="flex-row items-center gap-4 p-4 rounded-2xl mb-3"
      style={{
        backgroundColor: earned ? 'white' : Colors.muted,
        opacity: earned ? 1 : 0.55,
        borderWidth: earned ? 1.5 : 0,
        borderColor: earned ? Colors.border : 'transparent',
      }}
    >
      <View
        className="w-14 h-14 rounded-2xl items-center justify-center flex-shrink-0"
        style={{ backgroundColor: earned ? Colors.primary + '15' : Colors.muted }}
      >
        <MaterialCommunityIcons
          name={item.icon as any}
          size={28}
          color={earned ? Colors.primary : Colors.foreground}
          style={{ opacity: earned ? 1 : 0.4 }}
        />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-bold text-sm" style={{ color: Colors.primaryDark }}>
            {item.title}
          </Text>
          {earned && (
            <MaterialCommunityIcons name="check-circle" size={14} color={Colors.marker.empty} />
          )}
        </View>
        <Text className="text-xs mt-0.5 leading-relaxed" style={{ color: Colors.foreground, opacity: 0.65 }}>
          {item.description}
        </Text>
        {earned && earnedDate && (
          <Text className="text-xs mt-1" style={{ color: Colors.primary, opacity: 0.7 }}>
            {earnedDate} 獲得
          </Text>
        )}
      </View>
    </View>
  );
}

export default function AchievementsScreen() {
  const { user } = useAuthStore();

  const { data: achievements = [], isLoading } = useQuery({
    queryKey: ['achievements', user?.id],
    queryFn: () => fetchUserAchievements(user!.id),
    enabled: !!user?.id,
  });

  const earned = achievements.filter((a) => a.earned_at != null).length;
  const total = achievements.length;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 pt-2 pb-3 gap-2">
        <MaterialCommunityIcons
          name="arrow-left"
          size={24}
          color={Colors.primaryDark}
          onPress={() => router.back()}
        />
        <Text className="text-xl font-bold flex-1" style={{ color: Colors.primaryDark }}>
          成就
        </Text>
        {!isLoading && (
          <Text className="text-sm font-semibold" style={{ color: Colors.primary }}>
            {earned} / {total}
          </Text>
        )}
      </View>

      {/* Progress bar */}
      {!isLoading && total > 0 && (
        <View className="mx-4 mb-4">
          <View className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: Colors.muted }}>
            <View
              className="h-full rounded-full"
              style={{ width: `${(earned / total) * 100}%`, backgroundColor: Colors.primary }}
            />
          </View>
          <Text className="text-xs mt-1" style={{ color: Colors.foreground, opacity: 0.5 }}>
            已解鎖 {earned} 個，還有 {total - earned} 個等你挑戰
          </Text>
        </View>
      )}

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={achievements}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <AchievementCard item={item} />}
        />
      )}
    </SafeAreaView>
  );
}
