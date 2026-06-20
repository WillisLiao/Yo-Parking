import { View, Text } from 'react-native';
import { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PROBABILITY_COLORS } from '../../constants/colors';
import type { Space } from '../../types';

interface Props {
  space: Space;
  onPress: (space: Space) => void;
}

export function ParkingMarker({ space, onPress }: Props) {
  const color = PROBABILITY_COLORS(space.probability);
  const pct = Math.round(space.probability * 100);

  return (
    <Marker
      key={space.id}
      coordinate={{ latitude: space.location.lat, longitude: space.location.lng }}
      onPress={() => onPress(space)}
      tracksViewChanges={false}
    >
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            backgroundColor: color,
            borderRadius: 12,
            paddingHorizontal: 8,
            paddingVertical: 4,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
            minWidth: 44,
            minHeight: 28,
            flexDirection: 'row',
            gap: 2,
          }}
        >
          {space.verified && (
            <MaterialCommunityIcons name="check-decagram" size={11} color="white" />
          )}
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 12 }}>
            {pct}%
          </Text>
        </View>
        {/* Tail */}
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 6,
            borderRightWidth: 6,
            borderTopWidth: 8,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
      </View>
    </Marker>
  );
}
