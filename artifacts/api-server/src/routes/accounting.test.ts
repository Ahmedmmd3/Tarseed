// @ts-nocheck
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

type Session = {
  cookie: string;
  dataGeneration: number;
  organizationId: number;
};

type ApiResult = {
  response: Response;
  payload: any;
};

let server: Server;
let origin = "";
let pool: any;
const organizationIds: number[] = [];
const dataGenerationByCookie = new Map<string, number>();
let ownerA: Session;
let ownerB: Session;
let accountsA: any[];
let accountsB: any[];

async function api(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    ip?: string;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Origin: origin,
    "X-Forwarded-For": options.ip ?? "198.51.100.210",
  };
  if (options.cookie) {
    headers.Cookie = options.cookie;
    const generation = dataGenerationByCookie.get(options.cookie);
    if (generation != null) headers["X-Wudooh-Data-Generation"] = String(generation);
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${origin}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    response,
    payload: text ? JSON.parse(text) : null,
  };
}

async function createOwner(label: string, ipSuffix: number): Promise<Session> {
  const unique = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `vitest-accounting-${label}-${unique}@example.com`;
  const phone = `05${String(Date.now() + ipSuffix).slice(-8)}`;
  const password = "Safe-test-password-123";

  const registered = await api("/auth/register", {
    method: "POST",
    ip: `198.51.100.${ipSuffix}`,
    body: {
      projectName: `منشأة Vitest ${label} ${unique}`,
      name: `مالك ${label}`,
      email,
      phone,
      password,
    },
  });
  expect(registered.response.status).toBe(202);

  const verified = await api("/auth/email-verification/verify", {
    method: "POST",
    ip: `198.51.100.${ipSuffix}`,
    body: {
      email,
      code: process.env.EMAIL_VERIFICATION_TEST_CODE,
    },
  });
  expect(verified.response.status).toBe(200);

  const setCookie = verified.response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  const cookie = setCookie!.split(";")[0];
  const dataGeneration = Number(verified.payload.user.dataGeneration);
  const organizationId = Number(verified.payload.user.organizationId);
  expect(Number.isInteger(organizationId)).toBe(true);
  dataGenerationByCookie.set(cookie, dataGeneration);
  organizationIds.push(organizationId);
  return { cookie, dataGeneration, organizationId };
}

async function initializeAccounts(session: Session): Promise<any[]> {
  const initialized = await api("/accounting/initialize", {
    method: "POST",
    cookie: session.cookie,
  });
  expect([200, 201]).toContain(initialized.response.status);
  const listed = await api("/data/accounts", { cookie: session.cookie });
  expect(listed.response.status).toBe(200);
  return listed.payload.records;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.EMAIL_VERIFICATION_TEST_CODE = "654321";
  process.env.PHONE_VERIFICATION_TEST_CODE = "246810";

  const [{ default: app }, database] = await Promise.all([
    import("../app"),
    import("@workspace/db"),
  ]);
  pool = database.pool;
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("تعذر تشغيل خادم الاختبار.");
  origin = `http://127.0.0.1:${address.port}`;

  ownerA = await createOwner("A", 211);
  ownerB = await createOwner("B", 212);
  accountsA = await initializeAccounts(ownerA);
  accountsB = await initializeAccounts(ownerB);
}, 60_000);

afterAll(async () => {
  if (organizationIds.length && pool) {
    await pool.query(
      "delete from organizations where id = any($1::int[])",
      [organizationIds],
    );
  }
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (pool) await pool.end();
}, 30_000);

describe.sequential("accounting routes", () => {
  it("يرفض حفظ قيد غير متوازن بحالة 400", async () => {
    const asset = accountsA.find((account) => account.type === "asset");
    const revenue = accountsA.find((account) => account.type === "revenue");
    expect(asset).toBeTruthy();
    expect(revenue).toBeTruthy();

    const result = await api("/data/journalEntries", {
      method: "POST",
      cookie: ownerA.cookie,
      body: {
        date: "2026-03-01",
        description: "قيد غير متوازن",
        status: "draft",
        lines: [
          { accountId: String(asset.id), debit: 100, credit: 0 },
          { accountId: String(revenue.id), debit: 0, credit: 90 },
        ],
      },
    });

    expect(result.response.status).toBe(400);
    expect(result.payload.error).toContain("إجمالي المدين");
  });

  it("لا يعرض للمستخدم بيانات منشأة أخرى", async () => {
    const assetB = accountsB.find((account) => account.type === "asset");
    const equityB = accountsB.find((account) => account.type === "equity");
    const marker = `TENANT-B-${randomUUID()}`;
    const created = await api("/data/journalEntries", {
      method: "POST",
      cookie: ownerB.cookie,
      body: {
        date: "2026-03-02",
        description: marker,
        status: "draft",
        lines: [
          { accountId: String(assetB.id), debit: 75, credit: 0 },
          { accountId: String(equityB.id), debit: 0, credit: 75 },
        ],
      },
    });
    expect(created.response.status).toBe(201);

    const tenantARecords = await api("/data/journalEntries", {
      cookie: ownerA.cookie,
    });
    expect(tenantARecords.response.status).toBe(200);
    expect(tenantARecords.payload.records).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.payload.record.id,
          description: marker,
        }),
      ]),
    );
  });

  it("ينقص مخزون الموقع بعد البيع", async () => {
    const warehouses = await api("/data/warehouses", { cookie: ownerA.cookie });
    expect(warehouses.response.status).toBe(200);
    const warehouse = warehouses.payload.records[0];
    expect(warehouse).toBeTruthy();

    const productResult = await api("/data/products", {
      method: "POST",
      cookie: ownerA.cookie,
      body: {
        name: `منتج Vitest ${randomUUID()}`,
        sku: `VIT-${randomUUID().slice(0, 8)}`,
        barcode: "",
        sellPrice: 20,
        vatRate: 15,
        stock: 0,
        status: "active",
      },
    });
    expect(productResult.response.status).toBe(201);
    const product = productResult.payload.record;

    const adjustment = await api("/inventory/adjustments", {
      method: "POST",
      cookie: ownerA.cookie,
      body: {
        productId: product.id,
        warehouseId: warehouse.id,
        actualQuantity: 10,
        unitCostExVat: 5,
        reason: "رصيد افتتاحي لاختبار Vitest",
        date: "2026-03-03",
      },
    });
    expect(adjustment.response.status).toBe(200);

    const sale = await api("/inventory/sales", {
      method: "POST",
      cookie: ownerA.cookie,
      body: {
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: 3,
      },
    });
    expect(sale.response.status).toBe(200);

    const balances = await api("/data/inventoryBalances", {
      cookie: ownerA.cookie,
    });
    expect(balances.response.status).toBe(200);
    const balance = balances.payload.records.find(
      (record: any) => Number(record.productId) === Number(product.id)
        && Number(record.warehouseId) === Number(warehouse.id),
    );
    expect(balance).toBeTruthy();
    expect(Number(balance.quantity)).toBe(7);
  });
});