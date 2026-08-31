import { mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_MOCK_API_PORT ?? "4317");
const mockOrigin = `http://127.0.0.1:${port}`;
const maestro = process.env.MAESTRO_BIN ?? "maestro";
const outputDirectory = process.env.MAESTRO_OUTPUT_DIR?.trim() || null;
const flows = [
  "login.yaml",
  "navigation.yaml",
  "session-restore.yaml",
  "offline-sync.yaml",
];

const configuredApiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.trim().replace(
  /\/+$/,
  "",
);
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
  if (!response.ok)
    throw new Error(`Fixture state request failed with ${response.status}.`);
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
  const response = await fetch(`${mockOrigin}/__e2e/fail-next-sync`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error("Could not enable the deterministic offline-sync failure.");
}

function runFlow(flow) {
  const flowName = flow.replace(/\.yaml$/i, "");
  const args = ["test"];
  if (outputDirectory) {
    args.push(
      "--format",
      "junit",
      "--output",
      join(outputDirectory, `${flowName}.xml`),
      "--debug-output",
      join(outputDirectory, flowName),
      "--test-output-dir",
      join(outputDirectory, flowName),
    );
  }
  args.push(join(directory, flow));

  const result = spawnSync(maestro, args, {
    stdio: outputDirectory ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (outputDirectory) {
    writeFileSync(
      join(outputDirectory, `${flowName}.log`),
      [
        `command: ${maestro} ${args.join(" ")}`,
        `exitCode: ${result.status ?? "unknown"}`,
        "",
        result.stdout?.toString() ?? "",
        result.stderr?.toString() ?? "",
      ].join("\n"),
    );
    if (result.stdout?.length) process.stdout.write(result.stdout);
    if (result.stderr?.length) process.stderr.write(result.stderr);
  }
  if (result.error?.code === "ENOENT") {
    throw new Error(
      "Maestro is not installed. Install Maestro and set MAESTRO_BIN if it is not on PATH.",
    );
  }
  if (result.status !== 0) {
    captureFailureArtifacts(flowName);
    throw new Error(`Native E2E flow failed: ${flow}`);
  }
}

function captureFailureArtifacts(flowName) {
  if (!outputDirectory) return;

  const adb = process.env.ADB_BIN ?? "adb";
  try {
    const screenshot = spawnSync(adb, ["exec-out", "screencap", "-p"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    if (screenshot.status === 0 && screenshot.stdout?.length) {
      writeFileSync(
        join(outputDirectory, `${flowName}-failure.png`),
        screenshot.stdout,
      );
    }

    const logcat = spawnSync(adb, ["logcat", "-d", "-t", "1000"], {
      encoding: "utf8",
      timeout: 10000,
    });
    writeFileSync(
      join(outputDirectory, `${flowName}-logcat.txt`),
      logcat.stdout ||
        logcat.stderr ||
        "Could not collect Android logcat output.",
    );
  } catch (error) {
    writeFileSync(
      join(outputDirectory, `${flowName}-artifact-error.txt`),
      `Could not collect failure artifacts: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

const maestroVersion = spawnSync(maestro, ["--version"], { stdio: "ignore" });
if (maestroVersion.error?.code === "ENOENT") {
  throw new Error(
    "Maestro is not installed. Install Maestro and set MAESTRO_BIN if it is not on PATH.",
  );
}
if (maestroVersion.status !== 0) {
  throw new Error("Maestro is installed but could not start.");
}

if (outputDirectory) mkdirSync(outputDirectory, { recursive: true });

const fixture = spawn(process.execPath, [join(directory, "mock-api.mjs")], {
  stdio: "inherit",
  env: {
    ...process.env,
    E2E_MOCK_API_PORT: String(port),
    E2E_MOCK_API_HOST: "0.0.0.0",
  },
});

try {
  await waitForFixture();
  for (const flow of flows) {
    if (flow === "offline-sync.yaml") await failNextSync();
    runFlow(flow);
  }
  const state = await getState();
  const operations = state.syncOperations ?? [];
  if (
    operations.length !== 1 ||
    operations[0].kind !== "expense" ||
    operations[0].attempts !== 2
  ) {
    throw new Error(
      `Expected one retried local operation, got ${JSON.stringify(operations)}.`,
    );
  }
  if (
    state.requests.some(
      (request) =>
        request.path.includes("stripe") ||
        request.path.includes("resend") ||
        request.path.includes("twilio"),
    )
  ) {
    throw new Error("Native E2E contacted an external-service route.");
  }
  process.stdout.write(
    "Native E2E passed: login, native navigation, SecureStore restore, and offline sync.\n",
  );
} finally {
  fixture.kill("SIGTERM");
}
