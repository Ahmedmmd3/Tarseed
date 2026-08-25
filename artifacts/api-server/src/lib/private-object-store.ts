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

export async function savePrivateInvoiceXml(
  organizationId: number,
  documentId: number,
  xml: string,
  kind: "issued" | "authority" = "issued",
): Promise<string> {
  const key = `e-invoices/${organizationId}/${documentId}-${kind}-${randomUUID()}.xml`;
  const fullPath = `${privateDirectory()}/${key}`.replace(/^\/+/, "");
  const [bucketName, ...objectParts] = fullPath.split("/");
  if (!bucketName || !objectParts.length) throw new Error("لم تُجهّز مساحة التخزين الخاصة بعد.");
  await storage.bucket(bucketName).file(objectParts.join("/")).save(xml, {
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