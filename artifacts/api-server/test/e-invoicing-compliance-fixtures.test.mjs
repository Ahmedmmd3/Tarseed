import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ZATCA_COMPLIANCE_FIXTURES,
  complianceSuiteIsPassed,
  generateCsr,
  generateInvoiceDocument,
  officialValidationStatus,
} from "../src/lib/e-invoicing.ts";

const seller = {
  sellerName: "منشأة اختبار",
  vatNumber: "310122393500003",
  commercialRegistrationNumber: "1010123456",
  street: "شارع الملك",
  buildingNumber: "1234",
  city: "الرياض",
  postalCode: "12345",
  countryCode: "SA",
  vatRate: 15,
  pricesIncludeVat: true,
};

test("تطابق fixtures حالات Sandbox الرسمية المطلوبة", () => {
  const directory = join(process.cwd(), "test/fixtures/zatca");
  const fixtures = readdirSync(directory).map((file) => JSON.parse(readFileSync(join(directory, file), "utf8")));
  assert.deepEqual(fixtures.map((fixture) => fixture.id).sort(), ZATCA_COMPLIANCE_FIXTURES.map((fixture) => fixture.id).sort());
  for (const fixture of fixtures) {
    assert.equal(fixture.source, "ZATCA Fatoora Compliance API V2 Sandbox");
    assert.equal(fixture.endpoint, "/compliance/invoices");
    assert.equal(fixture.expectedValidationStatus, "PASS");
    assert.ok(fixture.input?.invoiceNumber);
    assert.ok(Array.isArray(fixture.input?.lines) && fixture.input.lines.length > 0);
  }
});

test("تغطي fixtures مستندات UBL الموقعة لكل حالة امتثال", async () => {
  const csr = await generateCsr(seller, "POS-RYD-01", "DEV-COMPLIANCE");
  const fixtureDirectory = join(process.cwd(), "test/fixtures/zatca");
  const fixtureInputs = new Map(readdirSync(fixtureDirectory)
    .map((file) => JSON.parse(readFileSync(join(fixtureDirectory, file), "utf8")))
    .map((fixture) => [fixture.id, fixture.input]));
  const directory = mkdtempSync(join(tmpdir(), "tarseed-zatca-fixture-"));
  try {
    const keyPath = join(directory, "key.pem");
    const certificatePath = join(directory, "certificate.pem");
    writeFileSync(keyPath, csr.privateKeyPem, { mode: 0o600 });
    execFileSync("openssl", [
      "req", "-x509", "-new", "-key", keyPath, "-days", "1",
      "-subj", "/CN=Test/O=Tarseed/C=SA", "-out", certificatePath,
    ]);
    const certificatePem = readFileSync(certificatePath, "utf8");
    for (const [index, fixture] of ZATCA_COMPLIANCE_FIXTURES.entries()) {
      const input = fixtureInputs.get(fixture.id);
      assert.ok(input, `missing input fixture for ${fixture.id}`);
      const document = await generateInvoiceDocument({
        ...input,
        invoiceCounter: index + 1,
        previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGM4YzNkNzZiY2YzY2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y=",
        documentType: fixture.documentType,
        issueAt: new Date("2026-08-25T12:00:00.000Z"),
        seller,
        privateKeyPem: csr.privateKeyPem,
        certificatePem,
      });
      assert.equal(document.signatureValid, true);
      assert.equal(document.localValidationError, null);
      assert.match(document.xml, /<cbc:UUID>/);
      execFileSync("xmllint", ["--noout", "-"], { input: document.xml });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("لا تعتبر الاستجابة الرسمية مقبولة إلا مع نتيجة PASS لكل حالة", () => {
  assert.equal(officialValidationStatus({ validationResults: { status: "PASS" } }), "PASS");
  assert.equal(officialValidationStatus({ validationResults: { status: "FAIL" } }), "FAIL");
  assert.equal(officialValidationStatus({}), "UNKNOWN");
  assert.equal(complianceSuiteIsPassed(ZATCA_COMPLIANCE_FIXTURES.map((fixture, index) => ({
    fixtureId: fixture.id,
    label: fixture.label,
    documentType: fixture.documentType,
    documentId: index + 1,
    invoiceNumber: fixture.id,
    status: "passed",
    httpStatus: 200,
    authorityMessage: null,
    checkedAt: "2026-08-25T12:00:00.000Z",
  }))), true);
});