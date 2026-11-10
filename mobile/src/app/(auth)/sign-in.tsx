import { router } from 'expo-router';
import { useState } from 'react';

import { AppBackButton, AppButton, AppCard, AppField, AppScreen, ErrorBanner, PageHeading } from '@/components/app-ui';
import { loginErrorMessage } from '@/lib/auth-errors';
import { useLocalApp } from '@/lib/local-app-context';

export default function SignInScreen() {
  const { login } = useLocalApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (cause) {
      setError(loginErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <AppBackButton fallbackRoute="/(auth)/welcome" label="Back to previous page" />
      <PageHeading eyebrow="Welcome back" title="Sign in" subtitle="Continue your agricultural journey." />
      <AppCard>
        <AppField label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <AppField label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoComplete="password" maxLength={128} />
        {error ? <ErrorBanner message={error} /> : null}
        <AppButton title="Sign in" loading={busy} onPress={() => void submit()} />
        <AppButton title="New to agriMentor? Create an account" variant="link" onPress={() => router.push('/(auth)/register')} />
      </AppCard>
    </AppScreen>
  );
}
