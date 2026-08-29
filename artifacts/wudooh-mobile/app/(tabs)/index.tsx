import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Hero, Money, PermissionGate, Screen, commonStyles } from '@/components/AppUI';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

export default function DashboardScreen() {
  const colors = useColors();
  const { user, invoices, expenses, balances, products, logout, queue } = useApp();
  const salesTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0);
  const lowStock = products.filter((product) => {
    const total = balances.filter((balance) => Number(balance.productId) === Number(product.id)).reduce((sum, item) => sum + Number(item.quantity), 0);
    return total <= 5;
  }).length;
  return (
    <Screen title="لوحة التحكم" eyebrow={user?.projectName}>
      <PermissionGate permission="dashboard">
        <Hero>
          <View style={styles.heroTop}>
            <View style={styles.heroCopy}>
              <Text style={styles.greeting}>أهلاً {user?.name.split(' ')[0]}</Text>
              <Text style={styles.heroText}>نظرة سريعة على أداء متجرك اليوم</Text>
            </View>
            <Pressable accessibilityLabel="تسجيل الخروج" testID="logout" onPress={() => void logout()}>
              <Ionicons name="log-out-outline" size={24} color={colors.primaryForeground} />
            </Pressable>
          </View>
          <View style={styles.heroMetrics}>
            <View><Text style={styles.heroLabel}>صافي الحركة</Text><Money value={salesTotal - expenseTotal} color={colors.primaryForeground} /></View>
            <View style={styles.heroDivider} />
            <View><Text style={styles.heroLabel}>بانتظار المزامنة</Text><Text style={styles.heroValue}>{queue.length.toLocaleString('ar-SA')}</Text></View>
          </View>
        </Hero>
        <Text style={[commonStyles.sectionTitle, { color: colors.foreground }]}>مؤشرات المنشأة</Text>
        <View style={styles.metrics}>
          <Metric icon="receipt-outline" label="إجمالي المبيعات" value={salesTotal} color={colors.info} />
          <Metric icon="wallet-outline" label="إجمالي المصاريف" value={expenseTotal} color={colors.rose} />
          <Metric icon="alert-circle-outline" label="مخزون منخفض" textValue={lowStock.toLocaleString('ar-SA')} color={colors.warning} />
          <Metric icon="cube-outline" label="المنتجات" textValue={products.length.toLocaleString('ar-SA')} color={colors.violet} />
        </View>
        <Text style={[commonStyles.sectionTitle, { color: colors.foreground }]}>إجراء سريع</Text>
        <View style={styles.actions}>
          <QuickAction icon="storefront-outline" label="فتح الكاشير" color={colors.primary} onPress={() => router.push('/pos')} />
          <QuickAction icon="add-circle-outline" label="مصروف جديد" color={colors.rose} onPress={() => router.push('/expenses')} />
          <QuickAction icon="layers-outline" label="فحص المخزون" color={colors.violet} onPress={() => router.push('/inventory')} />
        </View>
      </PermissionGate>
    </Screen>
  );
}

function Metric({ icon, label, value, textValue, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: number; textValue?: string; color: string }) {
  const colors = useColors();
  return <Card style={styles.metric}><Ionicons name={icon} size={21} color={color} /><Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>{value !== undefined ? <Money value={value} /> : <Text style={[styles.metricNumber, { color: colors.foreground }]}>{textValue}</Text>}</Card>;
}

function QuickAction({ icon, label, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><View style={[styles.actionIcon, { backgroundColor: colors.secondary }]}><Ionicons name={icon} size={22} color={color} /></View><Text style={[styles.actionLabel, { color: colors.foreground }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  heroTop: { flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroCopy: { flex: 1 },
  greeting: { color: '#ffffff', fontFamily: 'Cairo_700Bold', fontSize: 24, textAlign: 'right' },
  heroText: { color: '#cbd5e1', fontFamily: 'Cairo_400Regular', fontSize: 13, textAlign: 'right', marginTop: 5 },
  heroMetrics: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  heroLabel: { color: '#94a3b8', fontFamily: 'Cairo_400Regular', fontSize: 11, textAlign: 'right' },
  heroValue: { color: '#ffffff', fontFamily: 'Cairo_700Bold', fontSize: 20, textAlign: 'right' },
  heroDivider: { width: 1, height: 36, backgroundColor: '#334155' },
  metrics: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  metric: { width: '48%', minHeight: 120, justifyContent: 'space-between' },
  metricLabel: { fontFamily: 'Cairo_400Regular', fontSize: 11, textAlign: 'right' },
  metricNumber: { fontFamily: 'Cairo_700Bold', fontSize: 23, textAlign: 'right' },
  actions: { gap: 9 },
  action: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  actionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: 'Cairo_600SemiBold', fontSize: 14, textAlign: 'right' },
});
