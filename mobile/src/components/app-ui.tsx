import { PropsWithChildren, ReactNode, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const AppColors = {
  forest: '#1F5139',
  leaf: '#55A952',
  lime: '#E4F2E0',
  cream: '#F7F5EE',
  paper: '#FFFFFF',
  ink: '#20382B',
  muted: '#66766B',
  line: '#E2E6DC',
  orange: '#C77A3C',
  red: '#A84336',
  paleRed: '#F8E8E4',
};

export function AppScreen({ children, scroll = true, showBrand = true }: PropsWithChildren<{ scroll?: boolean; showBrand?: boolean }>) {
  const content = (
    <>
      {showBrand ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 }}>
          <View style={{ width: 27, height: 27, borderRadius: 8, backgroundColor: AppColors.leaf, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: AppColors.paper, fontSize: 16, fontWeight: '800' }}>◩</Text>
          </View>
          <Text style={{ color: AppColors.forest, fontSize: 15, fontWeight: '800' }}>AgriMentor</Text>
        </View>
      ) : null}
      {children}
    </>
  );
  if (!scroll) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.screenContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
          {content}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function PageHeading({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function AppBackButton({ fallbackRoute, label = 'Back' }: { fallbackRoute: Href; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace(fallbackRoute);
      }}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: 40,
        minWidth: 40,
        paddingHorizontal: 10,
        borderRadius: 20,
        borderColor: AppColors.line,
        borderWidth: 1,
        backgroundColor: AppColors.paper,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.75 : 1,
      })}>
      <Text style={{ color: AppColors.forest, fontSize: 22, lineHeight: 24 }}>‹</Text>
    </Pressable>
  );
}

export function AppCard({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'link';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
};

export function AppButton({ title, onPress, variant = 'primary', disabled, loading, compact }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        compact && styles.buttonCompact,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && !loading && styles.buttonPressed,
      ]}>
      {loading ? <ActivityIndicator color={variant === 'primary' ? AppColors.paper : AppColors.forest} /> : (
        <Text style={[styles.buttonText, styles[`buttonText_${variant}`], compact && styles.buttonTextCompact]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function AppField({ label, hint, error, multiline, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#8B978E"
        selectionColor={AppColors.leaf}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline, error ? styles.inputError : null, style]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Pill({ label, tone = 'green' }: { label: string; tone?: 'green' | 'orange' | 'gray' | 'red' }) {
  return <View style={[styles.pill, styles[`pill_${tone}`]]}><Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text></View>;
}

export function AppChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choiceChip, selected && styles.choiceChipSelected, pressed && styles.buttonPressed]}>
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionTitleText}>{title}</Text>{action}</View>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyMark}>✦</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorBannerText}>{message}</Text></View>;
}

export function Avatar({ name, size = 48, imageUrl }: { name: string; size?: number; imageUrl?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  const avatarStyle = [styles.avatar, { width: size, height: size, borderRadius: size / 2 }];
  if (imageUrl && !imageFailed) {
    return <Image source={{ uri: imageUrl }} style={avatarStyle} contentFit="cover" onError={() => setImageFailed(true)} />;
  }
  return <View style={avatarStyle}><Text style={[styles.avatarText, { fontSize: Math.max(14, size * 0.32) }]}>{initials || '?'}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppColors.cream },
  keyboardAvoider: { flex: 1 },
  screenContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 18, maxWidth: 393, width: '100%', alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headingText: { flex: 1, gap: 5 },
  eyebrow: { color: AppColors.leaf, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: AppColors.ink, fontSize: 29, lineHeight: 35, fontWeight: '800' },
  subtitle: { color: AppColors.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: AppColors.paper, borderColor: AppColors.line, borderWidth: 1, borderRadius: 18, padding: 17, gap: 12 },
  button: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexDirection: 'row' },
  buttonCompact: { minHeight: 38, paddingHorizontal: 12, borderRadius: 11 },
  button_primary: { backgroundColor: AppColors.leaf },
  button_secondary: { backgroundColor: AppColors.lime },
  button_outline: { backgroundColor: AppColors.paper, borderWidth: 1, borderColor: AppColors.line },
  button_danger: { backgroundColor: AppColors.paleRed },
  button_link: { backgroundColor: 'transparent', minHeight: 34, paddingHorizontal: 2 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  buttonTextCompact: { fontSize: 13 },
  buttonText_primary: { color: AppColors.paper },
  buttonText_secondary: { color: AppColors.forest },
  buttonText_outline: { color: AppColors.forest },
  buttonText_danger: { color: AppColors.red },
  buttonText_link: { color: AppColors.leaf },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  field: { gap: 7 },
  label: { color: AppColors.ink, fontSize: 14, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderColor: AppColors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, backgroundColor: AppColors.paper, color: AppColors.ink, fontSize: 15 },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: AppColors.red },
  errorText: { color: AppColors.red, fontSize: 12 },
  hint: { color: AppColors.muted, fontSize: 12, lineHeight: 17 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  pill_green: { backgroundColor: AppColors.lime },
  pill_orange: { backgroundColor: '#F7E8D8' },
  pill_gray: { backgroundColor: '#ECEEEA' },
  pill_red: { backgroundColor: AppColors.paleRed },
  pillText: { fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  pillText_green: { color: AppColors.forest },
  pillText_orange: { color: '#92511F' },
  pillText_gray: { color: AppColors.muted },
  pillText_red: { color: AppColors.red },
  choiceChip: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: AppColors.line, backgroundColor: AppColors.paper, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceChipSelected: { backgroundColor: AppColors.lime, borderColor: AppColors.leaf },
  choiceChipText: { color: AppColors.ink, fontSize: 13, fontWeight: '700' },
  choiceChipTextSelected: { color: AppColors.forest },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitleText: { color: AppColors.ink, fontSize: 17, fontWeight: '800' },
  empty: { alignItems: 'center', padding: 28, gap: 9, backgroundColor: AppColors.paper, borderColor: AppColors.line, borderWidth: 1, borderRadius: 18 },
  emptyMark: { fontSize: 24, color: AppColors.leaf },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink, textAlign: 'center' },
  emptyBody: { color: AppColors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorBanner: { backgroundColor: AppColors.paleRed, borderRadius: 12, padding: 12 },
  errorBannerText: { color: AppColors.red, fontSize: 13, lineHeight: 18 },
  avatar: { backgroundColor: AppColors.lime, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: AppColors.forest, fontWeight: '800' },
});
