import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  eInvoiceDocumentsTable,
  eInvoiceUnitsTable,
  erpRecordsTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { decryptEInvoiceSecret, encryptEInvoiceSecret, generateCsr } from "../src/lib/e-invoicing.ts";

const authorityBaseUrl = "https://zatca-certificate-safety.test";
const seller = {
  sellerName: "منشأة اختبار الشهادة",
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

const generationByCookie = new Map();
const authorityRequests = [];
let server;
let origin;
let originalFetch;
let certificateDirectory;

function unique(prefix) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const generation = generationByCookie.get(cookie);
  const response = await originalFetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(Number.isSafeInteger(generation) ? { "X-Wudooh-Data-Generation": String(generation) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "يجب أن ينشئ التسجيل جلسة للمالك");
  return cookie.split(";")[0];
}

function selfSignedCertificate(privateKeyPem, name) {
  const keyPath = join(certificateDirectory, `${name}.key.pem`);
  const certificatePath = join(certificateDirectory, `${name}.certificate.pem`);
  writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  execFileSync("openssl", [
    "req", "-x509", "-new", "-key", keyPath, "-days", "2",
    "-subj", `/CN=${name}/O=Wudooh/C=SA`, "-out", certificatePath,
  ]);
  return readFileSync(certificatePath, "utf8");
}

async function createPreparedDocument() {
  const ownerEmail = `${unique("certificate-owner")}@example.test`;
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: {
      projectName: unique("منشأة اختبار حماية الشهادة"),
      name: "مالك اختبار الشهادة",
      email: ownerEmail,
      password: "Safe-test-password-123",
    },
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.payload));
  const cookie = cookieFrom(registered.response);
  generationByCookie.set(cookie, registered.payload.user.dataGeneration);
  const organizationId = registered.payload.user.organizationId;
  assert.equal(typeof organizationId, "number");
  const [invoiceRecord] = await db.insert(erpRecordsTable).values({
    organizationId,
    tableName: "invoices",
    data: {
      warehouseId: registered.payload.user.warehouseIds?.[0],
      invoiceNumber: unique("CERT-INVOICE"),
      date: new Date().toISOString().slice(0, 10),
      total: 100,
    },
  }).returning();

  const csr = await generateCsr(seller, "POS-CERT-TEST", unique("DEVICE"));
  const oldCertificatePem = selfSignedCertificate(csr.privateKeyPem, unique("old-certificate"));
  const [unit] = await db.insert(eInvoiceUnitsTable).values({
    organizationId,
    ...seller,
    unitName: "وحدة اختبار الشهادة",
    deviceSerialNumber: unique("CERT"),
    csrPem: csr.csrPem,
    privateKeyCiphertext: encryptEInvoiceSecret(csr.privateKeyPem),
    certificateCiphertext: encryptEInvoiceSecret(oldCertificatePem),
    csidCiphertext: encryptEInvoiceSecret("old-csid"),
    secretCiphertext: encryptEInvoiceSecret("old-secret"),
    certificateExpiresAt: new Date(Date.now() - 60_000),
    status: "compliance_passed",
    complianceStatus: "passed",
    complianceSuiteStatus: "passed",
  }).returning();

  const [document] = await db.insert(eInvoiceDocumentsTable).values({
    organizationId,
    unitId: unit.id,
    invoiceRecordId: invoiceRecord.id,
    documentType: "simplified",
    status: "pending_submission",
    invoiceNumber: unique("CERT-SUBMIT"),
    uuid: randomUUID(),
    invoiceCounter: 1,
    previousInvoiceHash: "test-previous-hash",
    invoiceHash: "test-invoice-hash",
    qrPayload: "",
    xmlDigest: "test-xml-digest",
    xmlObjectPath: "/objects/test/e-invoice.xml",
    issuedAt: new Date(),
  }).returning();
  const complianceResult = JSON.stringify([{
    fixtureId: "simplified-invoice",
    label: "فاتورة مبسطة",
    documentType: "simplified",
    documentId: document.id,
    invoiceNumber: document.invoiceNumber,
    status: "passed",
    httpStatus: 200,
    authorityMessage: null,
    checkedAt: new Date().toISOString(),
  }]);
  await db.update(eInvoiceUnitsTable).set({ complianceSuiteResults: complianceResult })
    .where(eq(eInvoiceUnitsTable.id, unit.id));

  return { cookie, organizationId, unit, document };
}

test.before(async () => {
  certificateDirectory = mkdtempSync(join(tmpdir(), "wudooh-certificate-safety-"));
  process.env.ZATCA_SANDBOX_BASE_URL = authorityBaseUrl;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(authorityBaseUrl)) {
      authorityRequests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ reportingStatus: "REPORTED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  rmSync(certificateDirectory, { recursive: true, force: true });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("يرفض API الإرسال المباشر بالشهادة المنتهية أو ذات تاريخ صلاحية مفقود، ثم يفرض اعتماداً جديداً", async () => {
  const prepared = await createPreparedDocument();
  const submitPath = `/api/e-invoicing/documents/${prepared.document.id}/submit`;

  const expiredSubmit = await request(submitPath, { method: "POST", cookie: prepared.cookie });
  assert.equal(expiredSubmit.response.status, 409, JSON.stringify(expiredSubmit.payload));
  assert.match(expiredSubmit.payload.error, /انتهت شهادة وحدة الإصدار/);
  assert.equal(authorityRequests.length, 0, "يجب ألا يُرسل المستند للهيئة بعد انتهاء الشهادة");

  await db.update(eInvoiceUnitsTable).set({ certificateExpiresAt: null })
    .where(eq(eInvoiceUnitsTable.id, prepared.unit.id));
  const missingExpirySubmit = await request(submitPath, { method: "POST", cookie: prepared.cookie });
  assert.equal(missingExpirySubmit.response.status, 409, JSON.stringify(missingExpirySubmit.payload));
  assert.match(missingExpirySubmit.payload.error, /تاريخ انتهائها/);
  assert.equal(authorityRequests.length, 0, "يجب ألا يُرسل المستند للهيئة عندما يغيب تاريخ الصلاحية");

  const [currentUnit] = await db.select().from(eInvoiceUnitsTable).where(and(
    eq(eInvoiceUnitsTable.id, prepared.unit.id),
    eq(eInvoiceUnitsTable.organizationId, prepared.organizationId),
  )).limit(1);
  assert.ok(currentUnit);
  const csr = await generateCsr(seller, "POS-CERT-RENEW", unique("RENEW"));
  const renewedCertificatePem = selfSignedCertificate(csr.privateKeyPem, unique("renewed-certificate"));
  await db.update(eInvoiceUnitsTable).set({
    csrPem: csr.csrPem,
    privateKeyCiphertext: encryptEInvoiceSecret(csr.privateKeyPem),
  }).where(eq(eInvoiceUnitsTable.id, currentUnit.id));

  const renewal = await request("/api/e-invoicing/credentials", {
    method: "PUT",
    cookie: prepared.cookie,
    body: {
      certificatePem: renewedCertificatePem,
      csid: "renewed-csid",
      secret: "renewed-secret",
    },
  });
  assert.equal(renewal.response.status, 200, JSON.stringify(renewal.payload));
  assert.equal(renewal.payload.unit.complianceSuiteStatus, "not_started");
  assert.equal(renewal.payload.unit.certificateUsable, true);

  const [renewedUnit] = await db.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.id, prepared.unit.id)).limit(1);
  const [renewedDocument] = await db.select().from(eInvoiceDocumentsTable).where(eq(eInvoiceDocumentsTable.id, prepared.document.id)).limit(1);
  assert.equal(decryptEInvoiceSecret(renewedUnit.csidCiphertext), "renewed-csid");
  assert.equal(decryptEInvoiceSecret(renewedUnit.secretCiphertext), "renewed-secret");
  assert.equal(renewedDocument.status, "pending_compliance");

  const submitWithoutNewCompliance = await request(submitPath, { method: "POST", cookie: prepared.cookie });
  assert.equal(submitWithoutNewCompliance.response.status, 409, JSON.stringify(submitWithoutNewCompliance.payload));
  assert.match(submitWithoutNewCompliance.payload.error, /اجتياز حزمة حالات الامتثال/);
  assert.equal(authorityRequests.length, 0, "لا يجوز استخدام اعتماد الشهادة السابق بعد إعادة الاعتماد");
});