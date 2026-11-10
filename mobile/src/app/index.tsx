import { Redirect, router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppButton, AppColors, AppScreen, ErrorBanner, PageHeading } from '@/components/app-ui';
import { useLocalApp } from '@/lib/local-app-context';

export default function IndexRoute() {
  const { currentUser, loading, error, retrySessionRestore } = useLocalApp();
  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={AppColors.forest} /></View>;
  }
  if (error) {
    return (
      <AppScreen>
        <PageHeading title="Connection issue" subtitle="We could not restore your account. Check your connection and try again." />
        <ErrorBanner message={error} />
        <AppButton title="Try again" onPress={() => void retrySessionRestore()} />
        <AppButton title="Sign in" variant="outline" onPress={() => router.replace('/(auth)/welcome')} />
      </AppScreen>
    );
  }
  return <Redirect href={currentUser ? '/dashboard' : '/(auth)/welcome'} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: AppColors.cream, justifyContent: 'center', alignItems: 'center' },
});
