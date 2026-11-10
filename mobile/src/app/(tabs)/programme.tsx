import { Alert } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppChoiceChip, AppColors, AppField, AppScreen, EmptyState, ErrorBanner, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { ProgrammeMatchProposal, StaffParticipant, StaffProgrammeOversight } from '@/lib/auth-api';
import { useLocalApp } from '@/lib/local-app-context';
import { parseLocalDateTime } from '@/lib/session-date-time';

export default function ProgrammeOverviewScreen() {
  const params = useLocalSearchParams<{ programmeId?: string | string[] }>();
  const programmeId = Array.isArray(params.programmeId) ? params.programmeId[0] : params.programmeId;
  const {
    currentUser,
    getStaffProgrammeOversight,
    listStaffParticipants,
    listStaffMatchProposals,
    createStaffMatchProposal,
    withdrawStaffMatchProposal,
    createStaffProgrammeSession,
  } = useLocalApp();
  const [overview, setOverview] = useState<StaffProgrammeOversight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [matchError, setMatchError] = useState('');
  const [mentees, setMentees] = useState<StaffParticipant[]>([]);
  const [mentors, setMentors] = useState<StaffParticipant[]>([]);
  const [proposals, setProposals] = useState<ProgrammeMatchProposal[]>([]);
  const [selectedMenteeId, setSelectedMenteeId] = useState('');
  const [selectedMentorId, setSelectedMentorId] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionDateTime, setSessionDateTime] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [selectedRelationshipId, setSelectedRelationshipId] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const load = useCallback(async () => {
    if (!programmeId) {
      setError('Choose an assigned programme to view its oversight.');
      setOverview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setOverview(null);
    try {
      setOverview(await getStaffProgrammeOversight(programmeId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Programme oversight could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [getStaffProgrammeOversight, programmeId]);

  const loadMatchWorkspace = useCallback(async () => {
    if (!programmeId) return;
    setMatchError('');
    try {
      const [menteePage, mentorPage, nextProposals] = await Promise.all([
        listStaffParticipants(programmeId, { role: 'mentee', status: 'active', pageSize: 50 }),
        listStaffParticipants(programmeId, { role: 'mentor', status: 'active', pageSize: 50 }),
        listStaffMatchProposals(programmeId),
      ]);
      setMentees(menteePage.items);
      setMentors(mentorPage.items);
      setProposals(nextProposals);
      setSelectedMenteeId((current) => menteePage.items.some((item) => item.id === current) ? current : '');
      setSelectedMentorId((current) => mentorPage.items.some((item) => item.id === current) ? current : '');
    } catch (cause) {
      setMatchError(cause instanceof Error ? cause.message : 'Match coordination is unavailable.');
    }
  }, [listStaffMatchProposals, listStaffParticipants, programmeId]);

  useFocusEffect(useCallback(() => {
    if (currentUser?.role === 'staff') {
      void load();
      void loadMatchWorkspace();
    }
  }, [currentUser?.role, load, loadMatchWorkspace]));

  const selectedMentee = mentees.find((participant) => participant.id === selectedMenteeId);
  const selectedMentor = mentors.find((participant) => participant.id === selectedMentorId);
  const openProposals = proposals.filter((proposal) => ['proposed', 'awaiting_mentor', 'awaiting_mentee'].includes(proposal.status));

  const proposeMatch = async () => {
    if (!programmeId || !selectedMentee || !selectedMentor) return;
    if (selectedMentor.maxActiveMentees !== null
      && selectedMentor.activeMentees >= selectedMentor.maxActiveMentees) {
      setMatchError('This Mentor has no available capacity. Choose another Mentor.');
      return;
    }
    setProposalBusy(true);
    setMatchError('');
    try {
      await createStaffMatchProposal(programmeId, { menteeId: selectedMentee.id, mentorId: selectedMentor.id });
      await loadMatchWorkspace();
    } catch (cause) {
      setMatchError(cause instanceof Error ? cause.message : 'Match proposal could not be created.');
    } finally {
      setProposalBusy(false);
    }
  };

  const scheduleSession = async () => {
    const date = parseLocalDateTime(sessionDateTime);
    if (!programmeId || !sessionTitle.trim() || !date || date.getTime() <= Date.now() || !selectedRelationshipId) {
      setMatchError('Choose an active programme relationship, enter a title, and choose a future date/time.');
      return;
    }
    setSessionBusy(true);
    setMatchError('');
    try {
      await createStaffProgrammeSession(programmeId, {
        relationshipId: selectedRelationshipId,
        title: sessionTitle.trim(),
        scheduledAt: date.toISOString(),
        preparationNotes: sessionNotes.trim(),
      });
      setSessionTitle('');
      setSessionDateTime('');
      setSessionNotes('');
      await load();
    } catch (cause) {
      setMatchError(cause instanceof Error ? cause.message : 'Session could not be scheduled.');
    } finally {
      setSessionBusy(false);
    }
  };

  const confirmWithdraw = (proposal: ProgrammeMatchProposal) => {
    Alert.alert('Withdraw this proposal?', 'Neither participant will be able to accept it after withdrawal.', [
      { text: 'Keep proposal', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: () => {
          setProposalBusy(true);
          void withdrawStaffMatchProposal(proposal.programmeId, proposal.id)
            .then(() => loadMatchWorkspace())
            .catch((cause: unknown) => setMatchError(cause instanceof Error ? cause.message : 'Proposal could not be withdrawn.'))
            .finally(() => setProposalBusy(false));
        },
      },
    ]);
  };

  if (!currentUser || currentUser.role !== 'staff') return null;

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/participants" label="Back to previous page" />
      <PageHeading
        title={overview?.programme.name ?? 'Programme overview'}
        subtitle={overview?.programme.description || 'Read-only oversight within your assigned programme scope.'}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {error ? <AppButton title="Retry programme overview" variant="outline" loading={loading} onPress={() => void load()} /> : null}
      {loading ? <Text style={{ color: AppColors.muted }}>Loading programme records…</Text> : null}
      {overview ? (
        <>
          <SectionTitle title="Coordinate a mentorship match" />
          <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>
            Proposals are sent to both participants. A mentorship starts only after the assigned Mentee and Mentor both accept.
          </Text>
          {matchError ? <ErrorBanner message={matchError} /> : null}
          <AppCard style={{ gap: 8 }}>
            <Text style={{ color: AppColors.ink, fontWeight: '800' }}>Mentee</Text>
            {mentees.map((mentee) => (
              <AppChoiceChip
                key={mentee.id}
                label={`${mentee.name} · ${mentee.interests.join(', ') || mentee.location || 'Needs not listed'}`}
                selected={mentee.id === selectedMenteeId}
                onPress={() => setSelectedMenteeId(mentee.id)}
              />
            ))}
            {selectedMentee ? <Text style={{ color: AppColors.muted, fontSize: 12 }}>Needs: {selectedMentee.bio || 'Not provided'} · Experience: {selectedMentee.experience || 'Not provided'}</Text> : null}
            <Text style={{ color: AppColors.ink, fontWeight: '800' }}>Mentor</Text>
            {mentors.map((mentor) => (
              <AppChoiceChip
                key={mentor.id}
                label={`${mentor.name} · ${mentor.expertise.join(', ') || mentor.specialisation || 'Expertise not listed'} · ${mentor.maxActiveMentees === null ? `${mentor.activeMentees} active, no set limit` : `${mentor.activeMentees}/${mentor.maxActiveMentees} active`}`}
                selected={mentor.id === selectedMentorId}
                onPress={() => setSelectedMentorId(mentor.id)}
              />
            ))}
            {selectedMentor?.availabilityNote ? <Text style={{ color: AppColors.muted, fontSize: 12 }}>Availability: {selectedMentor.availabilityNote}</Text> : null}
            <AppButton title="Propose match" loading={proposalBusy} disabled={!selectedMentee || !selectedMentor} onPress={() => void proposeMatch()} />
          </AppCard>
          <SectionTitle title="Match proposals" />
          {openProposals.length ? openProposals.map((proposal) => (
            <AppCard key={proposal.id} style={{ gap: 7 }}>
              <Text style={{ color: AppColors.ink, fontWeight: '800' }}>{proposal.menteeName} ↔ {proposal.mentorName}</Text>
              <Pill label={proposal.status.replaceAll('_', ' ')} tone="orange" />
              <Text style={{ color: AppColors.muted, fontSize: 12 }}>Mentee: {proposal.menteeResponse} · Mentor: {proposal.mentorResponse}</Text>
              <AppButton title="Withdraw proposal" variant="danger" compact disabled={proposalBusy} onPress={() => confirmWithdraw(proposal)} />
            </AppCard>
          )) : <EmptyState title="No open proposals" body="New proposals appear here until both participants accept or either declines." />}
          <SectionTitle title="Coordinate a session" />
          {(() => {
            const activeRelationships = overview.relationships.filter((relationship) => relationship.status === 'active');
            return activeRelationships.length ? (
              <AppCard style={{ gap: 8 }}>
                <Text style={{ color: AppColors.ink, fontWeight: '800' }}>Active programme relationship</Text>
                {activeRelationships.map((relationship) => (
                  <AppChoiceChip
                    key={String(relationship.id)}
                    label={`${relationship.menteeName} ↔ ${relationship.mentorName}`}
                    selected={String(relationship.id) === selectedRelationshipId}
                    onPress={() => setSelectedRelationshipId(String(relationship.id))}
                  />
                ))}
                <AppField label="Session title" value={sessionTitle} onChangeText={setSessionTitle} placeholder="e.g. Field visit" maxLength={160} />
                <AppField label="Date and time" value={sessionDateTime} onChangeText={setSessionDateTime} placeholder="YYYY-MM-DD HH:mm" hint="Local time. Both participants will confirm attendance." />
                <AppField label="Preparation notes" value={sessionNotes} onChangeText={setSessionNotes} placeholder="Topics or preparation" multiline maxLength={2000} />
                <AppButton title="Schedule for both participants" loading={sessionBusy} disabled={!selectedRelationshipId} onPress={() => void scheduleSession()} />
              </AppCard>
            ) : <EmptyState title="No active relationships" body="A session can be coordinated after both participants accept a match." />;
          })()}
          <SectionTitle title="Mentorship requests" />
          {overview.requests.length ? overview.requests.map((request) => (
            <OversightCard
              key={String(request.id)}
              title={`${String(request.menteeName)} ↔ ${String(request.mentorName)}`}
              detail={`Request received ${dateLabel(request.createdAt)}.`}
              status={String(request.status)}
            />
          )) : <EmptyState title="No programme requests" body="Requests between currently assigned programme participants will appear here." />}

          <SectionTitle title="Mentorship relationships" />
          {overview.relationships.length ? overview.relationships.map((relationship) => (
            <OversightCard
              key={String(relationship.id)}
              title={`${String(relationship.menteeName)} ↔ ${String(relationship.mentorName)}`}
              detail={`Started ${dateLabel(relationship.startedAt)}${relationship.endedAt ? ` · ended ${dateLabel(relationship.endedAt)}` : ''}.`}
              status={String(relationship.status)}
            />
          )) : <EmptyState title="No programme relationships" body="Shared relationships require both participants to have an active membership in this programme." />}

          <SectionTitle title="Sessions" />
          {overview.sessions.length ? overview.sessions.map((session) => (
            <OversightCard
              key={String(session.id)}
              title={String(session.title)}
              detail={`${String(session.menteeName)} with ${String(session.mentorName)} · ${dateLabel(session.scheduledAt)}.`}
              status={String(session.status)}
            />
          )) : <EmptyState title="No sessions recorded" body="Sessions within assigned programme relationships will appear here." />}

          <SectionTitle title="Goals and milestones" />
          {overview.goals.length ? overview.goals.map((goal) => (
            <AppCard key={String(goal.id)} style={{ gap: 7 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: AppColors.ink, fontWeight: '800', flex: 1 }}>{String(goal.title)}</Text>
                <Pill label={String(goal.status)} />
              </View>
              <Text style={{ color: AppColors.muted }}>{String(goal.menteeName)} with {String(goal.mentorName)} · target {dateLabel(goal.targetDate)}</Text>
              <Text style={{ color: AppColors.ink }}>{String(goal.measurableOutcome)}</Text>
              {(Array.isArray(goal.milestones) ? goal.milestones : []).map((milestone) => {
                if (!milestone || typeof milestone !== 'object') return null;
                const item = milestone as Record<string, unknown>;
                return (
                  <Text key={String(item.id)} style={{ color: AppColors.muted }}>
                    • {String(item.title)} · {String(item.status)}
                  </Text>
                );
              })}
            </AppCard>
          )) : <EmptyState title="No goals recorded" body="Goals and milestones in assigned relationships will appear here." />}

          <AppButton title="View programme participants" variant="outline" onPress={() => router.push('/(tabs)/participants')} />
        </>
      ) : null}
    </AppScreen>
  );
}

function OversightCard({ title, detail, status }: { title: string; detail: string; status: string }) {
  return (
    <AppCard style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: AppColors.ink, fontWeight: '800', flex: 1 }}>{title}</Text>
        <Pill label={status} />
      </View>
      <Text style={{ color: AppColors.muted, fontSize: 13 }}>{detail}</Text>
    </AppCard>
  );
}

function dateLabel(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : date.toLocaleDateString();
}
