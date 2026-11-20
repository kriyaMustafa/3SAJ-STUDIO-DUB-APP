import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useProjectStore } from '../store/useProjectStore';
import { authService } from '../services/api/authService';

// Prevent splash screen from auto-hiding outside the component tree
SplashScreen.preventAutoHideAsync().catch(() => {});

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: '#EF4444', fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>
          Application Encountered an Issue
        </Text>
        <Text style={{ color: '#94A3B8', fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
          {error?.message || 'Unknown error occurred'}
        </Text>
        <TouchableOpacity
          onPress={retry}
          style={{ backgroundColor: '#005F73', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const initStore = useProjectStore((s) => s.initStore);

  useEffect(() => {
    let isMounted = true;

    async function prepare() {
      try {
        await initStore();
      } catch (e) {
        console.warn('initStore error during startup:', e);
      } finally {
        if (isMounted) {
          setAppIsReady(true);
        }
        try {
          await SplashScreen.hideAsync();
        } catch (splashErr) {
          console.warn('SplashScreen.hideAsync error:', splashErr);
        }
      }
    }

    prepare();

    // Global listener for OAuth deep links (sajstudio://auth/callback)
    const handleDeepLink = async (event: { url: string }) => {
      if (event.url && event.url.startsWith('sajstudio://auth/callback')) {
        try {
          await authService.handleAuthDeepLink(event.url);
        } catch (err) {
          console.warn('[RootLayout] Deep link auth handling error:', err);
        }
      }
    };

    const linkSub = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl && initialUrl.startsWith('sajstudio://auth/callback')) {
        handleDeepLink({ url: initialUrl });
      }
    });

    return () => {
      isMounted = false;
      linkSub.remove();
    };
  }, [initStore]);

  if (!appIsReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#0F172A" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#F8FAFC',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#0F172A' },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="editor/[id]"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings & API Keys',
            presentation: 'modal',
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
