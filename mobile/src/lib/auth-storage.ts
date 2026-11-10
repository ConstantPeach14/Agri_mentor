import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'agrimentor.access-token.v1';
let browserToken: string | null = null;

export async function readAuthToken(): Promise<string | null> {
  if (Platform.OS === 'web') return browserToken;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function writeAuthToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    browserToken = token;
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearAuthToken(): Promise<void> {
  if (Platform.OS === 'web') {
    browserToken = null;
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
