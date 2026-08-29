import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const sidecarEndpoint = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${sidecarEndpoint}/token`,
    type: "external_account",
    credential_source: {
      url: `${sidecarEndpoint}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateDirectory(): string {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("لم تُجهّز مساحة التخزين الخاصة بعد.");
  return directory.replace(/\/+$/, "");
}

function fileForObjectPath(objectPath: string): File {
  if (!objectPath.startsWith("/objects/")) throw new Error("مسار المستند غير صالح.");
  const key = objectPath.slice("/objects/".length);
  const fullPath = `${privateDirectory()}/${key}`.replace(/^\/+/, "");
  const [bucketName, ...objectParts] = fullPath.split("/");
  if (!bucketName || !objectParts.length) throw new Error("لم يمكن الوصول إلى مستند الفاتورة.");
  return storage.bucket(bucketName).file(objectParts.join("/"));
}

function fileForKey(key: string): File {
  const fullPath = `${privateDirectory()}/${key}`.replace(/^\/+/, "");
  const [bucketName, ...objectParts] = fullPath.split("/");
  if (!bucketName || !objectParts.length) throw new Error("لم تُجهّز مساحة التخزين الخاصة بعد.");
  return storage.bucket(bucketName).file(objectParts.join("/"));
}

export function isPrivateAttachmentPathForOrganization(objectPath: string, organizationId: number): boolean {
  return new RegExp(`^/objects/attachments/${organizationId}/[0-9a-f-]{36}$`, "i").test(objectPath);
}

/** Store a non-public ERP attachment. The returned path is deliberately opaque. */
export async function savePrivateAttachment(
  organizationId: number,
  content: Buffer,
  contentType: string,
): Promise<string> {
  const key = `attachments/${organizationId}/${randomUUID()}`;
  await fileForKey(key).save(content, {
    contentType,
    resumable: false,
    metadata: { cacheControl: "private, no-store" },
  });
  return `/objects/${key}`;
}

export async function readPrivateObject(objectPath: string): Promise<{ content: Buffer; contentType?: string }> {
  const file = fileForObjectPath(objectPath);
  const [[metadata], [content]] = await Promise.all([file.getMetadata(), file.download()]);
  return { content, contentType: metadata.contentType };
}

export async function deletePrivateObject(objectPath: string): Promise<void> {
  await fileForObjectPath(objectPath).delete({ ignoreNotFound: true });
}

export async function savePrivateInvoiceXml(
  organizationId: number,
  documentId: number,
  xml: string,
  kind: "issued" | "authority" = "issued",
): Promise<string> {
  const key = `e-invoices/${organizationId}/${documentId}-${kind}-${randomUUID()}.xml`;
  await fileForKey(key).save(xml, {
    contentType: "application/xml; charset=utf-8",
    resumable: false,
    metadata: { cacheControl: "private, no-store" },
  });
  return `/objects/${key}`;
}

export async function readPrivateInvoiceXml(objectPath: string): Promise<string> {
  const [content] = await fileForObjectPath(objectPath).download();
  return content.toString("utf8");
}