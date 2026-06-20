import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchAreaPattern } from '../../lib/queries';
import { useMapStore } from '../../store/mapStore';
import { Colors, PROBABILITY_COLORS } from '../../constants/colors';
import type { HourlyPattern } from '../../types';

const HOUR_LABELS: Record<number, string> = {
  0: '凌晨', 6: '清晨', 7: '早上', 8: '上班', 9: '上班',
  12: '中午', 13: '午後', 17: '下班', 18: '傍晚', 22: '深夜',
};

function AvailabilityBar({ entry, isNow }: { entry: HourlyPattern | null; isNow: boolean }) {
  const prob = entry?.avg_probability ?? 0;
  const hasData = entry !== null;
  const barH = hasData ? Math.max(6, Math.round(prob * 80)) : 6;
  const color = hasData ? PROBABILITY_COLORS(prob) : Colors.muted;

  return (
    <View className="flex-1 items-center justify-end gap-0.5" style={{ height: 88 }}>
      <View
        style={{
          width: '85%',
          height: barH,
          backgroundColor: hasData ? color + 'CC' : color,
          borderRadius: 3,
          borderWidth: isNow ? 2 : 0,
          borderColor: Colors.primaryDark,
        }}
      />
    </View>
  );
}

function HourlyChart({ data }: { data: HourlyPattern[] }) {
  const byHour = new Map(data.map((d) => [d.hour_of_day, d]));
  const now = new Date().getHours();
  const totalSamples = data.reduce((sum, d) => sum + d.sample_count, 0);

  if (data.length === 0) {
    return (
      <View className="items-center py-10 gap-2">
        <MaterialCommunityIcons name="chart-bar-stacked" size={40} color={Colors.muted} />
        <Text className="text-sm text-center" style={{ color: Colors.foreground, opacity: 0.4 }}>
          附近還沒有足夠資料{'\n'}回報更多車位後就能看到規律！
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-end gap-px" style={{ height: 88 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <AvailabilityBar key={h} entry={byHour.get(h) ?? null} isNow={h === now} />
        ))}
      </View>

      {/* X-axis labels */}
      <View className="flex-row">
        {[0, 6, 12, 18, 23].map((h) => (
          <Text
            key={h}
            className="absolute text-xs"
            style={{
              color: Colors.foreground,
              opacity: 0.45,
              fontSize: 10,
              left: `${(h / 23) * 96}%`,
            }}
          >
            {h}時
          </Text>
        ))}
      </View>

      <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.4 }}>
        基於過去 30 天 {totalSamples.toLocaleString()} 筆回報　▏= 現在時間
      </Text>
    </View>
  );
}

function PeakSummary({ data }: { data: HourlyPattern[] }) {
  if (data.length === 0) return null;

  const sorted = [...data].sort((a, b) => b.avg_probability - a.avg_probability);
  const best = sorted.slice(0, 3);
  const worst = sorted.slice(-3).reverse();

  function hourLabel(h: number) {
    const ampm = h < 12 ? '上午' : '下午';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${ampm} ${display}時`;
  }

  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="flex-1 p-4 rounded-2xl gap-2" style={{ backgroundColor: Colors.marker.empty + '12' }}>
          <View className="flex-row items-center gap-1">
            <MaterialCommunityIcons name="clock-check-outline" size={15} color={Colors.marker.empty} />
            <Text className="text-xs font-semibold" style={{ color: Colors.marker.empty }}>最容易找到</Text>
          </View>
          {best.map((d) => (
            <Text key={d.hour_of_day} className="text-sm" style={{ color: Colors.primaryDark }}>
              {hourLabel(d.hour_of_day)}
              <Text className="font-bold"> {Math.round(d.avg_probability * 100)}%</Text>
            </Text>
          ))}
        </View>

        <View className="flex-1 p-4 rounded-2xl gap-2" style={{ backgroundColor: Colors.marker.occupied + '10' }}>
          <View className="flex-row items-center gap-1">
            <MaterialCommunityIcons name="clock-alert-outline" size={15} color={Colors.marker.occupied} />
            <Text className="text-xs font-semibold" style={{ color: Colors.marker.occupied }}>最難找到</Text>
          </View>
          {worst.map((d) => (
            <Text key={d.hour_of_day} className="text-sm" style={{ color: Colors.primaryDark }}>
              {hourLabel(d.hour_of_day)}
              <Text className="font-bold"> {Math.round(d.avg_probability * 100)}%</Text>
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function AnalyticsScreen() {
  const { userLocation } = useMapStore();

  const { data: pattern = [], isLoading } = useQuery({
    queryKey: ['area-pattern', userLocation?.lat, userLocation?.lng],
    queryFn: () =>
      userLocation
        ? fetchAreaPattern(userLocation.lat, userLocation.lng)
        : Promise.resolve([]),
    enabled: !!userLocation,
    staleTime: 15 * 60_000,
  });

  const now = new Date().getHours();
  const nowEntry = pattern.find((d) => d.hour_of_day === now);
  const nowProbability = nowEntry?.avg_probability ?? null;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="py-4 gap-1 mb-4">
          <Text className="text-2xl font-bold" style={{ color: Colors.primaryDark }}>
            停車分析
          </Text>
          <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.55 }}>
            附近500公尺，過去30天的規律
          </Text>
        </View>

        {!userLocation && (
          <View className="items-center py-16 gap-2">
            <MaterialCommunityIcons name="map-marker-off-outline" size={48} color={Colors.muted} />
            <Text className="text-center" style={{ color: Colors.foreground, opacity: 0.5 }}>
              需要先開啟地圖定位
            </Text>
          </View>
        )}

        {userLocation && isLoading && (
          <View className="items-center py-16">
            <ActivityIndicator color={Colors.primary} />
          </View>
        )}

        {userLocation && !isLoading && (
          <View className="gap-4">
            {/* Current moment card */}
            {nowProbability !== null && (
              <View
                className="p-5 rounded-2xl flex-row items-center gap-4"
                style={{ backgroundColor: PROBABILITY_COLORS(nowProbability) + '15' }}
              >
                <View
                  className="w-16 h-16 rounded-full items-center justify-center"
                  style={{ backgroundColor: PROBABILITY_COLORS(nowProbability) + '25' }}
                >
                  <Text className="text-2xl font-bold" style={{ color: PROBABILITY_COLORS(nowProbability) }}>
                    {Math.round(nowProbability * 100)}%
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-base" style={{ color: Colors.primaryDark }}>
                    現在這個時段
                  </Text>
                  <Text className="text-sm mt-0.5" style={{ color: Colors.foreground, opacity: 0.6 }}>
                    {nowProbability >= 0.65
                      ? '通常很容易找到空位'
                      : nowProbability >= 0.4
                      ? '有時候有、有時候沒有'
                      : '這個時段通常很難找'}
                  </Text>
                </View>
              </View>
            )}

            {/* Hourly chart */}
            <View className="p-5 rounded-2xl gap-4" style={{ backgroundColor: 'white' }}>
              <Text className="font-semibold text-base" style={{ color: Colors.primaryDark }}>
                每小時空位率
              </Text>
              <HourlyChart data={pattern} />
            </View>

            {/* Peak summary */}
            {pattern.length > 0 && (
              <View className="p-5 rounded-2xl gap-3" style={{ backgroundColor: 'white' }}>
                <Text className="font-semibold text-base" style={{ color: Colors.primaryDark }}>
                  時段比較
                </Text>
                <PeakSummary data={pattern} />
              </View>
            )}

            {/* Tips */}
            <View className="p-4 rounded-2xl gap-2" style={{ backgroundColor: Colors.primary + '10' }}>
              <View className="flex-row items-center gap-2">
                <MaterialCommunityIcons name="lightbulb-outline" size={16} color={Colors.primary} />
                <Text className="font-semibold text-sm" style={{ color: Colors.primary }}>找車位小技巧</Text>
              </View>
              <Text className="text-sm leading-relaxed" style={{ color: Colors.primary, opacity: 0.85 }}>
                早上7–9點和下午5–7點是機車格最搶手的時段。建議提前15分鐘出發，或考慮提前回報讓其他人知道你看到的情況。
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
