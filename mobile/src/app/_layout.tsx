import '../global.css';

import { Stack } from 'expo-router';

import { LocalAppProvider } from '@/lib/local-app-context';

export default function RootLayout() {
  return (
    <LocalAppProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F7F5EE' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="mentor/[id]" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
    </LocalAppProvider>
  );
}
