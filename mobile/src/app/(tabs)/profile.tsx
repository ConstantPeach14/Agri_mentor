import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { AppButton, AppCard, AppColors, AppField, AppScreen, Avatar, ErrorBanner, PageHeading, Pill } from '@/components/app-ui';
import { AgriculturalImage, ImageAssetInput } from '@/lib/auth-api';
import { LocalProfile, UserRole } from '@/lib/local-data';
import { useLocalApp } from '@/lib/local-app-context';
import { profileCompletionMessage } from '@/lib/profile-workflow';

const roleLabel: Record<UserRole, string> = { mentee: 'Mentee', mentor: 'Mentor', staff: 'Programme staff' };

export default function ProfileScreen() {
  const { data, currentUser } = useLocalApp();
  const profile = data?.profiles.find((item) => item.userId === currentUser?.id);
  if (!currentUser || !profile) return null;
  return <ProfileEditor key={profile.userId} profile={profile} name={currentUser.name} email={currentUser.email} phone={currentUser.phone} role={currentUser.role} />;
}

function ProfileEditor({ profile, name, email, phone, role }: { profile: LocalProfile; name: string; email: string; phone: string; role: UserRole }) {
  const { updateProfile, logout, uploadProfileImage, uploadAgriculturalImage, listAgriculturalImages, deleteAgriculturalImage } = useLocalApp();
  const [editing, setEditing] = useState(() => role !== 'staff' && !!profileCompletionMessage(role, profile));
  const [fullName, setFullName] = useState(name);
  const [contactPhone, setContactPhone] = useState(phone);
  const [location, setLocation] = useState(profile.location);
  const [bio, setBio] = useState(profile.bio);
  const [experience, setExperience] = useState(profile.experience);
  const [specialisation, setSpecialisation] = useState(profile.specialisation);
  const [qualifications, setQualifications] = useState(profile.qualifications);
  const [needs, setNeeds] = useState(profile.needs);
  const [organization, setOrganization] = useState(profile.organization);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle);
  const [maxActiveMentees, setMaxActiveMentees] = useState(profile.maxActiveMentees?.toString() ?? '');
  const [availabilityNote, setAvailabilityNote] = useState(profile.availabilityNote);
  const [topics, setTopics] = useState((role === 'mentor' ? profile.expertise : profile.interests).join(', '));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [agriculturalImages, setAgriculturalImages] = useState<AgriculturalImage[]>([]);

  const resetForm = () => {
    setFullName(name);
    setContactPhone(phone);
    setLocation(profile.location);
    setBio(profile.bio);
    setExperience(profile.experience);
    setSpecialisation(profile.specialisation);
    setQualifications(profile.qualifications);
    setNeeds(profile.needs);
    setOrganization(profile.organization);
    setJobTitle(profile.jobTitle);
    setMaxActiveMentees(profile.maxActiveMentees?.toString() ?? '');
    setAvailabilityNote(profile.availabilityNote);
    setTopics((role === 'mentor' ? profile.expertise : profile.interests).join(', '));
    setError('');
  };

  useEffect(() => {
    let active = true;
    listAgriculturalImages()
      .then((images) => {
        if (active) setAgriculturalImages(images);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Agricultural images could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [listAgriculturalImages]);

  const selectImage = async (): Promise<ImageAssetInput | null> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo library access to choose an image.');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    const extension = asset.uri.split('.').pop()?.toLowerCase();
    const mimeType = asset.mimeType
      ?? (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg');
    return {
      uri: asset.uri,
      mimeType,
      fileName: asset.fileName ?? `agrimentor-image.${mimeType.split('/')[1]}`,
      file: asset.file,
    };
  };

  const uploadSelectedImage = async (target: 'profile' | 'agricultural') => {
    setError('');
    setImageBusy(true);
    try {
      const asset = await selectImage();
      if (!asset) return;
      if (target === 'profile') {
        await uploadProfileImage(asset);
        setNotice('Your profile image was saved.');
      } else {
        const uploaded = await uploadAgriculturalImage(asset);
        setAgriculturalImages((current) => [uploaded, ...current]);
        setNotice('Your agricultural image was saved.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be uploaded.');
    } finally {
      setImageBusy(false);
    }
  };

  const save = async () => {
    setNotice('');
    setError('');
    const selectedTopics = [...new Set(topics.split(',').map((item) => item.trim()).filter(Boolean))];
    const draft: LocalProfile = {
      ...profile,
      location: location.trim(),
      bio: bio.trim(),
      experience: experience.trim(),
      specialisation: specialisation.trim(),
      qualifications: qualifications.trim(),
      needs: needs.trim(),
      interests: role === 'mentee' ? selectedTopics : profile.interests,
      expertise: role === 'mentor' ? selectedTopics : profile.expertise,
    };
    const validationMessage = profileCompletionMessage(role, draft);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    if (fullName.trim().length < 2 || fullName.trim().length > 120 || contactPhone.trim().length > 40) {
      setError('Enter a name between 2 and 120 characters and a phone number no longer than 40 characters.');
      return;
    }
    if (role === 'mentor' && maxActiveMentees.trim()
      && (!/^\d+$/.test(maxActiveMentees.trim())
        || Number(maxActiveMentees) < 1
        || Number(maxActiveMentees) > 32767)) {
      setError('Maximum active mentees must be a whole number from 1 to 32767, or empty for unlimited.');
      return;
    }

    setBusy(true);
    try {
      const changes: Partial<Omit<LocalProfile, 'userId' | 'updatedAt'>>
        & { name?: string; phone?: string } = {
          name: fullName.trim(),
          phone: contactPhone.trim(),
        };
      if (role === 'mentee') {
        changes.location = draft.location;
        changes.bio = draft.bio;
        changes.interests = selectedTopics;
        changes.needs = draft.needs;
        changes.experience = draft.experience;
      } else if (role === 'mentor') {
        changes.location = draft.location;
        changes.bio = draft.bio;
        changes.expertise = selectedTopics;
        changes.experience = draft.experience;
        changes.specialisation = draft.specialisation;
        changes.qualifications = draft.qualifications;
        changes.maxActiveMentees = maxActiveMentees.trim() ? Number(maxActiveMentees) : null;
        changes.availabilityNote = availabilityNote.trim();
      } else {
        changes.organization = organization.trim();
        changes.jobTitle = jobTitle.trim();
      }
      await updateProfile(changes);
      setNotice('Your profile was saved and refreshed from agriMentor.');
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const logoutNow = async () => {
    try {
      await logout();
    } catch {
      Alert.alert('Signed out', 'This device was signed out, but the server could not confirm session invalidation. The session expires automatically.');
    } finally {
      router.replace('/(auth)/welcome');
    }
  };

  const confirmDeleteImage = (imageId: string) => {
    Alert.alert('Delete this image?', 'This removes the image from your account and image storage.', [
      { text: 'Keep image', style: 'cancel' },
      {
        text: 'Delete image',
        style: 'destructive',
        onPress: () => {
          setError('');
          void deleteAgriculturalImage(imageId)
            .then(() => {
              setAgriculturalImages((current) => current.filter((item) => item.id !== imageId));
              setNotice('Agricultural image deleted.');
            })
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The image could not be deleted.'));
        },
      },
    ]);
  };

  const topicList = role === 'mentor' ? profile.expertise : profile.interests;
  const completionMessage = role === 'staff' ? null : profileCompletionMessage(role, profile);

  return (
    <AppScreen>
      <PageHeading
        eyebrow={role === 'staff' ? 'Programme workspace' : 'Your community profile'}
        title="Profile"
        subtitle={role === 'staff' ? 'Manage your own programme staff profile and sign out securely.' : 'Keep your introduction current so the right people can connect with you.'}
      />
      <AppCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={name} size={58} imageUrl={profile.imageUrl} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: AppColors.ink, fontSize: 17, fontWeight: '800' }}>{name}</Text>
          <Text style={{ color: AppColors.muted, fontSize: 12 }}>{email}</Text>
          <Pill label={roleLabel[role]} />
        </View>
        <AppButton title="Photo" compact variant="outline" loading={imageBusy} onPress={() => void uploadSelectedImage('profile')} />
      </AppCard>
      <AppCard>
        <Text className="text-lg font-bold text-[#20382B]">Agricultural images</Text>
        <Text style={{ color: AppColors.muted, fontSize: 12, lineHeight: 18 }}>
          Share farm and crop images with your account. Uploads require sign-in; delivery uses public HTTPS image URLs.
        </Text>
        <AppButton title="Add agricultural image" variant="secondary" loading={imageBusy} onPress={() => void uploadSelectedImage('agricultural')} />
        {agriculturalImages.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {agriculturalImages.map((item) => (
              <View key={item.id} style={{ gap: 4 }}>
                <Image source={{ uri: item.secureUrl }} contentFit="cover" style={{ width: 96, height: 96, borderRadius: 12 }} />
                <AppButton title="Delete" compact variant="danger" onPress={() => confirmDeleteImage(item.id)} />
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: AppColors.muted, fontSize: 12 }}>No agricultural images have been uploaded yet.</Text>
        )}
      </AppCard>
      {role === 'staff' ? (
        <AppCard>
            <Text style={{ color: AppColors.ink, fontSize: 17, fontWeight: '800' }}>Personal information</Text>
            <ProfileDetail label="Full name" value={name} />
            <ProfileDetail label="Email address" value={email} />
            <ProfileDetail label="Contact number" value={phone} />
        </AppCard>
      ) : null}
      <AppCard>
        {editing ? (
          <>
            <Text style={{ color: AppColors.ink, fontSize: 17, fontWeight: '800' }}>
              {completionMessage ? 'Complete your profile' : 'Edit profile'}
            </Text>
            <AppField label="Full name" value={fullName} onChangeText={setFullName} maxLength={120} />
            <AppField label="Contact number" value={contactPhone} onChangeText={setContactPhone} maxLength={40} keyboardType="phone-pad" />
            {role !== 'staff' ? (
              <>
                <AppField label="Location" value={location} onChangeText={setLocation} placeholder="Town or region" maxLength={2000} />
                <AppField label="Short introduction" value={bio} onChangeText={setBio} placeholder="Tell the community about your agricultural journey" multiline maxLength={500} />
              </>
            ) : null}
            {role === 'mentee' ? (
              <>
                <AppField label="Agricultural interests" value={topics} onChangeText={setTopics} placeholder="Vegetables, soil health" hint="Separate topics with commas." />
                <AppField label="What guidance are you looking for?" value={needs} onChangeText={setNeeds} placeholder="Share your current goals or challenges" multiline maxLength={2000} />
                <AppField label="Experience" value={experience} onChangeText={setExperience} placeholder="e.g. Early-stage grower" maxLength={2000} />
              </>
            ) : role === 'mentor' ? (
              <>
                <AppField label="Areas of expertise" value={topics} onChangeText={setTopics} placeholder="Irrigation, poultry" hint="Separate topics with commas. Search and matching use these terms." />
                <AppField label="Specialisation" value={specialisation} onChangeText={setSpecialisation} placeholder="e.g. Smallholder crop systems" maxLength={2000} />
                <AppField label="Experience" value={experience} onChangeText={setExperience} placeholder="e.g. 8 years" maxLength={2000} />
                <AppField label="Qualifications" value={qualifications} onChangeText={setQualifications} placeholder="Optional" maxLength={2000} />
                <AppField
                  label="Maximum active mentees"
                  value={maxActiveMentees}
                  onChangeText={setMaxActiveMentees}
                  placeholder="Leave empty for no set limit"
                  keyboardType="number-pad"
                  maxLength={5}
                  hint="Cannot be lower than your current number of active mentorships."
                />
                <AppField
                  label="Availability notes"
                  value={availabilityNote}
                  onChangeText={setAvailabilityNote}
                  placeholder="e.g. Weekday evenings; field visits by arrangement"
                  multiline
                  maxLength={500}
                  hint="A short note only; appointment booking is not currently supported."
                />
              </>
            ) : (
              <>
                <AppField label="Organization" value={organization} onChangeText={setOrganization} placeholder="Programme organization" maxLength={160} />
                <AppField label="Job title" value={jobTitle} onChangeText={setJobTitle} placeholder="Programme role" maxLength={160} />
              </>
            )}
            {error ? <ErrorBanner message={error} /> : null}
            {notice ? <Text style={{ color: AppColors.forest, fontSize: 13 }}>{notice}</Text> : null}
            <AppButton title="Save profile" loading={busy} onPress={() => void save()} />
            {!completionMessage ? (
              <AppButton
                title="Cancel"
                variant="outline"
                disabled={busy}
                onPress={() => {
                  resetForm();
                  setEditing(false);
                }}
              />
            ) : null}
          </>
        ) : (
          <>
            <Text style={{ color: AppColors.ink, fontSize: 17, fontWeight: '800' }}>About you</Text>
            <ProfileDetail label="Location" value={profile.location} />
            <ProfileDetail label="Introduction" value={profile.bio} />
            {role === 'mentee' ? (
              <>
                <ProfileDetail label="Agricultural interests" value={topicList.join(', ')} />
                <ProfileDetail label="Guidance needs" value={profile.needs} />
                <ProfileDetail label="Experience" value={profile.experience} />
              </>
            ) : role === 'mentor' ? (
              <>
                <ProfileDetail label="Areas of expertise" value={topicList.join(', ')} />
                <ProfileDetail label="Specialisation" value={profile.specialisation} />
                <ProfileDetail label="Experience" value={profile.experience} />
                {profile.qualifications ? <ProfileDetail label="Qualifications" value={profile.qualifications} /> : null}
                <ProfileDetail
                  label="Active mentees / maximum"
                  value={`${profile.activeMentees} / ${profile.maxActiveMentees === null ? 'No set limit' : profile.maxActiveMentees}`}
                />
                <ProfileDetail label="Availability notes" value={profile.availabilityNote} />
              </>
            ) : (
              <>
                <ProfileDetail label="Organization" value={profile.organization} />
                <ProfileDetail label="Job title" value={profile.jobTitle} />
              </>
            )}
            {error ? <ErrorBanner message={error} /> : null}
            {notice ? <Text accessibilityRole="alert" style={{ color: AppColors.forest, fontSize: 13 }}>{notice}</Text> : null}
            <AppButton title="Edit Profile" variant="outline" onPress={() => setEditing(true)} />
          </>
        )}
      </AppCard>
      <AppCard style={{ backgroundColor: '#EFF3E7' }}>
        <Text style={{ color: AppColors.forest, fontWeight: '800' }}>Account security</Text>
        <Text style={{ color: AppColors.muted, fontSize: 12, lineHeight: 18 }}>
          Your account is managed by the agriMentor service. Programme staff access is limited to specifically assigned programmes.
        </Text>
        {role === 'staff' ? (
          <AppButton title="Accept another programme invitation" variant="outline" onPress={() => router.push('/(auth)/staff-invite')} />
        ) : null}
        <AppButton title="Sign out" variant="secondary" onPress={() => void logoutNow()} />
      </AppCard>
    </AppScreen>
  );
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: AppColors.muted, fontSize: 12, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: AppColors.ink, fontSize: 14, lineHeight: 20 }}>{value.trim() || 'Not provided'}</Text>
    </View>
  );
}
