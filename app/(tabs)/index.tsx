import { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Alert,
  Text,
  ActivityIndicator,
  TextInput,
  Platform,
  Keyboard,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { fetchNearbySpaces } from '../../lib/queries';
import { useMapStore } from '../../store/mapStore';
import { Colors, PROBABILITY_COLORS } from '../../constants/colors';
import { ParkingMarker } from '../../components/map/ParkingMarker';
import type { Space } from '../../types';
import type { RealtimeChannel } from '@supabase/supabase-js';

const INITIAL_REGION = {
  latitude: 25.0478,
  longitude: 121.5319,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const searchRef = useRef<TextInput>(null);

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const {
    spaces,
    userLocation,
    setUserLocation,
    bulkSetSpaces,
    upsertSpace,
    setSelectedSpace,
    emptyOnly,
    setEmptyOnly,
    showHeatmap,
    setShowHeatmap,
  } = useMapStore();

  const allSpaces = Object.values(spaces);
  const visibleSpaces = allSpaces.filter((s) => !emptyOnly || s.probability >= 0.5);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要位置權限', '請在設定中允許取用位置以使用地圖功能。');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setUserLocation(coords);
      mapRef.current?.animateToRegion({
        latitude: coords.lat, longitude: coords.lng,
        latitudeDelta: 0.008, longitudeDelta: 0.008,
      }, 800);
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20 },
        (l) => setUserLocation({ lat: l.coords.latitude, lng: l.coords.longitude }),
      );
    })();
    return () => { subscription?.remove(); };
  }, []);

  const { isLoading } = useQuery({
    queryKey: ['spaces', userLocation?.lat, userLocation?.lng],
    queryFn: () =>
      userLocation
        ? fetchNearbySpaces(userLocation.lat, userLocation.lng).then((s) => {
            bulkSetSpaces(s);
            return s;
          })
        : Promise.resolve([]),
    enabled: !!userLocation,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    channelRef.current = supabase
      .channel('spaces-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const raw = payload.new as any;
          const space: Space = {
            ...raw,
            location: {
              lat: raw.lat ?? raw.location?.coordinates?.[1] ?? 0,
              lng: raw.lng ?? raw.location?.coordinates?.[0] ?? 0,
            },
            verified: raw.verified ?? false,
          };
          upsertSpace(space);
        }
      })
      .subscribe();
    return () => { channelRef.current?.unsubscribe(); };
  }, []);

  const handleMarkerPress = useCallback(
    (space: Space) => {
      setSelectedSpace(space.id);
      router.push(`/space/${space.id}`);
    },
    [setSelectedSpace],
  );

  async function handleSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(q);
      if (results.length === 0) {
        Alert.alert('找不到', '請試試更具體的地址');
        return;
      }
      const { latitude, longitude } = results[0];
      mapRef.current?.animateToRegion({
        latitude, longitude, latitudeDelta: 0.008, longitudeDelta: 0.008,
      }, 600);
      setSearchVisible(false);
      setSearchQuery('');
    } catch {
      Alert.alert('搜尋失敗', '請再試一次');
    } finally {
      setSearching(false);
    }
  }

  function openSearch() {
    setSearchVisible(true);
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  function closeSearch() {
    setSearchVisible(false);
    setSearchQuery('');
    Keyboard.dismiss();
  }

  return (
    <View className="flex-1">
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={INITIAL_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        customMapStyle={mapStyle}
      >
        {showHeatmap && visibleSpaces.map((space) => (
          <Circle
            key={`heat-${space.id}`}
            center={{ latitude: space.location.lat, longitude: space.location.lng }}
            radius={40}
            fillColor={`${PROBABILITY_COLORS(space.probability)}55`}
            strokeWidth={0}
          />
        ))}
        {visibleSpaces.map((space) => (
          <ParkingMarker key={space.id} space={space} onPress={handleMarkerPress} />
        ))}
      </MapView>

      {isLoading && (
        <View className="absolute top-16 self-center px-4 py-2 rounded-full flex-row items-center gap-2"
          style={{ backgroundColor: Colors.primary }}>
          <ActivityIndicator color="white" size="small" />
          <Text className="text-white text-sm">載入中...</Text>
        </View>
      )}

      <SafeAreaView className="absolute top-0 left-0 right-0" edges={['top']}>
        {/* Top bar */}
        {!searchVisible ? (
          <View className="mx-4 mt-2 px-4 py-3 rounded-2xl flex-row items-center justify-between"
            style={{ backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 }}>
            <Text className="text-lg font-bold" style={{ color: Colors.primaryDark }}>
              Yo車位
            </Text>
            <View className="flex-row items-center gap-2">
              <View className="flex-row gap-1">
                {[
                  { color: Colors.marker.empty, label: '有空' },
                  { color: Colors.marker.uncertain, label: '不確定' },
                  { color: Colors.marker.occupied, label: '停滿' },
                ].map((item) => (
                  <View key={item.label} className="flex-row items-center gap-1 px-2 py-1 rounded-full"
                    style={{ backgroundColor: item.color + '20' }}>
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <Text className="text-xs" style={{ color: item.color }}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={openSearch} className="p-1">
                <MaterialCommunityIcons name="magnify" size={22} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Search bar */
          <View className="mx-4 mt-2 flex-row items-center gap-2 px-4 py-2 rounded-2xl"
            style={{ backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 }}>
            <MaterialCommunityIcons name="magnify" size={20} color={Colors.primary} />
            <TextInput
              ref={searchRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜尋地址或地名…"
              placeholderTextColor={Colors.foreground + '60'}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              className="flex-1 text-sm py-1"
              style={{ color: Colors.primaryDark }}
            />
            {searching ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <TouchableOpacity onPress={closeSearch}>
                <MaterialCommunityIcons name="close" size={20} color={Colors.foreground} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Filter toggles */}
        {!searchVisible && (
          <View className="mx-4 mt-2 flex-row gap-2">
            <TouchableOpacity
              onPress={() => setEmptyOnly(!emptyOnly)}
              activeOpacity={0.85}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-full"
              style={{
                backgroundColor: emptyOnly ? Colors.marker.empty : 'white',
                shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
              }}>
              <MaterialCommunityIcons
                name={emptyOnly ? 'filter-check' : 'filter-outline'}
                size={16} color={emptyOnly ? 'white' : Colors.primary} />
              <Text className="text-xs font-semibold" style={{ color: emptyOnly ? 'white' : Colors.primary }}>
                {emptyOnly ? '只顯示有空' : '顯示全部'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowHeatmap(!showHeatmap)}
              activeOpacity={0.85}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-full"
              style={{
                backgroundColor: showHeatmap ? Colors.accent : 'white',
                shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
              }}>
              <MaterialCommunityIcons name="fire" size={16} color={showHeatmap ? 'white' : Colors.accent} />
              <Text className="text-xs font-semibold" style={{ color: showHeatmap ? 'white' : Colors.accent }}>
                熱力圖
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/nearby-list')}
              activeOpacity={0.85}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-full"
              style={{ backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, elevation: 3 }}>
              <MaterialCommunityIcons name="format-list-bulleted" size={16} color={Colors.primary} />
              <Text className="text-xs font-semibold" style={{ color: Colors.primary }}>列表</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* Recenter */}
      <TouchableOpacity
        onPress={() => {
          if (userLocation) {
            mapRef.current?.animateToRegion({
              latitude: userLocation.lat, longitude: userLocation.lng,
              latitudeDelta: 0.008, longitudeDelta: 0.008,
            }, 500);
          }
        }}
        className="absolute right-4 bottom-32 w-12 h-12 rounded-full items-center justify-center"
        style={{ backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 }}
        activeOpacity={0.8}>
        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={Colors.primary} />
      </TouchableOpacity>

      {/* Report FAB */}
      <TouchableOpacity
        onPress={() => router.push('/report')}
        className="absolute right-4 bottom-20 w-16 h-16 rounded-full items-center justify-center"
        style={{ backgroundColor: Colors.primary, shadowColor: Colors.primary, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 }}
        activeOpacity={0.85}>
        <MaterialCommunityIcons name="plus" size={32} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const mapStyle = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
