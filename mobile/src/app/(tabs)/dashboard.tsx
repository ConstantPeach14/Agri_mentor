import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { AppButton, AppCard, AppColors, AppField, AppScreen, Avatar, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { APP_ROUTES } from '@/lib/app-routes';
import { StaffDashboard } from '@/lib/auth-api';
import { useLocalApp } from '@/lib/local-app-context';

const roleName = { mentee: 'Mentee', mentor: 'Mentor', staff: 'Programme staff' };

export default function HomeScreen() {
  const {
    data,
    currentUser,
    currentTime,
    mentorshipLoading,
    mentorshipError,
    refreshMentorshipData,
    managementLoading,
    managementError,
    refreshManagementData,
    getStaffDashboard,
    createStaffProgramme,
  } = useLocalApp();
  const [staffDashboard, setStaffDashboard] = useState<StaffDashboard | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState('');
  const [programmeName, setProgrammeName] = useState('');
  const [programmeDescription, setProgrammeDescription] = useState('');
  const [programmeNotice, setProgrammeNotice] = useState('');
  const [programmeSaving, setProgrammeSaving] = useState(false);
  const refreshStaffDashboard = useCallback(async () => {
    if (currentUser?.role !== 'staff') return;
    setStaffLoading(true);
    setStaffError('');
    setStaffDashboard(null);
    try {
      setStaffDashboard(await getStaffDashboard());
    } catch (cause) {
      setStaffError(cause instanceof Error ? cause.message : 'Programme information could not be loaded.');
    } finally {
      setStaffLoading(false);
    }
  }, [currentUser?.role, getStaffDashboard]);
  const createProgramme = async () => {
    setStaffError('');
    setProgrammeNotice('');
    if (!programmeName.trim()) {
      setStaffError('Enter a programme name.');
      return;
    }
    setProgrammeSaving(true);
    try {
      await createStaffProgramme({ name: programmeName, description: programmeDescription });
      setProgrammeName('');
      setProgrammeDescription('');
      setProgrammeNotice('Programme created and assigned to your account.');
      await refreshStaffDashboard();
    } catch (cause) {
      setStaffError(cause instanceof Error ? cause.message : 'Programme could not be created.');
    } finally {
      setProgrammeSaving(false);
    }
  };
  useFocusEffect(useCallback(() => {
    if (currentUser?.role === 'staff') {
      void refreshStaffDashboard();
    } else {
      void Promise.all([refreshMentorshipData(), refreshManagementData()]).catch(() => undefined);
    }
  }, [currentUser?.role, refreshManagementData, refreshMentorshipData, refreshStaffDashboard]));
  if (!data || !currentUser) return null;

  const profile = data.profiles.find((item) => item.userId === currentUser.id);
  const myRelationships = data.mentorships.filter((item) => item.status === 'active' && (item.menteeId === currentUser.id || item.mentorId === currentUser.id));
  const incoming = data.requests.filter((item) => item.mentorId === currentUser.id && item.status === 'pending');
  const outgoing = data.requests.filter((item) => item.menteeId === currentUser.id && item.status === 'pending');
  const myGoals = data.goals.filter((goal) => myRelationships.some((relationship) => relationship.id === goal.relationshipId));
  const completedMilestones = myGoals.flatMap((goal) => goal.milestones).filter((milestone) => milestone.completed).length;
  const totalMilestones = myGoals.flatMap((goal) => goal.milestones).length;
  const mySessions = data.sessions.filter((session) => myRelationships.some((relationship) => relationship.id === session.relationshipId));
  const upcomingSessions = mySessions.filter((session) => session.status === 'scheduled'
    && new Date(session.scheduledAt).getTime() >= currentTime)
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
  const completedSessions = mySessions.filter((session) => session.status === 'completed').length;
  const activeGoals = myGoals.filter((goal) => goal.status === 'active').length;

  return (
    <AppScreen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: AppColors.forest, fontSize: 13, fontWeight: '900', letterSpacing: 1.4 }}>agriMentor</Text>
        <Pill label={roleName[currentUser.role]} />
      </View>
      <PageHeading eyebrow="Your growing journey" title={`Hello, ${currentUser.name.split(' ')[0]}`} subtitle={profile?.location || 'Your mentorship space is ready.'} right={<Avatar name={currentUser.name} size={48} />} />
      <Image
        source={require('@/assets/images/agri-home.png')}
        contentFit="cover"
        accessibilityLabel="A farmer tending crop rows at sunset"
        style={{ width: '100%', height: 176, borderRadius: 18 }}
      />

      {currentUser.role === 'mentee' ? (
        <>
          <AppCard style={{ backgroundColor: AppColors.forest, borderColor: AppColors.forest }}>
            <Text style={{ color: '#DCE9C5', fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>A LITTLE GUIDANCE GOES A LONG WAY</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 22, lineHeight: 28, fontWeight: '800' }}>Find someone who has grown where you want to go.</Text>
            <AppButton title="Explore mentors  →" variant="secondary" onPress={() => router.push(APP_ROUTES.discover)} />
          </AppCard>
          {mentorshipError ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: AppColors.red, fontSize: 13 }}>{mentorshipError}</Text>
              <AppButton title="Retry mentorship data" variant="outline" compact onPress={() => void refreshMentorshipData().catch(() => undefined)} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricCard label="Active mentorships" value={mentorshipLoading || mentorshipError ? '—' : String(myRelationships.length)} />
            <MetricCard label="Pending requests" value={mentorshipLoading || mentorshipError ? '—' : String(outgoing.length)} />
          </View>
          <ProgressSummary
            activeGoals={activeGoals}
            completedMilestones={completedMilestones}
            totalMilestones={totalMilestones}
            upcomingSession={upcomingSessions[0]?.scheduledAt}
            completedSessions={completedSessions}
            loading={managementLoading}
            error={managementError}
            onRetry={() => void refreshManagementData().catch(() => undefined)}
          />
          <SectionTitle title="Your next steps" />
          <ActionCard title="Your mentorship" detail={mentorshipLoading ? 'Loading your active mentorships.' : mentorshipError ? 'Mentorship data is unavailable.' : myRelationships.length ? 'See your mentor, goals and shared plans.' : 'Your accepted matches will appear here.'} icon="🤝" onPress={() => router.push(APP_ROUTES.mentorship)} />
          <ActionCard title="Goals & progress" detail={managementLoading ? 'Loading your progress.' : managementError ? 'Progress data is unavailable.' : totalMilestones ? `${completedMilestones} of ${totalMilestones} milestones completed` : 'Turn your learning plans into goals.'} icon="🌱" onPress={() => router.push(APP_ROUTES.goals)} />
          <ActionCard title="Sessions" detail={managementLoading ? 'Loading your sessions.' : managementError ? 'Session data is unavailable.' : upcomingSessions.length ? `${upcomingSessions.length} scheduled conversation${upcomingSessions.length === 1 ? '' : 's'}` : 'Schedule or review mentorship conversations.'} icon="🗓️" onPress={() => router.push(APP_ROUTES.sessions)} />
          <ActionCard title="Requests" detail={mentorshipLoading ? 'Loading your requests.' : mentorshipError ? 'Request data is unavailable.' : outgoing.length ? `${outgoing.length} waiting for a mentor response` : 'Review your sent mentorship requests.'} icon="✉️" onPress={() => router.push(APP_ROUTES.requests)} />
        </>
      ) : currentUser.role === 'mentor' ? (
        <>
          <AppCard style={{ backgroundColor: AppColors.forest, borderColor: AppColors.forest }}>
            <Text style={{ color: '#DCE9C5', fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>YOUR EXPERIENCE CAN OPEN DOORS</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 22, lineHeight: 28, fontWeight: '800' }}>A thoughtful conversation can change a growing season.</Text>
            <AppButton title="Review incoming requests  →" variant="secondary" onPress={() => router.push(APP_ROUTES.requests)} />
          </AppCard>
          {mentorshipError ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: AppColors.red, fontSize: 13 }}>{mentorshipError}</Text>
              <AppButton title="Retry mentorship data" variant="outline" compact onPress={() => void refreshMentorshipData().catch(() => undefined)} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricCard label="Active mentees" value={mentorshipLoading || mentorshipError ? '—' : String(myRelationships.length)} />
            <MetricCard label="New requests" value={mentorshipLoading || mentorshipError ? '—' : String(incoming.length)} />
          </View>
          <ProgressSummary
            activeGoals={activeGoals}
            completedMilestones={completedMilestones}
            totalMilestones={totalMilestones}
            upcomingSession={upcomingSessions[0]?.scheduledAt}
            completedSessions={completedSessions}
            loading={managementLoading}
            error={managementError}
            onRetry={() => void refreshManagementData().catch(() => undefined)}
          />
          <SectionTitle title="Mentor workspace" />
          <ActionCard title="Incoming requests" detail={mentorshipLoading ? 'Loading incoming requests.' : mentorshipError ? 'Request data is unavailable.' : incoming.length ? `${incoming.length} request${incoming.length === 1 ? '' : 's'} need your response` : 'Your new requests will appear here.'} icon="📬" onPress={() => router.push(APP_ROUTES.requests)} />
          <ActionCard title="Mentees" detail={mentorshipLoading ? 'Loading your active mentees.' : mentorshipError ? 'Mentorship data is unavailable.' : 'Check in on your active mentorship relationships.'} icon="🌾" onPress={() => router.push(APP_ROUTES.mentorship)} />
          <ActionCard title="Goals & progress" detail={managementLoading ? 'Loading progress.' : managementError ? 'Progress data is unavailable.' : totalMilestones ? `${completedMilestones} of ${totalMilestones} milestones completed` : 'Set measurable goals with your mentees.'} icon="🌱" onPress={() => router.push(APP_ROUTES.goals)} />
          <ActionCard title="Sessions" detail={managementLoading ? 'Loading sessions.' : managementError ? 'Session data is unavailable.' : 'Plan a meeting or mark a session complete.'} icon="🗓️" onPress={() => router.push(APP_ROUTES.sessions)} />
        </>
      ) : (
        <>
          <AppCard style={{ backgroundColor: '#EFF3E7' }}>
            <Text style={{ color: AppColors.forest, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>PROGRAMME OVERSIGHT</Text>
            <Text style={{ color: AppColors.ink, fontSize: 20, lineHeight: 27, fontWeight: '800' }}>
              {staffLoading ? 'Loading assigned programmes…' : staffDashboard?.summary.programmeCount
                ? `${staffDashboard.summary.programmeCount} assigned programme${staffDashboard.summary.programmeCount === 1 ? '' : 's'}`
                : 'Your programme workspace'}
            </Text>
            <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>
              Reports include only active programmes and participant memberships assigned to your account.
            </Text>
            {staffError ? <Text accessibilityRole="alert" style={{ color: AppColors.red, fontSize: 13 }}>{staffError}</Text> : null}
            {staffError ? <AppButton title="Retry programme data" variant="outline" compact onPress={() => void refreshStaffDashboard()} /> : null}
          </AppCard>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricCard label="Assigned mentees" value={staffLoading || staffError ? '—' : String(staffDashboard?.summary.menteeCount ?? '—')} />
            <MetricCard label="Assigned mentors" value={staffLoading || staffError ? '—' : String(staffDashboard?.summary.mentorCount ?? '—')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricCard label="Active relationships" value={staffLoading || staffError ? '—' : String(staffDashboard?.summary.activeRelationshipCount ?? '—')} />
            <MetricCard label="Pending requests" value={staffLoading || staffError ? '—' : String(staffDashboard?.summary.pendingRequestCount ?? '—')} />
          </View>
          <SectionTitle title="Available staff tools" />
          <ActionCard title="Participants" detail="View the people assigned to your programmes." icon="◎" onPress={() => router.push(APP_ROUTES.participants)} />
          {staffDashboard?.programmes.map((programme) => (
            <ActionCard
              key={programme.id}
              title={programme.name}
              detail={`${programme.menteeCount} mentees · ${programme.mentorCount} mentors`}
              icon="🌾"
              onPress={() => router.push({ pathname: APP_ROUTES.programme, params: { programmeId: programme.id } })}
            />
          ))}
          {!staffLoading && !staffError && staffDashboard?.programmes.length === 0 ? (
            <Text style={{ color: AppColors.muted, fontSize: 13 }}>Create your first programme to begin assigning participants.</Text>
          ) : null}
          <AppCard>
            <SectionTitle title="Create a programme" />
            <AppField label="Programme name" value={programmeName} onChangeText={setProgrammeName} placeholder="e.g. Smallholder Growth Cohort" maxLength={160} />
            <AppField label="Description" value={programmeDescription} onChangeText={setProgrammeDescription} placeholder="Purpose and focus of this programme" multiline maxLength={2000} />
            <AppButton title="Create programme" loading={programmeSaving} onPress={() => void createProgramme()} />
            {programmeNotice ? <Text accessibilityRole="alert" style={{ color: AppColors.forest, fontSize: 13 }}>{programmeNotice}</Text> : null}
          </AppCard>
          {staffDashboard ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricCard label="Upcoming sessions" value={String(staffDashboard.summary.upcomingSessionCount)} />
              <MetricCard label="Overdue sessions" value={String(staffDashboard.summary.overdueSessionCount)} />
            </View>
          ) : null}
          {staffDashboard ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricCard label="Completed sessions" value={String(staffDashboard.summary.completedSessionCount)} />
              <MetricCard label="Cancelled sessions" value={String(staffDashboard.summary.cancelledSessionCount)} />
            </View>
          ) : null}
          {staffDashboard ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricCard label="Unmatched mentees" value={String(staffDashboard.summary.unmatchedMenteeCount)} />
              <MetricCard label="Unmatched mentors" value={String(staffDashboard.summary.unmatchedMentorCount)} />
            </View>
          ) : null}
          {staffDashboard ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricCard label="Active goals / milestones" value={`${staffDashboard.summary.activeGoalCount} / ${staffDashboard.summary.activeMilestoneCount}`} />
              <MetricCard label="Completed goals / milestones" value={`${staffDashboard.summary.completedGoalCount} / ${staffDashboard.summary.completedMilestoneCount}`} />
            </View>
          ) : null}
          {staffDashboard?.recentActivity.length ? (
            <>
              <SectionTitle title="Recent programme activity" />
              {staffDashboard.recentActivity.map((item) => (
                <Text key={`${item.type}-${item.id}`} style={{ color: AppColors.muted, fontSize: 13 }}>
                  {item.type} · {item.label} · {new Date(item.occurredAt).toLocaleDateString()}
                </Text>
              ))}
            </>
          ) : staffDashboard && !staffDashboard.recentActivity.length ? (
            <Text style={{ color: AppColors.muted, fontSize: 13 }}>No programme activity has been recorded yet.</Text>
          ) : null}
        </>
      )}
    </AppScreen>
  );
}

function ProgressSummary({
  activeGoals,
  completedMilestones,
  totalMilestones,
  upcomingSession,
  completedSessions,
  loading,
  error,
  onRetry,
}: {
  activeGoals: number;
  completedMilestones: number;
  totalMilestones: number;
  upcomingSession?: string;
  completedSessions: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const progressPercent = totalMilestones ? Math.round(completedMilestones / totalMilestones * 100) : 0;
  return (
    <AppCard style={{ backgroundColor: '#EFF3E7' }}>
      <Text style={{ color: AppColors.forest, fontSize: 15, fontWeight: '800' }}>Progress from your mentorship records</Text>
      {loading ? <Text style={{ color: AppColors.muted, fontSize: 13 }}>Loading your saved progress…</Text> : null}
      {!loading && error ? (
        <>
          <Text style={{ color: AppColors.muted, fontSize: 13 }}>{error}</Text>
          <AppButton title="Retry loading progress" variant="outline" compact onPress={onRetry} />
        </>
      ) : null}
      {!loading && !error ? <Text style={{ color: AppColors.ink, fontSize: 13 }}>{activeGoals} active goals · {completedMilestones}/{totalMilestones} milestones complete · {completedSessions} completed sessions</Text> : null}
      {!loading && !error && upcomingSession ? (
        <Text style={{ color: AppColors.muted, fontSize: 12 }}>Next session: {new Date(upcomingSession).toLocaleString()}</Text>
      ) : !loading && !error ? <Text style={{ color: AppColors.muted, fontSize: 12 }}>No upcoming session scheduled.</Text> : null}
      {!loading && !error && totalMilestones > 0 ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Completed milestones"
          accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
          style={{ height: 7, backgroundColor: '#D5DEC9', borderRadius: 9, overflow: 'hidden' }}>
          <View style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: AppColors.leaf }} />
        </View>
      ) : null}
    </AppCard>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <AppCard style={{ flex: 1, alignItems: 'flex-start', padding: 14, gap: 5 }}>
      <Text style={{ color: AppColors.forest, fontSize: 24, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: AppColors.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </AppCard>
  );
}

function ActionCard({ title, detail, icon, onPress }: { title: string; detail: string; icon: string; onPress: () => void }) {
  return (
    <AppCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: AppColors.ink, fontSize: 15, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: AppColors.muted, fontSize: 12, lineHeight: 17 }}>{detail}</Text>
      </View>
      <AppButton title="Open" variant="link" compact onPress={onPress} />
    </AppCard>
  );
}
