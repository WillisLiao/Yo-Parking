import { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchNearbySpaces, fetchBookmarkedSpaces } from '../lib/queries';
import { useMapStore } from '../store/mapStore';
import { Colors, PROBABILITY_COLORS } from '../constants/colors';
import type { Space } from '../types';

type SortMode = 'distance' | 'probability';
type FilterMode = 'all' | 'empty' | 'bookmarks';

function formatDistance(m?: number): string {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)} 公尺`;
  return `${(m / 1000).toFixed(1)} 公里`;
}

function formatTimeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (diff < 1) return '剛剛';
  if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
  return `${Math.floor(diff / 60)} 小時前`;
}

function SpaceRow({ space, onPress }: { space: Space; onPress: () => void }) {
  const pct = Math.round(space.probability * 100);
  const color = PROBABILITY_COLORS(space.probability);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="flex-row items-center gap-3 p-4 rounded-2xl mb-2"
      style={{ backgroundColor: 'white' }}
    >
      {/* Probability circle */}
      <View
        className="w-14 h-14 rounded-full items-center justify-center flex-shrink-0"
        style={{ backgroundColor: color + '20' }}
      >
        <Text className="text-lg font-bold" style={{ color }}>
          {pct}%
        </Text>
      </View>

      {/* Details */}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          {space.verified && (
            <MaterialCommunityIcons name="check-decagram" size={13} color={Colors.accent} />
          )}
          <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>
            {space.status === 'empty' ? '有空位' : '停滿'}
          </Text>
          <View
            className="px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor:
                space.status === 'empty' ? Colors.marker.empty + '20' : Colors.marker.occupied + '20',
            }}
          >
            <Text
              className="text-xs"
              style={{
                color: space.status === 'empty' ? Colors.marker.empty : Colors.marker.occupied,
              }}
            >
              {space.status === 'empty' ? '有空' : '停滿'}
            </Text>
          </View>
        </View>

        {space.notes && (
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.6 }} numberOfLines={1}>
            {space.notes}
          </Text>
        )}

        <View className="flex-row items-center gap-2 mt-0.5">
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.45 }}>
            {formatTimeAgo(space.last_updated)}
          </Text>
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.3 }}>·</Text>
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.45 }}>
            {space.report_count} 筆回報
          </Text>
        </View>
      </View>

      {/* Distance + chevron */}
      <View className="items-end gap-1 flex-shrink-0">
        {space.distance_m != null && (
          <Text className="text-sm font-semibold" style={{ color: Colors.primary }}>
            {formatDistance(space.distance_m)}
          </Text>
        )}
        <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.muted} />
      </View>
    </TouchableOpacity>
  );
}

export default function NearbyListScreen() {
  const { userLocation } = useMapStore();
  const [sort, setSort] = useState<SortMode>('distance');
  const [filter, setFilter] = useState<FilterMode>('all');

  const { data: nearby = [], isLoading: loadingNearby } = useQuery({
    queryKey: ['spaces-list', userLocation?.lat, userLocation?.lng],
    queryFn: () =>
      userLocation
        ? fetchNearbySpaces(userLocation.lat, userLocation.lng, 1000)
        : Promise.resolve([]),
    enabled: !!userLocation,
  });

  const { data: bookmarks = [], isLoading: loadingBookmarks } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: fetchBookmarkedSpaces,
    enabled: filter === 'bookmarks',
  });

  const isLoading = filter === 'bookmarks' ? loadingBookmarks : loadingNearby;

  const displayed = useMemo(() => {
    let list: Space[] = filter === 'bookmarks' ? bookmarks : nearby;
    if (filter === 'empty') list = list.filter((s) => s.probability >= 0.5);
    if (sort === 'distance') {
      list = [...list].sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    } else {
      list = [...list].sort((a, b) => b.probability - a.probability);
    }
    return list;
  }, [nearby, bookmarks, sort, filter]);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top', 'bottom']}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-3 gap-2">
        <TouchableOpacity onPress={() => router.back()} className="p-1">
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.primaryDark} />
        </TouchableOpacity>
        <Text className="text-xl font-bold flex-1" style={{ color: Colors.primaryDark }}>
          附近車位
        </Text>
        <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.5 }}>
          {displayed.length} 個
        </Text>
      </View>

      {/* Filter tabs */}
      <View className="px-4 pb-3">
        <View className="flex-row rounded-xl p-1" style={{ backgroundColor: Colors.muted }}>
          {([
            { key: 'all', label: '全部' },
            { key: 'empty', label: '有空' },
            { key: 'bookmarks', label: '收藏' },
          ] as { key: FilterMode; label: string }[]).map((f) => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              className="flex-1 py-2 rounded-lg items-center"
              style={{ backgroundColor: filter === f.key ? Colors.primary : 'transparent' }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: filter === f.key ? 'white' : Colors.foreground }}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Sort row */}
      <View className="flex-row items-center px-4 pb-2 gap-2">
        <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>排序：</Text>
        {([
          { key: 'distance', label: '距離' },
          { key: 'probability', label: '空位率' },
        ] as { key: SortMode; label: string }[]).map((s) => (
          <TouchableOpacity
            key={s.key}
            onPress={() => setSort(s.key)}
            className="flex-row items-center gap-1 px-3 py-1 rounded-full border"
            style={{
              borderColor: sort === s.key ? Colors.primary : Colors.border,
              backgroundColor: sort === s.key ? Colors.primary + '10' : 'transparent',
            }}
          >
            <Text className="text-xs font-semibold" style={{ color: sort === s.key ? Colors.primary : Colors.foreground }}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {!userLocation && filter !== 'bookmarks' ? (
        <View className="flex-1 items-center justify-center gap-2">
          <MaterialCommunityIcons name="map-marker-off-outline" size={48} color={Colors.muted} />
          <Text style={{ color: Colors.foreground, opacity: 0.5 }}>請先開啟地圖定位</Text>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <SpaceRow
              space={item}
              onPress={() => router.push(`/space/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <View className="items-center py-16 gap-2">
                <MaterialCommunityIcons
                  name={filter === 'bookmarks' ? 'bookmark-off-outline' : 'map-marker-off-outline'}
                  size={48} color={Colors.muted}
                />
                <Text style={{ color: Colors.foreground, opacity: 0.5 }}>
                  {filter === 'bookmarks' ? '還沒有收藏的車位' : '附近沒有車位資料'}
                </Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
