import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import {
  AppBackButton,
  AppButton,
  AppCard,
  AppChoiceChip,
  AppColors,
  AppField,
  AppScreen,
  Avatar,
  EmptyState,
  ErrorBanner,
  PageHeading,
  Pill,
} from '@/components/app-ui';
import { StaffParticipant, StaffParticipantDetail, StaffProgramme } from '@/lib/auth-api';
import { APP_ROUTES } from '@/lib/app-routes';
import { useLocalApp } from '@/lib/local-app-context';

export default function ParticipantsScreen() {
  const { currentUser, listStaffProgrammes, listStaffParticipants, getStaffParticipant } = useLocalApp();
  const { assignStaffParticipant, updateStaffParticipantMembership } = useLocalApp();
  const [programmes, setProgrammes] = useState<StaffProgramme[]>([]);
  const [programmeId, setProgrammeId] = useState('');
  const [participants, setParticipants] = useState<StaffParticipant[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<StaffParticipantDetail | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | 'mentee' | 'mentor'>('all');
  const [status, setStatus] = useState<'active' | 'removed' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [programmesLoading, setProgrammesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');
  const [participantRole, setParticipantRole] = useState<'mentee' | 'mentor'>('mentee');
  const [membershipBusy, setMembershipBusy] = useState(false);

  const loadProgrammes = useCallback(async () => {
    setProgrammesLoading(true);
    setError('');
    try {
      const rows = await listStaffProgrammes();
      setProgrammes(rows);
      setProgrammeId((current) => rows.some((programme) => programme.id === current) ? current : rows[0]?.id ?? '');
      if (!rows.length) setLoading(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Assigned programmes could not be loaded.');
      setProgrammes([]);
      setProgrammeId('');
      setParticipants([]);
      setTotal(0);
      setSelectedParticipant(null);
      setLoading(false);
    } finally {
      setProgrammesLoading(false);
    }
  }, [listStaffProgrammes]);

  const loadParticipants = useCallback(async () => {
    if (!programmeId) {
      setParticipants([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError('');
    setParticipants([]);
    setTotal(0);
    setSelectedParticipant(null);
    setDetailError('');
    try {
      const result = await listStaffParticipants(programmeId, {
        q: search.trim() || undefined,
        role: role === 'all' ? undefined : role,
        status,
        page,
        pageSize: 20,
      });
      setParticipants(result.items);
      setTotal(result.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Participants could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [listStaffParticipants, page, programmeId, role, search, status]);

  useFocusEffect(useCallback(() => {
    if (currentUser?.role === 'staff') void loadProgrammes();
  }, [currentUser?.role, loadProgrammes]));

  useFocusEffect(useCallback(() => {
    if (currentUser?.role === 'staff' && programmeId) void loadParticipants();
  }, [currentUser?.role, loadParticipants, programmeId]));

  const openParticipant = async (participantId: string) => {
    setDetailLoading(true);
    setDetailError('');
    setSelectedParticipant(null);
    try {
      setSelectedParticipant(await getStaffParticipant(participantId));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Participant profile is unavailable.');
    } finally {
      setDetailLoading(false);
    }
  };

  const addParticipant = async () => {
    if (!programmeId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participantEmail.trim())) {
      setError('Enter the email address of an active Mentee or Mentor account.');
      return;
    }
    setMembershipBusy(true);
    setError('');
    try {
      await assignStaffParticipant(programmeId, { email: participantEmail.trim(), role: participantRole });
      setParticipantEmail('');
      await loadParticipants();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Participant could not be assigned.');
    } finally {
      setMembershipBusy(false);
    }
  };

  const setMembershipStatus = (participant: StaffParticipant, nextStatus: 'active' | 'removed') => {
    const action = nextStatus === 'removed' ? 'Remove' : 'Re-add';
    Alert.alert(`${action} ${participant.name}?`,
      nextStatus === 'removed'
        ? 'This removes programme access but does not close or delete the person’s account.'
        : 'This restores the person’s active membership in this programme.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: nextStatus === 'removed' ? 'destructive' : 'default',
          onPress: () => {
            setMembershipBusy(true);
            setError('');
            void updateStaffParticipantMembership(programmeId, participant.id, nextStatus)
              .then(() => loadParticipants())
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Membership could not be updated.'))
              .finally(() => setMembershipBusy(false));
          },
        },
      ]);
  };

  if (!currentUser || currentUser.role !== 'staff') return null;

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/dashboard" label="Back to previous page" />
      <PageHeading title="Programme participants" subtitle="Only memberships in programmes assigned to your account are shown." />
      {error ? <ErrorBanner message={error} /> : null}
      {error ? <AppButton title={programmes.length ? 'Retry loading participants' : 'Retry assigned programmes'} variant="outline" onPress={() => void (programmes.length ? loadParticipants() : loadProgrammes())} /> : null}
      {programmes.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: AppColors.ink, fontWeight: '800' }}>Assigned programme</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {programmes.map((programme) => (
              <AppChoiceChip
                key={programme.id}
                label={programme.name}
                selected={programme.id === programmeId}
                onPress={() => {
                  setPage(1);
                  setProgrammeId(programme.id);
                  setSelectedParticipant(null);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}
      {!programmesLoading && !error && !programmes.length ? (
        <EmptyState title="No assigned programmes" body="A trusted programme operator must assign a programme before participant records are available." />
      ) : null}
      {programmesLoading ? <Text style={{ color: AppColors.muted }}>Loading assigned programmes…</Text> : null}
      {programmeId ? (
        <>
          <AppCard>
            <Text style={{ color: AppColors.ink, fontSize: 16, fontWeight: '800' }}>Manage programme membership</Text>
            <Text style={{ color: AppColors.muted, fontSize: 12, lineHeight: 18 }}>Add an existing active account by email. This does not create an account or change its credentials.</Text>
            <AppField label="Participant email" value={participantEmail} onChangeText={setParticipantEmail} placeholder="person@example.org" autoCapitalize="none" keyboardType="email-address" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['mentee', 'mentor'] as const).map((value) => (
                <AppChoiceChip key={value} label={value === 'mentee' ? 'Mentee' : 'Mentor'} selected={participantRole === value} onPress={() => setParticipantRole(value)} />
              ))}
            </View>
            <AppButton title="Add to programme" loading={membershipBusy} onPress={() => void addParticipant()} />
          </AppCard>
          <AppButton
            title="View programme oversight"
            variant="secondary"
            onPress={() => router.push({ pathname: APP_ROUTES.programme, params: { programmeId } })}
          />
          <AppField label="Search participants" value={search} onChangeText={setSearch} placeholder="Name, location or profile text" returnKeyType="search" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['all', 'mentee', 'mentor'] as const).map((filter) => (
              <AppChoiceChip key={filter} label={filter === 'all' ? 'All roles' : filter} selected={role === filter} onPress={() => { setRole(filter); setPage(1); }} />
            ))}
            {(['active', 'removed', 'all'] as const).map((filter) => (
              <AppChoiceChip key={filter} label={filter === 'all' ? 'All memberships' : filter} selected={status === filter} onPress={() => { setStatus(filter); setPage(1); }} />
            ))}
          </View>
          <AppButton title="Search / refresh" variant="outline" compact loading={loading} onPress={() => void loadParticipants()} />
          {loading ? <Text style={{ color: AppColors.muted }}>Loading programme participants…</Text> : null}
          {!loading && !error && participants.length === 0 ? (
            <EmptyState title="No matching participants" body="There are no participants matching this programme and filter." />
          ) : null}
          {participants.map((participant) => (
            <AppCard key={participant.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={participant.name} imageUrl={participant.imageUrl} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: AppColors.ink, fontWeight: '800', fontSize: 15 }}>{participant.name}</Text>
                  <Text style={{ color: AppColors.muted, fontSize: 12 }}>{participant.role} · {participant.location || 'Location not provided'}</Text>
                </View>
                <Pill label={participant.membershipStatus} />
              </View>
              {participant.bio ? <Text style={{ color: AppColors.muted, lineHeight: 18 }}>{participant.bio}</Text> : null}
              {participant.membershipStatus === 'active' ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><AppButton title="View profile" variant="outline" compact onPress={() => void openParticipant(participant.id)} /></View>
                  <View style={{ flex: 1 }}><AppButton title="Remove" variant="danger" compact disabled={membershipBusy} onPress={() => setMembershipStatus(participant, 'removed')} /></View>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: AppColors.muted, fontSize: 12 }}>Profile details are available only for active programme memberships.</Text>
                  <AppButton title="Re-add to programme" variant="outline" compact disabled={membershipBusy} onPress={() => setMembershipStatus(participant, 'active')} />
                </View>
              )}
            </AppCard>
          ))}
          {selectedParticipant ? <ParticipantProfile participant={selectedParticipant} /> : null}
          {detailLoading ? <Text style={{ color: AppColors.muted }}>Loading participant profile…</Text> : null}
          {detailError ? <ErrorBanner message={detailError} /> : null}
          {total > 20 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <AppButton title="Previous" variant="outline" compact disabled={page <= 1} onPress={() => setPage((current) => current - 1)} />
              <Text style={{ alignSelf: 'center', color: AppColors.muted }}>Page {page} · {total} participants</Text>
              <AppButton title="Next" variant="outline" compact disabled={page * 20 >= total} onPress={() => setPage((current) => current + 1)} />
            </View>
          ) : null}
        </>
      ) : null}
    </AppScreen>
  );
}

function ParticipantProfile({ participant }: { participant: StaffParticipantDetail }) {
  return (
    <AppCard style={{ gap: 8, backgroundColor: '#EFF3E7' }}>
      <Text style={{ color: AppColors.forest, fontSize: 16, fontWeight: '900' }}>{participant.name}</Text>
      <Text style={{ color: AppColors.muted }}>{participant.role} · {participant.location || 'Location not provided'}</Text>
      {participant.bio ? <Text style={{ color: AppColors.ink, lineHeight: 19 }}>{participant.bio}</Text> : null}
      {participant.role === 'mentee' && participant.experienceLevel ? <Text style={{ color: AppColors.muted }}>Experience: {participant.experienceLevel}</Text> : null}
      {participant.role === 'mentor' && participant.experienceYears !== null ? <Text style={{ color: AppColors.muted }}>Experience: {participant.experienceYears} years</Text> : null}
      {participant.specialisation ? <Text style={{ color: AppColors.muted }}>Specialisation: {participant.specialisation}</Text> : null}
      {participant.interests.length ? <Text style={{ color: AppColors.muted }}>Interests: {participant.interests.join(', ')}</Text> : null}
      {participant.expertise.length ? <Text style={{ color: AppColors.muted }}>Expertise: {participant.expertise.join(', ')}</Text> : null}
      <Text style={{ color: AppColors.ink, fontWeight: '800' }}>Programme memberships</Text>
      {participant.programmes.map((programme) => (
        <Text key={programme.id} style={{ color: AppColors.muted }}>{programme.name} · {programme.membershipStatus}</Text>
      ))}
    </AppCard>
  );
}
