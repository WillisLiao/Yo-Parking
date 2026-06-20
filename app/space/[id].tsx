import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  fetchSpaceDetail,
  submitReport,
  fetchSpacePattern,
  flagSpace,
  updateSpaceNote,
} from '../../lib/queries';
import { Colors, PROBABILITY_COLORS } from '../../constants/colors';
import type { SpaceStatus, FlagReason, HourlyPattern } from '../../types';

function formatTimeAgo(isoString: string): string {
  const diff = (Date.now() - new Date(isoString).getTime()) / 60_000;
  if (diff < 1) return '剛剛';
  if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
  return `${Math.floor(diff / 60)} 小時前`;
}

// Simple bar chart — renders 24 hours of availability data
function PatternChart({ data }: { data: HourlyPattern[] }) {
  if (data.length === 0) {
    return (
      <View className="items-center py-6 gap-1">
        <MaterialCommunityIcons name="chart-bar" size={32} color={Colors.muted} />
        <Text className="text-xs text-center" style={{ color: Colors.foreground, opacity: 0.4 }}>
          資料不足，等更多回報後才能顯示規律
        </Text>
      </View>
    );
  }

  const byHour = new Map(data.map((d) => [d.hour_of_day, d]));
  const now = new Date().getHours();

  return (
    <View>
      <View className="flex-row items-end gap-0.5" style={{ height: 56 }}>
        {Array.from({ length: 24 }, (_, h) => {
          const entry = byHour.get(h);
          const prob = entry?.avg_probability ?? 0;
          const barH = Math.max(4, Math.round(prob * 52));
          const color = PROBABILITY_COLORS(prob);
          const isNow = h === now;
          return (
            <View key={h} className="flex-1 items-center justify-end">
              <View
                style={{
                  width: '100%',
                  height: barH,
                  backgroundColor: color + (entry ? 'CC' : '33'),
                  borderRadius: 2,
                  borderWidth: isNow ? 1.5 : 0,
                  borderColor: isNow ? Colors.primaryDark : 'transparent',
                }}
              />
            </View>
          );
        })}
      </View>
      {/* Hour labels at 0, 6, 12, 18, 23 */}
      <View className="flex-row mt-1">
        {[0, 6, 12, 18, 23].map((h) => (
          <Text
            key={h}
            className="text-xs absolute"
            style={{
              color: Colors.foreground,
              opacity: 0.4,
              left: `${(h / 23) * 100}%`,
              fontSize: 9,
            }}
          >
            {h}時
          </Text>
        ))}
      </View>
    </View>
  );
}

const FLAG_REASONS: { value: FlagReason; label: string }[] = [
  { value: 'wrong_location', label: '位置錯誤' },
  { value: 'always_occupied', label: '這裡從來沒空位' },
  { value: 'spam', label: '疑似惡意標記' },
  { value: 'other', label: '其他原因' },
];

export default function SpaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<SpaceStatus | null>(null);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [selectedReason, setSelectedReason] = useState<FlagReason | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteText, setNoteText] = useState('');

  const { data: space, isLoading } = useQuery({
    queryKey: ['space', id],
    queryFn: () => fetchSpaceDetail(id!),
    enabled: !!id,
  });

  const { data: pattern = [] } = useQuery({
    queryKey: ['space-pattern', id],
    queryFn: () => fetchSpacePattern(id!),
    enabled: !!id,
    staleTime: 10 * 60_000,
  });

  const { mutate: confirm, isPending } = useMutation({
    mutationFn: async (status: SpaceStatus) => {
      setConfirming(status);
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') throw new Error('需要位置權限');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return submitReport({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        status,
        spaceId: id,
      });
    },
    onSuccess: (data: any) => {
      setConfirming(null);
      if (data?.error) {
        const msgs: Record<string, string> = {
          rate_limited: '你這小時已達回報上限。',
          too_far: '你距離這個車位太遠了。',
          too_soon: '你最近已回報過了，請10分鐘後再確認。',
        };
        Alert.alert('無法確認', msgs[data.error] ?? '請再試一次');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['space', id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      Alert.alert('謝謝！', '你的確認已送出。');
    },
    onError: (e: any) => {
      setConfirming(null);
      Alert.alert('失敗', e.message);
    },
  });

  const { mutate: submitFlag, isPending: flagging } = useMutation({
    mutationFn: () => flagSpace(id!, selectedReason!, flagNote.trim() || undefined),
    onSuccess: (data) => {
      setFlagModalVisible(false);
      setSelectedReason(null);
      setFlagNote('');
      if (data?.error) {
        Alert.alert('錯誤', '無法送出檢舉');
        return;
      }
      Alert.alert('已收到', '感謝你的回報，我們會檢視這個車位。');
    },
    onError: () => Alert.alert('失敗', '請再試一次'),
  });

  const { mutate: saveNote } = useMutation({
    mutationFn: () => updateSpaceNote(id!, noteText.trim()),
    onSuccess: () => {
      setNoteEditMode(false);
      queryClient.invalidateQueries({ queryKey: ['space', id] });
    },
    onError: (e: any) => {
      Alert.alert(
        '無法儲存',
        e.message?.includes('insufficient_credibility')
          ? '可信賴度需達 40 分才能新增備註'
          : '請再試一次',
      );
    },
  });

  function handleShare() {
    if (!space) return;
    Share.share({
      message: `Yo車位：附近有機車格，快來看看！ yo-parking://space/${id}`,
      url: `yo-parking://space/${id}`,
    });
  }

  function handleDirections() {
    if (!space) return;
    const { lat, lng } = space.location;
    const appleUrl = `maps://app?daddr=${lat},${lng}`;
    const googleUrl = `https://maps.google.com/?daddr=${lat},${lng}`;
    Linking.canOpenURL(appleUrl).then((supported) => {
      Linking.openURL(supported ? appleUrl : googleUrl);
    });
  }

  if (isLoading || !space) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: Colors.surface }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const pct = Math.round(space.probability * 100);
  const color = PROBABILITY_COLORS(space.probability);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top', 'bottom']}>
      {/* Handle */}
      <View className="items-center pt-2 pb-4">
        <View className="w-10 h-1 rounded-full" style={{ backgroundColor: Colors.muted }} />
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* Probability display */}
        <View className="items-center gap-2 py-4">
          <View className="flex-row items-center gap-2">
            {space.verified && (
              <View className="flex-row items-center gap-1 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: Colors.accent + '15' }}>
                <MaterialCommunityIcons name="check-decagram" size={13} color={Colors.accent} />
                <Text className="text-xs font-semibold" style={{ color: Colors.accent }}>已驗證車位</Text>
              </View>
            )}
          </View>

          <View
            className="w-28 h-28 rounded-full items-center justify-center"
            style={{ backgroundColor: color + '20' }}
          >
            <Text className="text-4xl font-bold" style={{ color }}>
              {pct}%
            </Text>
          </View>
          <Text className="text-lg font-semibold" style={{ color: Colors.primaryDark }}>
            現在有空的機率
          </Text>
          <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.6 }}>
            最後回報：{formatTimeAgo(space.last_updated)}
          </Text>
        </View>

        {/* Stats row */}
        <View className="flex-row gap-3 mb-4">
          {[
            { label: '總回報次數', value: space.report_count },
            {
              label: '目前狀態',
              value: space.status === 'empty' ? '有空' : '停滿',
              color: space.status === 'empty' ? Colors.marker.empty : Colors.marker.occupied,
            },
          ].map((stat) => (
            <View
              key={stat.label}
              className="flex-1 p-4 rounded-2xl items-center gap-1"
              style={{ backgroundColor: 'white' }}
            >
              <Text
                className="text-xl font-bold"
                style={{ color: (stat as any).color ?? Colors.primaryDark }}
              >
                {stat.value}
              </Text>
              <Text className="text-xs text-center" style={{ color: Colors.foreground, opacity: 0.6 }}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Action buttons: share + directions */}
        <View className="flex-row gap-3 mb-5">
          <TouchableOpacity
            onPress={handleShare}
            activeOpacity={0.85}
            className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-2xl"
            style={{ backgroundColor: Colors.primary + '15' }}
          >
            <MaterialCommunityIcons name="share-variant" size={18} color={Colors.primary} />
            <Text className="font-semibold text-sm" style={{ color: Colors.primary }}>分享</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDirections}
            activeOpacity={0.85}
            className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-2xl"
            style={{ backgroundColor: Colors.accent + '15' }}
          >
            <MaterialCommunityIcons name="navigation-variant" size={18} color={Colors.accent} />
            <Text className="font-semibold text-sm" style={{ color: Colors.accent }}>導航</Text>
          </TouchableOpacity>
        </View>

        {/* Notes section */}
        <View className="mb-5 p-4 rounded-2xl" style={{ backgroundColor: 'white' }}>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>
              現場備註
            </Text>
            {!noteEditMode && (
              <TouchableOpacity onPress={() => { setNoteText(space.notes ?? ''); setNoteEditMode(true); }}>
                <MaterialCommunityIcons
                  name={space.notes ? 'pencil-outline' : 'plus-circle-outline'}
                  size={18}
                  color={Colors.primary}
                />
              </TouchableOpacity>
            )}
          </View>

          {noteEditMode ? (
            <View className="gap-2">
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder="例：入口很窄、只能停 125cc…"
                placeholderTextColor={Colors.foreground + '60'}
                maxLength={80}
                multiline
                style={{
                  borderWidth: 1.5,
                  borderColor: Colors.border,
                  borderRadius: 10,
                  padding: 10,
                  fontSize: 13,
                  color: Colors.primaryDark,
                  minHeight: 56,
                  textAlignVertical: 'top',
                }}
              />
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => setNoteEditMode(false)}
                  className="flex-1 py-2 rounded-xl items-center"
                  style={{ backgroundColor: Colors.muted }}
                >
                  <Text className="text-sm" style={{ color: Colors.foreground }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => saveNote()}
                  className="flex-1 py-2 rounded-xl items-center"
                  style={{ backgroundColor: Colors.primary }}
                >
                  <Text className="text-sm font-semibold text-white">儲存</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : space.notes ? (
            <Text className="text-sm leading-relaxed" style={{ color: Colors.foreground }}>
              {space.notes}
            </Text>
          ) : (
            <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.4 }}>
              還沒有備註。可信賴度 ≥ 40 的用戶可以新增。
            </Text>
          )}
        </View>

        {/* Typical pattern */}
        <View className="mb-5 p-4 rounded-2xl" style={{ backgroundColor: 'white' }}>
          <Text className="font-semibold text-sm mb-3" style={{ color: Colors.primaryDark }}>
            典型規律（近30天）
          </Text>
          <PatternChart data={pattern} />
          <Text className="text-xs mt-3" style={{ color: Colors.foreground, opacity: 0.4 }}>
            綠色 = 通常有空　紅色 = 通常停滿　▏= 現在時間
          </Text>
        </View>

        {/* Confirm buttons */}
        <Text className="text-base font-semibold mb-3" style={{ color: Colors.primaryDark }}>
          你在附近嗎？幫忙確認現況：
        </Text>

        <View className="gap-3 mb-5">
          <TouchableOpacity
            onPress={() => confirm('empty')}
            disabled={isPending}
            activeOpacity={0.85}
            className="flex-row items-center justify-center gap-3 py-4 rounded-2xl"
            style={{ backgroundColor: Colors.marker.empty }}
          >
            {isPending && confirming === 'empty' ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <MaterialCommunityIcons name="motorbike" size={22} color="white" />
            )}
            <Text className="text-white font-semibold text-base">現在有空</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => confirm('occupied')}
            disabled={isPending}
            activeOpacity={0.85}
            className="flex-row items-center justify-center gap-3 py-4 rounded-2xl border-2"
            style={{ borderColor: Colors.marker.occupied, backgroundColor: 'white' }}
          >
            {isPending && confirming === 'occupied' ? (
              <ActivityIndicator color={Colors.marker.occupied} size="small" />
            ) : (
              <MaterialCommunityIcons name="car-brake-parking" size={22} color={Colors.marker.occupied} />
            )}
            <Text className="font-semibold text-base" style={{ color: Colors.marker.occupied }}>
              已停滿
            </Text>
          </TouchableOpacity>
        </View>

        <View className="p-4 rounded-xl mb-4" style={{ backgroundColor: Colors.primary + '10' }}>
          <Text className="text-sm leading-relaxed" style={{ color: Colors.primary }}>
            確認現況等於提交一筆新回報。你的GPS位置會被驗證，確認準確可提升你的可信賴度。
          </Text>
        </View>

        {/* Flag button */}
        <TouchableOpacity
          onPress={() => setFlagModalVisible(true)}
          className="flex-row items-center justify-center gap-2 py-3 mb-6"
        >
          <MaterialCommunityIcons name="flag-outline" size={16} color={Colors.foreground} style={{ opacity: 0.4 }} />
          <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.4 }}>
            檢舉這個車位
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Close button */}
      <View className="px-6 pb-4">
        <TouchableOpacity
          onPress={() => router.back()}
          className="py-3 rounded-2xl items-center"
          style={{ backgroundColor: Colors.muted }}
        >
          <Text style={{ color: Colors.foreground }}>關閉</Text>
        </TouchableOpacity>
      </View>

      {/* Flag modal */}
      <Modal
        visible={flagModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFlagModalVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            className="flex-1"
            activeOpacity={1}
            onPress={() => setFlagModalVisible(false)}
          />
          <View
            className="rounded-t-3xl p-6 gap-4"
            style={{ backgroundColor: 'white' }}
          >
            <Text className="text-lg font-bold" style={{ color: Colors.primaryDark }}>
              檢舉原因
            </Text>

            <View className="gap-2">
              {FLAG_REASONS.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  onPress={() => setSelectedReason(r.value)}
                  className="flex-row items-center gap-3 p-3 rounded-xl border"
                  style={{
                    borderColor: selectedReason === r.value ? Colors.primary : Colors.border,
                    backgroundColor: selectedReason === r.value ? Colors.primary + '08' : 'white',
                  }}
                >
                  <View
                    className="w-5 h-5 rounded-full border-2 items-center justify-center"
                    style={{
                      borderColor: selectedReason === r.value ? Colors.primary : Colors.muted,
                    }}
                  >
                    {selectedReason === r.value && (
                      <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: Colors.primary }} />
                    )}
                  </View>
                  <Text className="text-sm" style={{ color: Colors.primaryDark }}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={flagNote}
              onChangeText={setFlagNote}
              placeholder="補充說明（選填）"
              placeholderTextColor={Colors.foreground + '60'}
              maxLength={100}
              style={{
                borderWidth: 1.5,
                borderColor: Colors.border,
                borderRadius: 10,
                padding: 10,
                fontSize: 13,
                color: Colors.primaryDark,
              }}
            />

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setFlagModalVisible(false)}
                className="flex-1 py-3 rounded-2xl items-center"
                style={{ backgroundColor: Colors.muted }}
              >
                <Text style={{ color: Colors.foreground }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => submitFlag()}
                disabled={!selectedReason || flagging}
                className="flex-1 py-3 rounded-2xl items-center"
                style={{
                  backgroundColor: selectedReason ? Colors.marker.occupied : Colors.muted,
                  opacity: !selectedReason ? 0.5 : 1,
                }}
              >
                {flagging ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className="font-semibold text-white">送出檢舉</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
