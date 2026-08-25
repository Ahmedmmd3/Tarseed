import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateCsr, generateInvoiceDocument } from "../src/lib/e-invoicing.ts";

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

const baseInput = {
  invoiceNumber: "TEST-1",
  invoiceCounter: 1,
  previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGM4YzNkNzZiY2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y=",
  documentType: "simplified",
  issueAt: new Date("2026-08-25T12:00:00.000Z"),
  customerName: "عميل نقدي",
  paymentMethod: "cash",
  lines: [{ name: "منتج اختباري", sku: "TEST", quantity: 1, unitPrice: 115, total: 115 }],
  seller,
};

test("ينشئ مستند UBL موقّعاً يمكن التحقق منه محلياً", async () => {
  const csr = await generateCsr(seller, "POS-RYD-01", "DEV-001");
  const directory = mkdtempSync(join(tmpdir(), "tarseed-einvoice-test-"));
  try {
    const keyPath = join(directory, "key.pem");
    const certificatePath = join(directory, "certificate.pem");
    writeFileSync(keyPath, csr.privateKeyPem, { mode: 0o600 });
    execFileSync("openssl", [
      "req", "-x509", "-new", "-key", keyPath, "-days", "1",
      "-subj", "/CN=Test/O=Tarseed/C=SA", "-out", certificatePath,
    ]);
    const result = await generateInvoiceDocument({
      ...baseInput,
      privateKeyPem: csr.privateKeyPem,
      certificatePem: readFileSync(certificatePath, "utf8"),
    });
    assert.equal(result.signatureValid, true);
    assert.equal(result.localValidationError, null);
    assert.match(result.xml, /xades:QualifyingProperties/);
    assert.match(result.xml, /<cbc:ID>ICV<\/cbc:ID>/);
    assert.match(result.xml, /<cbc:ID>PIH<\/cbc:ID>/);
    assert.ok(result.qrPayload.length > 100);
    execFileSync("xmllint", ["--noout", "-"], { input: result.xml });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("يبقي المستند غير الموقّع خارج مسار الامتثال", async () => {
  const result = await generateInvoiceDocument(baseInput);
  assert.equal(result.signatureValid, false);
  assert.match(result.localValidationError || "", /غير موقع/);
  assert.doesNotMatch(result.xml, /xades:QualifyingProperties/);
});