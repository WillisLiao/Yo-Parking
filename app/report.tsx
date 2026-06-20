import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { submitReport } from '../lib/queries';
import { Colors } from '../constants/colors';

type StatusChoice = 'empty' | 'occupied' | null;

export default function ReportScreen() {
  const [choice, setChoice] = useState<StatusChoice>(null);
  const [note, setNote] = useState('');
  const [locating, setLocating] = useState(false);
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!choice) return;
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('需要位置權限');

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocating(false);

      return submitReport({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        status: choice,
        note: note.trim() || undefined,
      });
    },
    onSuccess: (data: any) => {
      if (data?.error) {
        const messages: Record<string, string> = {
          rate_limited: '你這小時的回報次數已達上限（5次），請稍後再試。',
          too_far: '你距離這個車位太遠了，請走近一點再回報。',
          too_soon: '你10分鐘內已回報過這個位置了。',
          new_space_limit_reached: '你今天已新增3個停車格，明天再來！',
        };
        Alert.alert('無法回報', messages[data.error] ?? '發生錯誤，請再試一次。');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      router.back();
    },
    onError: (e: any) => {
      setLocating(false);
      Alert.alert('回報失敗', e.message ?? '請再試一次');
    },
  });

  const isLoading = isPending || locating;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Handle bar */}
          <View className="items-center pt-2 pb-4">
            <View className="w-10 h-1 rounded-full" style={{ backgroundColor: Colors.muted }} />
          </View>

          <View className="gap-6">
            <View>
              <Text className="text-2xl font-bold" style={{ color: Colors.primaryDark }}>
                回報目前狀況
              </Text>
              <Text className="text-sm mt-1" style={{ color: Colors.foreground, opacity: 0.6 }}>
                使用你目前的GPS位置。請確認你在停車格旁邊。
              </Text>
            </View>

            {/* Choice buttons */}
            <View className="gap-3">
              <TouchableOpacity
                onPress={() => setChoice('empty')}
                activeOpacity={0.85}
                className="flex-row items-center gap-4 p-5 rounded-2xl border-2"
                style={{
                  borderColor: choice === 'empty' ? Colors.marker.empty : Colors.border,
                  backgroundColor: choice === 'empty' ? Colors.marker.empty + '10' : 'white',
                }}
              >
                <View
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: Colors.marker.empty + '20' }}
                >
                  <MaterialCommunityIcons name="motorbike" size={26} color={Colors.marker.empty} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-semibold" style={{ color: Colors.primaryDark }}>
                    有空位
                  </Text>
                  <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.6 }}>
                    這裡現在有空的機車格
                  </Text>
                </View>
                {choice === 'empty' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={Colors.marker.empty} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setChoice('occupied')}
                activeOpacity={0.85}
                className="flex-row items-center gap-4 p-5 rounded-2xl border-2"
                style={{
                  borderColor: choice === 'occupied' ? Colors.marker.occupied : Colors.border,
                  backgroundColor: choice === 'occupied' ? Colors.marker.occupied + '10' : 'white',
                }}
              >
                <View
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: Colors.marker.occupied + '20' }}
                >
                  <MaterialCommunityIcons name="car-brake-parking" size={26} color={Colors.marker.occupied} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-semibold" style={{ color: Colors.primaryDark }}>
                    已停滿
                  </Text>
                  <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.6 }}>
                    這裡目前沒有空位
                  </Text>
                </View>
                {choice === 'occupied' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={Colors.marker.occupied} />
                )}
              </TouchableOpacity>
            </View>

            {/* Optional note */}
            <View className="gap-2">
              <Text className="text-sm font-semibold" style={{ color: Colors.primaryDark }}>
                備註（選填）
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="例：入口很窄、只能停 125cc、需要側停…"
                placeholderTextColor={Colors.foreground + '80'}
                maxLength={80}
                multiline
                numberOfLines={2}
                style={{
                  backgroundColor: 'white',
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: note ? Colors.primary : Colors.border,
                  padding: 12,
                  fontSize: 14,
                  color: Colors.primaryDark,
                  minHeight: 64,
                  textAlignVertical: 'top',
                }}
              />
              <Text className="text-xs text-right" style={{ color: Colors.foreground, opacity: 0.4 }}>
                {note.length}/80
              </Text>
            </View>

            {/* Info note */}
            <View
              className="flex-row gap-3 p-4 rounded-xl"
              style={{ backgroundColor: Colors.primary + '10' }}
            >
              <MaterialCommunityIcons name="information-outline" size={18} color={Colors.primary} />
              <Text className="flex-1 text-sm leading-relaxed" style={{ color: Colors.primary }}>
                你的GPS位置會被驗證。回報準確可提升你的可信賴度，亂報則會降低。
              </Text>
            </View>

            {/* Submit button */}
            <TouchableOpacity
              onPress={() => mutate()}
              disabled={!choice || isLoading}
              activeOpacity={0.85}
              className="py-4 rounded-2xl items-center flex-row justify-center gap-2"
              style={{
                backgroundColor: choice ? Colors.primary : Colors.muted,
                opacity: !choice || isLoading ? 0.7 : 1,
              }}
            >
              {isLoading ? (
                <>
                  <ActivityIndicator color="white" size="small" />
                  <Text className="text-white font-semibold text-base">
                    {locating ? '定位中...' : '送出中...'}
                  </Text>
                </>
              ) : (
                <Text
                  className="font-semibold text-base"
                  style={{ color: choice ? 'white' : Colors.foreground }}
                >
                  送出回報
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
