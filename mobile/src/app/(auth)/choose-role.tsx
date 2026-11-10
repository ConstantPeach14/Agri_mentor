import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { AppBackButton, AppColors, AppScreen } from '@/components/app-ui';
import { UserRole } from '@/lib/local-data';

const roleChoices: { value: UserRole; icon: string; title: string; detail: string }[] = [
  { value: 'mentee', icon: '♧', title: 'I need a mentor', detail: 'Find guidance for your farm, business, or career.' },
  { value: 'mentor', icon: '♧', title: "I'm a mentor", detail: 'Share expertise and guide emerging talent.' },
  { value: 'staff', icon: '◎', title: 'Programme Staff', detail: 'Manage agricultural mentorship programmes.' },
];

export default function ChooseRoleScreen() {
  return (
    <AppScreen showBrand={false}>
      <AppBackButton fallbackRoute="/(auth)/welcome" label="Back to welcome" />
      <View style={{ gap: 8, paddingTop: 14 }}>
        <Text style={{ color: AppColors.leaf, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}>STEP 1 OF 3</Text>
        <Text style={{ color: AppColors.ink, fontSize: 28, lineHeight: 33, fontWeight: '800' }}>How will you use{'\n'}AgriMentor?</Text>
        <Text style={{ color: AppColors.muted, fontSize: 14, lineHeight: 20 }}>
          Choose your role to personalise your experience. You can update your profile later.
        </Text>
      </View>
      <View style={{ gap: 10, paddingTop: 12 }}>
        {roleChoices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="button"
            accessibilityLabel={`${choice.title}. ${choice.detail}`}
            onPress={() => router.push({ pathname: '/(auth)/register', params: { role: choice.value } })}
            style={({ pressed }) => ({
              minHeight: 78,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              backgroundColor: AppColors.paper,
              borderColor: AppColors.line,
              borderWidth: 1,
              borderRadius: 17,
              opacity: pressed ? 0.8 : 1,
            })}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: AppColors.lime, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: AppColors.forest, fontSize: 20, fontWeight: '800' }}>{choice.icon}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: AppColors.ink, fontSize: 14, fontWeight: '800' }}>{choice.title}</Text>
              <Text style={{ color: AppColors.muted, fontSize: 12, lineHeight: 16 }}>{choice.detail}</Text>
            </View>
            <Text style={{ color: AppColors.forest, fontSize: 22 }}>›</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ borderRadius: 12, padding: 12, backgroundColor: '#F5F3EC' }}>
        <Text style={{ color: AppColors.muted, fontSize: 11, lineHeight: 16 }}>✓  Your information is private and securely handled.</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/sign-in')} style={{ alignItems: 'center', paddingVertical: 8 }}>
        <Text style={{ color: AppColors.muted, fontSize: 13 }}>Already have an account? <Text style={{ color: AppColors.forest, fontWeight: '800' }}>Sign in</Text></Text>
      </Pressable>
    </AppScreen>
  );
}
