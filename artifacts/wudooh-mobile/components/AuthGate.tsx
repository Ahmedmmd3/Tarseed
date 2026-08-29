import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, booting, login } = useApp();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (booting) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (user) return <>{children}</>;

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError('أدخل البريد الإلكتروني أو رقم الجوال وكلمة المرور.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(identifier, password);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'تعذر تسجيل الدخول.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={[colors.navyDeep, colors.navy]} style={styles.fill}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.authContent, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Image source={require('@/assets/images/icon.png')} style={styles.logo} />
        <Text style={styles.brand}>ترصيد</Text>
        <Text style={styles.tagline}>متجرك معك، حتى عندما تنقطع الشبكة</Text>
        <View style={[styles.form, { backgroundColor: colors.card }]}>
          <Text style={[styles.formTitle, { color: colors.foreground }]}>الدخول إلى منشأتك</Text>
          <TextInput
            testID="login-identifier"
            accessibilityLabel="البريد الإلكتروني أو رقم الجوال"
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="البريد الإلكتروني أو رقم الجوال"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            textContentType="username"
            style={[styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]}
          />
          <TextInput
            testID="login-password"
            accessibilityLabel="كلمة المرور"
            value={password}
            onChangeText={setPassword}
            placeholder="كلمة المرور"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            textContentType="password"
            style={[styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]}
          />
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
          <Pressable
            testID="login-submit"
            disabled={submitting}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.7 : 1 }]}
          >
            {submitting ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>دخول آمن</Text>}
          </Pressable>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>تُطبق صلاحيات حسابك ونطاق مواقعك كما هي في ترصيد.</Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  authContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, alignItems: 'center' },
  logo: { width: 82, height: 82, borderRadius: 22 },
  brand: { color: '#ffffff', fontFamily: 'Cairo_700Bold', fontSize: 35, marginTop: 16 },
  tagline: { color: '#ccfbf1', fontFamily: 'Cairo_400Regular', fontSize: 14, marginBottom: 26, textAlign: 'center' },
  form: { width: '100%', borderRadius: 24, padding: 20, gap: 12 },
  formTitle: { fontFamily: 'Cairo_700Bold', fontSize: 20, textAlign: 'right', marginBottom: 4 },
  input: { height: 52, borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, fontFamily: 'Cairo_400Regular', textAlign: 'right' },
  error: { fontFamily: 'Cairo_500Medium', fontSize: 12, textAlign: 'right' },
  button: { minHeight: 52, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  buttonText: { fontFamily: 'Cairo_700Bold', fontSize: 16 },
  note: { fontFamily: 'Cairo_400Regular', fontSize: 11, textAlign: 'center', lineHeight: 19, marginTop: 2 },
});