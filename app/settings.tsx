import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import {
  fetchSavedLocations,
  upsertSavedLocation,
  deleteSavedLocation,
  setSavedLocationNotify,
} from '../lib/queries';
import { getCurrentCoords } from '../lib/notifications';
import { useAuthStore } from '../store/authStore';
import { Colors } from '../constants/colors';
import type { SavedLocation } from '../types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: Colors.foreground, opacity: 0.45 }}>
        {title}
      </Text>
      <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'white' }}>
        {children}
      </View>
    </View>
  );
}

function Row({
  icon,
  label,
  sub,
  right,
  onPress,
  danger,
}: {
  icon: any;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const tint = danger ? Colors.marker.occupied : Colors.primary;
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      className="flex-row items-center gap-3 px-4 py-3.5 border-b"
      style={{ borderColor: Colors.muted }}
    >
      <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: tint + '15' }}>
        <MaterialCommunityIcons name={icon} size={19} color={tint} />
      </View>
      <View className="flex-1">
        <Text className="text-base" style={{ color: danger ? Colors.marker.occupied : Colors.primaryDark }}>
          {label}
        </Text>
        {sub ? (
          <Text className="text-xs mt-0.5" style={{ color: Colors.foreground, opacity: 0.5 }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, reset } = useAuthStore();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: saved, isLoading } = useQuery({
    queryKey: ['saved-locations', user?.id],
    queryFn: () => fetchSavedLocations(user!.id),
    enabled: !!user?.id,
  });

  const home: SavedLocation | undefined = saved?.find((s) => s.label === 'home');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['saved-locations', user?.id] });

  const setHome = useMutation({
    mutationFn: async () => {
      setBusy(true);
      const coords = await getCurrentCoords();
      if (!coords) throw new Error('需要位置權限才能設定常用地點');
      await upsertSavedLocation({ userId: user!.id, lat: coords.lat, lng: coords.lng });
    },
    onSettled: () => setBusy(false),
    onSuccess: () => {
      invalidate();
      Alert.alert('已設定', '當你儲存的地點附近出現空位時，我們會通知你。');
    },
    onError: (e: any) => Alert.alert('失敗', e.message),
  });

  const clearHome = useMutation({
    mutationFn: () => deleteSavedLocation(home!.id),
    onSuccess: invalidate,
  });

  const toggleNotify = useMutation({
    mutationFn: (v: boolean) => setSavedLocationNotify(home!.id, v),
    onSuccess: invalidate,
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

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top', 'bottom']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-2xl font-bold" style={{ color: Colors.primaryDark }}>
          設定
        </Text>
        <TouchableOpacity onPress={() => router.back()} className="p-2">
          <MaterialCommunityIcons name="close" size={24} color={Colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32, gap: 24 }}>
        {/* Notify near home */}
        <Section title="通知">
          {isLoading ? (
            <View className="py-6 items-center">
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : home ? (
            <>
              <Row
                icon="home-map-marker"
                label="常用地點已設定"
                sub={`${home.lat.toFixed(4)}, ${home.lng.toFixed(4)} · 半徑 ${home.radius_m}m`}
              />
              <Row
                icon="bell-ring-outline"
                label="附近有空位時通知我"
                right={
                  <Switch
                    value={home.notify}
                    onValueChange={(v) => toggleNotify.mutate(v)}
                    trackColor={{ true: Colors.primary }}
                  />
                }
              />
              <Row
                icon="map-marker-off-outline"
                label="移除常用地點"
                danger
                onPress={() => clearHome.mutate()}
              />
            </>
          ) : (
            <Row
              icon="home-plus-outline"
              label={busy ? '取得位置中…' : '設定目前位置為常用地點'}
              sub="當附近出現空位時推播通知你"
              onPress={() => !busy && setHome.mutate()}
              right={busy ? <ActivityIndicator color={Colors.primary} /> : undefined}
            />
          )}
        </Section>

        {/* About / legal */}
        <Section title="關於">
          <Row
            icon="shield-check-outline"
            label="隱私政策"
            onPress={() => Linking.openURL('https://yoche.app/privacy')}
            right={<MaterialCommunityIcons name="chevron-right" size={20} color={Colors.muted} />}
          />
          <Row
            icon="file-document-outline"
            label="服務條款"
            onPress={() => Linking.openURL('https://yoche.app/terms')}
            right={<MaterialCommunityIcons name="chevron-right" size={20} color={Colors.muted} />}
          />
          <Row
            icon="information-outline"
            label="版本"
            right={
              <Text style={{ color: Colors.foreground, opacity: 0.5 }}>
                {Constants.expoConfig?.version ?? '1.0.0'}
              </Text>
            }
          />
        </Section>

        {/* Account */}
        <Section title="帳號">
          <Row icon="logout" label="登出" danger onPress={signOut} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
