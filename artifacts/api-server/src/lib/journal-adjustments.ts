export type JournalAdjustmentAction = "reverse" | "correct";

type JournalLineRecord = {
  accountId: string;
  debit: number;
  credit: number;
};

export type JournalRecord = Record<string, unknown> & {
  id?: number;
  number?: string;
  date?: string;
  description?: string;
  status?: string;
  lines?: unknown;
};

export type PreparedJournalAdjustment = {
  reversal: Record<string, unknown>;
  correction?: Record<string, unknown>;
};

export class JournalAdjustmentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeLines(value: unknown): JournalLineRecord[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new JournalAdjustmentError(400, "يجب أن يحتوي القيد المصحح على سطرين على الأقل.");
  }
  let totalDebit = 0;
  let totalCredit = 0;
  const lines = value.map((rawLine) => {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      throw new JournalAdjustmentError(400, "أسطر القيد المصحح غير صحيحة.");
    }
    const line = rawLine as Record<string, unknown>;
    const accountId = String(line.accountId ?? "").trim();
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    if (
      !accountId
      || !Number.isFinite(debit)
      || !Number.isFinite(credit)
      || debit < 0
      || credit < 0
      || ((debit > 0) === (credit > 0))
    ) {
      throw new JournalAdjustmentError(400, "كل سطر يحتاج حساباً ومبلغاً موجباً في المدين أو الدائن فقط.");
    }
    totalDebit += debit;
    totalCredit += credit;
    return { accountId, debit, credit };
  });
  if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new JournalAdjustmentError(400, "إجمالي المدين يجب أن يساوي إجمالي الدائن.");
  }
  return lines;
}

function linkedScope(original: JournalRecord): Record<string, unknown> {
  const keys = ["warehouseId", "fromWarehouseId", "toWarehouseId", "sourceType", "sourceId"];
  return Object.fromEntries(keys.flatMap((key) => original[key] == null ? [] : [[key, original[key]]]));
}

export function prepareJournalAdjustment(
  original: JournalRecord,
  action: JournalAdjustmentAction,
  body: Record<string, unknown>,
): PreparedJournalAdjustment {
  if (original.status !== "posted") {
    throw new JournalAdjustmentError(409, "يمكن عكس أو تصحيح القيود المرحلة فقط.");
  }
  if (original.adjustmentType === "reversal") {
    throw new JournalAdjustmentError(409, "لا يمكن عكس أو تصحيح قيد عكس.");
  }
  if (original.sourceType != null || original.sourceId != null) {
    throw new JournalAdjustmentError(409, "هذا القيد مولّد من مستند مصدري. صحّح أو ألغِ المستند من شاشته حتى تبقى القيود والمخزون والذمم متطابقة.");
  }
  if (
    original.adjustmentStatus === "reversed"
    || original.adjustmentStatus === "corrected"
    || (Array.isArray(original.adjustedByJournalIds) && original.adjustedByJournalIds.length > 0)
  ) {
    throw new JournalAdjustmentError(409, "سبق عكس أو تصحيح هذا القيد.");
  }
  if (!validDate(body.date)) {
    throw new JournalAdjustmentError(400, "يجب تحديد تاريخ صحيح للعكس أو التصحيح.");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) {
    throw new JournalAdjustmentError(400, "أدخل سبباً واضحاً من 3 إلى 1000 حرف.");
  }
  const originalLines = normalizeLines(original.lines);
  const originalId = Number(original.id);
  if (!Number.isInteger(originalId) || originalId <= 0) {
    throw new JournalAdjustmentError(400, "مرجع القيد الأصلي غير صالح.");
  }
  const originalNumber = String(original.number ?? `#${originalId}`);
  const scope = linkedScope(original);
  const reversal = {
    ...scope,
    number: `REV-${originalNumber}`,
    date: body.date,
    description: `عكس القيد ${originalNumber}: ${reason}`,
    status: "posted",
    lines: originalLines.map((line, index) => ({
      id: `reversal-${index + 1}`,
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
    })),
    adjustmentType: "reversal",
    adjustsJournalId: originalId,
    adjustmentReason: reason,
  };
  if (action === "reverse") return { reversal };

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length > 1000) {
    throw new JournalAdjustmentError(400, "أدخل بياناً صحيحاً للقيد المصحح.");
  }
  const correctedLines = normalizeLines(body.lines);
  return {
    reversal,
    correction: {
      ...scope,
      number: `COR-${originalNumber}`,
      date: body.date,
      description,
      status: "posted",
      lines: correctedLines.map((line, index) => ({ ...line, id: `correction-${index + 1}` })),
      adjustmentType: "correction",
      adjustsJournalId: originalId,
      adjustmentReason: reason,
    },
  };
}

export function auditDetails(
  original: JournalRecord,
  prepared: PreparedJournalAdjustment,
  createdIds: number[],
): string {
  return JSON.stringify({
    reason: prepared.reversal.adjustmentReason,
    original: { ...original },
    relationship: {
      originalJournalId: original.id,
      createdJournalIds: createdIds,
      originalRemainsUnchanged: true,
    },
    created: [
      { id: createdIds[0], ...prepared.reversal },
      ...(prepared.correction ? [{ id: createdIds[1], ...prepared.correction }] : []),
    ],
  });
}