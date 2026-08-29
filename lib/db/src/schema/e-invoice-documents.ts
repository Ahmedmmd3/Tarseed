import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./team-auth";
import { eInvoiceUnitsTable } from "./e-invoice-units";

export const eInvoiceDocumentsTable = pgTable(
  "e_invoice_documents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => eInvoiceUnitsTable.id, { onDelete: "restrict" }),
    invoiceRecordId: integer("invoice_record_id").notNull(),
    parentDocumentId: integer("parent_document_id"),
    operationId: text("operation_id"),
    documentType: text("document_type").notNull(),
    status: text("status").notNull().default("pending_configuration"),
    invoiceNumber: text("invoice_number").notNull(),
    uuid: text("uuid").notNull(),
    invoiceCounter: integer("invoice_counter"),
    previousInvoiceHash: text("previous_invoice_hash").notNull(),
    invoiceHash: text("invoice_hash").notNull(),
    qrPayload: text("qr_payload").notNull().default(""),
    xmlObjectPath: text("xml_object_path"),
    authorityXmlObjectPath: text("authority_xml_object_path"),
    xmlDigest: text("xml_digest").notNull(),
    localValidationError: text("local_validation_error"),
    submissionReference: text("submission_reference"),
    submissionError: text("submission_error"),
    submissionAttempts: integer("submission_attempts").notNull().default(0),
    lastSubmissionAt: timestamp("last_submission_at", { withTimezone: true }),
    adjustmentReason: text("adjustment_reason"),
    adjustmentLines: jsonb("adjustment_lines"),
    taxExclusiveAmount: numeric("tax_exclusive_amount", { precision: 18, scale: 2 }),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }),
    taxInclusiveAmount: numeric("tax_inclusive_amount", { precision: 18, scale: 2 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("e_invoice_documents_organization_uuid_unique").on(table.organizationId, table.uuid),
    uniqueIndex("e_invoice_documents_organization_operation_unique").on(table.organizationId, table.operationId),
    index("e_invoice_documents_organization_status_idx").on(table.organizationId, table.status),
    index("e_invoice_documents_parent_idx").on(table.parentDocumentId),
    uniqueIndex("e_invoice_documents_unit_counter_unique").on(table.unitId, table.invoiceCounter),
  ],
);

export type EInvoiceDocument = typeof eInvoiceDocumentsTable.$inferSelect;