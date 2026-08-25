import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./team-auth";

export const eInvoiceUnitsTable = pgTable(
  "e_invoice_units",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    unitName: text("unit_name").notNull().default("وحدة الإصدار الرئيسية"),
    deviceSerialNumber: text("device_serial_number").notNull().default(""),
    environment: text("environment").notNull().default("sandbox"),
    status: text("status").notNull().default("not_configured"),
    sellerName: text("seller_name").notNull().default(""),
    vatNumber: text("vat_number").notNull().default(""),
    commercialRegistrationNumber: text("commercial_registration_number").notNull().default(""),
    street: text("street").notNull().default(""),
    buildingNumber: text("building_number").notNull().default(""),
    city: text("city").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    countryCode: text("country_code").notNull().default("SA"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("15.00"),
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(false),
    csrPem: text("csr_pem"),
    privateKeyCiphertext: text("private_key_ciphertext"),
    certificateCiphertext: text("certificate_ciphertext"),
    csidCiphertext: text("csid_ciphertext"),
    secretCiphertext: text("secret_ciphertext"),
    certificateExpiresAt: timestamp("certificate_expires_at", { withTimezone: true }),
    certificateExpiryWarningDays: integer("certificate_expiry_warning_days").notNull().default(30),
    complianceStatus: text("compliance_status").notNull().default("not_started"),
    complianceSuiteStatus: text("compliance_suite_status").notNull().default("not_started"),
    complianceSuiteResults: text("compliance_suite_results"),
    lastComplianceCheckAt: timestamp("last_compliance_check_at", { withTimezone: true }),
    complianceError: text("compliance_error"),
    nextInvoiceCounter: integer("next_invoice_counter").notNull().default(1),
    previousInvoiceHash: text("previous_invoice_hash").notNull().default("NWZlY2ViNjZmZmM4NmYzOGM4YzNkNzZiY2YzY2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y3Y2Y="),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("e_invoice_units_organization_unique").on(table.organizationId),
    index("e_invoice_units_status_idx").on(table.status),
  ],
);

export type EInvoiceUnit = typeof eInvoiceUnitsTable.$inferSelect;