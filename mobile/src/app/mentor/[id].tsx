import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppColors, AppField, AppScreen, Avatar, ErrorBanner, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { MentorDirectoryProfile } from '@/lib/auth-api';
import { useLocalApp } from '@/lib/local-app-context';

export default function MentorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, currentUser, loading, mentorshipLoading, getMentor, sendRequest } = useLocalApp();
  const [mentorResult, setMentorResult] = useState<{
    id: string;
    mentor: MentorDirectoryProfile | null;
    error: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [needs, setNeeds] = useState('');
  const [interests, setInterests] = useState('');
  const [goals, setGoals] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || currentUser?.role !== 'mentee') return;
    let active = true;
    getMentor(id)
      .then((result) => {
        if (active) setMentorResult({ id, mentor: result, error: '' });
      })
      .catch((cause: unknown) => {
        if (active) {
          setMentorResult({
            id,
            mentor: null,
            error: cause instanceof Error ? cause.message : 'Mentor profile could not be loaded.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [currentUser?.role, getMentor, id, loading]);

  if (loading) return null;
  if (currentUser?.role !== 'mentee') return <Redirect href={currentUser ? '/(tabs)/dashboard' : '/(auth)/welcome'} />;
  if (!mentorResult || mentorResult.id !== id) {
    return <AppScreen><AppBackButton fallbackRoute="/(tabs)/discover" label="Back to mentors" /><ActivityIndicator accessibilityLabel="Loading mentor profile" color={AppColors.forest} /></AppScreen>;
  }
  const mentor = mentorResult.mentor;
  const loadError = mentorResult.error;
  if (loadError || !mentor) {
    return (
      <AppScreen>
        <AppBackButton fallbackRoute="/(tabs)/discover" label="Back to mentors" />
        <PageHeading title="Mentor profile unavailable" subtitle={loadError || 'This mentor is no longer available.'} />
        <ErrorBanner message={loadError || 'This mentor is no longer available.'} />
      </AppScreen>
    );
  }

  const existingRequest = data.requests.find(
    (request) => request.menteeId === currentUser.id && request.mentorId === mentor.id && request.status === 'pending',
  );
  const active = data.mentorships.some(
    (relationship) => relationship.menteeId === currentUser.id && relationship.mentorId === mentor.id && relationship.status === 'active',
  );
  const submit = async () => {
    setError('');
    setNotice('');
    if (!message.trim()) {
      setError('Add a short personal message for the mentor.');
      return;
    }
    setBusy(true);
    try {
      await sendRequest({
        mentorId: mentor.id,
        message: message.trim(),
        needs: needs.trim(),
        interests: interests.trim(),
        goals: goals.trim(),
      });
      setNotice('Your request has been sent.');
      setMessage('');
      setNeeds('');
      setInterests('');
      setGoals('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/discover" label="Back to mentors" />
      <AppCard style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Avatar name={mentor.name} size={82} imageUrl={mentor.imageUrl} />
        <Text style={{ color: AppColors.ink, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{mentor.name}</Text>
        <Text style={{ color: AppColors.muted, fontSize: 14, textAlign: 'center' }}>{mentor.specialisation || 'Agricultural mentor'}</Text>
        {mentor.location ? <Text style={{ color: AppColors.muted, fontSize: 13 }}>{mentor.location}</Text> : null}
        {mentor.availabilityNote ? <Text style={{ color: AppColors.muted, fontSize: 13 }}>{mentor.availabilityNote}</Text> : null}
        <Pill
          label={mentor.availableSlots === null
            ? 'Open to requests'
            : `${mentor.availableSlots} of ${mentor.maxActiveMentees} spaces available`}
          tone="orange"
        />
      </AppCard>
      <PageHeading eyebrow="Mentor profile" title="Experience to grow from" />
      <AppCard>
        <SectionTitle title="About" />
        <Text style={{ color: AppColors.ink, fontSize: 15, lineHeight: 23 }}>{mentor.bio || 'This mentor has not added a biography yet.'}</Text>
        <Text style={{ color: AppColors.muted, fontSize: 13 }}>Experience: {mentor.experience || 'Not specified'}</Text>
        {mentor.qualifications ? <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 20 }}>Agricultural background: {mentor.qualifications}</Text> : null}
        <SectionTitle title="Areas of expertise" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {mentor.expertise.length
            ? mentor.expertise.map((topic) => <Pill key={topic} label={topic} />)
            : <Text style={{ color: AppColors.muted, fontSize: 13 }}>No expertise topics listed yet.</Text>}
        </View>
      </AppCard>
      {active ? (
        <AppCard>
          <Text style={{ color: AppColors.forest, fontWeight: '800' }}>You are already connected</Text>
          <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>Your active mentorship is available in My matches.</Text>
          <AppButton title="View my mentorship" variant="outline" onPress={() => router.push('/mentorship')} />
        </AppCard>
      ) : existingRequest ? (
        <AppCard>
          <Text style={{ color: AppColors.forest, fontWeight: '800' }}>Your request is pending</Text>
          <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>You can check its status or cancel it from Requests.</Text>
          <AppButton title="View request" variant="outline" onPress={() => router.push('/requests')} />
        </AppCard>
      ) : mentor.availableSlots !== null && mentor.availableSlots < 1 ? (
        <AppCard><Text style={{ color: AppColors.muted }}>This mentor is currently at capacity.</Text></AppCard>
      ) : (
        <AppCard>
          <Text style={{ color: AppColors.ink, fontSize: 17, fontWeight: '800' }}>Request mentorship</Text>
          <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>Share enough detail so the mentor can understand what support would be useful.</Text>
          <AppField label="Personal message" value={message} onChangeText={setMessage} placeholder="Introduce yourself and explain why you are reaching out." multiline maxLength={2000} />
          <AppField label="Your needs or challenges" value={needs} onChangeText={setNeeds} placeholder="What kind of guidance would help?" multiline maxLength={1000} />
          <AppField label="Agricultural interests" value={interests} onChangeText={setInterests} placeholder="Crops, livestock, soil health..." multiline maxLength={1000} />
          <AppField label="Mentorship goals" value={goals} onChangeText={setGoals} placeholder="What would you like to learn or achieve?" multiline maxLength={1000} />
          {error ? <ErrorBanner message={error} /> : null}
          {notice ? <Text accessibilityRole="alert" style={{ color: AppColors.forest, fontSize: 13, lineHeight: 19 }}>{notice}</Text> : null}
          <AppButton title="Send mentorship request" loading={busy || mentorshipLoading} onPress={() => void submit()} />
        </AppCard>
      )}
    </AppScreen>
  );
}
