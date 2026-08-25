import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { fetchBranchProtection } from "./verify-branch-protection";

async function startGitHubApi(
  statusCode: number,
  body: unknown,
): Promise<{
  apiRoot: string;
  requestHeaders: Promise<Record<string, string | string[] | undefined>>;
  close: () => Promise<void>;
}> {
  let resolveRequestHeaders:
    | ((headers: Record<string, string | string[] | undefined>) => void)
    | undefined;
  const requestHeaders = new Promise<
    Record<string, string | string[] | undefined>
  >((resolve) => {
    resolveRequestHeaders = resolve;
  });

  const server = createServer((request, response) => {
    resolveRequestHeaders?.(request.headers);
    response.writeHead(statusCode, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the test GitHub API address.");
  }

  return {
    apiRoot: `http://127.0.0.1:${address.port}`,
    requestHeaders,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test("reads branch protection using the configured token", async () => {
  const api = await startGitHubApi(200, {
    required_status_checks: { contexts: ["Frontend typecheck"] },
  });
  try {
    const protection = await fetchBranchProtection(
      "example/repository",
      "main",
      "test-token",
      api.apiRoot,
    );
    const headers = await api.requestHeaders;
    assert.equal(headers.authorization, "Bearer test-token");
    assert.equal(headers.accept, "application/vnd.github+json");
    assert.deepEqual(protection, {
      required_status_checks: { contexts: ["Frontend typecheck"] },
    });
  } finally {
    await api.close();
  }
});

test("explains how to fix insufficient branch-protection permission", async () => {
  const api = await startGitHubApi(403, {
    message: "Resource not accessible by integration",
  });
  try {
    await assert.rejects(
      fetchBranchProtection(
        "example/repository",
        "main",
        "test-token",
        api.apiRoot,
      ),
      /HTTP 403.*GitHub App installation token with Administration: read/s,
    );
  } finally {
    await api.close();
  }
});