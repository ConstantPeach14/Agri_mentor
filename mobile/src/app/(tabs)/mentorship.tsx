import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppColors, AppField, AppScreen, Avatar, EmptyState, ErrorBanner, PageHeading, Pill } from '@/components/app-ui';
import { useLocalApp } from '@/lib/local-app-context';

export default function MentorshipScreen() {
  const { data, currentUser, endRelationship, mentorshipLoading, mentorshipError, refreshMentorshipData } = useLocalApp();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [endingId, setEndingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useFocusEffect(useCallback(() => {
    void refreshMentorshipData().catch(() => undefined);
  }, [refreshMentorshipData]));
  if (!data || !currentUser) return null;

  const relationships = data.mentorships.filter(
    (item) => item.menteeId === currentUser.id || item.mentorId === currentUser.id,
  );
  const activeRelationships = relationships.filter((item) => item.status === 'active');
  const endedRelationships = relationships.filter((item) => item.status === 'ended');
  const requestEnd = (relationshipId: string) => {
    Alert.alert(
      'End this mentorship?',
      'The relationship will be retained in history, but new sessions and goals will no longer be available.',
      [
        { text: 'Keep mentorship', style: 'cancel' },
        {
          text: 'End mentorship',
          style: 'destructive',
          onPress: () => {
            setError('');
            setNotice('');
            setEndingId(relationshipId);
            void endRelationship(relationshipId, reasons[relationshipId] ?? '')
              .then(() => setNotice('The mentorship has ended and remains in your history.'))
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not end the mentorship.'))
              .finally(() => setEndingId(''));
          },
        },
      ],
      { cancelable: true },
    );
  };
  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/dashboard" label="Back to previous page" />
      <PageHeading
        eyebrow="Shared growth"
        title={currentUser.role === 'mentor' ? 'My mentees' : 'My mentorship'}
        subtitle="Your accepted mentorship relationships and the people you are growing with."
      />
      {mentorshipError ? (
        <View style={{ gap: 8 }}>
          <ErrorBanner message={mentorshipError} />
          <AppButton title="Reload relationships" variant="outline" compact onPress={() => void refreshMentorshipData().catch(() => undefined)} />
        </View>
      ) : null}
      {mentorshipLoading && !relationships.length ? <ActivityIndicator accessibilityLabel="Loading mentorships" color={AppColors.forest} /> : null}
      {!mentorshipLoading && !mentorshipError && activeRelationships.length === 0 ? (
        <EmptyState
          title="Your next connection starts here"
          body={currentUser.role === 'mentee'
            ? 'Discover mentors and send a note about what you would like to learn.'
            : 'Accepted requests become your active mentorships.'}
          action={currentUser.role === 'mentee' ? <AppButton title="Find a mentor" onPress={() => router.push('/discover')} /> : undefined}
        />
      ) : activeRelationships.map((relationship) => {
        const other = relationship.menteeId === currentUser.id ? relationship.mentor : relationship.mentee;
        const detail = currentUser.role === 'mentor'
          ? other.location || 'Mentee'
          : other.specialisation || other.location || 'Mentor';
        return (
          <AppCard key={relationship.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Avatar name={other.name} size={58} imageUrl={other.imageUrl} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: AppColors.ink, fontSize: 17, fontWeight: '800' }}>{other.name}</Text>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>{detail}</Text>
              </View>
              <Pill label={relationship.status} />
            </View>
            {other.location ? <Text style={{ color: AppColors.muted, fontSize: 13 }}>{other.location}</Text> : null}
            <Text style={{ color: AppColors.ink, fontSize: 13, lineHeight: 20 }}>
              {currentUser.role === 'mentor' ? 'You are supporting this mentee in their agricultural learning journey.' : 'You are connected with this mentor for guidance.'}
            </Text>
            <Text style={{ color: AppColors.muted, fontSize: 12 }}>
              Started {new Date(relationship.startedAt).toLocaleDateString()}
            </Text>
            <AppField
              label="Reason for ending (optional)"
              value={reasons[relationship.id] ?? ''}
              onChangeText={(value) => setReasons((previous) => ({ ...previous, [relationship.id]: value }))}
              maxLength={1000}
              multiline
            />
            <AppButton
              title="End mentorship"
              compact
              variant="danger"
              loading={endingId === relationship.id}
              onPress={() => requestEnd(relationship.id)}
            />
          </AppCard>
        );
      })}
      {endedRelationships.length ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: AppColors.ink, fontSize: 18, fontWeight: '800' }}>Past mentorships</Text>
          {endedRelationships.map((relationship) => {
            const other = relationship.menteeId === currentUser.id ? relationship.mentor : relationship.mentee;
            return (
              <AppCard key={relationship.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: AppColors.ink, fontSize: 16, fontWeight: '800', flex: 1 }}>{other.name}</Text>
                  <Pill label="Ended" tone="gray" />
                </View>
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>
                  Started {new Date(relationship.startedAt).toLocaleDateString()}
                  {relationship.endedAt ? ` · Ended ${new Date(relationship.endedAt).toLocaleDateString()}` : ''}
                </Text>
                {relationship.endReason ? <Text style={{ color: AppColors.muted, fontSize: 13 }}>{relationship.endReason}</Text> : null}
              </AppCard>
            );
          })}
        </View>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Text accessibilityRole="alert" style={{ color: AppColors.forest, fontSize: 13 }}>{notice}</Text> : null}
    </AppScreen>
  );
}
