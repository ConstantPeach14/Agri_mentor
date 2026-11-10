import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AppBackButton, AppButton, AppCard, AppColors, AppField, AppScreen, ErrorBanner, PageHeading } from '@/components/app-ui';
import { passwordValidationMessage } from '@/lib/password-validation';
import { UserRole } from '@/lib/local-data';
import { registrationRole } from '@/lib/app-routes';
import { useLocalApp } from '@/lib/local-app-context';

const roles: { value: UserRole; label: string; detail: string }[] = [
  { value: 'mentee', label: 'Mentee', detail: 'I need a mentor' },
  { value: 'mentor', label: 'Mentor', detail: "I'm a mentor" },
  { value: 'staff', label: 'Programme Staff', detail: 'Manage agricultural mentorship programmes' },
];

export default function RegisterScreen() {
  const { role: initialRole } = useLocalSearchParams<{ role?: string | string[] }>();
  const { register } = useLocalApp();
  const [role, setRole] = useState<UserRole>(() => registrationRole(initialRole) ?? 'mentee');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!name.trim() || !email.trim() || !password) {
      setError('Name, email and password are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    const passwordError = passwordValidationMessage(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await register({ name, email, password, role, phone });
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(auth)/choose-role" label="Back to role selection" />
      <PageHeading eyebrow="Join the community" title="Create your account" subtitle="Choose how you want to take part. You can update your profile later." />
      <AppCard>
        <Text style={{ color: AppColors.ink, fontWeight: '700' }}>Choose your role</Text>
        <View style={{ gap: 8 }}>
          {roles.map((item) => (
            <AppButton
              key={item.value}
              title={`${role === item.value ? '✓ ' : ''}${item.label} · ${item.detail}`}
              variant={role === item.value ? 'secondary' : 'outline'}
              compact
              onPress={() => setRole(item.value)}
            />
          ))}
        </View>
        <AppField label="Full name" value={name} onChangeText={setName} placeholder="Your name" autoComplete="name" />
        <AppField label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <AppField label="Contact number (optional)" value={phone} onChangeText={setPhone} placeholder="+27 ..." keyboardType="phone-pad" autoComplete="tel" />
        <AppField label="Password" value={password} onChangeText={setPassword} placeholder="Use letters, numbers and a special character" secureTextEntry autoComplete="new-password" maxLength={128} hint="Use 6 to 128 characters with letters, numbers and a special character." />
        <AppField label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter password again" secureTextEntry autoComplete="new-password" />
        {error ? <ErrorBanner message={error} /> : null}
        <AppButton title="Create account" loading={busy} onPress={() => void submit()} />
        <AppButton title="I already have an account" variant="link" onPress={() => router.push('/(auth)/sign-in')} />
      </AppCard>
    </AppScreen>
  );
}
