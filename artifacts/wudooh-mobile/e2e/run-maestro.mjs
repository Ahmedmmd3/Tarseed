import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_MOCK_API_PORT ?? "4317");
const mockOrigin = `http://127.0.0.1:${port}`;
const maestro = process.env.MAESTRO_BIN ?? "maestro";
const flows = ["login.yaml", "navigation.yaml", "session-restore.yaml", "offline-sync.yaml"];

const configuredApiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.trim().replace(/\/+$/, "");
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  `http://10.0.2.2:${port}`,
]);
if (!configuredApiOrigin || !allowedOrigins.has(configuredApiOrigin)) {
  throw new Error(
    `EXPO_PUBLIC_API_ORIGIN must be a simulator-local fixture URL on port ${port}; refusing to run against a real API.`,
  );
}

async function getState() {
  const response = await fetch(`${mockOrigin}/__e2e/state`);
  if (!response.ok) throw new Error(`Fixture state request failed with ${response.status}.`);
  return await response.json();
}

async function waitForFixture() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${mockOrigin}/__e2e/health`);
      if (response.ok) return;
    } catch {
      // The fixture can take a moment to bind its local port.
    }
    await delay(100);
  }
  throw new Error("The local E2E fixture did not become ready.");
}

async function failNextSync() {
  const response = await fetch(`${mockOrigin}/__e2e/fail-next-sync`, { method: "POST" });
  if (!response.ok) throw new Error("Could not enable the deterministic offline-sync failure.");
}

function runFlow(flow) {
  const result = spawnSync(maestro, ["test", join(directory, flow)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("Maestro is not installed. Install Maestro and set MAESTRO_BIN if it is not on PATH.");
  }
  if (result.status !== 0) throw new Error(`Native E2E flow failed: ${flow}`);
}

const maestroVersion = spawnSync(maestro, ["--version"], { stdio: "ignore" });
if (maestroVersion.error?.code === "ENOENT") {
  throw new Error("Maestro is not installed. Install Maestro and set MAESTRO_BIN if it is not on PATH.");
}
if (maestroVersion.status !== 0) {
  throw new Error("Maestro is installed but could not start.");
}

const fixture = spawn(process.execPath, [join(directory, "mock-api.mjs")], {
  stdio: "inherit",
  env: { ...process.env, E2E_MOCK_API_PORT: String(port), E2E_MOCK_API_HOST: "0.0.0.0" },
});

try {
  await waitForFixture();
  for (const flow of flows) {
    if (flow === "offline-sync.yaml") await failNextSync();
    runFlow(flow);
  }
  const state = await getState();
  const operations = state.syncOperations ?? [];
  if (operations.length !== 1 || operations[0].kind !== "expense" || operations[0].attempts !== 2) {
    throw new Error(`Expected one retried local operation, got ${JSON.stringify(operations)}.`);
  }
  if (state.requests.some((request) => request.path.includes("stripe") || request.path.includes("resend") || request.path.includes("twilio"))) {
    throw new Error("Native E2E contacted an external-service route.");
  }
  process.stdout.write("Native E2E passed: login, native navigation, SecureStore restore, and offline sync.\n");
} finally {
  fixture.kill("SIGTERM");
}