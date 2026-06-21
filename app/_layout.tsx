import '../global.css';
import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { registerForPushNotifications } from '../lib/notifications';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

export default function RootLayout() {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) registerForPushNotifications(session.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) registerForPushNotifications(session.user.id);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Tapping a push notification deep-links to the relevant space.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const spaceId = response.notification.request.content.data?.spaceId;
      if (typeof spaceId === 'string') router.push(`/space/${spaceId}`);
    });
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="report" options={{ presentation: 'modal' }} />
          <Stack.Screen name="space/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        </Stack>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
