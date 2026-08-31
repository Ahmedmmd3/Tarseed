import { StyleSheet, Text, View } from 'react-native';
import { Card, Empty, Money, PermissionGate, Screen, commonStyles } from '@/components/AppUI';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

export default function SalesScreen() {
  const colors = useColors();
  const { invoices } = useApp();
  const ordered = [...invoices].sort((a, b) => String(b.issueDate ?? '').localeCompare(String(a.issueDate ?? '')));
  return (
    <Screen testID="sales-screen" title="المبيعات" eyebrow="الفواتير وحركة التحصيل">
      <PermissionGate permission="sales">
        {ordered.length ? ordered.map((invoice) => <Card key={String(invoice.id)} style={styles.invoice}><View style={styles.top}><View><Text style={[styles.number, { color: colors.foreground }]}>{invoice.number ?? `#${invoice.id}`}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{invoice.customerName ?? 'عميل نقدي'} · {invoice.issueDate ?? '—'}</Text></View><View style={[styles.status, { backgroundColor: invoice.status === 'paid' ? colors.accent : colors.secondary }]}><Text style={[styles.statusText, { color: invoice.status === 'paid' ? colors.success : colors.warning }]}>{invoice.status === 'paid' ? 'مسددة' : invoice.status === 'partial' ? 'جزئية' : 'غير مسددة'}</Text></View></View><View style={styles.bottom}><Text style={[commonStyles.label, { color: colors.mutedForeground, marginBottom: 0 }]}>{invoice.paymentMethod === 'cash' ? 'نقدي' : invoice.paymentMethod === 'card' ? 'شبكة' : 'آجل'}</Text><Money value={Number(invoice.total ?? 0)} /></View></Card>) : <Empty icon="receipt-outline" title="لا توجد مبيعات بعد" text="الفواتير التي تنشئها من نقطة البيع ستظهر هنا." />}
      </PermissionGate>
    </Screen>
  );
}
const styles = StyleSheet.create({
  invoice: { gap: 14 },
  top: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-start' },
  number: { fontFamily: 'Cairo_700Bold', fontSize: 16, textAlign: 'right' },
  meta: { fontFamily: 'Cairo_400Regular', fontSize: 11, textAlign: 'right', marginTop: 3 },
  status: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14 },
  statusText: { fontFamily: 'Cairo_600SemiBold', fontSize: 10 },
  bottom: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
});