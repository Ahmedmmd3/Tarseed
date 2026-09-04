import assert from "node:assert/strict";
import test from "node:test";
import { commonJournalSuggestion } from "../src/lib/journal-suggestion.ts";

const accounts = [
  { id: "cash", code: "1000", name: "الصندوق" },
  { id: "bank", code: "1100", name: "البنك" },
  { id: "rent", code: "5100", name: "مصاريف إيجار" },
  { id: "salaries", code: "5200", name: "مصاريف رواتب" },
  { id: "utilities", code: "5300", name: "مصاريف مرافق" },
];

test("يفهم دفع الإيجار النقدي من وصف عربي قصير", () => {
  const rawSuggestion = commonJournalSuggestion("دفعنا إيجار 3000 ريال نقداً", accounts);
  assert.ok(rawSuggestion);
  assert.deepEqual(JSON.parse(rawSuggestion), {
    description: "دفع إيجار نقداً",
    lines: [
      { accountId: "rent", debit: 3000, credit: 0 },
      { accountId: "cash", debit: 0, credit: 3000 },
    ],
  });
});

test("يفهم الأرقام العربية والدفع البنكي للمرافق", () => {
  const rawSuggestion = commonJournalSuggestion("سددنا فاتورة الكهرباء ١٬٢٥٠ عن طريق البنك", accounts);
  assert.ok(rawSuggestion);
  assert.deepEqual(JSON.parse(rawSuggestion), {
    description: "دفع مصروف مرافق عن طريق البنك",
    lines: [
      { accountId: "utilities", debit: 1250, credit: 0 },
      { accountId: "bank", debit: 0, credit: 1250 },
    ],
  });
});