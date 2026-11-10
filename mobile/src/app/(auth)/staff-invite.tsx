import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppColors, AppField, AppScreen, ErrorBanner, PageHeading } from '@/components/app-ui';
import { useLocalApp } from '@/lib/local-app-context';

export default function StaffInvitationScreen() {
  const { currentUser, consumeStaffInvitation, acceptStaffInvitation } = useLocalApp();
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signedInStaff = currentUser?.role === 'staff';

  const submit = async () => {
    setError('');
    if (!token.trim()) {
      setError('Enter the invitation token supplied by your programme coordinator.');
      return;
    }
    if (currentUser && !signedInStaff) {
      setError('Sign out before accepting a Programme Staff invitation.');
      return;
    }
    if (!signedInStaff) {
      if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Enter the name and email address associated with this invitation.');
        return;
      }
      if (password.length < 6 || password.length > 128) {
        setError('Password must contain 6 to 128 characters.');
        return;
      }
      if (password !== confirmation) {
        setError('The passwords do not match.');
        return;
      }
    }
    setBusy(true);
    try {
      if (signedInStaff) {
        await acceptStaffInvitation(token.trim());
      } else {
        await consumeStaffInvitation({ token: token.trim(), name, email, password, phone });
      }
      router.replace('/(tabs)/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The invitation could not be accepted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <AppBackButton fallbackRoute={signedInStaff ? '/(tabs)/profile' : '/(auth)/register'} label="Back to previous page" />
      <PageHeading
        eyebrow="Approved access"
        title={signedInStaff ? 'Join a programme' : 'Accept your invitation'}
        subtitle="Programme Staff access is limited to the programme named in your one-time invitation."
      />
      <AppCard>
        <Text style={{ color: AppColors.muted, fontSize: 13, lineHeight: 19 }}>
          Invitations expire and can only be used once. Never share the invitation token with anyone else.
        </Text>
        <AppField label="Invitation token" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} maxLength={60} />
        {signedInStaff ? null : (
          <>
            <AppField label="Full name" value={name} onChangeText={setName} autoComplete="name" maxLength={120} />
            <AppField label="Invitation email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={254} />
            <AppField label="Contact number (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={40} />
            <AppField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" maxLength={128} />
            <AppField label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" maxLength={128} />
          </>
        )}
        {error ? <ErrorBanner message={error} /> : null}
        <AppButton title={signedInStaff ? 'Accept programme assignment' : 'Create Staff account'} loading={busy} onPress={() => void submit()} />
      </AppCard>
    </AppScreen>
  );
}
