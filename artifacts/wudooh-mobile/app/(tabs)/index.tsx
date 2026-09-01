import { Ionicons } from '@expo/vector-icons';
import { Alert, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Empty, Hero, Money, PermissionGate, Screen, commonStyles } from '@/components/AppUI';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { useState } from 'react';

export default function DashboardScreen() {
  const colors = useColors();
  const {
    user,
    invoices,
    expenses,
    balances,
    products,
    logout,
    queue,
    can,
    purchaseOrderShareAlerts,
    purchaseOrderShareAlertsError,
    rotatePurchaseOrderShare,
  } = useApp();
  const [rotatingPurchaseOrderId, setRotatingPurchaseOrderId] = useState<number | null>(null);
  const [rotationError, setRotationError] = useState('');
  const salesTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0);
  const lowStock = products.filter((product) => {
    const total = balances.filter((balance) => Number(balance.productId) === Number(product.id)).reduce((sum, item) => sum + Number(item.quantity), 0);
    return total <= 5;
  }).length;
  return (
    <Screen testID="dashboard-screen" title="لوحة التحكم" eyebrow={user?.projectName}>
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
      </PermissionGate>
      {can('inventory') ? (
        <PurchaseOrderShareExpiryAlerts
          alerts={purchaseOrderShareAlerts}
          loading={rotatingPurchaseOrderId !== null}
          error={purchaseOrderShareAlertsError || rotationError}
          rotatingPurchaseOrderId={rotatingPurchaseOrderId}
          onRotate={(purchaseOrderId) => {
            setRotationError('');
            Alert.alert(
              'تدوير رابط المورد',
              'سيُلغى الرابط الحالي فوراً ويُنشأ رابط جديد صالح للمورد. هل تريد المتابعة؟',
              [
                { text: 'إلغاء', style: 'cancel' },
                {
                  text: 'تدوير الرابط',
                  style: 'destructive',
                  onPress: () => {
                    setRotatingPurchaseOrderId(purchaseOrderId);
                    void rotatePurchaseOrderShare(purchaseOrderId)
                      .catch((error: unknown) => {
                        setRotationError(error instanceof Error ? error.message : 'تعذر تدوير رابط المورد.');
                      })
                      .finally(() => setRotatingPurchaseOrderId(null));
                  },
                },
              ],
            );
          }}
        />
      ) : null}
      {can('dashboard') ? (
        <>
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
        </>
      ) : null}
    </Screen>
  );
}

function PurchaseOrderShareExpiryAlerts({
  alerts,
  loading,
  error,
  rotatingPurchaseOrderId,
  onRotate,
}: {
  alerts: Array<{
    purchaseOrderId: number;
    shareId: number;
    orderNumber: string;
    supplierName: string;
    expiresAt: string;
    hoursRemaining: number;
  }>;
  loading: boolean;
  error: string;
  rotatingPurchaseOrderId: number | null;
  onRotate: (purchaseOrderId: number) => void;
}) {
  const colors = useColors();
  if (alerts.length === 0 && !error) return null;
  return (
    <Card style={[styles.expiryCard, { backgroundColor: colors.accent, borderColor: colors.warning }]}>
      <View style={styles.expiryHeading}>
        <View style={[styles.expiryIcon, { backgroundColor: colors.secondary }]}>
          <Ionicons name="warning-outline" size={21} color={colors.warning} />
        </View>
        <View style={styles.expiryCopy}>
          <Text style={[styles.expiryTitle, { color: colors.foreground }]}>روابط موردين ستنتهي قريباً</Text>
          <Text style={[styles.expiryDescription, { color: colors.mutedForeground }]}>
            جدّد الرابط قبل انتهاء صلاحيته حتى لا يتعذر على المورد اتخاذ القرار.
          </Text>
        </View>
      </View>
      {error ? (
        <Text testID="po-share-expiry-error" style={[styles.expiryError, { color: colors.destructive }]}>{error}</Text>
      ) : null}
      {alerts.map((alert) => (
        <View key={alert.purchaseOrderId} testID={`po-share-expiry-item-${alert.purchaseOrderId}`} style={[styles.expiryItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.expiryItemCopy}>
            <Text style={[styles.expiryOrder, { color: colors.foreground }]}>أمر شراء {alert.orderNumber}</Text>
            <Text style={[styles.expiryMeta, { color: colors.mutedForeground }]}>
              {alert.supplierName} · ينتهي خلال {alert.hoursRemaining} ساعة
            </Text>
            <Text style={[styles.expiryDate, { color: colors.mutedForeground }]}>
              {formatExpiryDate(alert.expiresAt)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`تدوير رابط أمر الشراء ${alert.orderNumber}`}
            testID={`po-share-expiry-rotate-${alert.purchaseOrderId}`}
            disabled={loading}
            onPress={() => onRotate(alert.purchaseOrderId)}
            style={({ pressed }) => [
              styles.rotateButton,
              { backgroundColor: colors.warning, opacity: pressed || loading ? 0.7 : 1 },
            ]}
          >
            {rotatingPurchaseOrderId === alert.purchaseOrderId
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Ionicons name="refresh-outline" size={19} color={colors.primaryForeground} />}
            <Text style={[styles.rotateLabel, { color: colors.primaryForeground }]}>تدوير الرابط</Text>
          </Pressable>
        </View>
      ))}
      {alerts.length === 0 && error ? (
        <Empty icon="cloud-offline-outline" title="تعذر تحديث تنبيهات الروابط" text="تحقق من الصلاحية أو إصدار بيانات المنشأة ثم اسحب للتحديث." />
      ) : null}
    </Card>
  );
}

function formatExpiryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تاريخ الانتهاء غير متاح';
  return `ينتهي في ${date.toLocaleDateString('ar-SA')}، ${date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`;
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
  expiryCard: { gap: 12, padding: 14 },
  expiryHeading: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  expiryIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  expiryCopy: { flex: 1, gap: 2 },
  expiryTitle: { fontFamily: 'Cairo_700Bold', fontSize: 16, textAlign: 'right' },
  expiryDescription: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  expiryError: { fontFamily: 'Cairo_500Medium', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  expiryItem: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 12 },
  expiryItemCopy: { gap: 2 },
  expiryOrder: { fontFamily: 'Cairo_700Bold', fontSize: 14, textAlign: 'right' },
  expiryMeta: { fontFamily: 'Cairo_400Regular', fontSize: 12, textAlign: 'right' },
  expiryDate: { fontFamily: 'Cairo_400Regular', fontSize: 11, textAlign: 'right' },
  rotateButton: { minHeight: 43, borderRadius: 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  rotateLabel: { fontFamily: 'Cairo_700Bold', fontSize: 12 },
});
