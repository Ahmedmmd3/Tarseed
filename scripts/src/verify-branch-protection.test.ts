import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { fetchBranchProtection } from "./verify-branch-protection";

const workflowPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.github/workflows/verify-branch-protection.yml",
);

type WorkflowStep = {
  name?: string;
  id?: string;
  if?: string;
  "continue-on-error"?: boolean;
  uses?: string;
  with?: {
    script?: string;
  };
};

type WorkflowIssue = {
  number: number;
  title: string;
  body?: string;
  state: "open" | "closed";
  pull_request?: unknown;
};

type IssueCall = {
  issue_number?: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
};

type WorkflowGithub = {
  paginate: (...args: unknown[]) => Promise<WorkflowIssue[]>;
  rest: {
    issues: {
      listForRepo: (...args: unknown[]) => unknown;
      create: (call: IssueCall) => Promise<{ data: WorkflowIssue }>;
      update: (call: IssueCall) => Promise<{ data: WorkflowIssue }>;
    };
  };
};

type WorkflowContext = {
  serverUrl: string;
  repo: { owner: string; repo: string };
  runId: number;
};

async function getWorkflowScript(stepName: string): Promise<string> {
  const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
    jobs?: {
      verify?: {
        steps?: WorkflowStep[];
      };
    };
  };
  const step = workflow.jobs?.verify?.steps?.find(
    (candidate) => candidate.name === stepName,
  );
  const script = step?.with?.script;
  if (!script) {
    throw new Error(`Could not find github-script step "${stepName}".`);
  }
  return script;
}

async function runWorkflowScript(
  script: string,
  github: WorkflowGithub,
  context: WorkflowContext,
  errors: string[] = [],
): Promise<void> {
  const execute = new Function(
    "github",
    "context",
    "core",
    `"use strict"; return (async () => {\n${script}\n})();`,
  ) as (
    github: WorkflowGithub,
    context: WorkflowContext,
    core: {
      notice: (message: string) => void;
      error: (message: string) => void;
    },
  ) => Promise<void>;
  await execute(github, context, {
    notice: () => undefined,
    error: (message) => errors.push(message),
  });
}

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

test("updates and closes the alert issue, not a same-title pull request", async () => {
  const pullRequest: WorkflowIssue = {
    number: 99,
    title: "Branch protection drift detected for main",
    state: "open",
    pull_request: { url: "https://api.github.com/repos/example/repository/pulls/99" },
  };
  const issues: WorkflowIssue[] = [pullRequest];
  const createCalls: IssueCall[] = [];
  const updateCalls: IssueCall[] = [];
  let nextIssueNumber = 1;
  const github = {
    paginate: async () => issues.filter((issue) => issue.state === "open"),
    rest: {
      issues: {
        listForRepo: () => undefined,
        create: async (call: IssueCall) => {
          const issue: WorkflowIssue = {
            number: nextIssueNumber++,
            title: call.title ?? "",
            body: call.body,
            state: "open",
          };
          issues.push(issue);
          createCalls.push(call);
          return { data: issue };
        },
        update: async (call: IssueCall) => {
          const issue = issues.find(
            (candidate) => candidate.number === call.issue_number,
          );
          assert.ok(issue, `Expected issue #${call.issue_number} to exist.`);
          Object.assign(issue, {
            ...(call.body === undefined ? {} : { body: call.body }),
            ...(call.state === undefined ? {} : { state: call.state }),
          });
          updateCalls.push(call);
          return { data: issue };
        },
      },
    },
  };
  const context = {
    serverUrl: "https://github.com",
    repo: { owner: "example", repo: "repository" },
    runId: 123,
  };
  const alertScript = await getWorkflowScript(
    "Synchronize branch-protection drift alert",
  );
  const closeScript = await getWorkflowScript(
    "Close resolved branch-protection alert",
  );
  const originalFailure = process.env.BRANCH_PROTECTION_FAILURE;

  try {
    process.env.BRANCH_PROTECTION_FAILURE = [
      "GitHub branch protection for main does not match .github/branch-protection-required-checks.json.",
      "Required locally but missing from GitHub protection: Frontend typecheck",
      "Required by GitHub protection but missing locally: Legacy check",
    ].join("\n");

    await runWorkflowScript(alertScript, github, context);

    assert.equal(createCalls.length, 1);
    assert.equal(updateCalls.length, 0);
    assert.equal(issues.length, 2);
    assert.equal(issues[1]?.number, 1);
    assert.equal(issues[1]?.state, "open");
    assert.equal(pullRequest.state, "open");
    assert.match(
      createCalls[0]?.body ?? "",
      /Frontend typecheck[\s\S]*Legacy check/,
    );
    assert.match(
      createCalls[0]?.body ?? "",
      /Update the GitHub branch protection and `\.github\/branch-protection-required-checks\.json` together/,
    );

    process.env.BRANCH_PROTECTION_FAILURE = [
      "GitHub branch protection for main does not match .github/branch-protection-required-checks.json.",
      "Required locally but missing from GitHub protection: Frontend typecheck, Deploy",
      "Required by GitHub protection but missing locally: Legacy check",
    ].join("\n");

    await runWorkflowScript(alertScript, github, context);

    assert.equal(createCalls.length, 1);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.issue_number, 1);
    assert.equal(issues.length, 2);
    assert.match(updateCalls[0]?.body ?? "", /Frontend typecheck, Deploy/);
    assert.equal(issues[1]?.state, "open");
    assert.equal(pullRequest.state, "open");
    assert.equal(
      updateCalls.some((call) => call.issue_number === pullRequest.number),
      false,
    );

    await runWorkflowScript(closeScript, github, context);

    assert.equal(createCalls.length, 1);
    assert.equal(updateCalls.length, 2);
    assert.equal(updateCalls[1]?.issue_number, 1);
    assert.equal(updateCalls[1]?.state, "closed");
    assert.equal(issues[1]?.state, "closed");
    assert.equal(pullRequest.state, "open");
    assert.equal(
      updateCalls.some(
        (call) =>
          call.issue_number === pullRequest.number && call.state === "closed",
      ),
      false,
    );
  } finally {
    if (originalFailure === undefined) {
      delete process.env.BRANCH_PROTECTION_FAILURE;
    } else {
      process.env.BRANCH_PROTECTION_FAILURE = originalFailure;
    }
  }
});

test("reports alert synchronization failures from each GitHub API operation", async () => {
  const alertScript = await getWorkflowScript(
    "Synchronize branch-protection drift alert",
  );
  const closeScript = await getWorkflowScript(
    "Close resolved branch-protection alert",
  );
  const context = {
    serverUrl: "https://github.com",
    repo: { owner: "example", repo: "repository" },
    runId: 123,
  };
  const errors: string[] = [];

  await assert.rejects(
    runWorkflowScript(
      alertScript,
      {
        paginate: async () => {
          throw new Error("list unavailable");
        },
        rest: {
          issues: {
            listForRepo: () => undefined,
            create: async () => {
              throw new Error("create should not be called");
            },
            update: async () => {
              throw new Error("update should not be called");
            },
          },
        },
      },
      context,
      errors,
    ),
    /Branch-protection alert synchronization failed while reading open alert issues: list unavailable/,
  );
  assert.match(errors.at(-1) ?? "", /synchronization failed/);

  await assert.rejects(
    runWorkflowScript(
      alertScript,
      {
        paginate: async () => [],
        rest: {
          issues: {
            listForRepo: () => undefined,
            create: async () => {
              throw new Error("create unavailable");
            },
            update: async () => {
              throw new Error("update should not be called");
            },
          },
        },
      },
      context,
      errors,
    ),
    /Branch-protection alert synchronization failed while creating the alert issue: create unavailable/,
  );

  const existingIssue: WorkflowIssue = {
    number: 7,
    title: "Branch protection drift detected for main",
    state: "open",
  };
  const updateFailureGithub = {
    paginate: async () => [existingIssue],
    rest: {
      issues: {
        listForRepo: () => undefined,
        create: async () => {
          throw new Error("create should not be called");
        },
        update: async () => {
          throw new Error("update unavailable");
        },
      },
    },
  };
  await assert.rejects(
    runWorkflowScript(
      alertScript,
      updateFailureGithub,
      context,
      errors,
    ),
    /Branch-protection alert synchronization failed while updating existing alert issue #7: update unavailable/,
  );

  await assert.rejects(
    runWorkflowScript(
      closeScript,
      {
        paginate: async () => {
          throw new Error("close list unavailable");
        },
        rest: {
          issues: {
            listForRepo: () => undefined,
            create: async () => {
              throw new Error("create should not be called");
            },
            update: async () => {
              throw new Error("update should not be called");
            },
          },
        },
      },
      context,
      errors,
    ),
    /Branch-protection alert synchronization failed while reading open alert issues: close list unavailable/,
  );

  await assert.rejects(
    runWorkflowScript(
      closeScript,
      {
        paginate: async () => [existingIssue],
        rest: {
          issues: {
            listForRepo: () => undefined,
            create: async () => {
              throw new Error("create should not be called");
            },
            update: async () => {
              throw new Error("close update unavailable");
            },
          },
        },
      },
      context,
      errors,
    ),
    /Branch-protection alert synchronization failed while closing resolved alert issue #7: close update unavailable/,
  );
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
