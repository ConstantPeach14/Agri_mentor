import { Redirect, Tabs, useSegments } from 'expo-router';
import { Text } from 'react-native';

import { AppColors } from '@/components/app-ui';
import { AppRoute, isAppRoute, roleTabRoutes, routeRoles } from '@/lib/app-routes';
import { useLocalApp } from '@/lib/local-app-context';

const routeMeta: Record<AppRoute, { label: string; icon: string }> = {
  dashboard: { label: 'Home', icon: '⌂' },
  discover: { label: 'Find mentors', icon: '⌕' },
  requests: { label: 'Requests', icon: '✉' },
  mentorship: { label: 'My matches', icon: '🤝' },
  goals: { label: 'Goals', icon: '✓' },
  sessions: { label: 'Sessions', icon: '◷' },
  participants: { label: 'Participants', icon: '◎' },
  programme: { label: 'Programme overview', icon: '▤' },
  profile: { label: 'Profile', icon: '○' },
};

export default function TabsLayout() {
  const { currentUser, loading } = useLocalApp();
  const segments = useSegments();
  if (loading) return null;
  if (!currentUser) return <Redirect href="/(auth)/welcome" />;

  const segment = segments[segments.length - 1];
  if (segments[0] === '(tabs)' && isAppRoute(segment) && !routeRoles[segment].includes(currentUser.role)) {
    return <Redirect href="/(tabs)/dashboard" />;
  }

  const tabRoutes = roleTabRoutes[currentUser.role];
  const labels: Partial<Record<AppRoute, string>> = currentUser.role === 'mentee'
    ? { dashboard: 'Home', discover: 'Find mentor', mentorship: 'Mentorship', goals: 'Progress', profile: 'Profile' }
    : currentUser.role === 'mentor'
      ? { dashboard: 'Home', requests: 'Requests', mentorship: 'Mentees', sessions: 'Sessions', profile: 'Profile' }
      : { dashboard: 'Dashboard', participants: 'People', profile: 'Profile' };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: AppColors.forest,
        tabBarInactiveTintColor: AppColors.muted,
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: '#E2E6DC', height: 66, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}>
      {(Object.keys(routeMeta) as AppRoute[]).map((name) => {
        const meta = routeMeta[name];
        const visible = routeRoles[name].includes(currentUser.role);
        const tabBarScreen = tabRoutes.includes(name);
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: labels[name] ?? meta.label,
              href: visible && tabBarScreen ? undefined : null,
              tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{meta.icon}</Text>,
            }}
          />
        );
      })}
    </Tabs>
  );
}
