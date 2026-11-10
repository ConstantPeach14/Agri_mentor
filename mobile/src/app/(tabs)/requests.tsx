import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppColors, AppScreen, Avatar, EmptyState, ErrorBanner, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { MentorshipRequest, RequestStatus } from '@/lib/local-data';
import { ProgrammeMatchProposal } from '@/lib/auth-api';
import { useLocalApp } from '@/lib/local-app-context';

function statusTone(status: RequestStatus): 'green' | 'orange' | 'gray' | 'red' {
  if (status === 'accepted') return 'green';
  if (status === 'pending') return 'orange';
  if (status === 'declined') return 'red';
  return 'gray';
}

export default function RequestsScreen() {
  const {
    data,
    currentUser,
    updateRequest,
    mentorshipLoading,
    mentorshipError,
    refreshMentorshipData,
    listMatchProposals,
    respondToMatchProposal,
  } = useLocalApp();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProgrammeMatchProposal[]>([]);
  const [proposalError, setProposalError] = useState('');
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const refreshProposals = useCallback(async () => {
    setProposalError('');
    try {
      setProposals(await listMatchProposals());
    } catch (cause) {
      setProposalError(cause instanceof Error ? cause.message : 'Match proposals could not be loaded.');
    }
  }, [listMatchProposals]);
  useFocusEffect(useCallback(() => {
    void refreshMentorshipData().catch(() => undefined);
    void refreshProposals();
  }, [refreshMentorshipData, refreshProposals]));
  if (!data || !currentUser) return null;

  const requests = data.requests
    .filter((request) => currentUser.role === 'mentor' ? request.mentorId === currentUser.id : request.menteeId === currentUser.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const respond = async (request: MentorshipRequest, status: Extract<RequestStatus, 'accepted' | 'declined' | 'cancelled'>) => {
    setNotice('');
    setError('');
    setUpdatingId(request.id);
    try {
      await updateRequest(request.id, status);
      setNotice(status === 'accepted' ? 'Request accepted. An active mentorship has been created.' : `Request ${status}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the request.');
    } finally {
      setUpdatingId(null);
    }
  };

  const respondToProposal = async (proposalId: string, response: 'accepted' | 'declined') => {
    setProposalBusyId(proposalId);
    setProposalError('');
    try {
      await respondToMatchProposal(proposalId, response);
      await Promise.all([refreshProposals(), refreshMentorshipData()]);
    } catch (cause) {
      setProposalError(cause instanceof Error ? cause.message : 'Match response could not be saved.');
    } finally {
      setProposalBusyId(null);
    }
  };

  const openProposals = proposals.filter((proposal) => ['proposed', 'awaiting_mentor', 'awaiting_mentee'].includes(proposal.status));

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/dashboard" label="Back to previous page" />
      <PageHeading
        eyebrow="Mentorship connections"
        title={currentUser.role === 'mentor' ? 'Incoming requests' : 'Your requests'}
        subtitle={currentUser.role === 'mentor'
          ? 'Review each request and decide whether you can support this mentee.'
          : 'Follow each request from your first message to a new connection.'}
      />
      <SectionTitle title="Programme match proposals" />
      {proposalError ? (
        <View style={{ gap: 8 }}>
          <ErrorBanner message={proposalError} />
          <AppButton title="Reload match proposals" variant="outline" compact onPress={() => void refreshProposals()} />
        </View>
      ) : null}
      {!proposalError && !openProposals.length ? (
        <Text style={{ color: AppColors.muted, fontSize: 13 }}>Programme Staff proposals for your account will appear here.</Text>
      ) : null}
      {openProposals.map((proposal) => {
        const myResponse = currentUser.role === 'mentee' ? proposal.menteeResponse : proposal.mentorResponse;
        const otherResponse = currentUser.role === 'mentee' ? proposal.mentorResponse : proposal.menteeResponse;
        const otherName = currentUser.role === 'mentee' ? proposal.mentorName : proposal.menteeName;
        return (
          <AppCard key={proposal.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: AppColors.ink, fontWeight: '800', flex: 1 }}>{otherName}</Text>
              <Pill label={proposal.status.replaceAll('_', ' ')} tone="orange" />
            </View>
            {currentUser.role === 'mentee' ? (
              <>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>Expertise: {proposal.mentorExpertise.join(', ') || proposal.mentorSpecialisation}</Text>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>Availability: {proposal.mentorAvailability || 'Not provided'}</Text>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>Capacity: {proposal.mentorActiveMentees} active{proposal.mentorCapacity === null ? '' : ` of ${proposal.mentorCapacity}`}</Text>
              </>
            ) : (
              <>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>Interests: {proposal.menteeInterests.join(', ') || 'Not provided'}</Text>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>Needs: {proposal.menteeNeeds || 'Not provided'}</Text>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>Experience: {proposal.menteeExperience || 'Not provided'}</Text>
              </>
            )}
            <Text style={{ color: AppColors.muted, fontSize: 12 }}>
              Your response: {myResponse} · Other participant: {otherResponse}
            </Text>
            {myResponse === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><AppButton title="Accept match" compact loading={proposalBusyId === proposal.id} disabled={!!proposalBusyId} onPress={() => void respondToProposal(proposal.id, 'accepted')} /></View>
                <View style={{ flex: 1 }}><AppButton title="Decline" variant="danger" compact disabled={!!proposalBusyId} onPress={() => void respondToProposal(proposal.id, 'declined')} /></View>
              </View>
            ) : null}
          </AppCard>
        );
      })}
      {notice ? <AppCard style={{ backgroundColor: '#EFF3E7' }}><Text style={{ color: AppColors.forest, fontSize: 13 }}>{notice}</Text></AppCard> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {mentorshipError ? (
        <View style={{ gap: 8 }}>
          <ErrorBanner message={mentorshipError} />
          <AppButton title="Reload requests" variant="outline" compact onPress={() => void refreshMentorshipData().catch(() => undefined)} />
        </View>
      ) : null}
      {mentorshipLoading && !requests.length ? <ActivityIndicator accessibilityLabel="Loading requests" color={AppColors.forest} /> : null}
      {!mentorshipLoading && !mentorshipError && !requests.length ? (
        <EmptyState title="No requests yet" body={currentUser.role === 'mentor' ? 'New mentee requests will appear here.' : 'When you contact a mentor, your request and status will show here.'} />
      ) : requests.map((request) => {
        const other = currentUser.role === 'mentor' ? request.mentee : request.mentor;
        return (
          <AppCard key={request.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Avatar name={other.name} imageUrl={other.imageUrl} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: AppColors.ink, fontSize: 15, fontWeight: '800' }}>{other.name}</Text>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>
                  {currentUser.role === 'mentor' ? 'Mentee' : other.specialisation || 'Mentor'}
                  {other.location ? ` · ${other.location}` : ''}
                </Text>
              </View>
              <Pill label={request.status} tone={statusTone(request.status)} />
            </View>
            <SectionTitle title="Personal message" />
            <Text style={{ color: AppColors.ink, fontSize: 14, lineHeight: 21 }}>{request.message}</Text>
            {request.needs ? <Detail label="Needs" value={request.needs} /> : null}
            {request.interests ? <Detail label="Agricultural interests" value={request.interests} /> : null}
            {request.goals ? <Detail label="Mentorship goals" value={request.goals} /> : null}
            {currentUser.role === 'mentor' && request.mentee.interests?.length ? (
              <View style={{ gap: 5 }}>
                <Text style={{ color: AppColors.ink, fontSize: 12, fontWeight: '800' }}>Mentee interests</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {request.mentee.interests.map((interest) => <Pill key={interest} label={interest} tone="gray" />)}
                </View>
              </View>
            ) : null}
            {currentUser.role === 'mentor' && request.mentee.experience ? <Detail label="Experience" value={request.mentee.experience} /> : null}
            <Text style={{ color: AppColors.muted, fontSize: 11 }}>
              Sent {new Date(request.createdAt).toLocaleDateString()}
              {request.respondedAt ? ` · Updated ${new Date(request.respondedAt).toLocaleDateString()}` : ''}
            </Text>
            {request.status === 'pending' ? (
              currentUser.role === 'mentor' ? (
                <View style={{ flexDirection: 'row', gap: 9 }}>
                  <View style={{ flex: 1 }}>
                    <AppButton title="Accept" compact loading={updatingId === request.id} disabled={!!updatingId} onPress={() => void respond(request, 'accepted')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton title="Decline" variant="danger" compact disabled={!!updatingId} onPress={() => void respond(request, 'declined')} />
                  </View>
                </View>
              ) : <AppButton title="Cancel request" variant="outline" compact loading={updatingId === request.id} disabled={!!updatingId} onPress={() => void respond(request, 'cancelled')} />
            ) : request.status === 'accepted' ? (
              <Text style={{ color: AppColors.forest, fontSize: 12, fontWeight: '700' }}>An active mentorship is available in My matches.</Text>
            ) : null}
          </AppCard>
        );
      })}
    </AppScreen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: AppColors.ink, fontSize: 12, fontWeight: '800' }}>{label}</Text>
      <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>{value}</Text>
    </View>
  );
}
