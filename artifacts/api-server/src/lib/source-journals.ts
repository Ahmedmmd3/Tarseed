export type SourceTable = "invoices" | "purchaseOrders" | "expenses";
export type SourceType = "sale" | "purchase" | "expense";

type AccountRecord = Record<string, unknown> & { id: number };

export class SourceJournalError extends Error {
  readonly status = 409;
}

const asNumber = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function sourceTypeFor(tableName: SourceTable): SourceType {
  return tableName === "invoices" ? "sale" : tableName === "purchaseOrders" ? "purchase" : "expense";
}

export function sourceTypeVariants(tableName: SourceTable): string[] {
  return tableName === "expenses" ? ["expenses", "expense"] : [sourceTypeFor(tableName)];
}

export function journalLinesForSource(
  tableName: SourceTable,
  data: Record<string, unknown>,
  accounts: AccountRecord[],
): Array<{ accountId: string; debit: number; credit: number }> {
  const type = sourceTypeFor(tableName);
  const account = (code: string) => accounts.find((item) => String(item.code) === code && item.status !== "inactive");
  const total = asNumber(
    Array.isArray(data.receipts)
      ? data.receivedTotal
      : data.total ?? data.amount ?? data.totalAmount,
  );
  const tax = Array.isArray(data.receipts) ? asNumber(data.receivedVat) : asNumber(data.tax);
  const net = Array.isArray(data.receipts)
    ? asNumber(data.receivedSubtotal)
    : asNumber(data.subtotal ?? total - tax);
  const cogs = asNumber(data.cogsTotal);
  const cashOrAr = account(
    data.paymentMethod === "credit" || data.customerId
      ? "1200"
      : data.paymentMethod === "card" || data.paymentMethod === "transfer"
        ? "1100"
        : "1000",
  );

  if (total <= 0 || !cashOrAr) {
    throw new SourceJournalError("يلزم مبلغ موجب وحسابات افتراضية نشطة مطابقة في دليل الحسابات.");
  }

  if (type === "sale") {
    const sales = account("4000");
    const outputVat = account("2100");
    const inventory = account("1300");
    const cogsAccount = account("5500") ?? account("6000");
    if (!sales || !outputVat || !inventory || !cogsAccount) {
      throw new SourceJournalError("الحسابات الافتراضية للبيع غير مكتملة.");
    }
    return [
      { accountId: String(cashOrAr.id), debit: total, credit: 0 },
      { accountId: String(sales.id), debit: 0, credit: net },
      { accountId: String(outputVat.id), debit: 0, credit: tax },
      { accountId: String(cogsAccount.id), debit: cogs, credit: 0 },
      { accountId: String(inventory.id), debit: 0, credit: cogs },
    ];
  }

  if (type === "purchase") {
    const inventory = account("1300");
    const inputVat = account("1400");
    const settlement = account(data.paymentMethod === "credit" ? "2000" : "1000");
    if (!inventory || !inputVat || !settlement) {
      throw new SourceJournalError("الحسابات الافتراضية للشراء غير مكتملة.");
    }
    return [
      { accountId: String(inventory.id), debit: net, credit: 0 },
      { accountId: String(inputVat.id), debit: tax, credit: 0 },
      { accountId: String(settlement.id), debit: 0, credit: total },
    ];
  }

  const expenseCategoryMap: Record<string, string> = {
    "إيجار": "5100",
    "رواتب": "5200",
    "مرافق": "5300",
    "كهرباء": "5300",
    "ماء": "5300",
    "تسويق": "5400",
    "إعلان": "5400",
    "نقل": "5500",
    "مواصلات": "5500",
    "صيانة": "5600",
    "مشتريات": "5000",
    "أخرى": "5900",
  };
  const requestedExpenseCode = expenseCategoryMap[String(data.category ?? "")] ?? "5100";
  const expense = account(requestedExpenseCode) ?? account("5100");
  const settlement = account(
    data.paymentMethod === "card" || data.paymentMethod === "transfer" ? "1100" : "1000",
  );
  if (!expense || !settlement) {
    throw new SourceJournalError("الحسابات الافتراضية للمصروف غير مكتملة.");
  }
  return [
    { accountId: String(expense.id), debit: total, credit: 0 },
    { accountId: String(settlement.id), debit: 0, credit: total },
  ];
}