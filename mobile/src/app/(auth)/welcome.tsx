import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { AppButton, AppColors, AppScreen } from '@/components/app-ui';

export default function WelcomeScreen() {
  return (
    <AppScreen showBrand={false}>
      <View style={{ gap: 20 }}>
        <View style={{ height: 370, borderBottomRightRadius: 36, borderBottomLeftRadius: 20, overflow: 'hidden', justifyContent: 'space-between', padding: 18 }}>
          <Image
            source={require('@/assets/images/agri-home.png')}
            contentFit="cover"
            accessibilityLabel="A farmer tending crops"
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(10, 43, 30, 0.62)' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: AppColors.leaf, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFFFFF', fontSize: 19 }}>◩</Text>
            </View>
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>AgriMentor</Text>
            <View style={{ marginLeft: 'auto', borderColor: 'rgba(255,255,255,0.65)', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700', letterSpacing: 1 }}>GROW TOGETHER</Text>
            </View>
          </View>
          <View style={{ gap: 10 }}>
            <Text style={{ color: '#D5EBC9', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}>GROW WITH GUIDANCE</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 33, lineHeight: 38, fontWeight: '800' }}>
              Rooted in{'\n'}experience.{'\n'}Built for progress.
            </Text>
            <Text style={{ color: '#F1F4EF', fontSize: 14, lineHeight: 21, maxWidth: 300 }}>
              Connect with the right agricultural mentor, turn advice into action, and track outcomes that matter.
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingTop: 1 }}>
          <WelcomeBenefit icon="◎" label="Expert matching" />
          <WelcomeBenefit icon="◉" label="Measurable goals" />
          <WelcomeBenefit icon="▥" label="Real progress" />
        </View>
        <AppButton title="Get started  ›" onPress={() => router.push('/(auth)/choose-role')} />
        <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/sign-in')} style={{ alignItems: 'center', paddingBottom: 8 }}>
          <Text style={{ color: AppColors.muted, fontSize: 13 }}>Already have an account? <Text style={{ color: AppColors.forest, fontWeight: '800' }}>Sign in</Text></Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}

function WelcomeBenefit({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 7 }}>
      <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: AppColors.lime, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: AppColors.leaf, fontSize: 19, fontWeight: '800' }}>{icon}</Text>
      </View>
      <Text style={{ color: AppColors.ink, fontSize: 10, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
