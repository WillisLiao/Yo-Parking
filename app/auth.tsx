import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Colors } from '../constants/colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const { session } = useAuthStore();
  const [loading, setLoading] = useState(false);

  if (session) return <Redirect href="/(tabs)/" />;

  async function signInWithGoogle() {
    try {
      setLoading(true);
      const redirectUri = makeRedirectUri({ scheme: 'yo-parking' });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;

      const result = await WebBrowser.openAuthSessionAsync(data.url!, redirectUri);

      if (result.type === 'success') {
        const { url } = result;
        const params = new URLSearchParams(url.split('#')[1] ?? url.split('?')[1] ?? '');
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken ?? '',
          });
        }
      }
    } catch (e: any) {
      Alert.alert('登入失敗', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 bg-surface px-6">
      <View className="flex-1 items-center justify-center gap-8">
        {/* Logo area */}
        <View className="items-center gap-3">
          <View
            className="w-20 h-20 rounded-3xl items-center justify-center"
            style={{ backgroundColor: Colors.primary }}
          >
            <MaterialCommunityIcons name="motorbike" size={44} color="white" />
          </View>
          <Text
            className="text-4xl font-bold"
            style={{ color: Colors.primaryDark }}
          >
            Yo車位
          </Text>
          <Text className="text-base text-center" style={{ color: Colors.foreground, opacity: 0.7 }}>
            即時機車停車空位地圖{'\n'}大家一起回報，一起受益
          </Text>
        </View>

        {/* Sign in buttons */}
        <View className="w-full gap-3">
          <TouchableOpacity
            onPress={signInWithGoogle}
            disabled={loading}
            activeOpacity={0.8}
            className="w-full flex-row items-center justify-center gap-3 py-4 rounded-2xl"
            style={{ backgroundColor: Colors.primary }}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <MaterialCommunityIcons name="google" size={22} color="white" />
                <Text className="text-white font-semibold text-base">
                  以 Google 登入
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <Text className="text-xs text-center" style={{ color: Colors.foreground, opacity: 0.5 }}>
          登入即表示你同意我們的服務條款與隱私政策
        </Text>
      </View>
    </View>
  );
}
