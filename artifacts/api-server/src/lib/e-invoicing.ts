import { execFile } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultPreviousInvoiceHash = "NWZlY2ViNjZmZmM4NmYzOGM4YzNkNzZiY2YzY2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y=";

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
};

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

function invoiceCode(type: InvoiceInput["documentType"]): string {
  if (type === "simplified") return "0200000";
  if (type === "credit_note") return "381";
  if (type === "debit_note") return "383";
  return "0100000";
}

function invoiceTypeValue(type: InvoiceInput["documentType"]): string {
  if (type === "credit_note") return "381";
  if (type === "debit_note") return "383";
  return "388";
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

export function generateInvoiceDocument(input: InvoiceInput): GeneratedInvoice {
  const uuid = randomUUID();
  const totals = calculateTotals(input.lines, input.seller.vatRate, input.seller.pricesIncludeVat);
  const issuedDate = input.issueAt.toISOString().slice(0, 10);
  const issuedTime = input.issueAt.toISOString().slice(11, 19);
  const documentCurrency = "SAR";
  const customerSection = input.documentType === "simplified"
    ? ""
    : `<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VAT">${escapeXml(input.customerVatNumber || "")}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${escapeXml(input.customerName)}</cbc:Name></cac:PartyName>${input.customerAddress ? `<cac:PostalAddress><cbc:StreetName>${escapeXml(input.customerAddress)}</cbc:StreetName><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>` : ""}</cac:Party></cac:AccountingCustomerParty>`;
  const referenceSection = input.parentInvoiceUuid
    ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${escapeXml(input.parentInvoiceUuid)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>`
    : "";
  const invoiceLines = input.lines.map((line, index) => {
    const lineNet = input.seller.pricesIncludeVat
      ? Number(line.total) / (1 + input.seller.vatRate / 100)
      : Number(line.total);
    return `<cac:InvoiceLine><cbc:ID>${index + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${escapeXml(line.quantity)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${documentCurrency}">${amount(lineNet)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${escapeXml(line.name)}</cbc:Name>${line.sku ? `<cac:SellersItemIdentification><cbc:ID>${escapeXml(line.sku)}</cbc:ID></cac:SellersItemIdentification>` : ""}<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${amount(input.seller.vatRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${documentCurrency}">${amount(line.unitPrice)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
  }).join("");
  const unsignedXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
<cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID><cbc:UUID>${uuid}</cbc:UUID><cbc:IssueDate>${issuedDate}</cbc:IssueDate><cbc:IssueTime>${issuedTime}</cbc:IssueTime><cbc:InvoiceTypeCode name="${invoiceCode(input.documentType)}">${invoiceTypeValue(input.documentType)}</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${documentCurrency}</cbc:DocumentCurrencyCode>${referenceSection}
<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${input.invoiceCounter}</cbc:UUID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(input.previousInvoiceHash)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="CRN">${escapeXml(input.seller.commercialRegistrationNumber)}</cbc:ID></cac:PartyIdentification><cac:PostalAddress><cbc:StreetName>${escapeXml(input.seller.street)}</cbc:StreetName><cbc:BuildingNumber>${escapeXml(input.seller.buildingNumber)}</cbc:BuildingNumber><cbc:CityName>${escapeXml(input.seller.city)}</cbc:CityName><cbc:PostalZone>${escapeXml(input.seller.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${escapeXml(input.seller.countryCode)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(input.seller.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(input.seller.sellerName)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
${customerSection}<cac:PaymentMeans><cbc:PaymentMeansCode>${escapeXml(input.paymentMethod)}</cbc:PaymentMeansCode></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="${documentCurrency}">${amount(totals.taxAmount)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${documentCurrency}">${amount(totals.taxExclusiveAmount)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${documentCurrency}">${amount(totals.taxAmount)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${amount(input.seller.vatRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${documentCurrency}">${amount(totals.taxExclusiveAmount)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="${documentCurrency}">${amount(totals.taxExclusiveAmount)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${documentCurrency}">${amount(totals.taxInclusiveAmount)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${documentCurrency}">${amount(totals.taxInclusiveAmount)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${invoiceLines}</Invoice>`;
  const invoiceHash = createHash("sha256").update(unsignedXml, "utf8").digest("base64");
  const signature = input.privateKeyPem
    ? sign("sha256", Buffer.from(invoiceHash, "utf8"), input.privateKeyPem).toString("base64")
    : "";
  const certificateHash = input.certificatePem
    ? createHash("sha256").update(input.certificatePem, "utf8").digest("base64")
    : "";
  const qrPayload = tlv([
    [1, input.seller.sellerName],
    [2, input.seller.vatNumber],
    [3, input.issueAt.toISOString()],
    [4, amount(totals.taxInclusiveAmount)],
    [5, amount(totals.taxAmount)],
    ...(signature ? [[6, invoiceHash], [7, signature], [8, certificateHash], [9, input.previousInvoiceHash]] as Array<[number, string]> : []),
  ]);
  const signatureExtension = signature
    ? `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>${signature}</SignatureValue></Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`
    : "";
  return {
    uuid,
    xml: signatureExtension
      ? unsignedXml.replace(/(<Invoice[^>]*>)/, `$1${signatureExtension}`)
      : unsignedXml,
    invoiceHash,
    qrPayload,
    ...totals,
  };
}

export async function generateCsr(seller: SellerProfile, unitName: string, deviceSerialNumber: string): Promise<{ csrPem: string; privateKeyPem: string }> {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const directory = await mkdtemp(join(tmpdir(), "tarseed-zatca-"));
  const keyPath = join(directory, "key.pem");
  const configPath = join(directory, "openssl.cnf");
  const csrPath = join(directory, "csr.pem");
  const serial = `1-Tarseed|2-Web|3-${deviceSerialNumber || unitName}`;
  const config = `[req]\nprompt = no\ndistinguished_name = dn\nreq_extensions = req_ext\n[dn]\nCN = ${serial}\nO = ${seller.sellerName}\nOU = ${unitName}\nC = ${seller.countryCode || "SA"}\nserialNumber = ${seller.vatNumber}\n[req_ext]\nkeyUsage = critical,digitalSignature,nonRepudiation\nsubjectAltName = dirName:alt_names\n[alt_names]\nserialNumber = ${seller.commercialRegistrationNumber}\n`;
  try {
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    await writeFile(configPath, config, { mode: 0o600 });
    await execFileAsync("openssl", ["req", "-new", "-key", keyPath, "-config", configPath, "-out", csrPath]);
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