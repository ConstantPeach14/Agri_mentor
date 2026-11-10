import { Redirect } from 'expo-router';

import { useLocalApp } from '@/lib/local-app-context';

export default function LegacyExploreRoute() {
  const { currentUser, loading } = useLocalApp();
  if (loading) return null;
  if (!currentUser) return <Redirect href="/(auth)/welcome" />;
  return <Redirect href={currentUser.role === 'mentee' ? '/(tabs)/discover' : '/(tabs)/dashboard'} />;
}
