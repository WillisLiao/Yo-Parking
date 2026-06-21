import { useState, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, Dimensions, ViewToken } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'map-marker-plus' as const,
    title: '發現空位，馬上回報',
    body: '看到空的機車停車格？按一下，讓附近的人知道！你的回報即時更新在地圖上。',
    color: Colors.marker.empty,
  },
  {
    icon: 'shield-star-outline' as const,
    title: '可信賴度讓資訊更準確',
    body: '每個人的回報都有可信賴分數。回報越準確，你的分數越高，影響力越大。亂報的人分數低，影響力自然變小。',
    color: Colors.primary,
  },
  {
    icon: 'chart-bell-curve-cumulative' as const,
    title: '機率幫你判斷',
    body: '每個空位都有「現在有空的機率」，根據最近的回報自動計算。綠色表示高機率有空，紅色則可能已停滿。',
    color: Colors.accent,
  },
];

export default function OnboardingScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]) setActiveIndex(viewableItems[0].index ?? 0);
    },
  ).current;

  async function finish() {
    await AsyncStorage.setItem('onboarded', 'true');
    router.replace('/(tabs)/');
  }

  function next() {
    if (activeIndex < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: activeIndex + 1 });
    } else {
      finish();
    }
  }

  return (
    <View className="flex-1 bg-surface">
      <FlatList
        ref={flatRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={{ width }} className="flex-1 items-center justify-center px-8 gap-8">
            <View
              className="w-28 h-28 rounded-full items-center justify-center"
              style={{ backgroundColor: item.color + '20' }}
            >
              <MaterialCommunityIcons name={item.icon} size={56} color={item.color} />
            </View>
            <View className="gap-3">
              <Text className="text-2xl font-bold text-center" style={{ color: Colors.primaryDark }}>
                {item.title}
              </Text>
              <Text className="text-base text-center leading-relaxed" style={{ color: Colors.foreground, opacity: 0.75 }}>
                {item.body}
              </Text>
            </View>
          </View>
        )}
        keyExtractor={(_, i) => String(i)}
      />

      {/* Dots */}
      <View className="flex-row justify-center gap-2 mb-6">
        {SLIDES.map((_, i) => (
          <View
            key={i}
            className="h-2 rounded-full"
            style={{
              width: i === activeIndex ? 24 : 8,
              backgroundColor: i === activeIndex ? Colors.primary : Colors.muted,
            }}
          />
        ))}
      </View>

      <View className="px-6 pb-12 gap-3">
        <TouchableOpacity
          onPress={next}
          activeOpacity={0.85}
          className="w-full py-4 rounded-2xl items-center"
          style={{ backgroundColor: Colors.primary }}
        >
          <Text className="text-white font-semibold text-base">
            {activeIndex === SLIDES.length - 1 ? '開始使用' : '下一步'}
          </Text>
        </TouchableOpacity>
        {activeIndex < SLIDES.length - 1 && (
          <TouchableOpacity onPress={finish} className="items-center py-2">
            <Text style={{ color: Colors.primary, opacity: 0.7 }}>跳過</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
