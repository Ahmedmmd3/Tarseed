import { createServer } from "node:http";

const port = Number(process.env.E2E_MOCK_API_PORT ?? "4317");
const host = process.env.E2E_MOCK_API_HOST ?? "0.0.0.0";
const sessionToken = "native-e2e-session-token";
const operationRecords = [];
const state = {
  failNextSync: false,
  requests: [],
};

const user = {
  id: 9001,
  accountId: 9001,
  organizationId: 9001,
  projectName: "مساحة اختبار التطبيق الأصلي",
  dataGeneration: 1,
  email: "native-e2e@example.test",
  phone: null,
  emailVerifiedAt: "2026-08-31T00:00:00.000Z",
  phoneVerifiedAt: null,
  name: "مالك الاختبار",
  roleId: "owner",
  permissions: {
    dashboard: true,
    sales: true,
    accounting: true,
    inventory: true,
    hr: true,
    operations: true,
    reports: true,
  },
  locationScope: "all",
  warehouseIds: [],
  status: "active",
  isTeamMember: false,
  subscription: { planId: "test", status: "active", accessActive: true },
};

const warehouses = [{ id: 1, name: "الموقع الرئيسي", status: "active" }];
const products = [{ id: 1, name: "منتج اختبار", sku: "NATIVE-001", barcode: "6290000000011", price: 25, sellPrice: 25 }];
const balances = [{ id: 1, productId: 1, warehouseId: 1, quantity: 20 }];
const invoices = [];
const expenses = [];
let expiringShareAlerts = [{
  purchaseOrderId: 42,
  orderNumber: "PO-NATIVE-001",
  supplierName: "مورد الاختبار",
  expiresAt: "2026-09-01T18:00:00.000Z",
  hoursRemaining: 4,
}];

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, X-Wudooh-Client, X-Wudooh-Data-Generation",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function noContent(response, status = 204) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, X-Wudooh-Client, X-Wudooh-Data-Generation",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end();
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function isAuthenticated(request) {
  return request.headers.authorization === `Bearer ${sessionToken}`;
}

function requireAuthentication(request, response) {
  if (isAuthenticated(request)) return true;
  json(response, 401, { error: "جلسة الاختبار غير صالحة." });
  return false;
}

function recordRequest(request, pathname, body) {
  state.requests.push({
    method: request.method,
    path: pathname,
    hasBearer: Boolean(request.headers.authorization),
    body: body && typeof body === "object" ? body : undefined,
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const body = request.method === "POST" ? await readBody(request) : undefined;
  recordRequest(request, url.pathname, body);

  if (request.method === "OPTIONS") {
    noContent(response);
    return;
  }
  if (url.pathname === "/__e2e/health") {
    json(response, 200, { ok: true, mode: "local-fixture" });
    return;
  }
  if (url.pathname === "/__e2e/fail-next-sync" && request.method === "POST") {
    state.failNextSync = true;
    json(response, 200, { failNextSync: true });
    return;
  }
  if (url.pathname === "/__e2e/state" && request.method === "GET") {
    json(response, 200, {
      failNextSync: state.failNextSync,
      requests: state.requests,
      syncOperations: operationRecords,
    });
    return;
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    if (body?.identifier !== user.email || body?.password !== "Native-e2e-password-123") {
      json(response, 401, { error: "البريد الإلكتروني أو رقم الجوال أو كلمة المرور غير صحيحة." });
      return;
    }
    json(response, 200, { user, sessionToken });
    return;
  }
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    json(response, 200, { user: isAuthenticated(request) ? user : null });
    return;
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (!requireAuthentication(request, response)) return;
    noContent(response);
    return;
  }

  const records = {
    "/api/data/products": products,
    "/api/data/warehouses": warehouses,
    "/api/data/inventoryBalances": balances,
    "/api/data/invoices": invoices,
    "/api/data/expenses": expenses,
  }[url.pathname];
  if (records && request.method === "GET") {
    if (!requireAuthentication(request, response)) return;
    json(response, 200, { records });
    return;
  }

  if (url.pathname === "/api/data/purchaseOrderShares/expiring" && request.method === "GET") {
    if (!requireAuthentication(request, response)) return;
    json(response, 200, { alerts: expiringShareAlerts });
    return;
  }

  const shareMatch = url.pathname.match(/^\/api\/data\/purchaseOrders\/(\d+)\/share$/);
  if (shareMatch && request.method === "POST") {
    if (!requireAuthentication(request, response)) return;
    const purchaseOrderId = Number(shareMatch[1]);
    if (!expiringShareAlerts.some((alert) => alert.purchaseOrderId === purchaseOrderId)) {
      json(response, 404, { error: "أمر الشراء غير متاح." });
      return;
    }
    expiringShareAlerts = expiringShareAlerts.filter((alert) => alert.purchaseOrderId !== purchaseOrderId);
    json(response, 201, {
      rotated: true,
      share: {
        id: 1001,
        url: "https://example.test/purchase-order-share/native-fixture-token",
        status: "pending",
        expiresAt: "2026-09-08T18:00:00.000Z",
        createdAt: "2026-09-01T14:00:00.000Z",
      },
    });
    return;
  }

  if (url.pathname === "/api/data/expenses" && request.method === "POST") {
    if (!requireAuthentication(request, response)) return;
    if (state.failNextSync) {
      state.failNextSync = false;
      json(response, 503, { error: "تمت محاكاة انقطاع الشبكة." });
      return;
    }
    const expense = {
      ...body,
      id: `expense-${expenses.length + 1}`,
    };
    expenses.unshift(expense);
    operationRecords.push({
      kind: "expense",
      clientOperationId: body?.clientOperationId,
      attempts: state.requests.filter((item) => item.path === "/api/data/expenses" && item.body?.clientOperationId === body?.clientOperationId).length,
    });
    json(response, 201, { record: expense });
    return;
  }

  if (url.pathname === "/api/inventory/checkout" && request.method === "POST") {
    if (!requireAuthentication(request, response)) return;
    if (state.failNextSync) {
      state.failNextSync = false;
      json(response, 503, { error: "تمت محاكاة انقطاع الشبكة." });
      return;
    }
    const invoice = {
      id: `invoice-${invoices.length + 1}`,
      number: `E2E-${invoices.length + 1}`,
      issueDate: body?.issueDate,
      total: 25,
      status: "paid",
      paymentMethod: body?.paymentMethod ?? "cash",
    };
    invoices.unshift(invoice);
    operationRecords.push({
      kind: "checkout",
      clientOperationId: body?.clientOperationId,
      attempts: state.requests.filter((item) => item.path === "/api/inventory/checkout" && item.body?.clientOperationId === body?.clientOperationId).length,
    });
    json(response, 201, { invoice });
    return;
  }

  json(response, 404, { error: "مسار غير موجود في Fixture الاختبار المحلي." });
});

server.listen(port, host, () => {
  process.stdout.write(`Native E2E mock API listening on http://${host}:${port}\n`);
});

function close() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", close);
process.on("SIGINT", close);