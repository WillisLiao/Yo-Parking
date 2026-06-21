import { useState, useRef } from 'react';
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
  FlatList,
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
  toggleBookmark,
  isBookmarked,
  fetchSpaceComments,
  addSpaceComment,
  deleteSpaceComment,
} from '../../lib/queries';
import { useAuthStore } from '../../store/authStore';
import { Colors, PROBABILITY_COLORS, BADGE_LABELS } from '../../constants/colors';
import type { SpaceStatus, FlagReason, HourlyPattern, SpaceComment, Badge } from '../../types';

function formatTimeAgo(isoString: string): string {
  const diff = (Date.now() - new Date(isoString).getTime()) / 60_000;
  if (diff < 1) return '剛剛';
  if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小時前`;
  return `${Math.floor(diff / 1440)} 天前`;
}

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

  // Best time insight
  const sorted = [...data].sort((a, b) => b.avg_probability - a.avg_probability);
  const best = sorted[0];
  const bestLabel = best
    ? `通常在 ${best.hour_of_day}:00 最容易找到（${Math.round(best.avg_probability * 100)}%）`
    : null;

  return (
    <View className="gap-3">
      {bestLabel && (
        <View className="flex-row items-center gap-2 p-3 rounded-xl"
          style={{ backgroundColor: Colors.marker.empty + '12' }}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={16} color={Colors.marker.empty} />
          <Text className="text-xs flex-1" style={{ color: Colors.primaryDark }}>{bestLabel}</Text>
        </View>
      )}
      <View className="flex-row items-end gap-0.5" style={{ height: 56 }}>
        {Array.from({ length: 24 }, (_, h) => {
          const entry = byHour.get(h);
          const prob = entry?.avg_probability ?? 0;
          const barH = Math.max(4, Math.round(prob * 52));
          const color = PROBABILITY_COLORS(prob);
          return (
            <View key={h} className="flex-1 items-center justify-end">
              <View style={{
                width: '100%', height: barH,
                backgroundColor: color + (entry ? 'CC' : '33'),
                borderRadius: 2,
                borderWidth: h === now ? 1.5 : 0,
                borderColor: h === now ? Colors.primaryDark : 'transparent',
              }} />
            </View>
          );
        })}
      </View>
      <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.4 }}>
        綠色 = 通常有空　紅色 = 通常停滿　▏= 現在時間　（近30天資料）
      </Text>
    </View>
  );
}

const FLAG_REASONS: { value: FlagReason; label: string }[] = [
  { value: 'wrong_location', label: '位置錯誤' },
  { value: 'always_occupied', label: '這裡從來沒空位' },
  { value: 'spam', label: '疑似惡意標記' },
  { value: 'other', label: '其他原因' },
];

function CommentBubble({
  comment,
  myUserId,
  onDelete,
}: {
  comment: SpaceComment;
  myUserId?: string;
  onDelete: (id: string) => void;
}) {
  const isMe = comment.user_id === myUserId;
  const badgeColor = Colors.badge[comment.badge as Badge] ?? Colors.primary;

  return (
    <View className="flex-row gap-2 mb-3">
      <View className="w-8 h-8 rounded-full items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: Colors.primary + '20' }}>
        <Text className="text-xs font-bold" style={{ color: Colors.primary }}>
          {(comment.display_name ?? '?')[0].toUpperCase()}
        </Text>
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5 mb-0.5">
          <Text className="text-xs font-semibold" style={{ color: Colors.primaryDark }}>
            {comment.display_name ?? '匿名用戶'}
          </Text>
          <Text className="text-xs" style={{ color: badgeColor }}>{BADGE_LABELS[comment.badge]}</Text>
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.4 }}>
            {formatTimeAgo(comment.created_at)}
          </Text>
          {isMe && (
            <TouchableOpacity onPress={() => onDelete(comment.id)} className="ml-auto">
              <MaterialCommunityIcons name="trash-can-outline" size={14} color={Colors.marker.occupied} />
            </TouchableOpacity>
          )}
        </View>
        <View className="p-2.5 rounded-xl rounded-tl-none"
          style={{ backgroundColor: isMe ? Colors.primary + '12' : Colors.muted }}>
          <Text className="text-sm" style={{ color: Colors.primaryDark }}>{comment.body}</Text>
        </View>
      </View>
    </View>
  );
}

export default function SpaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const commentInputRef = useRef<TextInput>(null);

  const [confirming, setConfirming] = useState<SpaceStatus | null>(null);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [selectedReason, setSelectedReason] = useState<FlagReason | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentsExpanded, setCommentsExpanded] = useState(false);

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

  const { data: bookmarked = false } = useQuery({
    queryKey: ['bookmarked', id],
    queryFn: () => isBookmarked(id!),
    enabled: !!id && !!user,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', id],
    queryFn: () => fetchSpaceComments(id!),
    enabled: !!id && commentsExpanded,
  });

  const { mutate: confirm, isPending } = useMutation({
    mutationFn: async (status: SpaceStatus) => {
      setConfirming(status);
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') throw new Error('需要位置權限');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return submitReport({ lat: loc.coords.latitude, lng: loc.coords.longitude, status, spaceId: id });
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
      if (data?.new_achievements?.length) {
        const names = data.new_achievements.join('、');
        Alert.alert('🎉 成就解鎖！', `你獲得了：${names}`);
      } else {
        Alert.alert('謝謝！', '你的確認已送出。');
      }
    },
    onError: (e: any) => { setConfirming(null); Alert.alert('失敗', e.message); },
  });

  const { mutate: doToggleBookmark } = useMutation({
    mutationFn: () => toggleBookmark(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarked', id] });
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });

  const { mutate: submitFlag, isPending: flagging } = useMutation({
    mutationFn: () => flagSpace(id!, selectedReason!, flagNote.trim() || undefined),
    onSuccess: () => {
      setFlagModalVisible(false);
      setSelectedReason(null);
      setFlagNote('');
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
    onError: (e: any) => Alert.alert('無法儲存',
      e.message?.includes('insufficient_credibility') ? '可信賴度需達 40 分才能新增備註' : '請再試一次'),
  });

  const { mutate: postComment, isPending: posting } = useMutation({
    mutationFn: () => addSpaceComment(id!, commentText.trim()),
    onSuccess: (data: any) => {
      if (data?.error) {
        Alert.alert('失敗', data.error === 'too_many_comments' ? '今天這個車位的留言已達上限' : '請再試一次');
        return;
      }
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['comments', id] });
    },
    onError: () => Alert.alert('失敗', '請再試一次'),
  });

  const { mutate: doDeleteComment } = useMutation({
    mutationFn: (commentId: string) => deleteSpaceComment(commentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', id] }),
  });

  function handleShare() {
    if (!space) return;
    Share.share({ message: `Yo車位：附近有機車格！ yo-parking://space/${id}`, url: `yo-parking://space/${id}` });
  }

  function handleDirections() {
    if (!space) return;
    const { lat, lng } = space.location;
    const apple = `maps://app?daddr=${lat},${lng}`;
    const google = `https://maps.google.com/?daddr=${lat},${lng}`;
    Linking.canOpenURL(apple).then((ok) => Linking.openURL(ok ? apple : google));
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
      <View className="items-center pt-2 pb-2">
        <View className="w-10 h-1 rounded-full" style={{ backgroundColor: Colors.muted }} />
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Verified + bookmark row */}
          <View className="flex-row items-center justify-between mb-2">
            {space.verified ? (
              <View className="flex-row items-center gap-1 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: Colors.accent + '15' }}>
                <MaterialCommunityIcons name="check-decagram" size={13} color={Colors.accent} />
                <Text className="text-xs font-semibold" style={{ color: Colors.accent }}>已驗證車位</Text>
              </View>
            ) : <View />}
            <TouchableOpacity onPress={() => doToggleBookmark()} className="p-2">
              <MaterialCommunityIcons
                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                size={24}
                color={bookmarked ? Colors.primary : Colors.foreground}
              />
            </TouchableOpacity>
          </View>

          {/* Probability */}
          <View className="items-center gap-2 py-3">
            <View className="w-28 h-28 rounded-full items-center justify-center" style={{ backgroundColor: color + '20' }}>
              <Text className="text-4xl font-bold" style={{ color }}>{pct}%</Text>
            </View>
            <Text className="text-lg font-semibold" style={{ color: Colors.primaryDark }}>現在有空的機率</Text>
            <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.6 }}>
              最後回報：{formatTimeAgo(space.last_updated)}
            </Text>
          </View>

          {/* Stats */}
          <View className="flex-row gap-3 mb-4">
            {[
              { label: '總回報次數', value: space.report_count },
              {
                label: '目前狀態',
                value: space.status === 'empty' ? '有空' : '停滿',
                color: space.status === 'empty' ? Colors.marker.empty : Colors.marker.occupied,
              },
            ].map((stat) => (
              <View key={stat.label} className="flex-1 p-4 rounded-2xl items-center gap-1"
                style={{ backgroundColor: 'white' }}>
                <Text className="text-xl font-bold" style={{ color: (stat as any).color ?? Colors.primaryDark }}>
                  {stat.value}
                </Text>
                <Text className="text-xs text-center" style={{ color: Colors.foreground, opacity: 0.6 }}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>

          {/* Share + Directions */}
          <View className="flex-row gap-3 mb-5">
            <TouchableOpacity onPress={handleShare} activeOpacity={0.85}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-2xl"
              style={{ backgroundColor: Colors.primary + '15' }}>
              <MaterialCommunityIcons name="share-variant" size={18} color={Colors.primary} />
              <Text className="font-semibold text-sm" style={{ color: Colors.primary }}>分享</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDirections} activeOpacity={0.85}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-2xl"
              style={{ backgroundColor: Colors.accent + '15' }}>
              <MaterialCommunityIcons name="navigation-variant" size={18} color={Colors.accent} />
              <Text className="font-semibold text-sm" style={{ color: Colors.accent }}>導航</Text>
            </TouchableOpacity>
          </View>

          {/* Notes */}
          <View className="mb-5 p-4 rounded-2xl" style={{ backgroundColor: 'white' }}>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>現場備註</Text>
              {!noteEditMode && (
                <TouchableOpacity onPress={() => { setNoteText(space.notes ?? ''); setNoteEditMode(true); }}>
                  <MaterialCommunityIcons
                    name={space.notes ? 'pencil-outline' : 'plus-circle-outline'}
                    size={18} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {noteEditMode ? (
              <View className="gap-2">
                <TextInput value={noteText} onChangeText={setNoteText}
                  placeholder="例：入口很窄、只能停 125cc…"
                  placeholderTextColor={Colors.foreground + '60'}
                  maxLength={80} multiline
                  style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
                    padding: 10, fontSize: 13, color: Colors.primaryDark, minHeight: 56, textAlignVertical: 'top' }} />
                <View className="flex-row gap-2">
                  <TouchableOpacity onPress={() => setNoteEditMode(false)}
                    className="flex-1 py-2 rounded-xl items-center" style={{ backgroundColor: Colors.muted }}>
                    <Text className="text-sm" style={{ color: Colors.foreground }}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => saveNote()}
                    className="flex-1 py-2 rounded-xl items-center" style={{ backgroundColor: Colors.primary }}>
                    <Text className="text-sm font-semibold text-white">儲存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : space.notes ? (
              <Text className="text-sm leading-relaxed" style={{ color: Colors.foreground }}>{space.notes}</Text>
            ) : (
              <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.4 }}>
                還沒有備註。可信賴度 ≥ 40 的用戶可以新增。
              </Text>
            )}
          </View>

          {/* Pattern chart */}
          <View className="mb-5 p-4 rounded-2xl" style={{ backgroundColor: 'white' }}>
            <Text className="font-semibold text-sm mb-3" style={{ color: Colors.primaryDark }}>
              典型規律（近30天）
            </Text>
            <PatternChart data={pattern} />
          </View>

          {/* Confirm buttons */}
          <Text className="text-base font-semibold mb-3" style={{ color: Colors.primaryDark }}>
            你在附近嗎？幫忙確認現況：
          </Text>
          <View className="gap-3 mb-5">
            <TouchableOpacity onPress={() => confirm('empty')} disabled={isPending} activeOpacity={0.85}
              className="flex-row items-center justify-center gap-3 py-4 rounded-2xl"
              style={{ backgroundColor: Colors.marker.empty }}>
              {isPending && confirming === 'empty'
                ? <ActivityIndicator color="white" size="small" />
                : <MaterialCommunityIcons name="motorbike" size={22} color="white" />}
              <Text className="text-white font-semibold text-base">現在有空</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirm('occupied')} disabled={isPending} activeOpacity={0.85}
              className="flex-row items-center justify-center gap-3 py-4 rounded-2xl border-2"
              style={{ borderColor: Colors.marker.occupied, backgroundColor: 'white' }}>
              {isPending && confirming === 'occupied'
                ? <ActivityIndicator color={Colors.marker.occupied} size="small" />
                : <MaterialCommunityIcons name="car-brake-parking" size={22} color={Colors.marker.occupied} />}
              <Text className="font-semibold text-base" style={{ color: Colors.marker.occupied }}>已停滿</Text>
            </TouchableOpacity>
          </View>

          <View className="p-4 rounded-xl mb-4" style={{ backgroundColor: Colors.primary + '10' }}>
            <Text className="text-sm leading-relaxed" style={{ color: Colors.primary }}>
              確認現況等於提交一筆新回報。你的GPS位置會被驗證，確認準確可提升你的可信賴度。
            </Text>
          </View>

          {/* Comments section */}
          <View className="mb-5 rounded-2xl overflow-hidden" style={{ backgroundColor: 'white' }}>
            <TouchableOpacity
              onPress={() => setCommentsExpanded(!commentsExpanded)}
              className="flex-row items-center justify-between p-4"
            >
              <Text className="font-semibold text-sm" style={{ color: Colors.primaryDark }}>留言討論</Text>
              <MaterialCommunityIcons
                name={commentsExpanded ? 'chevron-up' : 'chevron-down'}
                size={20} color={Colors.foreground}
              />
            </TouchableOpacity>

            {commentsExpanded && (
              <View className="px-4 pb-4 gap-3">
                {comments.length > 0 ? (
                  comments.map((c) => (
                    <CommentBubble key={c.id} comment={c} myUserId={user?.id}
                      onDelete={(cid) => doDeleteComment(cid)} />
                  ))
                ) : (
                  <Text className="text-sm text-center py-2" style={{ color: Colors.foreground, opacity: 0.4 }}>
                    還沒有留言，來第一個說說吧！
                  </Text>
                )}

                {/* Comment input */}
                <View className="flex-row items-end gap-2 mt-1">
                  <TextInput
                    ref={commentInputRef}
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder="留言…"
                    placeholderTextColor={Colors.foreground + '60'}
                    maxLength={200}
                    multiline
                    className="flex-1 py-2 px-3 rounded-xl text-sm"
                    style={{
                      borderWidth: 1.5,
                      borderColor: commentText ? Colors.primary : Colors.border,
                      color: Colors.primaryDark,
                      maxHeight: 80,
                      textAlignVertical: 'top',
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => postComment()}
                    disabled={!commentText.trim() || posting}
                    className="w-9 h-9 rounded-full items-center justify-center"
                    style={{ backgroundColor: commentText.trim() ? Colors.primary : Colors.muted }}
                  >
                    {posting
                      ? <ActivityIndicator color="white" size="small" />
                      : <MaterialCommunityIcons name="send" size={16} color="white" />}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Flag */}
          <TouchableOpacity
            onPress={() => setFlagModalVisible(true)}
            className="flex-row items-center justify-center gap-2 py-3 mb-6"
          >
            <MaterialCommunityIcons name="flag-outline" size={16} color={Colors.foreground} style={{ opacity: 0.4 }} />
            <Text className="text-sm" style={{ color: Colors.foreground, opacity: 0.4 }}>檢舉這個車位</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Close */}
        <View className="px-6 pb-4">
          <TouchableOpacity onPress={() => router.back()}
            className="py-3 rounded-2xl items-center" style={{ backgroundColor: Colors.muted }}>
            <Text style={{ color: Colors.foreground }}>關閉</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Flag modal */}
      <Modal visible={flagModalVisible} transparent animationType="slide"
        onRequestClose={() => setFlagModalVisible(false)}>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setFlagModalVisible(false)} />
          <View className="rounded-t-3xl p-6 gap-4" style={{ backgroundColor: 'white' }}>
            <Text className="text-lg font-bold" style={{ color: Colors.primaryDark }}>檢舉原因</Text>
            <View className="gap-2">
              {FLAG_REASONS.map((r) => (
                <TouchableOpacity key={r.value} onPress={() => setSelectedReason(r.value)}
                  className="flex-row items-center gap-3 p-3 rounded-xl border"
                  style={{
                    borderColor: selectedReason === r.value ? Colors.primary : Colors.border,
                    backgroundColor: selectedReason === r.value ? Colors.primary + '08' : 'white',
                  }}>
                  <View className="w-5 h-5 rounded-full border-2 items-center justify-center"
                    style={{ borderColor: selectedReason === r.value ? Colors.primary : Colors.muted }}>
                    {selectedReason === r.value && (
                      <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: Colors.primary }} />
                    )}
                  </View>
                  <Text className="text-sm" style={{ color: Colors.primaryDark }}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput value={flagNote} onChangeText={setFlagNote}
              placeholder="補充說明（選填）"
              placeholderTextColor={Colors.foreground + '60'} maxLength={100}
              style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
                padding: 10, fontSize: 13, color: Colors.primaryDark }} />
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setFlagModalVisible(false)}
                className="flex-1 py-3 rounded-2xl items-center" style={{ backgroundColor: Colors.muted }}>
                <Text style={{ color: Colors.foreground }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => submitFlag()} disabled={!selectedReason || flagging}
                className="flex-1 py-3 rounded-2xl items-center"
                style={{ backgroundColor: selectedReason ? Colors.marker.occupied : Colors.muted,
                  opacity: !selectedReason ? 0.5 : 1 }}>
                {flagging
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text className="font-semibold text-white">送出檢舉</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
