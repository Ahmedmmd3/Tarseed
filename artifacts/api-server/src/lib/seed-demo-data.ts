import { and, eq, sql } from "drizzle-orm";
import { db, erpRecordsTable } from "@workspace/db";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;
type DemoRecordData = Record<string, unknown>;

export const DEMO_SEED_KEY = "new-organization-v1";

export const DEFAULT_WAREHOUSE_DEFINITIONS = [
  { name: "المستودع الرئيسي", type: "warehouse", city: "", manager: "", status: "active" },
  { name: "فرع المبيعات", type: "branch", city: "", manager: "", status: "active" },
] as const;

export const DEFAULT_ACCOUNT_DEFINITIONS = [
  { code: "1000", name: "الصندوق", type: "asset", parent: null, openingBalance: 0, status: "active" },
  { code: "1100", name: "البنك", type: "asset", parent: null, openingBalance: 0, status: "active" },
  { code: "1200", name: "العملاء", type: "asset", parent: null, openingBalance: 0, status: "active" },
  { code: "1300", name: "المخزون", type: "asset", parent: null, openingBalance: 0, status: "active" },
  { code: "1400", name: "ضريبة مدخلات", type: "asset", parent: null, openingBalance: 0, status: "active" },
  { code: "2000", name: "الموردون", type: "liability", parent: null, openingBalance: 0, status: "active" },
  { code: "2100", name: "ضريبة مخرجات", type: "liability", parent: null, openingBalance: 0, status: "active" },
  { code: "2200", name: "مصروفات مستحقة", type: "liability", parent: null, openingBalance: 0, status: "active" },
  { code: "3000", name: "رأس المال", type: "equity", parent: null, openingBalance: 0, status: "active" },
  { code: "3100", name: "الأرباح المبقاة", type: "equity", parent: null, openingBalance: 0, status: "active" },
  { code: "4000", name: "المبيعات", type: "revenue", parent: null, openingBalance: 0, status: "active" },
  { code: "4100", name: "إيرادات أخرى", type: "revenue", parent: null, openingBalance: 0, status: "active" },
  { code: "5000", name: "مصروفات تشغيلية", type: "expense", parent: null, openingBalance: 0, status: "active" },
  { code: "5100", name: "مصروفات الرواتب", type: "expense", parent: null, openingBalance: 0, status: "active" },
  { code: "5500", name: "تكلفة المبيعات", type: "expense", parent: null, openingBalance: 0, status: "active" },
] as const;

const CUSTOMERS = [
  { name: "شركة النور للتجارة", phone: "0112001001", email: "alnoor@example.com", vatNumber: "310123456700003" },
  { name: "مؤسسة الخليج", phone: "0138002002", email: "alkhaleej@example.com", vatNumber: "310123456700011" },
  { name: "محلات الأمين", phone: "0126003003", email: "alameen@example.com", vatNumber: "310123456700029" },
] as const;

const PRODUCTS = [
  { name: "قهوة عربية", sku: "QH001", sellPrice: 45, stock: 100, costPrice: 30 },
  { name: "تمر مجدول", sku: "TM001", sellPrice: 120, stock: 50, costPrice: 80 },
  { name: "عسل طبيعي", sku: "AS001", sellPrice: 200, stock: 30, costPrice: 140 },
  { name: "زعفران", sku: "ZF001", sellPrice: 350, stock: 20, costPrice: 250 },
  { name: "ماء معدني كرتون", sku: "MA001", sellPrice: 25, stock: 200, costPrice: 15 },
] as const;

const INVOICES = [
  { customerIndex: 0, total: 4_500, status: "paid", paymentMethod: "cash", day: 4 },
  { customerIndex: 1, total: 8_200, status: "paid", paymentMethod: "card", day: 10 },
  { customerIndex: 2, total: 3_750, status: "pending", paymentMethod: "credit", day: 16 },
  { customerIndex: 0, total: 6_100, status: "overdue", paymentMethod: "credit", day: 2 },
] as const;

const EXPENSES = [
  { description: "إيجار", amount: 3_500, category: "إيجار", accountCode: "5000", day: 3 },
  { description: "رواتب", amount: 12_000, category: "رواتب", accountCode: "5100", day: 8 },
  { description: "كهرباء", amount: 850, category: "مرافق", accountCode: "5000", day: 13 },
  { description: "تسويق", amount: 1_200, category: "تسويق", accountCode: "5000", day: 18 },
  { description: "صيانة", amount: 450, category: "صيانة", accountCode: "5000", day: 22 },
] as const;

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function dateInCurrentMonth(day: number, now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function tagged(data: DemoRecordData, dataGeneration: number): DemoRecordData {
  return {
    ...data,
    isDemoData: true,
    demoSeedKey: DEMO_SEED_KEY,
    demoDataGeneration: dataGeneration,
  };
}

function balanced(lines: Array<{ accountId: string; debit: number; credit: number }>): boolean {
  const debit = money(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = money(lines.reduce((sum, line) => sum + line.credit, 0));
  return debit === credit;
}

async function ensureDefaultWarehouses(
  organizationId: number,
  executor: DatabaseExecutor,
): Promise<void> {
  const existing = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "warehouses"),
  ));
  const existingKeys = new Set(existing.map((record) => `${String(record.data.name)}:${String(record.data.type)}`));
  const missing = DEFAULT_WAREHOUSE_DEFINITIONS.filter(
    (definition) => !existingKeys.has(`${definition.name}:${definition.type}`),
  );
  if (!missing.length) return;

  await executor.insert(erpRecordsTable).values(missing.map((definition) => ({
    organizationId,
    tableName: "warehouses",
    data: { ...definition },
  })));
}

export async function seedDemoData(
  organizationId: number,
  dataGeneration: number,
  executor: DatabaseExecutor = db,
  now = new Date(),
): Promise<{ created: number }> {
  await ensureDefaultWarehouses(organizationId, executor);

  const existing = await executor.select({ id: erpRecordsTable.id }).from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    sql`${erpRecordsTable.data}->>'demoSeedKey' = ${DEMO_SEED_KEY}`,
  )).limit(1);
  if (existing.length) return { created: 0 };

  const [warehouse] = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "warehouses"),
  )).orderBy(erpRecordsTable.id).limit(1);
  if (!warehouse) throw new Error("تعذر العثور على المستودع الافتراضي لإنشاء البيانات التجريبية.");

  const insertedAccounts = await executor.insert(erpRecordsTable).values(
    DEFAULT_ACCOUNT_DEFINITIONS.map((definition) => ({
      organizationId,
      tableName: "accounts",
      data: tagged({ ...definition }, dataGeneration),
    })),
  ).onConflictDoNothing().returning();
  const accountRows = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "accounts"),
  ));
  const accountByCode = new Map(accountRows.map((row) => [String(row.data.code), row]));
  const accountId = (code: string): string => {
    const account = accountByCode.get(code);
    if (!account) throw new Error(`الحساب الافتراضي ${code} غير متاح.`);
    return String(account.id);
  };

  const customerRows = await executor.insert(erpRecordsTable).values(CUSTOMERS.map((customer) => ({
    organizationId,
    tableName: "customers",
    data: tagged({ ...customer, status: "active", city: "الرياض" }, dataGeneration),
  }))).returning();

  const productRows = await executor.insert(erpRecordsTable).values(PRODUCTS.map((product) => ({
    organizationId,
    tableName: "products",
    data: tagged({
      name: product.name,
      sku: product.sku,
      barcode: "",
      sellPrice: product.sellPrice,
      costPrice: product.costPrice,
      stock: product.stock,
      vatRate: 15,
      status: "active",
    }, dataGeneration),
  }))).returning();

  const inventoryRecords = productRows.flatMap((product, index) => {
    const definition = PRODUCTS[index];
    const common = {
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: definition.stock,
    };
    return [
      {
        organizationId,
        tableName: "inventoryBalances",
        data: tagged(common, dataGeneration),
      },
      {
        organizationId,
        tableName: "inventoryLayers",
        data: tagged({
          productId: product.id,
          warehouseId: warehouse.id,
          originalQuantity: definition.stock,
          remainingQuantity: definition.stock,
          unitCostExVat: definition.costPrice,
          receivedDate: dateInCurrentMonth(1, now),
          layerType: "demo_opening",
        }, dataGeneration),
      },
    ];
  });
  await executor.insert(erpRecordsTable).values(inventoryRecords);

  const journals: Array<{
    organizationId: number;
    tableName: string;
    data: DemoRecordData;
  }> = [];
  const inventoryValue = PRODUCTS.reduce((sum, product) => sum + product.stock * product.costPrice, 0);
  const openingLines = [
    { accountId: accountId("1300"), debit: inventoryValue, credit: 0 },
    { accountId: accountId("3000"), debit: 0, credit: inventoryValue },
  ];
  journals.push({
    organizationId,
    tableName: "journalEntries",
    data: tagged({
      number: "DEMO-J-001",
      date: dateInCurrentMonth(1, now),
      description: "إثبات المخزون التجريبي الافتتاحي",
      status: "posted",
      sourceType: "opening_balance",
      lines: openingLines,
    }, dataGeneration),
  });

  let createdCount = insertedAccounts.length + customerRows.length + productRows.length + inventoryRecords.length;
  for (const [index, invoiceDefinition] of INVOICES.entries()) {
    const customer = customerRows[invoiceDefinition.customerIndex];
    const customerDefinition = CUSTOMERS[invoiceDefinition.customerIndex];
    const subtotal = money(invoiceDefinition.total / 1.15);
    const tax = money(invoiceDefinition.total - subtotal);
    const issueDate = dateInCurrentMonth(invoiceDefinition.day, now);
    const dueDate = invoiceDefinition.status === "overdue"
      ? dateInCurrentMonth(5, now)
      : dateInCurrentMonth(28, now);
    const [invoice] = await executor.insert(erpRecordsTable).values({
      organizationId,
      tableName: "invoices",
      data: tagged({
        number: `DEMO-INV-${String(index + 1).padStart(3, "0")}`,
        issueDate,
        dueDate: invoiceDefinition.paymentMethod === "credit" ? dueDate : undefined,
        warehouseId: warehouse.id,
        customerId: customer.id,
        customerName: customerDefinition.name,
        customerVatNumber: customerDefinition.vatNumber,
        paymentMethod: invoiceDefinition.paymentMethod,
        status: invoiceDefinition.status,
        items: [{
          name: "توريد منتجات متنوعة",
          quantity: 1,
          unitPrice: subtotal,
          vatRate: 15,
          vatAmount: tax,
          lineNet: subtotal,
          lineGross: invoiceDefinition.total,
          total: invoiceDefinition.total,
        }],
        subtotal,
        tax,
        total: invoiceDefinition.total,
        paid: invoiceDefinition.status === "paid" ? invoiceDefinition.total : 0,
      }, dataGeneration),
    }).returning();
    createdCount += 1;

    const settlementAccount = invoiceDefinition.paymentMethod === "cash"
      ? "1000"
      : invoiceDefinition.paymentMethod === "card" ? "1100" : "1200";
    const lines = [
      { accountId: accountId(settlementAccount), debit: invoiceDefinition.total, credit: 0 },
      { accountId: accountId("4000"), debit: 0, credit: subtotal },
      { accountId: accountId("2100"), debit: 0, credit: tax },
    ];
    if (!balanced(lines)) throw new Error("تعذر إنشاء قيد فاتورة تجريبية متوازن.");
    journals.push({
      organizationId,
      tableName: "journalEntries",
      data: tagged({
        number: `DEMO-J-${String(index + 2).padStart(3, "0")}`,
        date: issueDate,
        description: `فاتورة تجريبية — ${customerDefinition.name}`,
        status: "posted",
        sourceType: "sale",
        sourceId: invoice.id,
        lines,
      }, dataGeneration),
    });

    if (invoiceDefinition.paymentMethod === "credit") {
      await executor.insert(erpRecordsTable).values({
        organizationId,
        tableName: "receivables",
        data: tagged({
          invoiceId: invoice.id,
          customerId: customer.id,
          customerName: customerDefinition.name,
          party: customerDefinition.name,
          type: "receivable",
          reference: `DEMO-INV-${String(index + 1).padStart(3, "0")}`,
          issueDate,
          dueDate,
          amount: invoiceDefinition.total,
          paid: 0,
          status: invoiceDefinition.status === "overdue" ? "overdue" : "unpaid",
        }, dataGeneration),
      });
      createdCount += 1;
    }
  }

  for (const [index, expenseDefinition] of EXPENSES.entries()) {
    const date = dateInCurrentMonth(expenseDefinition.day, now);
    const [expense] = await executor.insert(erpRecordsTable).values({
      organizationId,
      tableName: "expenses",
      data: tagged({
        description: expenseDefinition.description,
        amount: expenseDefinition.amount,
        date,
        category: expenseDefinition.category,
        vendor: "",
        paymentMethod: "cash",
        paid: expenseDefinition.amount,
        status: "paid",
      }, dataGeneration),
    }).returning();
    createdCount += 1;
    const lines = [
      { accountId: accountId(expenseDefinition.accountCode), debit: expenseDefinition.amount, credit: 0 },
      { accountId: accountId("1000"), debit: 0, credit: expenseDefinition.amount },
    ];
    if (!balanced(lines)) throw new Error("تعذر إنشاء قيد مصروف تجريبي متوازن.");
    journals.push({
      organizationId,
      tableName: "journalEntries",
      data: tagged({
        number: `DEMO-J-${String(index + 6).padStart(3, "0")}`,
        date,
        description: `مصروف تجريبي — ${expenseDefinition.description}`,
        status: "posted",
        sourceType: "expense",
        sourceId: expense.id,
        lines,
      }, dataGeneration),
    });
  }

  await executor.insert(erpRecordsTable).values(journals);
  createdCount += journals.length;
  return { created: createdCount };
}