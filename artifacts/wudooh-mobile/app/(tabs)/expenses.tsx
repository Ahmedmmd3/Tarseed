import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Empty, Money, PermissionGate, Screen, commonStyles } from '@/components/AppUI';
import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { todayLocalDate } from '@/lib/date';

const categories = ['إيجار', 'رواتب', 'مشتريات', 'مرافق', 'تسويق', 'نقل', 'صيانة', 'أخرى'];
export default function ExpensesScreen() {
  const colors = useColors();
  const { expenses, addExpense } = useApp();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('أخرى');
  const [vendor, setVendor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async () => {
    const numericAmount = Number(amount);
    if (!description.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setMessage('أدخل بياناً ومبلغاً صحيحاً.');
      return;
    }
    setSubmitting(true);
    const result = await addExpense({ description: description.trim(), amount: numericAmount, date: todayLocalDate(), category, vendor: vendor.trim() || undefined });
    setSubmitting(false);
    setOpen(false);
    setDescription('');
    setAmount('');
    setVendor('');
    setMessage(result.queued ? 'حُفظ المصروف محلياً وبانتظار المزامنة.' : 'تم حفظ المصروف.');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  return (
    <Screen testID="expenses-screen" title="المصاريف" eyebrow="تسجيل ومتابعة المصروفات">
      <PermissionGate permission="accounting">
        <Pressable testID="add-expense" onPress={() => setOpen(true)} style={[styles.add, { backgroundColor: colors.primary }]}><Ionicons name="add" size={23} color={colors.primaryForeground} /><Text style={[styles.addText, { color: colors.primaryForeground }]}>مصروف جديد</Text></Pressable>
        {message ? <Card><Text style={[commonStyles.body, { color: colors.success }]}>{message}</Text></Card> : null}
        {expenses.length ? expenses.map((expense) => <Card key={String(expense.id)} style={styles.expense}><View style={[styles.expenseIcon, { backgroundColor: colors.secondary }]}><Ionicons name="receipt-outline" size={21} color={colors.rose} /></View><View style={styles.expenseCopy}><Text style={[styles.description, { color: colors.foreground }]}>{expense.description ?? 'مصروف'}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{expense.category ?? 'أخرى'} · {expense.date ?? '—'}</Text></View><Money value={Number(expense.amount ?? 0)} color={colors.rose} /></Card>) : <Empty icon="receipt-outline" title="لا توجد مصاريف" text="سجّل أول مصروف من الزر أعلاه." />}
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={styles.shade}><View style={[styles.sheet, { backgroundColor: colors.background }]}><View style={styles.header}><Pressable onPress={() => setOpen(false)}><Ionicons name="close" size={26} color={colors.foreground} /></Pressable><Text style={[commonStyles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>مصروف جديد</Text></View>
          <TextInput testID="expense-description" value={description} onChangeText={setDescription} placeholder="بيان المصروف" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
          <TextInput testID="expense-amount" value={amount} onChangeText={setAmount} placeholder="المبلغ" keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
          <View style={styles.categories}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.category, { borderColor: category === item ? colors.primary : colors.border, backgroundColor: category === item ? colors.accent : colors.card }]}><Text style={[styles.categoryText, { color: category === item ? colors.accentForeground : colors.mutedForeground }]}>{item}</Text></Pressable>)}</View>
          <TextInput value={vendor} onChangeText={setVendor} placeholder="المورد (اختياري)" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
          {message ? <Text style={[styles.formMessage, { color: colors.destructive }]}>{message}</Text> : null}
          <Pressable testID="save-expense" disabled={submitting} onPress={() => void submit()} style={[styles.submit, { backgroundColor: colors.primary }]}>{submitting ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.addText, { color: colors.primaryForeground }]}>حفظ المصروف</Text>}</Pressable>
        </View></View></Modal>
      </PermissionGate>
    </Screen>
  );
}
const styles = StyleSheet.create({
  add: { height: 50, borderRadius: 14, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addText: { fontFamily: 'Cairo_700Bold', fontSize: 14 },
  expense: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, padding: 12 },
  expenseIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  expenseCopy: { flex: 1 },
  description: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, textAlign: 'right' },
  meta: { fontFamily: 'Cairo_400Regular', fontSize: 10, textAlign: 'right' },
  shade: { flex: 1, backgroundColor: 'rgba(2,6,23,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, gap: 11 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { height: 49, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontFamily: 'Cairo_400Regular', textAlign: 'right' },
  categories: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  category: { borderWidth: 1, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 11 },
  categoryText: { fontFamily: 'Cairo_500Medium', fontSize: 10 },
  formMessage: { fontFamily: 'Cairo_500Medium', fontSize: 11, textAlign: 'right' },
  submit: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});