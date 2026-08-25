import { execFile } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
  X509Certificate,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultPreviousInvoiceHash = "NWZlY2ViNjZmZmM4NmYzOGM4YzNkNzZiY2YzY2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y=";
const c14n11 = "http://www.w3.org/2006/12/xml-c14n11";
const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const ecdsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256";
const envelopedSignature = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const xadesSignedProperties = "http://uri.etsi.org/01903#SignedProperties";

export type SellerProfile = {
  sellerName: string;
  vatNumber: string;
  commercialRegistrationNumber: string;
  street: string;
  buildingNumber: string;
  city: string;
  postalCode: string;
  countryCode: string;
  vatRate: number;
  pricesIncludeVat: boolean;
};

export type InvoiceLine = {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type InvoiceInput = {
  invoiceNumber: string;
  invoiceCounter: number;
  previousInvoiceHash: string;
  documentType: "simplified" | "standard" | "credit_note" | "debit_note";
  issueAt: Date;
  customerName: string;
  customerVatNumber?: string;
  customerAddress?: string;
  paymentMethod: string;
  lines: InvoiceLine[];
  seller: SellerProfile;
  parentInvoiceUuid?: string;
  privateKeyPem?: string;
  certificatePem?: string;
};

export type GeneratedInvoice = {
  uuid: string;
  xml: string;
  invoiceHash: string;
  qrPayload: string;
  taxExclusiveAmount: number;
  taxAmount: number;
  taxInclusiveAmount: number;
  signatureValid: boolean;
  localValidationError: string | null;
};

export const ZATCA_COMPLIANCE_FIXTURES = [
  {
    id: "simplified",
    documentType: "simplified",
    label: "فاتورة مبسطة",
    scenario: "بيع نقدي لعميل غير مسجل في ضريبة القيمة المضافة",
  },
  {
    id: "standard",
    documentType: "standard",
    label: "فاتورة ضريبية منظمة",
    scenario: "بيع لعميل مسجل في ضريبة القيمة المضافة",
  },
  {
    id: "credit_note",
    documentType: "credit_note",
    label: "إشعار دائن",
    scenario: "إشعار دائن مرتبط بفاتورة أصلية",
  },
  {
    id: "debit_note",
    documentType: "debit_note",
    label: "إشعار مدين",
    scenario: "إشعار مدين مرتبط بفاتورة أصلية",
  },
] as const;

export type ZatcaComplianceFixtureId = typeof ZATCA_COMPLIANCE_FIXTURES[number]["id"];
export type ZatcaComplianceStatus = "passed" | "failed" | "unknown" | "missing";
export type ZatcaComplianceFixtureResult = {
  fixtureId: ZatcaComplianceFixtureId;
  label: string;
  documentType: InvoiceInput["documentType"];
  documentId: number | null;
  invoiceNumber: string | null;
  status: ZatcaComplianceStatus;
  httpStatus: number | null;
  authorityMessage: string | null;
  checkedAt: string;
};

export type ZatcaComplianceResponse = Record<string, unknown> & {
  validationResults?: Record<string, unknown>;
};

export function officialValidationStatus(body: ZatcaComplianceResponse): "PASS" | "FAIL" | "UNKNOWN" {
  const validation = body.validationResults;
  const rawStatus = validation?.status ?? body.status;
  if (typeof rawStatus !== "string") return "UNKNOWN";
  const status = rawStatus.trim().toUpperCase();
  if (status === "PASS" || status === "PASSED") return "PASS";
  if (status === "FAIL" || status === "FAILED") return "FAIL";
  return "UNKNOWN";
}

export function complianceSuiteIsPassed(results: ZatcaComplianceFixtureResult[]): boolean {
  if (results.length !== ZATCA_COMPLIANCE_FIXTURES.length) return false;
  return ZATCA_COMPLIANCE_FIXTURES.every((fixture) => {
    const result = results.find((candidate) => candidate.fixtureId === fixture.id);
    return Boolean(result && result.status === "passed");
  });
}

export function parseComplianceSuiteResults(value: string | null): ZatcaComplianceFixtureResult[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ZatcaComplianceFixtureResult => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<ZatcaComplianceFixtureResult>;
      return typeof candidate.fixtureId === "string"
        && typeof candidate.status === "string"
        && typeof candidate.checkedAt === "string";
    });
  } catch {
    return [];
  }
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("تعذر حماية بيانات الفوترة لأن مفتاح الجلسة غير مهيأ.");
  return createHash("sha256").update(`tarseed:e-invoicing:${secret}`).digest();
}

export function encryptEInvoiceSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptEInvoiceSecret(value: string | null): string | undefined {
  if (!value) return undefined;
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("بيانات اعتماد الفوترة المخزنة غير صالحة.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function amount(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function invoiceNameCode(input: InvoiceInput): string {
  return input.documentType === "standard" || Boolean(input.customerVatNumber) ? "0100000" : "0200000";
}

function invoiceTypeValue(type: InvoiceInput["documentType"]): string {
  if (type === "credit_note") return "381";
  if (type === "debit_note") return "383";
  return "388";
}

function paymentMeansCode(value: string): string {
  if (value === "cash") return "10";
  if (value === "card") return "48";
  if (value === "credit") return "30";
  return "30";
}

function tlv(payload: Array<[number, string]>): string {
  const chunks: Buffer[] = [];
  for (const [tag, value] of payload) {
    const encoded = Buffer.from(value, "utf8");
    if (encoded.length > 255) throw new Error("حقل QR أطول من الحد المسموح.");
    chunks.push(Buffer.from([tag, encoded.length]), encoded);
  }
  return Buffer.concat(chunks).toString("base64");
}

function calculateTotals(lines: InvoiceLine[], rate: number, pricesIncludeVat: boolean): {
  taxExclusiveAmount: number;
  taxAmount: number;
  taxInclusiveAmount: number;
} {
  const rateFraction = rate / 100;
  const gross = lines.reduce((sum, line) => sum + Math.round(Number(line.total) * 100), 0) / 100;
  if (pricesIncludeVat) {
    const taxExclusiveAmount = Math.round((gross / (1 + rateFraction)) * 100) / 100;
    return {
      taxExclusiveAmount,
      taxAmount: Math.round((gross - taxExclusiveAmount) * 100) / 100,
      taxInclusiveAmount: gross,
    };
  }
  const taxAmount = Math.round(gross * rateFraction * 100) / 100;
  return { taxExclusiveAmount: gross, taxAmount, taxInclusiveAmount: gross + taxAmount };
}

function validateInput(input: InvoiceInput): void {
  if (!input.lines.length) throw new Error("لا يمكن إصدار فاتورة بلا بنود.");
  if (!Number.isInteger(input.invoiceCounter) || input.invoiceCounter < 1) throw new Error("عداد الفاتورة غير صالح.");
  if (input.documentType === "standard" && (!/^\d{15}$/.test(input.customerVatNumber || "") || !input.customerAddress)) {
    throw new Error("الفاتورة الضريبية المنظمة تتطلب رقماً ضريبياً وعنواناً للعميل.");
  }
  for (const line of input.lines) {
    if (!line.name || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.total) || line.total < 0) {
      throw new Error("أحد بنود الفاتورة غير صالح.");
    }
  }
  if (input.certificatePem && !input.privateKeyPem) {
    throw new Error("شهادة وحدة الإصدار لا يمكن استخدامها دون المفتاح الخاص المطابق.");
  }
}

async function canonicalizeXml(xml: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tarseed-c14n-"));
  const sourcePath = join(directory, "invoice.xml");
  try {
    await writeFile(sourcePath, xml, { mode: 0o600 });
    const { stdout } = await execFileAsync("xmllint", ["--c14n11", sourcePath], { maxBuffer: 5_000_000 });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sha256Base64(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("base64");
}

function removeHashExcludedSections(xml: string): string {
  return xml
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/g, "")
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/g, "")
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/g, "");
}

async function invoiceHashFor(xml: string): Promise<string> {
  return sha256Base64(await canonicalizeXml(removeHashExcludedSections(xml)));
}

function certificateBody(certificatePem: string): string {
  return certificatePem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, "");
}

function finalDerBitString(certificateDer: Buffer): Buffer {
  const readLength = (offset: number): { length: number; next: number } => {
    const first = certificateDer[offset];
    if (first < 0x80) return { length: first, next: offset + 1 };
    const width = first & 0x7f;
    let length = 0;
    for (let index = 0; index < width; index += 1) length = (length << 8) | certificateDer[offset + 1 + index];
    return { length, next: offset + 1 + width };
  };
  const skip = (offset: number): number => {
    if (certificateDer[offset] !== 0x30) throw new Error("تنسيق شهادة وحدة الإصدار غير صالح.");
    const { length, next } = readLength(offset + 1);
    return next + length;
  };
  let offset = 0;
  if (certificateDer[offset] !== 0x30) throw new Error("تنسيق شهادة وحدة الإصدار غير صالح.");
  offset = readLength(offset + 1).next;
  offset = skip(offset);
  offset = skip(offset);
  if (certificateDer[offset] !== 0x03) throw new Error("تعذر استخراج توقيع شهادة وحدة الإصدار.");
  const { length, next } = readLength(offset + 1);
  return certificateDer.subarray(next + 1, next + length);
}

function certificateQrValues(certificatePem: string): { certificateHash: string; publicKey: string; certificateSignature: string; certificateBody: string; issuer: string; serial: string } {
  const certificate = new X509Certificate(certificatePem);
  const publicKeyDer = certificate.publicKey.export({ type: "spki", format: "der" });
  const point = publicKeyDer.length >= 65 && publicKeyDer.at(-65) === 0x04
    ? publicKeyDer.subarray(-65)
    : publicKeyDer;
  return {
    certificateHash: sha256Base64(certificate.raw),
    publicKey: point.toString("base64"),
    certificateSignature: finalDerBitString(certificate.raw).toString("base64"),
    certificateBody: certificateBody(certificatePem),
    issuer: certificate.issuer,
    serial: certificate.serialNumber,
  };
}

function signP1363(payload: string, privateKeyPem: string): string {
  return sign("sha256", Buffer.from(payload, "utf8"), {
    key: privateKeyPem,
    dsaEncoding: "ieee-p1363",
  }).toString("base64");
}

function verifyP1363(payload: string, signature: string, certificatePem: string): boolean {
  return verify("sha256", Buffer.from(payload, "utf8"), {
    key: certificatePem,
    dsaEncoding: "ieee-p1363",
  }, Buffer.from(signature, "base64"));
}

function xadesProperties(input: InvoiceInput, signatureId: string, propertiesId: string, certificate: ReturnType<typeof certificateQrValues>): string {
  return `<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#${signatureId}"><xades:SignedProperties Id="${propertiesId}"><xades:SignedSignatureProperties><xades:SigningTime>${input.issueAt.toISOString()}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="${sha256}"/><ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.certificateHash}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(certificate.issuer)}</ds:X509IssuerName><ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(certificate.serial)}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties></xades:QualifyingProperties>`;
}

async function createSignatureExtension(input: InvoiceInput, invoiceHash: string): Promise<{ extension: string; signature: string; valid: boolean; qrValues: ReturnType<typeof certificateQrValues> }> {
  if (!input.privateKeyPem || !input.certificatePem) throw new Error("بيانات توقيع الفاتورة غير متاحة.");
  const signatureId = "signature";
  const propertiesId = "xadesSignedProperties";
  const certificate = certificateQrValues(input.certificatePem);
  const qualifyingProperties = xadesProperties(input, signatureId, propertiesId, certificate);
  const signedPropertiesDigest = sha256Base64(await canonicalizeXml(qualifyingProperties.match(/<xades:SignedProperties[\s\S]*<\/xades:SignedProperties>/)?.[0] || ""));
  const signedInfo = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="${c14n11}"/><ds:SignatureMethod Algorithm="${ecdsaSha256}"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="${envelopedSignature}"/><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="${c14n11}"/></ds:Transforms><ds:DigestMethod Algorithm="${sha256}"/><ds:DigestValue>${invoiceHash}</ds:DigestValue></ds:Reference><ds:Reference Type="${xadesSignedProperties}" URI="#${propertiesId}"><ds:DigestMethod Algorithm="${sha256}"/><ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  const canonicalSignedInfo = await canonicalizeXml(signedInfo);
  const signature = signP1363(canonicalSignedInfo, input.privateKeyPem);
  const valid = verifyP1363(canonicalSignedInfo, signature, input.certificatePem);
  const extension = `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${signatureId}">${signedInfo}<ds:SignatureValue>${signature}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificate.certificateBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>${qualifyingProperties}</ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  return { extension, signature, valid, qrValues: certificate };
}

function lineXml(line: InvoiceLine, index: number, input: InvoiceInput): string {
  const rate = input.seller.vatRate / 100;
  const lineNet = input.seller.pricesIncludeVat ? Number(line.total) / (1 + rate) : Number(line.total);
  const unitNet = lineNet / Number(line.quantity);
  return `<cac:InvoiceLine><cbc:ID>${index + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${escapeXml(line.quantity)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">${amount(lineNet)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${escapeXml(line.name)}</cbc:Name>${line.sku ? `<cac:SellersItemIdentification><cbc:ID>${escapeXml(line.sku)}</cbc:ID></cac:SellersItemIdentification>` : ""}<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${amount(input.seller.vatRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="SAR">${amount(unitNet)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
}

function invoiceBody(input: InvoiceInput, uuid: string, totals: ReturnType<typeof calculateTotals>, qrPayload: string): string {
  const issuedDate = input.issueAt.toISOString().slice(0, 10);
  const issuedTime = input.issueAt.toISOString().slice(11, 19);
  const standard = input.documentType === "standard" || Boolean(input.customerVatNumber);
  const customerSection = standard
    ? `<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VAT">${escapeXml(input.customerVatNumber || "")}</cbc:ID></cac:PartyIdentification><cac:PostalAddress><cbc:StreetName>${escapeXml(input.customerAddress || "")}</cbc:StreetName><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(input.customerVatNumber || "")}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(input.customerName)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`
    : `<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(input.customerName || "عميل نقدي")}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`;
  const referenceSection = input.parentInvoiceUuid
    ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${escapeXml(input.parentInvoiceUuid)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>`
    : "";
  return `<cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID><cbc:UUID>${uuid}</cbc:UUID><cbc:IssueDate>${issuedDate}</cbc:IssueDate><cbc:IssueTime>${issuedTime}</cbc:IssueTime><cbc:InvoiceTypeCode name="${invoiceNameCode(input)}">${invoiceTypeValue(input.documentType)}</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>${referenceSection}<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${input.invoiceCounter}</cbc:UUID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(input.previousInvoiceHash)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>${qrPayload ? `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrPayload}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>` : ""}<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature><cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="CRN">${escapeXml(input.seller.commercialRegistrationNumber)}</cbc:ID></cac:PartyIdentification><cac:PostalAddress><cbc:StreetName>${escapeXml(input.seller.street)}</cbc:StreetName><cbc:BuildingNumber>${escapeXml(input.seller.buildingNumber)}</cbc:BuildingNumber><cbc:CitySubdivisionName>${escapeXml(input.seller.city)}</cbc:CitySubdivisionName><cbc:CityName>${escapeXml(input.seller.city)}</cbc:CityName><cbc:PostalZone>${escapeXml(input.seller.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${escapeXml(input.seller.countryCode)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(input.seller.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(input.seller.sellerName)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>${customerSection}<cac:PaymentMeans><cbc:PaymentMeansCode>${paymentMeansCode(input.paymentMethod)}</cbc:PaymentMeansCode></cac:PaymentMeans><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${amount(totals.taxAmount)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">${amount(totals.taxExclusiveAmount)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">${amount(totals.taxAmount)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${amount(input.seller.vatRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">${amount(totals.taxExclusiveAmount)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="SAR">${amount(totals.taxExclusiveAmount)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">${amount(totals.taxInclusiveAmount)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="SAR">${amount(totals.taxInclusiveAmount)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${input.lines.map((line, index) => lineXml(line, index, input)).join("")}`;
}

function invoiceRoot(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">${content}</Invoice>`;
}

export async function generateInvoiceDocument(input: InvoiceInput): Promise<GeneratedInvoice> {
  validateInput(input);
  const uuid = randomUUID();
  const totals = calculateTotals(input.lines, input.seller.vatRate, input.seller.pricesIncludeVat);
  const unsigned = invoiceRoot(invoiceBody(input, uuid, totals, ""));
  const invoiceHash = await invoiceHashFor(unsigned);
  let extension = "";
  let signatureValid = false;
  let localValidationError: string | null = null;
  let qrPayload = tlv([
    [1, input.seller.sellerName],
    [2, input.seller.vatNumber],
    [3, input.issueAt.toISOString()],
    [4, amount(totals.taxInclusiveAmount)],
    [5, amount(totals.taxAmount)],
  ]);
  if (input.privateKeyPem && input.certificatePem) {
    const signed = await createSignatureExtension(input, invoiceHash);
    signatureValid = signed.valid;
    if (!signed.valid) throw new Error("فشل التحقق المحلي من توقيع الفاتورة.");
    qrPayload = tlv([
      [1, input.seller.sellerName],
      [2, input.seller.vatNumber],
      [3, input.issueAt.toISOString()],
      [4, amount(totals.taxInclusiveAmount)],
      [5, amount(totals.taxAmount)],
      [6, invoiceHash],
      [7, signed.signature],
      [8, signed.qrValues.publicKey],
      [9, signed.qrValues.certificateSignature],
    ]);
    extension = signed.extension;
  } else {
    localValidationError = "المستند غير موقع: أكمل Compliance CSID وشهادة وحدة الإصدار قبل فحص الامتثال أو الإرسال.";
  }
  const xml = invoiceRoot(`${extension}${invoiceBody(input, uuid, totals, qrPayload)}`);
  if (!xml.includes("<cbc:UUID>") || !xml.includes("<cbc:ID>ICV</cbc:ID>") || !xml.includes("<cbc:ID>PIH</cbc:ID>")) {
    throw new Error("فشل التحقق المحلي من بنية UBL الأساسية.");
  }
  return { uuid, xml, invoiceHash, qrPayload, signatureValid, localValidationError, ...totals };
}

export async function generateCsr(seller: SellerProfile, unitName: string, deviceSerialNumber: string): Promise<{ csrPem: string; privateKeyPem: string }> {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const directory = await mkdtemp(join(tmpdir(), "tarseed-zatca-"));
  const keyPath = join(directory, "key.pem");
  const configPath = join(directory, "openssl.cnf");
  const csrPath = join(directory, "csr.pem");
  const dnValue = (value: string, maximum = 64): string => value
    .replace(/[\r\n[\]=#;]/g, " ")
    .trim()
    .slice(0, maximum);
  const commonName = dnValue(`Tarseed-${deviceSerialNumber || unitName}`, 64);
  const config = `[req]\nprompt = no\nutf8 = yes\ndistinguished_name = dn\nreq_extensions = req_ext\n[dn]\nCN = ${commonName}\nO = ${dnValue(seller.sellerName)}\nOU = ${dnValue(unitName)}\nC = ${dnValue(seller.countryCode || "SA", 2)}\nserialNumber = ${dnValue(seller.vatNumber, 32)}\n[req_ext]\nkeyUsage = critical,digitalSignature,nonRepudiation\nextendedKeyUsage = clientAuth\nsubjectAltName = dirName:alt_names\n[alt_names]\nUID = ${dnValue(seller.vatNumber, 32)}\nserialNumber = ${dnValue(deviceSerialNumber || unitName)}\n`;
  try {
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    await writeFile(configPath, config, { mode: 0o600 });
    await execFileAsync("openssl", ["req", "-new", "-sha256", "-key", keyPath, "-config", configPath, "-out", csrPath]);
    return { csrPem: await readFile(csrPath, "utf8"), privateKeyPem: privateKey };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function configurationIsComplete(seller: SellerProfile): boolean {
  return Boolean(
    seller.sellerName
    && /^\d{15}$/.test(seller.vatNumber)
    && seller.commercialRegistrationNumber
    && seller.street
    && seller.buildingNumber
    && seller.city
    && seller.postalCode
    && seller.countryCode === "SA",
  );
}

export function defaultInvoiceHash(): string {
  return defaultPreviousInvoiceHash;
}