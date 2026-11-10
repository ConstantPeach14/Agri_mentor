import type { UserRole } from './local-data';

export const APP_ROUTES = {
  dashboard: '/(tabs)/dashboard',
  discover: '/(tabs)/discover',
  requests: '/(tabs)/requests',
  mentorship: '/(tabs)/mentorship',
  goals: '/(tabs)/goals',
  sessions: '/(tabs)/sessions',
  participants: '/(tabs)/participants',
  programme: '/(tabs)/programme',
  profile: '/(tabs)/profile',
} as const;

export type AppRoute = keyof typeof APP_ROUTES;

export function isAppRoute(value: string | undefined): value is AppRoute {
  return value !== undefined && Object.prototype.hasOwnProperty.call(APP_ROUTES, value);
}

export const roleTabRoutes: Record<UserRole, readonly AppRoute[]> = {
  mentee: ['dashboard', 'discover', 'requests', 'mentorship', 'sessions', 'goals', 'profile'],
  mentor: ['dashboard', 'requests', 'mentorship', 'sessions', 'profile'],
  staff: ['dashboard', 'participants', 'programme', 'profile'],
};

export function registrationRole(value: string | string[] | undefined): UserRole | null {
  const role = Array.isArray(value) ? value[0] : value;
  return role === 'mentee' || role === 'mentor' || role === 'staff' ? role : null;
}

export const routeRoles: Record<AppRoute, readonly UserRole[]> = {
  dashboard: ['mentee', 'mentor', 'staff'],
  discover: ['mentee'],
  requests: ['mentee', 'mentor'],
  mentorship: ['mentee', 'mentor'],
  goals: ['mentee', 'mentor'],
  sessions: ['mentee', 'mentor'],
  participants: ['staff'],
  programme: ['staff'],
  profile: ['mentee', 'mentor', 'staff'],
};

export function canOpenAppRoute(role: UserRole, route: AppRoute): boolean {
  return routeRoles[route].includes(role);
}
