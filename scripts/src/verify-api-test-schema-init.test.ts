import assert from "node:assert/strict";
import test from "node:test";

import {
  detectsDatabaseWrite,
  extractApiTestPaths,
  findApiTestSchemaViolations,
  formatApiTestSchemaViolations,
  initializesSchemaBeforeTests,
} from "./verify-api-test-schema-init";

test("finds test files in direct and bundled node test commands", () => {
  assert.deepEqual(
    extractApiTestPaths(
      `pnpm --filter @workspace/db run push && esbuild test/billing-flow.test.mjs --outfile=test/.billing-flow.test.mjs && node --test "$out"`,
    ),
    ["test/billing-flow.test.mjs"],
  );
});

test("detects direct database and HTTP writes", () => {
  assert.equal(
    detectsDatabaseWrite(
      "await db.insert(accountsTable).values({ name: 'test' });",
    ),
    true,
  );
  assert.equal(
    detectsDatabaseWrite(
      `await request("/accounts", { method: "POST", body: payload });`,
    ),
    true,
  );
  assert.equal(
    detectsDatabaseWrite(
      `const response = await request("/accounts", { method: "GET" });`,
    ),
    false,
  );
});

test("requires schema initialization first and stops when it fails", () => {
  assert.equal(
    initializesSchemaBeforeTests(
      "pnpm --filter @workspace/db run push && node --test test/writes.test.mjs",
    ),
    true,
  );
  assert.equal(
    initializesSchemaBeforeTests(
      "node --test test/writes.test.mjs && pnpm --filter @workspace/db run push",
    ),
    false,
  );
  assert.equal(
    initializesSchemaBeforeTests(
      "pnpm --filter @workspace/db run push; node --test test/writes.test.mjs",
    ),
    false,
  );
});

test("flags database-writing tests whose script skips schema initialization", () => {
  const violations = findApiTestSchemaViolations({
    scripts: {
      "test:missing-push": "node --test test/writes.test.mjs",
      "test:initialized": "pnpm --filter @workspace/db run push && node --test test/writes.test.mjs",
      "test:fixtures": "node --test test/fixtures.test.mjs",
    },
    testSources: new Map([
      ["test/writes.test.mjs", "await db.update(accountsTable).set({ name: 'new' });"],
      ["test/fixtures.test.mjs", "assert.equal(1 + 1, 2);"],
    ]),
  });

  assert.deepEqual(violations, [
    {
      scriptName: "test:missing-push",
      testPath: "test/writes.test.mjs",
      reason: "direct database write",
    },
  ]);
});

test("flags a push placed after the writing test", () => {
  const violations = findApiTestSchemaViolations({
    scripts: {
      "test:late-push":
        "node --test test/writes.test.mjs && pnpm --filter @workspace/db run push",
    },
    testSources: new Map([
      [
        "test/writes.test.mjs",
        `await request("/accounts", { method: "POST", body: payload });`,
      ],
    ]),
  });

  assert.deepEqual(violations, [
    {
      scriptName: "test:late-push",
      testPath: "test/writes.test.mjs",
      reason: "HTTP write request",
    },
  ]);
});

test("flags a mixed script when schema initialization is not its guarded prefix", () => {
  const violations = findApiTestSchemaViolations({
    scripts: {
      "test:mixed":
        "node --test test/read-only.test.mjs && pnpm --filter @workspace/db run push && node --test test/writes.test.mjs",
    },
    testSources: new Map([
      ["test/read-only.test.mjs", `await request("/accounts");`],
      [
        "test/writes.test.mjs",
        "await db.delete(accountsTable).where(eq(accountsTable.id, id));",
      ],
    ]),
  });

  assert.deepEqual(violations, [
    {
      scriptName: "test:mixed",
      testPath: "test/writes.test.mjs",
      reason: "direct database write",
    },
  ]);
});

test("formats an actionable schema initialization error", () => {
  assert.match(
    formatApiTestSchemaViolations([
      {
        scriptName: "test:billing",
        testPath: "test/billing-flow.test.mjs",
        reason: "HTTP write request",
      },
    ]),
    /Start each script with "pnpm --filter @workspace\/db run push &&".*test:billing -> test\/billing-flow\.test\.mjs/s,
  );
});