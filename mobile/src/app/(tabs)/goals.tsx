import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppChoiceChip, AppColors, AppField, AppScreen, EmptyState, ErrorBanner, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { useLocalApp } from '@/lib/local-app-context';
import { LocalGoal } from '@/lib/local-data';

export default function GoalsScreen() {
  const {
    data,
    currentUser,
    createGoal,
    updateGoal,
    createMilestone,
    updateMilestone,
    managementLoading,
    managementError,
    refreshManagementData,
  } = useLocalApp();
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [milestoneDrafts, setMilestoneDrafts] = useState<Record<string, string>>({});
  const [goalEdits, setGoalEdits] = useState<Record<string, { title: string; outcome: string; targetDate: string }>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    void refreshManagementData().catch(() => undefined);
  }, [refreshManagementData]));
  if (!currentUser) return null;
  if (currentUser.role === 'staff') {
    return (
      <AppScreen>
        <PageHeading eyebrow="Programme oversight" title="Progress reporting" subtitle="Programme-scoped summaries require assigned-programme membership." />
        <AppCard style={{ backgroundColor: '#EFF3E7' }}>
          <Text style={{ color: AppColors.forest, fontSize: 15, fontWeight: '800' }}>Reporting is not configured</Text>
          <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>
            The current database has no programme membership or staff-assignment model. No participant-level goals, sessions, or progress are exposed to this account.
          </Text>
        </AppCard>
      </AppScreen>
    );
  }

  const myRelationships = data.mentorships.filter(
    (item) => item.menteeId === currentUser.id || item.mentorId === currentUser.id,
  );
  const activeRelationships = myRelationships.filter((item) => item.status === 'active');
  const relationshipIds = new Set(myRelationships.map((item) => item.id));
  const selectedRelationshipId = activeRelationships.some((item) => item.id === selectedRelationship)
    ? selectedRelationship
    : activeRelationships[0]?.id;
  const goals = data.goals.filter((goal) => relationshipIds.has(goal.relationshipId));
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const milestones = goals.flatMap((goal) => goal.milestones);
  const completedMilestones = milestones.filter((item) => item.status === 'completed').length;
  const completedGoals = goals.filter((goal) => goal.status === 'completed').length;
  const progressPercent = milestones.length ? Math.round(completedMilestones / milestones.length * 100) : 0;
  const otherParticipantName = (relationshipId: string) => {
    const relationship = myRelationships.find((item) => item.id === relationshipId);
    if (!relationship) return '';
    return relationship.menteeId === currentUser.id ? relationship.mentor.name : relationship.mentee.name;
  };

  const saveGoal = async () => {
    setError('');
    setNotice('');
    if (!title.trim() || !outcome.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setError('Enter a goal title, measurable outcome, and target date (YYYY-MM-DD).');
      return;
    }
    if (!selectedRelationshipId) {
      setError('Create goals from an active mentorship as a mentee or mentor.');
      return;
    }
    setBusy(true);
    try {
      await createGoal({
        title: title.trim(),
        description: outcome.trim(),
        targetDate,
      }, selectedRelationshipId);
      setTitle('');
      setOutcome('');
      setTargetDate('');
      setNotice('Measurable goal saved for both participants.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your goal.');
    } finally {
      setBusy(false);
    }
  };

  const currentEdit = (goal: LocalGoal) => goalEdits[goal.id] ?? {
    title: goal.title,
    outcome: goal.measurableOutcome,
    targetDate: goal.targetDate,
  };

  const saveEdits = async (goal: LocalGoal) => {
    const edit = currentEdit(goal);
    if (!edit.title.trim() || !edit.outcome.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(edit.targetDate)) {
      setError('Enter a goal title, measurable outcome, and target date (YYYY-MM-DD).');
      return;
    }
    setError('');
    try {
      await updateGoal(goal.id, {
        title: edit.title.trim(),
        description: edit.outcome.trim(),
        targetDate: edit.targetDate,
      });
      setNotice('Goal details revised and added to its history.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the goal.');
    }
  };

  const addMilestone = async (goalId: string) => {
    const text = milestoneDrafts[goalId]?.trim();
    if (!text) {
      setError('Write a milestone before adding it.');
      return;
    }
    setError('');
    try {
      await createMilestone(goalId, text);
      setMilestoneDrafts((previous) => ({ ...previous, [goalId]: '' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the milestone.');
    }
  };

  const toggleMilestoneStatus = async (goalId: string, milestoneId: string, status: 'pending' | 'completed') => {
    setError('');
    try {
      await updateMilestone(milestoneId, { status });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the milestone.');
    }
  };

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/dashboard" label="Back to previous page" />
      <PageHeading eyebrow="Small steps, real progress" title="Goals & milestones" subtitle="Agree on measurable outcomes, track steps together, and keep a history of changes." />
      {managementError ? (
        <View style={{ gap: 8 }}>
          <ErrorBanner message={managementError} />
          <AppButton title="Retry loading goals" variant="outline" compact loading={managementLoading} onPress={() => void refreshManagementData().catch(() => undefined)} />
        </View>
      ) : null}
      {managementLoading ? <Text style={{ color: AppColors.muted }}>Loading progress…</Text> : null}
      {!managementLoading && !managementError ? (
        <AppCard style={{ backgroundColor: '#EFF3E7' }}>
          <Text style={{ color: AppColors.forest, fontSize: 15, fontWeight: '800' }}>Progress from your records</Text>
          <Text style={{ color: AppColors.muted, fontSize: 13 }}>
            {activeGoals.length} active · {completedGoals} completed goals · {completedMilestones} of {milestones.length} milestones complete
          </Text>
          {milestones.length > 0 ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Completed milestones"
              accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
              style={{ height: 8, backgroundColor: '#D5DEC9', borderRadius: 9, overflow: 'hidden' }}>
              <View style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: AppColors.leaf }} />
            </View>
          ) : null}
        </AppCard>
      ) : null}
      {activeRelationships.length ? (
        <AppCard>
          <SectionTitle title="Create a measurable goal" />
          {activeRelationships.length > 1 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: AppColors.ink, fontSize: 14, fontWeight: '700' }}>Mentorship</Text>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {activeRelationships.map((relationship) => {
                  const name = otherParticipantName(relationship.id);
                  return (
                    <AppChoiceChip
                      key={relationship.id}
                      label={`${relationship.id === selectedRelationshipId ? 'Selected · ' : ''}${name}`}
                      selected={relationship.id === selectedRelationshipId}
                      onPress={() => setSelectedRelationship(relationship.id)}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}
          <AppField label="Goal title" value={title} onChangeText={setTitle} placeholder="e.g. Improve soil moisture retention" maxLength={160} />
          <AppField label="Measurable outcome" value={outcome} onChangeText={setOutcome} placeholder="How will you measure success?" multiline maxLength={2000} />
          <AppField label="Target date" value={targetDate} onChangeText={setTargetDate} placeholder="YYYY-MM-DD" />
          <AppButton title="Save goal" loading={busy} onPress={() => void saveGoal()} />
        </AppCard>
      ) : null}
      <View style={{ gap: 10 }}>
        <SectionTitle title="Goal history" />
        {managementLoading ? <Text style={{ color: AppColors.muted }}>Loading goals…</Text> : null}
        {!managementLoading && !managementError && !goals.length ? (
          <EmptyState title="No goals to show yet" body="Create a goal after accepting a mentorship. Goals and milestones are shared with that relationship's participants." />
        ) : null}
        {goals.map((goal) => {
          const edit = currentEdit(goal);
          const done = goal.milestones.filter((item) => item.status === 'completed').length;
          return (
            <AppCard key={goal.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <Text style={{ color: AppColors.ink, fontSize: 16, fontWeight: '800', flex: 1 }}>{goal.title}</Text>
                <Pill label={goal.status} tone={goal.status === 'completed' ? 'green' : goal.status === 'archived' ? 'gray' : 'orange'} />
              </View>
              <Text style={{ color: AppColors.muted, fontSize: 12 }}>Target: {goal.targetDate} · {done}/{goal.milestones.length} steps complete</Text>
              <Text style={{ color: AppColors.muted, fontSize: 12 }}>Mentorship with {otherParticipantName(goal.relationshipId)}</Text>
              <Text style={{ color: AppColors.ink, fontSize: 13, lineHeight: 19 }}>{goal.measurableOutcome}</Text>
              {goal.status !== 'archived' ? (
                <>
                  <AppField label="Revise goal title" value={edit.title} onChangeText={(value) => setGoalEdits((prev) => ({ ...prev, [goal.id]: { ...edit, title: value } }))} maxLength={160} />
                  <AppField label="Revise measurable outcome" value={edit.outcome} onChangeText={(value) => setGoalEdits((prev) => ({ ...prev, [goal.id]: { ...edit, outcome: value } }))} multiline maxLength={2000} />
                  <AppField label="Target date" value={edit.targetDate} onChangeText={(value) => setGoalEdits((prev) => ({ ...prev, [goal.id]: { ...edit, targetDate: value } }))} />
                  <AppButton title="Save revisions" compact variant="outline" onPress={() => void saveEdits(goal)} />
                </>
              ) : null}
              {goal.status !== 'archived' ? (
                <AppButton
                  title={goal.status === 'completed' ? 'Reopen goal' : 'Mark goal complete'}
                  compact
                  variant="secondary"
                  onPress={() => void updateGoal(goal.id, { status: goal.status === 'completed' ? 'active' : 'completed' })
                    .then(() => setNotice('Goal status updated.'))
                    .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not update goal status.'))}
                />
              ) : null}
              <SectionTitle title="Milestones" />
              {goal.milestones.map((milestone) => (
                <View key={milestone.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <AppButton
                    title={milestone.completed ? '✓' : '○'}
                    compact
                    variant={milestone.completed ? 'secondary' : 'outline'}
                    disabled={goal.status !== 'active'}
                    onPress={() => void toggleMilestoneStatus(goal.id, milestone.id, milestone.completed ? 'pending' : 'completed')}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: AppColors.ink, fontSize: 13, textDecorationLine: milestone.completed ? 'line-through' : 'none' }}>{milestone.title}</Text>
                    {milestone.completedAt ? <Text style={{ color: AppColors.muted, fontSize: 11 }}>Completed {new Date(milestone.completedAt).toLocaleDateString()}</Text> : null}
                  </View>
                </View>
              ))}
              {goal.status === 'active' ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <AppField label="Add milestone" value={milestoneDrafts[goal.id] ?? ''} onChangeText={(value) => setMilestoneDrafts((prev) => ({ ...prev, [goal.id]: value }))} placeholder="A measurable next step" />
                  </View>
                  <AppButton title="Add" compact variant="secondary" onPress={() => void addMilestone(goal.id)} />
                </View>
              ) : null}
              <SectionTitle title="Activity history" />
              {goal.history.map((event) => (
                <Text key={event.id} style={{ color: AppColors.muted, fontSize: 12 }}>
                  {event.type.replaceAll('_', ' ')} · {new Date(event.createdAt).toLocaleString()}
                </Text>
              ))}
            </AppCard>
          );
        })}
      </View>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Text style={{ color: AppColors.forest, fontSize: 13 }}>{notice}</Text> : null}
    </AppScreen>
  );
}
