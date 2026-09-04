export type JournalAccountInput = {
  id: string;
  code: string;
  name: string;
};

function normalizeArabicText(value: string): string {
  return value
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

function extractOperationAmount(operation: string): number | null {
  const normalizedDigits = operation
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[٬،]/g, ",");
  const matches = [...normalizedDigits.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function findJournalAccount(
  accounts: JournalAccountInput[],
  codes: string[],
  names: string[],
): JournalAccountInput | undefined {
  const normalizedNames = names.map(normalizeArabicText);
  return accounts.find((account) => codes.includes(account.code))
    ?? accounts.find((account) => {
      const normalizedName = normalizeArabicText(account.name);
      return normalizedNames.some((name) => normalizedName.includes(name));
    });
}

export function commonJournalSuggestion(
  operation: string,
  accounts: JournalAccountInput[],
): string | null {
  const normalized = normalizeArabicText(operation);
  const amount = extractOperationAmount(operation);
  if (!amount) return null;

  const paymentAccount = /(نقد|كاش|صندوق)/.test(normalized)
    ? findJournalAccount(accounts, ["1000"], ["الصندوق", "نقد"])
    : /(بنك|تحويل)/.test(normalized)
      ? findJournalAccount(accounts, ["1100"], ["البنك"])
      : undefined;
  if (!paymentAccount) return null;

  const expenseRules = [
    { pattern: /ايجار/, codes: ["5100"], names: ["ايجار"], description: "دفع إيجار" },
    { pattern: /رواتب|راتب|اجور/, codes: ["5200"], names: ["رواتب", "اجور"], description: "دفع رواتب" },
    { pattern: /مرافق|كهرباء|مياه|ماء|انترنت|اتصالات/, codes: ["5300"], names: ["مرافق"], description: "دفع مصروف مرافق" },
  ];
  const expenseRule = expenseRules.find((rule) => rule.pattern.test(normalized));
  if (!expenseRule) return null;
  const expenseAccount = findJournalAccount(accounts, expenseRule.codes, expenseRule.names);
  if (!expenseAccount || expenseAccount.id === paymentAccount.id) return null;

  return JSON.stringify({
    description: `${expenseRule.description} ${paymentAccount.code === "1000" ? "نقداً" : "عن طريق البنك"}`,
    lines: [
      { accountId: expenseAccount.id, debit: amount, credit: 0 },
      { accountId: paymentAccount.id, debit: 0, credit: amount },
    ],
  });
}