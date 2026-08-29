import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Empty, Money, PermissionGate, Screen, commonStyles } from '@/components/AppUI';
import { useApp, type Product } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

type CartItem = { product: Product; quantity: number };
const priceOf = (product: Product) => Number(product.sellPrice ?? product.salePrice ?? product.price ?? 0);

export default function PosScreen() {
  const colors = useColors();
  const { products, warehouses, balances, checkout } = useApp();
  const [warehouseId, setWarehouseId] = useState<number | null>(warehouses.filter((item) => item.status !== 'inactive')[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit'>('card');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const filtered = useMemo(() => products.filter((product) => !search.trim() || product.name.includes(search.trim()) || product.sku?.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const stockOf = (product: Product) => Number(balances.find((item) => Number(item.productId) === Number(product.id) && Number(item.warehouseId) === Number(warehouseId))?.quantity ?? 0);
  const total = cart.reduce((sum, item) => sum + priceOf(item.product) * item.quantity, 0);
  const add = (product: Product) => {
    if (stockOf(product) <= 0) return;
    void Haptics.selectionAsync();
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (!existing) return [...current, { product, quantity: 1 }];
      if (existing.quantity >= stockOf(product)) return current;
      return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
    });
  };
  const adjust = (productId: number, delta: number) => setCart((current) => current.flatMap((item) => {
    if (item.product.id !== productId) return [item];
    const quantity = Math.min(stockOf(item.product), item.quantity + delta);
    return quantity > 0 ? [{ ...item, quantity }] : [];
  }));
  const submit = async () => {
    if (!warehouseId || !cart.length || (paymentMethod === 'credit' && !dueDate)) {
      setMessage('أكمل بيانات الدفع المطلوبة.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    const result = await checkout({
      warehouseId,
      issueDate: new Date().toISOString().slice(0, 10),
      paymentMethod,
      dueDate: paymentMethod === 'credit' ? dueDate : undefined,
      customerName: customerName.trim() || undefined,
      items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
    });
    setCart([]);
    setOpen(false);
    setCustomerName('');
    setDueDate('');
    setSubmitting(false);
    setMessage(result.queued ? 'حُفظ البيع على الجهاز وسيُزامن تلقائياً عند عودة الشبكة.' : `تم إصدار الفاتورة ${result.invoice?.number ?? ''}`);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  return (
    <Screen title="نقطة البيع" eyebrow="كاشير سريع وآمن">
      <PermissionGate permission="sales">
        <View style={styles.warehouses}>{warehouses.filter((item) => item.status !== 'inactive').map((warehouse) => <Pressable key={warehouse.id} onPress={() => setWarehouseId(warehouse.id)} style={[styles.chip, { backgroundColor: warehouseId === warehouse.id ? colors.accent : colors.card, borderColor: warehouseId === warehouse.id ? colors.primary : colors.border }]}><Text style={[styles.chipText, { color: warehouseId === warehouse.id ? colors.accentForeground : colors.mutedForeground }]}>{warehouse.name}</Text></Pressable>)}</View>
        <TextInput testID="pos-search" value={search} onChangeText={setSearch} placeholder="ابحث بالاسم أو الرمز" placeholderTextColor={colors.mutedForeground} style={[styles.search, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
        {message ? <Card><Text style={[commonStyles.body, { color: colors.success }]}>{message}</Text></Card> : null}
        {filtered.length ? <View style={styles.grid}>{filtered.map((product) => {
          const stock = stockOf(product);
          return <Pressable testID={`product-${product.id}`} disabled={stock <= 0} key={product.id} onPress={() => add(product)} style={({ pressed }) => [styles.product, { backgroundColor: colors.card, borderColor: colors.border, opacity: stock <= 0 ? 0.45 : pressed ? 0.7 : 1 }]}><View style={[styles.productIcon, { backgroundColor: colors.secondary }]}><Ionicons name="cube-outline" size={23} color={colors.primary} /></View><Text numberOfLines={1} style={[styles.productName, { color: colors.foreground }]}>{product.name}</Text><Money value={priceOf(product)} /><Text style={[styles.stock, { color: stock <= 5 ? colors.warning : colors.mutedForeground }]}>{stock.toLocaleString('ar-SA')} متاح</Text></Pressable>;
        })}</View> : <Empty icon="search-outline" title="لا توجد نتائج" text="جرّب اسماً أو رمزاً مختلفاً." />}
        <Pressable testID="open-cart" disabled={!cart.length} onPress={() => setOpen(true)} style={({ pressed }) => [styles.checkoutBar, { backgroundColor: colors.primary, opacity: !cart.length ? 0.45 : pressed ? 0.75 : 1 }]}><View style={styles.checkoutCopy}><Ionicons name="cart-outline" size={21} color={colors.primaryForeground} /><Text style={[styles.checkoutText, { color: colors.primaryForeground }]}>السلة ({cart.reduce((sum, item) => sum + item.quantity, 0)})</Text></View><Money value={total} color={colors.primaryForeground} /></Pressable>
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.modalShade}><View style={[styles.sheet, { backgroundColor: colors.background }]}><View style={styles.sheetHeader}><Pressable onPress={() => setOpen(false)}><Ionicons name="close" size={26} color={colors.foreground} /></Pressable><Text style={[commonStyles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>إتمام البيع</Text></View>
            {cart.map((item) => <Card key={item.product.id} style={styles.cartRow}><View style={styles.cartName}><Text style={[styles.productName, { color: colors.foreground }]}>{item.product.name}</Text><Money value={priceOf(item.product) * item.quantity} /></View><View style={styles.stepper}><Pressable onPress={() => adjust(item.product.id, -1)}><Ionicons name="remove-circle-outline" size={27} color={colors.mutedForeground} /></Pressable><Text style={[styles.qty, { color: colors.foreground }]}>{item.quantity}</Text><Pressable onPress={() => adjust(item.product.id, 1)}><Ionicons name="add-circle" size={27} color={colors.primary} /></Pressable></View></Card>)}
            <TextInput value={customerName} onChangeText={setCustomerName} placeholder="اسم العميل (اختياري)" placeholderTextColor={colors.mutedForeground} style={[styles.search, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
            <View style={styles.payment}>{(['cash', 'card', 'credit'] as const).map((method) => <Pressable key={method} onPress={() => setPaymentMethod(method)} style={[styles.paymentButton, { borderColor: paymentMethod === method ? colors.primary : colors.border, backgroundColor: paymentMethod === method ? colors.accent : colors.card }]}><Ionicons name={method === 'cash' ? 'cash-outline' : method === 'card' ? 'card-outline' : 'time-outline'} size={21} color={paymentMethod === method ? colors.primary : colors.mutedForeground} /><Text style={[styles.paymentText, { color: colors.foreground }]}>{method === 'cash' ? 'نقدي' : method === 'card' ? 'شبكة' : 'آجل'}</Text></Pressable>)}</View>
            {paymentMethod === 'credit' ? <TextInput value={dueDate} onChangeText={setDueDate} placeholder="تاريخ الاستحقاق YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.search, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} /> : null}
            <Pressable testID="checkout-submit" disabled={submitting} onPress={() => void submit()} style={[styles.submit, { backgroundColor: colors.primary }]}>{submitting ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.submitText, { color: colors.primaryForeground }]}>تأكيد الدفع — {new Intl.NumberFormat('ar-SA').format(total)} ر.س</Text>}</Pressable>
          </View></View>
        </Modal>
      </PermissionGate>
    </Screen>
  );
}
const styles = StyleSheet.create({
  warehouses: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 13 },
  chipText: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
  search: { height: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontFamily: 'Cairo_400Regular', textAlign: 'right' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  product: { width: '48%', borderWidth: 1, borderRadius: 17, padding: 12, gap: 7 },
  productIcon: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productName: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, textAlign: 'right' },
  stock: { fontFamily: 'Cairo_400Regular', fontSize: 10, textAlign: 'right' },
  checkoutBar: { minHeight: 58, borderRadius: 17, paddingHorizontal: 17, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  checkoutCopy: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  checkoutText: { fontFamily: 'Cairo_700Bold', fontSize: 14 },
  modalShade: { flex: 1, backgroundColor: 'rgba(2,6,23,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, gap: 11 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cartRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  cartName: { flex: 1, gap: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qty: { fontFamily: 'Cairo_700Bold', minWidth: 20, textAlign: 'center' },
  payment: { flexDirection: 'row-reverse', gap: 8 },
  paymentButton: { flex: 1, borderWidth: 1, borderRadius: 13, paddingVertical: 10, alignItems: 'center', gap: 3 },
  paymentText: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
  submit: { minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontFamily: 'Cairo_700Bold', fontSize: 14 },
});