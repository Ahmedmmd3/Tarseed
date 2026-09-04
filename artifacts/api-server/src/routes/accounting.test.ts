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
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Origin: origin,
    "X-Forwarded-For": options.ip ?? "198.51.100.210",
    ...(options.headers ?? {}),
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

  it("ينفذ مرتجعات البيع الكاملة والجزئية بأمان وبشكل idempotent", async () => {
    const warehouses = await api("/data/warehouses", { cookie: ownerA.cookie });
    expect(warehouses.response.status).toBe(200);
    const warehouse = warehouses.payload.records[0];
    const product = (await api("/data/products", {
      method: "POST", cookie: ownerA.cookie,
      body: { name: `منتج مرتجع ${randomUUID()}`, sku: `RET-${randomUUID().slice(0, 8)}`, sellPrice: 20, costPrice: 6, vatRate: 15, stock: 0, status: "active" },
    })).payload.record;
    expect(product).toBeTruthy();
    expect((await api("/inventory/adjustments", {
      method: "POST", cookie: ownerA.cookie,
      body: { productId: product.id, warehouseId: warehouse.id, actualQuantity: 10, unitCostExVat: 6, reason: "رصيد اختبار المرتجعات", date: "2026-06-01" },
    })).response.status).toBe(200);
    const checkoutBody = {
      warehouseId: warehouse.id, issueDate: "2026-06-02", paymentMethod: "cash",
      items: [{ productId: product.id, quantity: 3 }], clientOperationId: `return-sale-${randomUUID()}`,
    };
    const sold = await api("/inventory/checkout", { method: "POST", cookie: ownerA.cookie, body: checkoutBody });
    expect(sold.response.status).toBe(200);
    const invoice = sold.payload.invoice;
    const originalInvoice = structuredClone(invoice);
    const fullBody = {
      invoiceId: invoice.id, returnDate: "2026-06-03", reason: "إرجاع كامل للاختبار",
      items: [{ productId: product.id, quantity: 3 }], clientOperationId: `return-full-${randomUUID()}`,
    };
    const full = await api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: fullBody });
    expect(full.response.status).toBe(200);
    expect(full.payload.created).toBe(true);
    const replay = await api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: fullBody });
    expect(replay.response.status).toBe(200);
    expect(replay.payload.created).toBe(false);
    expect(replay.payload.salesReturn.id).toBe(full.payload.salesReturn.id);
    const mismatch = await api("/inventory/sales-returns", {
      method: "POST", cookie: ownerA.cookie,
      body: { ...fullBody, items: [{ productId: product.id, quantity: 2 }] },
    });
    expect(mismatch.response.status).toBe(409);

    const invoiceList = await api("/data/invoices", { cookie: ownerA.cookie });
    expect(invoiceList.response.status).toBe(200);
    const afterFullInvoice = invoiceList.payload.records.find((row: any) => Number(row.id) === Number(invoice.id));
    expect(afterFullInvoice).toMatchObject({
      items: originalInvoice.items, subtotal: originalInvoice.subtotal, tax: originalInvoice.tax, total: originalInvoice.total,
    });
    let balances = await api("/data/inventoryBalances", { cookie: ownerA.cookie });
    expect(Number(balances.payload.records.find((row: any) => Number(row.productId) === product.id && Number(row.warehouseId) === warehouse.id).quantity)).toBe(10);
    let journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
    const returnJournal = journals.payload.records.find((row: any) => Number(row.sourceId) === Number(full.payload.salesReturn.id) && row.sourceType === "sale");
    expect(returnJournal).toBeTruthy();
    expect(returnJournal.lines.reduce((sum: number, line: any) => sum + Number(line.debit), 0)).toBe(
      returnJournal.lines.reduce((sum: number, line: any) => sum + Number(line.credit), 0),
    );

    const partialSale = await api("/inventory/checkout", {
      method: "POST", cookie: ownerA.cookie,
      body: { ...checkoutBody, issueDate: "2026-06-04", items: [{ productId: product.id, quantity: 5 }], clientOperationId: `return-partial-sale-${randomUUID()}` },
    });
    expect(partialSale.response.status).toBe(200);
    const partialOne = await api("/inventory/sales-returns", {
      method: "POST", cookie: ownerA.cookie,
      body: { invoiceId: partialSale.payload.invoice.id, returnDate: "2026-06-05", reason: "مرتجع جزئي أول", items: [{ productId: product.id, quantity: 2 }], clientOperationId: `return-partial-one-${randomUUID()}` },
    });
    expect(partialOne.response.status).toBe(200);
    const partialTwo = await api("/inventory/sales-returns", {
      method: "POST", cookie: ownerA.cookie,
      body: { invoiceId: partialSale.payload.invoice.id, returnDate: "2026-06-06", reason: "مرتجع جزئي ثان", items: [{ productId: product.id, quantity: 3 }], clientOperationId: `return-partial-two-${randomUUID()}` },
    });
    expect(partialTwo.response.status).toBe(200);
    const overReturn = await api("/inventory/sales-returns", {
      method: "POST", cookie: ownerA.cookie,
      body: { invoiceId: partialSale.payload.invoice.id, returnDate: "2026-06-07", reason: "تجاوز الكمية", items: [{ productId: product.id, quantity: 1 }], clientOperationId: `return-over-${randomUUID()}` },
    });
    expect(overReturn.response.status).toBe(409);
    balances = await api("/data/inventoryBalances", { cookie: ownerA.cookie });
    expect(Number(balances.payload.records.find((row: any) => Number(row.productId) === product.id && Number(row.warehouseId) === warehouse.id).quantity)).toBe(10);
  });

  it("يسلسل المرتجعات المتزامنة ويعيد FIFO وفواتير الآجل بدقة", async () => {
    const warehouse = (await api("/data/warehouses", { cookie: ownerA.cookie })).payload.records[0];
    const createStockedProduct = async (label: string, layers: Array<[number, number]>) => {
      const created = await api("/data/products", { method: "POST", cookie: ownerA.cookie, body: {
        name: `${label} ${randomUUID()}`, sku: `${label}-${randomUUID().slice(0, 8)}`, sellPrice: 20, vatRate: 15, stock: 0, status: "active",
      } });
      expect(created.response.status).toBe(201);
      let quantity = 0;
      for (const [added, cost] of layers) {
        quantity += added;
        const adjustment = await api("/inventory/adjustments", { method: "POST", cookie: ownerA.cookie, body: {
          productId: created.payload.record.id, warehouseId: warehouse.id, actualQuantity: quantity, unitCostExVat: cost,
          reason: `طبقة ${label}`, date: "2026-07-01",
        } });
        expect(adjustment.response.status).toBe(200);
      }
      return created.payload.record;
    };
    const checkout = async (productId: number, quantity: number, operation: string, paymentMethod = "cash") => {
      const result = await api("/inventory/checkout", { method: "POST", cookie: ownerA.cookie, body: {
        warehouseId: warehouse.id, issueDate: "2026-07-02", paymentMethod, ...(paymentMethod === "credit" ? { dueDate: "2026-07-30" } : {}),
        items: [{ productId, quantity }], clientOperationId: operation,
      } });
      expect(result.response.status).toBe(200);
      return result.payload.invoice;
    };

    const concurrentProduct = await createStockedProduct("CON", [[4, 5]]);
    const concurrentInvoice = await checkout(concurrentProduct.id, 4, `con-sale-${randomUUID()}`);
    const sameRequest = { invoiceId: concurrentInvoice.id, returnDate: "2026-07-03", reason: "إعادة متزامنة", items: [{ productId: concurrentProduct.id, quantity: 2 }], clientOperationId: `con-same-${randomUUID()}` };
    const [sameLeft, sameRight] = await Promise.all([
      api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: sameRequest }),
      api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: sameRequest }),
    ]);
    expect(sameLeft.response.status).toBe(200);
    expect(sameRight.response.status).toBe(200);
    expect(sameLeft.payload.salesReturn.id).toBe(sameRight.payload.salesReturn.id);
    const competing = await Promise.all([
      api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: { ...sameRequest, clientOperationId: `con-a-${randomUUID()}`, items: [{ productId: concurrentProduct.id, quantity: 2 }] } }),
      api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: { ...sameRequest, clientOperationId: `con-b-${randomUUID()}`, items: [{ productId: concurrentProduct.id, quantity: 2 }] } }),
    ]);
    expect(competing.map((result) => result.response.status).sort()).toEqual([200, 409]);

    const fifoProduct = await createStockedProduct("FIFO", [[2, 5], [2, 9]]);
    const fifoInvoice = await checkout(fifoProduct.id, 4, `fifo-sale-${randomUUID()}`);
    expect(fifoInvoice.cogsTotal).toBe(28);
    const fifoReturns = [];
    for (const quantity of [1, 3]) {
      const returned = await api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: {
        invoiceId: fifoInvoice.id, returnDate: quantity === 1 ? "2026-07-04" : "2026-07-05", reason: "اختبار FIFO",
        items: [{ productId: fifoProduct.id, quantity }], clientOperationId: `fifo-return-${quantity}-${randomUUID()}`,
      } });
      expect(returned.response.status).toBe(200);
      fifoReturns.push(returned.payload.salesReturn);
    }
    expect(fifoReturns.reduce((sum, item) => sum + Number(item.cogsTotal), 0)).toBe(Number(fifoInvoice.cogsTotal));
    const fifoCosts = fifoReturns.flatMap((item) => item.items.flatMap((line: any) => line.returnFifoAllocations.map((allocation: any) => Number(allocation.unitCostExVat))));
    expect(fifoCosts).toEqual(expect.arrayContaining([5, 9]));

    const unpaidProduct = await createStockedProduct("CRU", [[1, 7]]);
    const unpaidInvoice = await checkout(unpaidProduct.id, 1, `credit-unpaid-${randomUUID()}`, "credit");
    const unpaidReturn = await api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: {
      invoiceId: unpaidInvoice.id, returnDate: "2026-07-06", reason: "آجل غير مدفوع", items: [{ productId: unpaidProduct.id, quantity: 1 }], clientOperationId: `credit-unpaid-return-${randomUUID()}`,
    } });
    expect(unpaidReturn.response.status).toBe(200);
    expect(Number(unpaidReturn.payload.salesReturn.arReduction)).toBe(Number(unpaidInvoice.total));
    expect(Number(unpaidReturn.payload.salesReturn.refundAmount)).toBe(0);
    let receivables = await api("/data/receivables", { cookie: ownerA.cookie });
    expect(receivables.payload.records.find((row: any) => Number(row.invoiceId) === Number(unpaidInvoice.id))).toMatchObject({ amount: unpaidInvoice.total, paid: unpaidInvoice.total, status: "paid" });

    const partialProduct = await createStockedProduct("CRP", [[1, 7]]);
    const partialInvoice = await checkout(partialProduct.id, 1, `credit-partial-${randomUUID()}`, "credit");
    await pool.query("update erp_records set data = jsonb_set(data, '{paid}', '10'::jsonb) where organization_id = $1 and table_name = 'receivables' and data->>'invoiceId' = $2", [ownerA.organizationId, String(partialInvoice.id)]);
    const partialReturn = await api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: {
      invoiceId: partialInvoice.id, returnDate: "2026-07-07", reason: "آجل مدفوع جزئيا", items: [{ productId: partialProduct.id, quantity: 1 }], clientOperationId: `credit-partial-return-${randomUUID()}`,
    } });
    expect(partialReturn.response.status).toBe(200);
    expect(Number(partialReturn.payload.salesReturn.arReduction)).toBe(Number(partialInvoice.total) - 10);
    expect(Number(partialReturn.payload.salesReturn.refundAmount)).toBe(10);
    receivables = await api("/data/receivables", { cookie: ownerA.cookie });
    expect(receivables.payload.records.find((row: any) => Number(row.invoiceId) === Number(partialInvoice.id))).toMatchObject({ amount: partialInvoice.total, paid: partialInvoice.total, status: "paid" });
    const journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
    const partialJournal = journals.payload.records.find((row: any) => Number(row.sourceId) === Number(partialReturn.payload.salesReturn.id));
    expect(partialJournal.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ credit: Number(partialInvoice.total) - 10 }),
      expect.objectContaining({ credit: 10 }),
    ]));
  });

  it("يسترد كسور net وVAT بالكامل عبر ثلاثة مرتجعات دون بقايا تقريب", async () => {
    const warehouse = (await api("/data/warehouses", { cookie: ownerA.cookie })).payload.records[0];
    const productResult = await api("/data/products", { method: "POST", cookie: ownerA.cookie, body: {
      name: `منتج كسور ${randomUUID()}`, sku: `ROUND-${randomUUID().slice(0, 8)}`, sellPrice: 0.1, vatRate: 15, stock: 0, status: "active",
    } });
    expect(productResult.response.status).toBe(201);
    const product = productResult.payload.record;
    expect((await api("/inventory/adjustments", { method: "POST", cookie: ownerA.cookie, body: {
      productId: product.id, warehouseId: warehouse.id, actualQuantity: 3, unitCostExVat: 0.03,
      reason: "اختبار كسور المرتجع", date: "2026-07-08",
    } })).response.status).toBe(200);
    const checkout = await api("/inventory/checkout", { method: "POST", cookie: ownerA.cookie, body: {
      warehouseId: warehouse.id, issueDate: "2026-07-08", paymentMethod: "cash",
      items: [{ productId: product.id, quantity: 3 }], clientOperationId: `round-sale-${randomUUID()}`,
    } });
    expect(checkout.response.status).toBe(200);
    const invoice = checkout.payload.invoice;
    const returns = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await api("/inventory/sales-returns", { method: "POST", cookie: ownerA.cookie, body: {
        invoiceId: invoice.id, returnDate: `2026-07-${String(9 + index).padStart(2, "0")}`, reason: `مرتجع كسور ${index + 1}`,
        items: [{ productId: product.id, quantity: 1 }], clientOperationId: `round-return-${index}-${randomUUID()}`,
      } });
      expect(result.response.status).toBe(200);
      returns.push(result.payload.salesReturn);
    }
    const sum = (field: string) => Math.round(returns.reduce((total, item) => total + Number(item[field]), 0) * 100) / 100;
    expect(sum("subtotal")).toBe(Number(invoice.subtotal));
    expect(sum("tax")).toBe(Number(invoice.tax));
    expect(sum("total")).toBe(Number(invoice.total));

    const journals = (await api("/data/journalEntries", { cookie: ownerA.cookie })).payload.records;
    const accountCode = new Map(accountsA.map((account: any) => [String(account.code), String(account.id)]));
    const returnJournals = returns.map((salesReturn) => journals.find((journal: any) =>
      journal.sourceType === "sale" && Number(journal.sourceId) === Number(salesReturn.id),
    ));
    expect(returnJournals.every(Boolean)).toBe(true);
    const journalDebit = (accountId: string) => Math.round(returnJournals.reduce((total: number, journal: any) =>
      total + journal.lines.filter((line: any) => line.accountId === accountId).reduce((lineTotal: number, line: any) => lineTotal + Number(line.debit), 0), 0) * 100) / 100;
    expect(journalDebit(accountCode.get("4000"))).toBe(Number(invoice.subtotal));
    expect(journalDebit(accountCode.get("2100"))).toBe(Number(invoice.tax));

    const creditNotes = await pool.query(
      "select tax_exclusive_amount, tax_amount, tax_inclusive_amount from e_invoice_documents where organization_id = $1 and invoice_record_id = $2 and document_type = 'credit_note'",
      [ownerA.organizationId, invoice.id],
    );
    if (creditNotes.rows.length) {
      const noteSum = (field: string) => Math.round(creditNotes.rows.reduce((total: number, row: any) => total + Number(row[field]), 0) * 100) / 100;
      expect(noteSum("tax_exclusive_amount")).toBe(Number(invoice.subtotal));
      expect(noteSum("tax_amount")).toBe(Number(invoice.tax));
      expect(noteSum("tax_inclusive_amount")).toBe(Number(invoice.total));
    }
  });

  it("ينشئ قيد المصروف بالتصنيف وطريقة الدفع ولا يكرر القيد عند إعادة الطلب", async () => {
    const accountCode = new Map(accountsA.map((account: any) => [String(account.code), account.id]));
    const categories = [
      ["إيجار", "5100"],
      ["رواتب", "5200"],
      ["مرافق", "5300"],
      ["تسويق", "5400"],
      ["نقل", "5500"],
      ["صيانة", "5600"],
      ["أخرى", "5900"],
      ["غير معروف", "5100"],
    ];
    const createdIds: number[] = [];
    for (const [category, debitCode] of categories) {
      const clientOperationId = `expense-category-${category}-${randomUUID()}`;
      const body = {
        clientOperationId,
        description: `اختبار تصنيف ${category}`,
        amount: 100,
        date: "2026-04-01",
        category,
        paymentMethod: "cash",
      };
      const created = await api("/data/expenses", {
        method: "POST",
        cookie: ownerA.cookie,
        body,
      });
      expect(created.response.status).toBe(201);
      createdIds.push(created.payload.record.id);
      const repeated = await api("/data/expenses", {
        method: "POST",
        cookie: ownerA.cookie,
        body,
      });
      expect(repeated.response.status).toBe(200);
      expect(repeated.payload.record.id).toBe(created.payload.record.id);

      const journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
      const matching = journals.payload.records.filter((journal: any) =>
        journal.sourceType === "expense" && Number(journal.sourceId) === Number(created.payload.record.id)
        && !journal.adjustmentType,
      );
      expect(matching).toHaveLength(1);
      const expectedDebitAccountId = accountCode.get(debitCode) ?? accountCode.get("5100");
      expect(matching[0].lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: String(expectedDebitAccountId), debit: 100, credit: 0 }),
        expect.objectContaining({ accountId: String(accountCode.get("1000")), debit: 0, credit: 100 }),
      ]));
    }

    for (const paymentMethod of ["card", "transfer"]) {
      const created = await api("/data/expenses", {
        method: "POST",
        cookie: ownerA.cookie,
        body: {
          clientOperationId: `expense-payment-${paymentMethod}-${randomUUID()}`,
          description: `اختبار دفع ${paymentMethod}`,
          amount: 125,
          date: "2026-04-02",
          category: "إيجار",
          paymentMethod,
        },
      });
      expect(created.response.status).toBe(201);
      const journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
      const journal = journals.payload.records.find((item: any) =>
        item.sourceType === "expense" && Number(item.sourceId) === Number(created.payload.record.id)
        && !item.adjustmentType,
      );
      expect(journal).toBeTruthy();
      expect(journal.lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: String(accountCode.get("1100")), debit: 0, credit: 125 }),
      ]));
    }

    const cleanup = await api(`/data/expenses/${createdIds[0]}`, {
      method: "DELETE",
      cookie: ownerA.cookie,
    });
    expect(cleanup.response.status).toBe(204);
  });

  it("يعكس قيد المصروف عند التعديل والحذف، وتعيد المزامنة إنشاء قيد المصروف القديم", async () => {
    const accountCode = new Map(accountsA.map((account: any) => [String(account.code), account.id]));
    const created = await api("/data/expenses", {
      method: "POST",
      cookie: ownerA.cookie,
      body: {
        clientOperationId: `expense-lifecycle-${randomUUID()}`,
        description: "مصروف دورة الحياة",
        amount: 80,
        date: "2026-04-03",
        category: "مرافق",
        paymentMethod: "cash",
      },
    });
    expect(created.response.status).toBe(201);
    const expenseId = Number(created.payload.record.id);

    const updated = await api(`/data/expenses/${expenseId}`, {
      method: "PATCH",
      cookie: ownerA.cookie,
      headers: { "Idempotency-Key": `expense-update-${randomUUID()}` },
      body: { amount: 140, paymentMethod: "card" },
    });
    expect(updated.response.status).toBe(200);
    let journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
    let sourceJournals = journals.payload.records.filter((item: any) =>
      item.sourceType === "expense" && Number(item.sourceId) === expenseId,
    );
    expect(sourceJournals.filter((item: any) => item.adjustmentType === "reversal")).toHaveLength(1);
    expect(sourceJournals.filter((item: any) => !item.adjustmentType)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lines: expect.arrayContaining([
          expect.objectContaining({ accountId: String(accountCode.get("5300")), debit: 140, credit: 0 }),
          expect.objectContaining({ accountId: String(accountCode.get("1100")), debit: 0, credit: 140 }),
        ]),
      }),
    ]));

    const removed = await api(`/data/expenses/${expenseId}`, {
      method: "DELETE",
      cookie: ownerA.cookie,
    });
    expect(removed.response.status).toBe(204);
    journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
    sourceJournals = journals.payload.records.filter((item: any) =>
      item.sourceType === "expense" && Number(item.sourceId) === expenseId,
    );
    expect(sourceJournals.filter((item: any) => item.adjustmentType === "reversal")).toHaveLength(2);

    const legacyExpense = await api("/data/expenses", {
      method: "POST",
      cookie: ownerA.cookie,
      body: {
        clientOperationId: `expense-sync-${randomUUID()}`,
        description: "مصروف قديم للمزامنة",
        amount: 60,
        date: "2026-04-04",
        category: "أخرى",
        paymentMethod: "transfer",
      },
    });
    expect(legacyExpense.response.status).toBe(201);
    const legacyId = Number(legacyExpense.payload.record.id);
    await pool.query(
      "delete from erp_records where organization_id = $1 and table_name = 'journalEntries' and data->>'sourceId' = $2",
      [ownerA.organizationId, String(legacyId)],
    );
    const synced = await api("/accounting/sync-source-journals", {
      method: "POST",
      cookie: ownerA.cookie,
    });
    expect(synced.response.status).toBe(200);
    expect(synced.payload.created).toBeGreaterThanOrEqual(1);
    journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
    expect(journals.payload.records.filter((item: any) =>
      item.sourceType === "expense" && Number(item.sourceId) === legacyId && !item.adjustmentType,
    )).toHaveLength(1);
  });

  it("يحوّل قيد بيع يدوي للعميل إلى فاتورة مسودة واحدة ويظل القيد قابلاً للترحيل", async () => {
    const customer = await api("/data/customers", {
      method: "POST", cookie: ownerA.cookie,
      body: { name: `عميل قيد بيع ${randomUUID()}` },
    });
    expect(customer.response.status).toBe(201);
    const ar = accountsA.find((account) => String(account.code) === "1200");
    const sales = accountsA.find((account) => String(account.code) === "4000");
    expect(ar).toBeTruthy();
    expect(sales).toBeTruthy();
    const created = await api("/data/journalEntries", {
      method: "POST", cookie: ownerA.cookie,
      body: {
        date: "2026-05-01", description: "بيع يدوي للعميل", status: "draft",
        customerId: customer.payload.record.id,
        lines: [{ accountId: String(ar.id), debit: 150, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 150 }],
      },
    });
    expect(created.response.status).toBe(201);
    const journal = created.payload.record;
    expect(journal.conversionStatus).toBe("linked_draft");
    expect(journal.sourceType).toBe("sale");
    const invoices = await api("/data/invoices", { cookie: ownerA.cookie });
    const linked = invoices.payload.records.filter((invoice: any) => Number(invoice.sourceJournalId) === Number(journal.id));
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ status: "draft", customerId: customer.payload.record.id, customerName: customer.payload.record.name });

    const edited = await api(`/data/journalEntries/${journal.id}`, {
      method: "PATCH",
      cookie: ownerA.cookie,
      body: {
        description: "بيع يدوي معدل",
        lines: [{ accountId: String(ar.id), debit: 175, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 175 }],
        convertedSourceId: 999999,
        sourceDocumentId: 999999,
      },
    });
    expect(edited.response.status).toBe(200);
    expect(edited.payload.record).toMatchObject({ description: "بيع يدوي معدل", convertedSourceId: journal.convertedSourceId, sourceDocumentId: journal.sourceDocumentId });
    const invoicesEdited = await api("/data/invoices", { cookie: ownerA.cookie });
    expect(invoicesEdited.payload.records.filter((invoice: any) => Number(invoice.sourceJournalId) === Number(journal.id))).toEqual([
      expect.objectContaining({ id: linked[0].id, status: "draft", total: 175, subtotal: 175 }),
    ]);
    const removed = await api(`/data/journalEntries/${journal.id}`, { method: "DELETE", cookie: ownerA.cookie });
    expect(removed.response.status).toBe(409);
    const posted = await api(`/data/journalEntries/${journal.id}`, { method: "PATCH", cookie: ownerA.cookie, body: { status: "posted" } });
    expect(posted.response.status).toBe(200);
    expect(posted.payload.record.status).toBe("posted");
    const editedAfterPosting = await api(`/data/journalEntries/${journal.id}`, { method: "PATCH", cookie: ownerA.cookie, body: { description: "تعديل بعد الترحيل" } });
    expect(editedAfterPosting.response.status).toBe(409);
    const corrected = await api(`/accounting/journals/${journal.id}/correct`, {
      method: "POST",
      cookie: ownerA.cookie,
      headers: { "Idempotency-Key": `correct-linked-manual-${randomUUID()}` },
      body: {
        date: "2026-05-02",
        reason: "تصحيح مبلغ البيع",
        description: "بيع يدوي مصحح",
        lines: [{ accountId: String(ar.id), debit: 180, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 180 }],
      },
    });
    expect(corrected.response.status).toBe(201);
    expect(corrected.payload.correction).toMatchObject({ adjustmentType: "correction", sourceId: linked[0].id });
    const invoicesAfter = await api("/data/invoices", { cookie: ownerA.cookie });
    expect(invoicesAfter.payload.records.filter((invoice: any) => Number(invoice.sourceJournalId) === Number(journal.id))).toEqual([
      expect.objectContaining({ id: linked[0].id, status: "draft", total: 180, subtotal: 180 }),
    ]);
  });

  it("يحوّل قيد مصروف يدوي للمورد إلى مسودة واحدة ولا يكرر المصدر أو القيد عند الإعادة والمزامنة", async () => {
    const supplier = await api("/data/suppliers", {
      method: "POST", cookie: ownerA.cookie,
      body: { name: `مورد قيد مصروف ${randomUUID()}` },
    });
    expect(supplier.response.status).toBe(201);
    const expense = accountsA.find((account) => account.type === "expense" && String(account.code) === "5100");
    const cash = accountsA.find((account) => String(account.code) === "1000");
    expect(expense).toBeTruthy();
    expect(cash).toBeTruthy();
    const created = await api("/data/journalEntries", {
      method: "POST", cookie: ownerA.cookie,
      body: {
        date: "2026-05-02", description: "مصروف يدوي للمورد", status: "draft", supplierId: supplier.payload.record.id,
        lines: [{ accountId: String(expense.id), debit: 90, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: 90 }],
      },
    });
    expect(created.response.status).toBe(201);
    const journal = created.payload.record;
    expect(journal.sourceType).toBe("expense");
    const expensesBefore = await api("/data/expenses", { cookie: ownerA.cookie });
    expect(expensesBefore.payload.records.filter((item: any) => Number(item.sourceJournalId) === Number(journal.id))).toEqual([
      expect.objectContaining({ status: "draft", supplierId: supplier.payload.record.id, vendor: supplier.payload.record.name }),
    ]);
    const edited = await api(`/data/journalEntries/${journal.id}`, {
      method: "PATCH", cookie: ownerA.cookie,
      body: {
        description: "مصروف يدوي معدل",
        lines: [{ accountId: String(expense.id), debit: 95, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: 95 }],
      },
    });
    expect(edited.response.status).toBe(200);
    const expensesEdited = await api("/data/expenses", { cookie: ownerA.cookie });
    expect(expensesEdited.payload.records.filter((item: any) => Number(item.sourceJournalId) === Number(journal.id))).toEqual([
      expect.objectContaining({ id: expensesBefore.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(journal.id)).id, amount: 95, description: "مصروف يدوي معدل" }),
    ]);
    const repeat = await api(`/accounting/journals/${journal.id}/convert-source-draft`, { method: "POST", cookie: ownerA.cookie });
    expect(repeat.response.status).toBe(200);
    expect(repeat.payload.converted).toBe(true);
    const synced = await api("/accounting/sync-source-journals", { method: "POST", cookie: ownerA.cookie });
    expect(synced.response.status).toBe(200);
    const expensesAfter = await api("/data/expenses", { cookie: ownerA.cookie });
    const journalsAfter = await api("/data/journalEntries", { cookie: ownerA.cookie });
    expect(expensesAfter.payload.records.filter((item: any) => Number(item.sourceJournalId) === Number(journal.id))).toHaveLength(1);
    expect(journalsAfter.payload.records.filter((item: any) =>
      item.sourceType === "expense" && Number(item.sourceId) === Number(journal.sourceId),
    )).toHaveLength(1);
  });

  it("لا يحوّل القيد العام الملتبس ويرفض طرف منشأة أخرى", async () => {
    const asset = accountsA.find((account) => account.type === "asset" && String(account.code) === "1000");
    const equity = accountsA.find((account) => account.type === "equity");
    const foreignCustomer = await api("/data/customers", {
      method: "POST", cookie: ownerB.cookie, body: { name: `عميل منشأة أخرى ${randomUUID()}` },
    });
    expect(foreignCustomer.response.status).toBe(201);
    const foreign = await api("/data/journalEntries", {
      method: "POST", cookie: ownerA.cookie,
      body: { date: "2026-05-03", description: "طرف غير تابع", status: "draft", customerId: foreignCustomer.payload.record.id, lines: [{ accountId: String(asset.id), debit: 10, credit: 0 }, { accountId: String(equity.id), debit: 0, credit: 10 }] },
    });
    expect(foreign.response.status).toBe(400);
    const created = await api("/data/journalEntries", {
      method: "POST", cookie: ownerA.cookie,
      body: { date: "2026-05-03", description: "قيد عام ملتبس", status: "draft", lines: [{ accountId: String(asset.id), debit: 10, credit: 0 }, { accountId: String(equity.id), debit: 0, credit: 10 }] },
    });
    expect(created.response.status).toBe(201);
    expect(created.payload.record.convertedSourceId).toBeFalsy();
    const conversion = await api(`/accounting/journals/${created.payload.record.id}/convert-source-draft`, { method: "POST", cookie: ownerA.cookie });
    expect(conversion.response.status).toBe(200);
    expect(conversion.payload.converted).toBe(false);
  });

  it("يرفض الأنماط المختلطة والأسطر الإضافية ويحتفظ بطريقة دفع الطرف المقابل", async () => {
    const cash = accountsA.find((account) => String(account.code) === "1000");
    const bank = accountsA.find((account) => String(account.code) === "1100");
    const ar = accountsA.find((account) => String(account.code) === "1200");
    const sales = accountsA.find((account) => String(account.code) === "4000");
    const expense = accountsA.find((account) => String(account.code) === "5100");
    const created = await api("/data/journalEntries", {
      method: "POST", cookie: ownerA.cookie,
      body: { date: "2026-05-04", description: "بيع بنكي دقيق", status: "draft", lines: [{ accountId: String(bank.id), debit: 50, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 50 }] },
    });
    expect(created.response.status).toBe(201);
    const invoices = await api("/data/invoices", { cookie: ownerA.cookie });
    expect(invoices.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(created.payload.record.id))).toMatchObject({ paymentMethod: "transfer" });
    for (const lines of [
      [{ accountId: String(ar.id), debit: 50, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 50 }, { accountId: String(cash.id), debit: 1, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 1 }],
      [{ accountId: String(expense.id), debit: 50, credit: 0 }, { accountId: String(bank.id), debit: 0, credit: 40 }, { accountId: String(cash.id), debit: 0, credit: 10 }],
    ]) {
      const result = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-04", description: `نمط مرفوض ${randomUUID()}`, status: "draft", lines } });
      expect(result.response.status).toBe(201);
      expect(result.payload.record.convertedSourceId).toBeFalsy();
    }
  });

  it("ينشئ شراء بلا مورد كمسودة ناقصة ولا تنشئ مسودة المصروف قيود دورة حياة", async () => {
    const inventory = accountsA.find((account) => String(account.code) === "1300");
    const payable = accountsA.find((account) => String(account.code) === "2000");
    const expense = accountsA.find((account) => String(account.code) === "5100");
    const cash = accountsA.find((account) => String(account.code) === "1000");
    const purchase = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-05", description: "شراء بلا مورد", status: "draft", lines: [{ accountId: String(inventory.id), debit: 70, credit: 0 }, { accountId: String(payable.id), debit: 0, credit: 70 }] } });
    expect(purchase.response.status).toBe(201);
    const purchaseEdited = await api(`/data/journalEntries/${purchase.payload.record.id}`, {
      method: "PATCH", cookie: ownerA.cookie,
      body: { lines: [{ accountId: String(inventory.id), debit: 75, credit: 0 }, { accountId: String(payable.id), debit: 0, credit: 75 }] },
    });
    expect(purchaseEdited.response.status).toBe(200);
    const orders = await api("/data/purchaseOrders", { cookie: ownerA.cookie });
    expect(orders.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(purchase.payload.record.id))).toMatchObject({ accountingOnlyDraft: true, requiresCompletion: true, supplierName: expect.stringContaining("مورد غير محدد"), total: 75, subtotal: 75 });
    const journal = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-05", description: "مصروف مسودة معلوماتية", status: "draft", lines: [{ accountId: String(expense.id), debit: 33, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: 33 }] } });
    const expenses = await api("/data/expenses", { cookie: ownerA.cookie });
    const source = expenses.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(journal.payload.record.id));
    const before = await api("/data/journalEntries", { cookie: ownerA.cookie });
    expect((await api(`/data/expenses/${source.id}`, { method: "PATCH", cookie: ownerA.cookie, body: { accountingOnlyDraft: false, requiresCompletion: false, sourceJournalId: null } })).response.status).toBe(409);
    expect((await api(`/data/expenses/${source.id}`, { method: "DELETE", cookie: ownerA.cookie })).response.status).toBe(409);
    const after = await api("/data/journalEntries", { cookie: ownerA.cookie });
    expect(after.payload.records.length).toBe(before.payload.records.length);
  });

  it("يعيد التحويل الرابط المحفوظ ويمنع التكرار عند تخزين معرّف المصدر كسلسلة", async () => {
    const expense = accountsA.find((account) => String(account.code) === "5100");
    const cash = accountsA.find((account) => String(account.code) === "1000");
    const created = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-06", description: "خصم سلسلة المصدر", status: "draft", lines: [{ accountId: String(expense.id), debit: 41, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: 41 }] } });
    const retry = await api(`/accounting/journals/${created.payload.record.id}/convert-source-draft`, { method: "POST", cookie: ownerA.cookie });
    expect(retry.payload.journal).toMatchObject({ id: created.payload.record.id, convertedSourceId: created.payload.record.convertedSourceId });
    await pool.query("update erp_records set data = jsonb_set(data, '{sourceId}', to_jsonb(data->>'sourceId')) where id = $1", [created.payload.record.id]);
    expect((await api("/accounting/sync-source-journals", { method: "POST", cookie: ownerA.cookie })).response.status).toBe(200);
    const journals = await api("/data/journalEntries", { cookie: ownerA.cookie });
    expect(journals.payload.records.filter((item: any) => item.sourceType === "expense" && String(item.sourceId) === String(created.payload.record.sourceId))).toHaveLength(1);
  });

  it("يرفض تصحيح وإلغاء مسودات القيد اليدوي المعلوماتية دون قيود أو حركة مخزون", async () => {
    const bank = accountsA.find((account) => String(account.code) === "1100");
    const sales = accountsA.find((account) => String(account.code) === "4000");
    const expense = accountsA.find((account) => String(account.code) === "5100");
    const cash = accountsA.find((account) => String(account.code) === "1000");
    const sale = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-07", description: "فاتورة مسودة محمية", status: "draft", lines: [{ accountId: String(bank.id), debit: 61, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 61 }] } });
    const expenseJournal = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-07", description: "مصروف مسودة محمي", status: "draft", lines: [{ accountId: String(expense.id), debit: 62, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: 62 }] } });
    expect((await api(`/data/journalEntries/${sale.payload.record.id}`, { method: "PATCH", cookie: ownerA.cookie, body: { status: "posted" } })).response.status).toBe(200);
    expect((await api(`/data/journalEntries/${expenseJournal.payload.record.id}`, { method: "PATCH", cookie: ownerA.cookie, body: { status: "posted" } })).response.status).toBe(200);
    const invoices = await api("/data/invoices", { cookie: ownerA.cookie });
    const expenses = await api("/data/expenses", { cookie: ownerA.cookie });
    const invoice = invoices.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(sale.payload.record.id));
    const expenseDraft = expenses.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(expenseJournal.payload.record.id));
    const journalsBefore = await api("/data/journalEntries", { cookie: ownerA.cookie });
    const inventoryBefore = await api("/data/inventoryBalances", { cookie: ownerA.cookie });
    for (const [table, source] of [["invoices", invoice], ["expenses", expenseDraft]] as const) {
      for (const action of ["cancel", "correct"] as const) {
        const result = await api(`/accounting/sources/${table}/${source.id}/${action}`, {
          method: "POST", cookie: ownerA.cookie, headers: { "Idempotency-Key": `manual-draft-${table}-${action}-${randomUUID()}` },
          body: { reason: "محاولة تشغيلية مرفوضة" },
        });
        expect(result.response.status).toBe(409);
        expect(result.payload.error).toContain("مسودة معلوماتية");
      }
    }
    const journalsAfter = await api("/data/journalEntries", { cookie: ownerA.cookie });
    const inventoryAfter = await api("/data/inventoryBalances", { cookie: ownerA.cookie });
    expect(journalsAfter.payload.records.length).toBe(journalsBefore.payload.records.length);
    expect(inventoryAfter.payload.records).toEqual(inventoryBefore.payload.records);
  });

  it("يرفض حذف كل مصادر القيد اليدوي المرتبطة ويبقي الرابط نفسه عند إعادة التحويل", async () => {
    const bank = accountsA.find((account) => String(account.code) === "1100");
    const sales = accountsA.find((account) => String(account.code) === "4000");
    const inventory = accountsA.find((account) => String(account.code) === "1300");
    const payable = accountsA.find((account) => String(account.code) === "2000");
    const expense = accountsA.find((account) => String(account.code) === "5100");
    const cash = accountsA.find((account) => String(account.code) === "1000");
    const inputs = [
      { table: "invoices", lines: [{ accountId: String(bank.id), debit: 81, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: 81 }] },
      { table: "purchaseOrders", lines: [{ accountId: String(inventory.id), debit: 82, credit: 0 }, { accountId: String(payable.id), debit: 0, credit: 82 }] },
      { table: "expenses", lines: [{ accountId: String(expense.id), debit: 83, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: 83 }] },
    ];
    const journalsBefore = await api("/data/journalEntries", { cookie: ownerA.cookie });
    for (const input of inputs) {
      const created = await api("/data/journalEntries", { method: "POST", cookie: ownerA.cookie, body: { date: "2026-05-08", description: `مصدر محمي ${input.table}`, status: "draft", lines: input.lines } });
      expect(created.response.status).toBe(201);
      const sources = await api(`/data/${input.table}`, { cookie: ownerA.cookie });
      const source = sources.payload.records.find((item: any) => Number(item.sourceJournalId) === Number(created.payload.record.id));
      expect(source).toBeTruthy();
      expect((await api(`/data/${input.table}/${source.id}`, { method: "DELETE", cookie: ownerA.cookie })).response.status).toBe(409);
      const retry = await api(`/accounting/journals/${created.payload.record.id}/convert-source-draft`, { method: "POST", cookie: ownerA.cookie });
      expect(retry.payload.journal).toMatchObject({ convertedSourceId: source.id, sourceId: source.id });
      expect(retry.payload.source).toEqual({ id: source.id, tableName: input.table });
    }
    const journalsAfter = await api("/data/journalEntries", { cookie: ownerA.cookie });
    expect(journalsAfter.payload.records.length).toBe(journalsBefore.payload.records.length + 3);
  });
});