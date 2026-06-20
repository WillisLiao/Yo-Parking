import { useEffect, useRef, useCallback } from 'react';
import { View, TouchableOpacity, Alert, Text, ActivityIndicator } from 'react-native';
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
  const visibleSpaces = allSpaces.filter(
    (s) => !emptyOnly || s.probability >= 0.5,
  );

  // Request location permission and watch position
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
        latitude: coords.lat,
        longitude: coords.lng,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      }, 800);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20 },
        (l) => setUserLocation({ lat: l.coords.latitude, lng: l.coords.longitude }),
      );
    })();

    return () => { subscription?.remove(); };
  }, []);

  // Load nearby spaces
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

  // Supabase Realtime — live space updates
  useEffect(() => {
    channelRef.current = supabase
      .channel('spaces-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'spaces' },
        (payload) => {
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
        },
      )
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
        {/* Heatmap overlay — circles sized by probability */}
        {showHeatmap && visibleSpaces.map((space) => (
          <Circle
            key={`heat-${space.id}`}
            center={{ latitude: space.location.lat, longitude: space.location.lng }}
            radius={40}
            fillColor={`${PROBABILITY_COLORS(space.probability)}55`}
            strokeWidth={0}
          />
        ))}

        {/* Markers — hidden in pure heatmap mode to reduce clutter */}
        {!showHeatmap && visibleSpaces.map((space) => (
          <ParkingMarker key={space.id} space={space} onPress={handleMarkerPress} />
        ))}

        {/* In heatmap mode still allow tapping via invisible markers */}
        {showHeatmap && visibleSpaces.map((space) => (
          <ParkingMarker key={`tap-${space.id}`} space={space} onPress={handleMarkerPress} />
        ))}
      </MapView>

      {/* Loading indicator */}
      {isLoading && (
        <View
          className="absolute top-16 self-center px-4 py-2 rounded-full flex-row items-center gap-2"
          style={{ backgroundColor: Colors.primary }}
        >
          <ActivityIndicator color="white" size="small" />
          <Text className="text-white text-sm">載入中...</Text>
        </View>
      )}

      {/* Top bar */}
      <SafeAreaView className="absolute top-0 left-0 right-0" edges={['top']}>
        <View className="mx-4 mt-2 px-4 py-3 rounded-2xl flex-row items-center justify-between"
          style={{ backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 }}
        >
          <Text className="text-lg font-bold" style={{ color: Colors.primaryDark }}>
            Yo車位
          </Text>
          <View className="flex-row gap-1">
            <View className="flex-row items-center gap-1 px-2 py-1 rounded-full" style={{ backgroundColor: Colors.marker.empty + '20' }}>
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: Colors.marker.empty }} />
              <Text className="text-xs" style={{ color: Colors.marker.empty }}>有空</Text>
            </View>
            <View className="flex-row items-center gap-1 px-2 py-1 rounded-full" style={{ backgroundColor: Colors.marker.uncertain + '20' }}>
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: Colors.marker.uncertain }} />
              <Text className="text-xs" style={{ color: Colors.marker.uncertain }}>不確定</Text>
            </View>
            <View className="flex-row items-center gap-1 px-2 py-1 rounded-full" style={{ backgroundColor: Colors.marker.occupied + '20' }}>
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: Colors.marker.occupied }} />
              <Text className="text-xs" style={{ color: Colors.marker.occupied }}>停滿</Text>
            </View>
          </View>
        </View>

        {/* Filter toggles */}
        <View className="mx-4 mt-2 flex-row gap-2">
          <TouchableOpacity
            onPress={() => setEmptyOnly(!emptyOnly)}
            activeOpacity={0.85}
            className="flex-row items-center gap-1.5 px-3 py-2 rounded-full"
            style={{
              backgroundColor: emptyOnly ? Colors.marker.empty : 'white',
              shadowColor: '#000',
              shadowOpacity: 0.1,
              shadowRadius: 6,
              elevation: 3,
            }}
          >
            <MaterialCommunityIcons
              name={emptyOnly ? 'filter-check' : 'filter-outline'}
              size={16}
              color={emptyOnly ? 'white' : Colors.primary}
            />
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
              shadowColor: '#000',
              shadowOpacity: 0.1,
              shadowRadius: 6,
              elevation: 3,
            }}
          >
            <MaterialCommunityIcons
              name="fire"
              size={16}
              color={showHeatmap ? 'white' : Colors.accent}
            />
            <Text className="text-xs font-semibold" style={{ color: showHeatmap ? 'white' : Colors.accent }}>
              熱力圖
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Recenter button */}
      <TouchableOpacity
        onPress={() => {
          if (userLocation) {
            mapRef.current?.animateToRegion({
              latitude: userLocation.lat,
              longitude: userLocation.lng,
              latitudeDelta: 0.008,
              longitudeDelta: 0.008,
            }, 500);
          }
        }}
        className="absolute right-4 bottom-32 w-12 h-12 rounded-full items-center justify-center"
        style={{ backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 }}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={Colors.primary} />
      </TouchableOpacity>

      {/* Report FAB */}
      <TouchableOpacity
        onPress={() => router.push('/report')}
        className="absolute right-4 bottom-20 w-16 h-16 rounded-full items-center justify-center"
        style={{ backgroundColor: Colors.primary, shadowColor: Colors.primary, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 }}
        activeOpacity={0.85}
      >
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
