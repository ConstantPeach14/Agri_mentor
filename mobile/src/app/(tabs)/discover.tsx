import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppColors, AppField, AppScreen, Avatar, EmptyState, ErrorBanner, PageHeading, Pill, SectionTitle } from '@/components/app-ui';
import { MentorDirectoryProfile, MentorSearchFilters } from '@/lib/auth-api';
import { useLocalApp } from '@/lib/local-app-context';
import { recommendMentors } from '@/lib/mentor-recommendations';

export default function DiscoverScreen() {
  const { data, currentUser, listMentors } = useLocalApp();
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [minimumExperience, setMinimumExperience] = useState('');
  const [selectedExpertise, setSelectedExpertise] = useState('');
  const [mentors, setMentors] = useState<MentorDirectoryProfile[]>([]);
  const [expertiseOptions, setExpertiseOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const searchRequest = useRef(0);
  const topics = expertiseOptions;

  const searchMentors = useCallback(async () => {
    const requestId = ++searchRequest.current;
    const filters: MentorSearchFilters = {
      q: query.trim() || undefined,
      location: location.trim() || undefined,
      expertise: selectedExpertise || undefined,
    };
    if (minimumExperience.trim()) {
      const parsed = Number(minimumExperience);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        setError('Minimum experience must be a whole number from 0 to 100.');
        setLoading(false);
        return;
      }
      filters.minExperience = parsed;
    }

    setLoading(true);
    setError('');
    try {
      const result = await listMentors(filters);
      if (requestId === searchRequest.current) {
        setMentors(result);
        setExpertiseOptions((previous) => (
          [...new Set([...previous, ...result.flatMap((mentor) => mentor.expertise)])]
            .sort((a, b) => a.localeCompare(b))
        ));
      }
    } catch (cause) {
      if (requestId === searchRequest.current) {
        setError(cause instanceof Error ? cause.message : 'Mentors could not be loaded.');
      }
    } finally {
      if (requestId === searchRequest.current) setLoading(false);
    }
  }, [listMentors, location, minimumExperience, query, selectedExpertise]);

  useFocusEffect(useCallback(() => {
    const timer = setTimeout(() => void searchMentors(), 250);
    return () => {
      clearTimeout(timer);
      searchRequest.current += 1;
    };
  }, [searchMentors]));

  const clearFilters = () => {
    setQuery('');
    setLocation('');
    setMinimumExperience('');
    setSelectedExpertise('');
  };
  const profile = data.profiles.find((item) => item.userId === currentUser?.id);
  const recommendations = profile
    ? recommendMentors(profile, data.goals, mentors)
    : mentors.map((mentor) => ({ mentor, reasons: ['Complete your profile to get more relevant match reasons.'], score: 0 }));

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(tabs)/dashboard" label="Back to previous page" />
      <PageHeading eyebrow="Find your guide" title="Meet our mentors" subtitle="Explore agricultural experience that can help your ideas take root." />
      <AppField label="Search mentors" value={query} onChangeText={setQuery} placeholder="Name, expertise or agricultural topic" returnKeyType="search" />
      <AppField label="Location" value={location} onChangeText={setLocation} placeholder="Town, region or country" />
      <AppField
        label="Minimum years of experience"
        value={minimumExperience}
        onChangeText={setMinimumExperience}
        placeholder="Any"
        keyboardType="number-pad"
      />
      <View style={{ gap: 9 }}>
        <SectionTitle title="Filter by expertise" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          <AppButton title="All" variant={!selectedExpertise ? 'secondary' : 'outline'} compact onPress={() => setSelectedExpertise('')} />
          {topics.map((topic) => (
            <AppButton
              key={topic}
              title={topic}
              variant={topic === selectedExpertise ? 'secondary' : 'outline'}
              compact
              onPress={() => setSelectedExpertise(topic)}
            />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <SectionTitle title="Recommended mentors" />
        {loading ? <ActivityIndicator accessibilityLabel="Loading mentors" color={AppColors.forest} /> : null}
        {error ? (
          <View style={{ gap: 8 }}>
            <ErrorBanner message={error} />
            <AppButton title="Try again" variant="outline" compact onPress={() => void searchMentors()} />
          </View>
        ) : null}
        {!loading && !error && recommendations.map(({ mentor, reasons }, index) => (
          <AppCard key={mentor.id} style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Avatar name={mentor.name} size={56} imageUrl={mentor.imageUrl} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: AppColors.ink, fontSize: 16, fontWeight: '800' }}>{mentor.name}</Text>
                {index === 0 && reasons.some((reason) => !reason.startsWith('No direct')) ? <Pill label="Strong match" /> : null}
                <Text style={{ color: AppColors.muted, fontSize: 12 }}>{mentor.specialisation || mentor.location || 'Agricultural mentor'}</Text>
                {mentor.location ? <Text style={{ color: AppColors.muted, fontSize: 12 }}>{mentor.location}</Text> : null}
              </View>
              <Pill label={mentor.availableSlots === null ? 'Open to requests' : `${mentor.availableSlots} spaces`} tone="orange" />
            </View>
            {mentor.bio ? <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 20 }}>{mentor.bio}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {mentor.expertise.slice(0, 5).map((topic) => <Pill key={topic} label={topic} tone="gray" />)}
            </View>
            {mentor.experience ? <Text style={{ color: AppColors.muted, fontSize: 12 }}>Experience: {mentor.experience}</Text> : null}
            <View style={{ backgroundColor: '#EFF3E7', borderRadius: 12, padding: 11, gap: 5 }}>
              <Text style={{ color: AppColors.forest, fontSize: 12, fontWeight: '800' }}>Why this mentor</Text>
              {reasons.map((reason) => <Text key={reason} style={{ color: AppColors.ink, fontSize: 12, lineHeight: 18 }}>• {reason}</Text>)}
            </View>
            <AppButton title="View profile & request" variant="outline" onPress={() => router.push({ pathname: '/mentor/[id]', params: { id: mentor.id } })} />
          </AppCard>
        ))}
        {!loading && !error && !recommendations.length ? (
          <EmptyState title="No mentors found" body="Try changing your search or clearing one of the filters." action={<AppButton title="Clear filters" variant="outline" compact onPress={clearFilters} />} />
        ) : null}
      </View>
    </AppScreen>
  );
}
