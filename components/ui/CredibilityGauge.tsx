import { View, Text } from 'react-native';
import { Colors, BADGE_LABELS, BADGE_THRESHOLDS } from '../../constants/colors';
import type { Badge } from '../../types';

interface Props {
  score: number;
  badge: Badge;
}

const BADGE_ORDER: Badge[] = ['newbie', 'regular', 'reliable', 'expert', 'guardian'];

export function CredibilityGauge({ score, badge }: Props) {
  const color = Colors.badge[badge];
  const pct = Math.min(100, Math.max(0, score));

  const nextBadge = BADGE_ORDER[BADGE_ORDER.indexOf(badge) + 1];
  const nextThreshold = nextBadge ? BADGE_THRESHOLDS[nextBadge] : 100;
  const currentThreshold = BADGE_THRESHOLDS[badge];
  const segmentPct =
    nextBadge
      ? ((pct - currentThreshold) / (nextThreshold - currentThreshold)) * 100
      : 100;

  return (
    <View className="gap-3">
      {/* Score and badge */}
      <View className="flex-row items-center justify-between">
        <View className="gap-1">
          <Text className="text-4xl font-bold" style={{ color }}>
            {Math.round(pct)}
          </Text>
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>
            / 100 可信賴度
          </Text>
        </View>
        <View
          className="px-4 py-2 rounded-full"
          style={{ backgroundColor: color + '20' }}
        >
          <Text className="font-bold text-base" style={{ color }}>
            {BADGE_LABELS[badge]}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View className="gap-1">
        <View className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: Colors.muted }}>
          <View
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </View>
        {nextBadge && (
          <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>
            距離「{BADGE_LABELS[nextBadge]}」還差 {Math.ceil(nextThreshold - pct)} 分
          </Text>
        )}
      </View>

      {/* Badge tier row */}
      <View className="flex-row justify-between mt-1">
        {BADGE_ORDER.map((b) => (
          <View key={b} className="items-center gap-1">
            <View
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor: Colors.badge[b],
                opacity: BADGE_ORDER.indexOf(b) <= BADGE_ORDER.indexOf(badge) ? 1 : 0.25,
              }}
            />
            <Text className="text-xs" style={{ color: Colors.foreground, opacity: 0.5 }}>
              {BADGE_LABELS[b]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
