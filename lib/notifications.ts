import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Show notifications even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const projectId =
  Constants.expoConfig?.extra?.eas?.projectId ??
  Constants.easConfig?.projectId;

/**
 * Ask for push permission, fetch the Expo push token, and persist it for the
 * signed-in user. Safe to call repeatedly (idempotent upsert). Returns the
 * token, or null if unavailable / denied.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0F766E',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;

    await supabase.from('push_tokens').upsert(
      { user_id: userId, token, platform: Platform.OS },
      { onConflict: 'user_id,token' },
    );

    return token;
  } catch (e) {
    console.warn('push registration failed', e);
    return null;
  }
}

/** Whether the OS-level notification permission is currently granted. */
export async function hasNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/**
 * Capture the device's current coordinates for use as a saved "home" location.
 * Returns null if permission is denied.
 */
export async function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}
