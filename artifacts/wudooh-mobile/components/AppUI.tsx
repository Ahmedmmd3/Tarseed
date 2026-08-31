import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

export function Screen({ title, eyebrow, testID, children }: { title: string; eyebrow?: string; testID?: string; children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { loading, refresh, queue, retrySync } = useApp();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View>
            {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
            <Text testID={testID} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          </View>
          {queue.length ? (
            <Pressable testID="sync-status" onPress={() => void retrySync()} style={[styles.sync, { backgroundColor: colors.accent }]}>
              <Ionicons name="cloud-upload-outline" size={16} color={colors.accentForeground} />
              <Text style={[styles.syncText, { color: colors.accentForeground }]}>{queue.length}</Text>
            </Pressable>
          ) : (
            <View style={[styles.sync, { backgroundColor: colors.secondary }]}>
              <Ionicons name="cloud-done-outline" size={17} color={colors.success} />
            </View>
          )}
        </View>
        {children}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

export function Hero({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <LinearGradient colors={[colors.navy, colors.navyDeep]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={styles.hero}>
      {children}
    </LinearGradient>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

export function Empty({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  const colors = useColors();
  return (
    <Card style={styles.empty}>
      <Ionicons name={icon} size={30} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{text}</Text>
    </Card>
  );
}

export function PermissionGate({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useApp();
  if (can(permission)) return <>{children}</>;
  return <Empty icon="lock-closed-outline" title="ليس لديك صلاحية لهذه الوحدة" text="تواصل مع مالك المنشأة لتعديل صلاحيات حسابك." />;
}

export function Money({ value, color }: { value: number; color?: string }) {
  const colors = useColors();
  return <Text style={[styles.money, { color: color ?? colors.foreground }]}>{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(value)}</Text>;
}

export const commonStyles = StyleSheet.create({
  sectionTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18, textAlign: 'right', marginBottom: 12 },
  label: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, textAlign: 'right', marginBottom: 6 },
  body: { fontFamily: 'Cairo_400Regular', fontSize: 14, lineHeight: 23, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', alignItems: 'center' },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', minHeight: 54 },
  eyebrow: { fontFamily: 'Cairo_600SemiBold', fontSize: 11, textAlign: 'right' },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 25, textAlign: 'right' },
  sync: { minWidth: 38, height: 38, paddingHorizontal: 10, borderRadius: 19, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 4 },
  syncText: { fontFamily: 'Cairo_700Bold', fontSize: 12 },
  hero: { borderRadius: 24, padding: 20, overflow: 'hidden' },
  card: { borderRadius: 18, borderWidth: 1, padding: 16 },
  empty: { alignItems: 'center', paddingVertical: 30, gap: 7 },
  emptyTitle: { fontFamily: 'Cairo_700Bold', fontSize: 16, textAlign: 'center' },
  emptyText: { fontFamily: 'Cairo_400Regular', fontSize: 13, lineHeight: 21, textAlign: 'center' },
  money: { fontFamily: 'Cairo_700Bold', fontSize: 17, writingDirection: 'rtl' },
});