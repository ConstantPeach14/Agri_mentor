import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppChoiceChip, AppColors, AppField, AppScreen, EmptyState, ErrorBanner, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { useLocalApp } from '@/lib/local-app-context';
import { localDateTime, parseLocalDateTime } from '@/lib/session-date-time';
import { LocalSession } from '@/lib/local-data';

export default function SessionsScreen() {
  const {
    data,
    currentUser,
    createSession,
    updateSession,
    updateSessionStatus,
    managementLoading,
    managementError,
    refreshManagementData,
    currentTime,
  } = useLocalApp();
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [preparationNotes, setPreparationNotes] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, { title: string; scheduledAt: string; preparationNotes: string }>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    void refreshManagementData().catch(() => undefined);
  }, [refreshManagementData]));
  if (!currentUser) return null;

  const allRelationships = data.mentorships.filter(
    (item) => item.menteeId === currentUser.id || item.mentorId === currentUser.id,
  );
  const relationships = allRelationships.filter((item) => item.status === 'active');
  const relationshipIds = new Set(allRelationships.map((item) => item.id));
  const selectedRelationshipId = relationships.some((item) => item.id === selectedRelationship)
    ? selectedRelationship
    : relationships[0]?.id;
  const sessions = data.sessions.filter((session) => relationshipIds.has(session.relationshipId))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const upcoming = sessions.filter((session) => session.status === 'scheduled'
    && new Date(session.scheduledAt).getTime() >= currentTime);
  const history = sessions.filter((session) => session.status !== 'scheduled'
    || new Date(session.scheduledAt).getTime() < currentTime);

  const otherParticipantName = (relationshipId: string) => {
    const relationship = allRelationships.find((item) => item.id === relationshipId);
    if (!relationship) return '';
    return relationship.menteeId === currentUser.id ? relationship.mentor.name : relationship.mentee.name;
  };

  const save = async () => {
    setError('');
    setNotice('');
    const date = parseLocalDateTime(scheduledAt);
    if (!title.trim() || !date) {
      setError('Enter a session title and date/time in YYYY-MM-DD HH:mm format.');
      return;
    }
    if (date.getTime() <= Date.now()) {
      setError('Choose a future date and time for a session.');
      return;
    }
    if (!selectedRelationshipId) {
      setError('You need an active mentorship before scheduling a session.');
      return;
    }
    setBusy(true);
    try {
      await createSession({
        title: title.trim(),
        scheduledAt: date.toISOString(),
        notes: preparationNotes.trim(),
      }, selectedRelationshipId);
      setTitle('');
      setScheduledAt('');
      setPreparationNotes('');
      setNotice('Session scheduled for both participants.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not schedule the session.');
    } finally {
      setBusy(false);
    }
  };

  const editFor = (session: LocalSession) => edits[session.id] ?? {
    title: session.title,
    scheduledAt: localDateTime(session.scheduledAt),
    preparationNotes: session.preparationNotes,
  };

  const saveEdits = async (session: LocalSession) => {
    const edit = editFor(session);
    const date = parseLocalDateTime(edit.scheduledAt);
    if (!edit.title.trim() || !date || date.getTime() <= Date.now()) {
      setError('Use a future date/time in YYYY-MM-DD HH:mm format and a non-empty session title.');
      return;
    }
    setError('');
    try {
      await updateSession(session.id, {
        title: edit.title.trim(),
        scheduledAt: date.toISOString(),
        preparationNotes: edit.preparationNotes.trim(),
      });
      setNotice('Session details updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the session.');
    }
  };

  const finish = async (session: LocalSession) => {
    setError('');
    try {
      await updateSession(session.id, {
        outcomeNotes: outcomes[session.id] ?? session.outcomeNotes,
        status: 'completed',
      });
      setNotice('Session completed and outcome saved to its history.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the session.');
    }
  };

  const cancel = async (session: LocalSession) => {
    setError('');
    try {
      await updateSessionStatus(session.id, 'cancelled');
      setNotice('Session cancelled.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not cancel the session.');
    }
  };

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/dashboard" label="Back to previous page" />
      <PageHeading eyebrow="Time to connect" title="Mentorship sessions" subtitle="Schedule conversations, keep preparation notes, and record outcomes for both participants." />
      {managementError ? (
        <View style={{ gap: 8 }}>
          <ErrorBanner message={managementError} />
          <AppButton title="Retry loading sessions" variant="outline" compact loading={managementLoading} onPress={() => void refreshManagementData().catch(() => undefined)} />
        </View>
      ) : null}
      {relationships.length ? (
        <AppCard>
          <SectionTitle title="Plan a session" />
          {relationships.length > 1 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: AppColors.ink, fontSize: 14, fontWeight: '700' }}>Mentorship</Text>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {relationships.map((relationship) => {
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
          <AppField label="Session title" value={title} onChangeText={setTitle} placeholder="e.g. Review irrigation plan" maxLength={160} />
          <AppField label="Date and time" value={scheduledAt} onChangeText={setScheduledAt} placeholder="2026-12-10 14:30" hint="Use local time in YYYY-MM-DD HH:mm format." autoCapitalize="none" />
          <AppField label="Preparation notes" value={preparationNotes} onChangeText={setPreparationNotes} placeholder="Topics to discuss or preparation needed" multiline maxLength={2000} />
          <AppButton title="Schedule session" loading={busy} onPress={() => void save()} />
        </AppCard>
      ) : null}
      <View style={{ gap: 10 }}>
        <SectionTitle title="Upcoming sessions" />
        {managementLoading ? <Text style={{ color: AppColors.muted }}>Loading sessions…</Text> : null}
        {!managementLoading && !managementError && !upcoming.length ? (
          <EmptyState title="No upcoming sessions" body="Schedule a session from an active mentorship. Both participants can see its details." />
        ) : null}
        {upcoming.map((session) => {
          const edit = editFor(session);
          return (
            <AppCard key={session.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <Text style={{ color: AppColors.ink, fontSize: 16, fontWeight: '800', flex: 1 }}>{session.title}</Text>
                <Pill label="Scheduled" tone="orange" />
              </View>
              <Text style={{ color: AppColors.muted, fontSize: 13 }}>{new Date(session.scheduledAt).toLocaleString()}</Text>
              <Text style={{ color: AppColors.muted, fontSize: 12 }}>With {otherParticipantName(session.relationshipId)}</Text>
              {session.preparationNotes ? <Text style={{ color: AppColors.ink, fontSize: 13, lineHeight: 19 }}>{session.preparationNotes}</Text> : null}
              <AppField label="Update title" value={edit.title} onChangeText={(value) => setEdits((prev) => ({ ...prev, [session.id]: { ...edit, title: value } }))} maxLength={160} />
              <AppField label="Update date/time" value={edit.scheduledAt} onChangeText={(value) => setEdits((prev) => ({ ...prev, [session.id]: { ...edit, scheduledAt: value } }))} autoCapitalize="none" />
              <AppField label="Preparation notes" value={edit.preparationNotes} onChangeText={(value) => setEdits((prev) => ({ ...prev, [session.id]: { ...edit, preparationNotes: value } }))} multiline maxLength={2000} />
              <AppField
                label="Session outcomes"
                value={outcomes[session.id] ?? session.outcomeNotes}
                onChangeText={(value) => setOutcomes((prev) => ({ ...prev, [session.id]: value }))}
                placeholder="Record decisions, results, or next actions"
                multiline
                maxLength={4000}
              />
              <AppButton title="Save changes" compact variant="outline" onPress={() => void saveEdits(session)} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><AppButton title="Complete" compact variant="secondary" onPress={() => void finish(session)} /></View>
                <View style={{ flex: 1 }}><AppButton title="Cancel session" compact variant="danger" onPress={() => void cancel(session)} /></View>
              </View>
            </AppCard>
          );
        })}
      </View>
      <View style={{ gap: 10 }}>
        <SectionTitle title="Session history & follow-up" />
        {!managementLoading && !managementError && !history.length ? (
          <EmptyState title="No past sessions yet" body="Completed, cancelled, and past-due scheduled sessions appear here." />
        ) : null}
        {history.map((session) => {
          const needsResolution = session.status === 'scheduled'
            && new Date(session.scheduledAt).getTime() < currentTime;
          return (
          <AppCard key={session.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: AppColors.ink, fontSize: 16, fontWeight: '800', flex: 1 }}>{session.title}</Text>
              <Pill label={session.status} tone={session.status === 'completed' ? 'green' : 'gray'} />
            </View>
            <Text style={{ color: AppColors.muted, fontSize: 13 }}>{new Date(session.scheduledAt).toLocaleString()}</Text>
            <Text style={{ color: AppColors.muted, fontSize: 12 }}>With {otherParticipantName(session.relationshipId)}</Text>
            {session.preparationNotes ? <Text style={{ color: AppColors.ink, fontSize: 13 }}>Preparation: {session.preparationNotes}</Text> : null}
            {session.outcomeNotes ? <Text style={{ color: AppColors.ink, fontSize: 13, lineHeight: 19 }}>Outcome: {session.outcomeNotes}</Text> : null}
            {needsResolution ? (
              <>
                <Text style={{ color: AppColors.orange, fontSize: 13, lineHeight: 19 }}>
                  This session time has passed. Confirm whether it took place or cancel it; it has not been completed automatically.
                </Text>
                <AppField
                  label="Session outcomes"
                  value={outcomes[session.id] ?? session.outcomeNotes}
                  onChangeText={(value) => setOutcomes((previous) => ({ ...previous, [session.id]: value }))}
                  placeholder="Record decisions, results, or next actions"
                  multiline
                  maxLength={4000}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><AppButton title="Mark completed" compact variant="secondary" onPress={() => void finish(session)} /></View>
                  <View style={{ flex: 1 }}><AppButton title="Cancel session" compact variant="danger" onPress={() => void cancel(session)} /></View>
                </View>
              </>
            ) : null}
          </AppCard>
          );
        })}
      </View>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Text style={{ color: AppColors.forest, fontSize: 13 }}>{notice}</Text> : null}
      <Text style={{ color: AppColors.muted, fontSize: 11, lineHeight: 16 }}>Avoid including sensitive personal information in session notes.</Text>
    </AppScreen>
  );
}
