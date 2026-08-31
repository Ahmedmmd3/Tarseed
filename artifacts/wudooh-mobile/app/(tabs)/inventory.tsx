import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Empty, PermissionGate, Screen } from '@/components/AppUI';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

export default function InventoryScreen() {
  const colors = useColors();
  const { products, balances, warehouses } = useApp();
  return (
    <Screen testID="inventory-screen" title="المخزون" eyebrow="الأرصدة حسب موقع التشغيل">
      <PermissionGate permission="inventory">
        {products.length ? products.map((product) => {
          const locations = balances.filter((item) => Number(item.productId) === Number(product.id));
          const total = locations.reduce((sum, item) => sum + Number(item.quantity), 0);
          return <Card key={product.id} style={styles.card}><View style={styles.head}><View style={[styles.icon, { backgroundColor: colors.secondary }]}><Ionicons name="cube-outline" size={22} color={colors.violet} /></View><View style={styles.copy}><Text style={[styles.name, { color: colors.foreground }]}>{product.name}</Text><Text style={[styles.sku, { color: colors.mutedForeground }]}>{product.sku || 'بدون رمز'}</Text></View><Text style={[styles.total, { color: total <= 5 ? colors.warning : colors.success }]}>{total.toLocaleString('ar-SA')}</Text></View>{locations.map((balance) => <View key={balance.id} style={[styles.location, { borderTopColor: colors.border }]}><Text style={[styles.locationName, { color: colors.mutedForeground }]}>{warehouses.find((warehouse) => Number(warehouse.id) === Number(balance.warehouseId))?.name ?? `موقع #${balance.warehouseId}`}</Text><Text style={[styles.quantity, { color: colors.foreground }]}>{Number(balance.quantity).toLocaleString('ar-SA')}</Text></View>)}</Card>;
        }) : <Empty icon="cube-outline" title="لا توجد منتجات" text="أضف المنتجات من ترصيد على الويب، ثم اسحب للتحديث." />}
      </PermissionGate>
    </Screen>
  );
}
const styles = StyleSheet.create({
  card: { gap: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 11 },
  icon: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  name: { fontFamily: 'Cairo_600SemiBold', fontSize: 14, textAlign: 'right' },
  sku: { fontFamily: 'Cairo_400Regular', fontSize: 10, textAlign: 'right' },
  total: { fontFamily: 'Cairo_700Bold', fontSize: 20 },
  location: { borderTopWidth: 1, paddingTop: 8, flexDirection: 'row-reverse', justifyContent: 'space-between' },
  locationName: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  quantity: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
});