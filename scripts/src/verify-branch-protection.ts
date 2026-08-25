import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findMissingRequiredCheckNames,
  findCheckNameMismatches,
  formatMissingRequiredChecksError,
  getActualRequiredCheckNames,
  getWorkflowCheckNames,
} from "./verify-ci-check-names";
import {
  findProtectionMismatches,
  normalizeLiveProtection,
  normalizeLiveRulesets,
  parseProtectionBaseline,
} from "./branch-protection-baseline";

type CliOptions = {
  workflowPath: string;
  protectionPath: string;
  repository: string;
};

function getOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`The ${name} option requires a value.`);
  }
  return value;
}

function getOptions(workspaceRoot: string): CliOptions {
  const args = process.argv.slice(2);
  const repository =
    getOption(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error(
      "A GitHub repository is required. Run this in GitHub Actions or set " +
        "GITHUB_REPOSITORY to OWNER/REPOSITORY.",
    );
  }

  return {
    repository,
    workflowPath: resolve(
      workspaceRoot,
      getOption(args, "--workflow") ?? ".github/workflows/ci.yml",
    ),
    protectionPath: resolve(
      workspaceRoot,
      getOption(args, "--protection") ??
        ".github/branch-protection-required-checks.json",
    ),
  };
}

export async function fetchBranchProtection(
  repository: string,
  branch: string,
  token: string,
  apiRoot = process.env.GITHUB_API_URL ?? "https://api.github.com",
): Promise<unknown> {
  const normalizedApiRoot = apiRoot.replace(/\/+$/, "");
  const response = await fetch(
    `${normalizedApiRoot}/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    let message = "";
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string") {
        message = `: ${body.message}`;
      }
    } catch {
      // Keep the status-based error when GitHub does not return JSON.
    }

    const guidance =
      response.status === 404
        ? " The branch may not be protected, or the branch/repository may not exist."
        : response.status === 403
          ? " Use a GitHub App installation token with Administration: read access for this repository."
          : "";
    throw new Error(
      `Could not read branch protection from GitHub (HTTP ${response.status})${message}.${guidance}`,
    );
  }

  return response.json();
}

export async function fetchBranchRulesets(
  repository: string,
  branch: string,
  token: string,
  apiRoot = process.env.GITHUB_API_URL ?? "https://api.github.com",
): Promise<unknown> {
  const response = await fetch(
    `${apiRoot.replace(/\/+$/, "")}/repos/${repository}/rules/branches/${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Could not read branch rulesets from GitHub (HTTP ${response.status}).`,
    );
  }
  return response.json();
}

function formatLiveProtectionMismatchError(
  branch: string,
  configOnly: string[],
  githubOnly: string[],
): string {
  const lines = [
    `GitHub branch protection for ${branch} does not match .github/branch-protection-required-checks.json.`,
  ];
  if (configOnly.length > 0) {
    lines.push(
      `Required locally but missing from GitHub protection: ${configOnly.join(", ")}`,
    );
  }
  if (githubOnly.length > 0) {
    lines.push(
      `Required by GitHub protection but missing locally: ${githubOnly.join(", ")}`,
    );
  }
  lines.push(
    "Update the GitHub branch protection and the local configuration together.",
  );
  return lines.join("\n");
}

async function main() {
  const workspaceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const options = getOptions(workspaceRoot);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is required to read branch protection. In GitHub Actions, " +
        "use the temporary GitHub App token configured for this job; do not store " +
        "a token in the repository.",
    );
  }

  const [workflow, protectionFile] = await Promise.all([
    readFile(options.workflowPath, "utf8"),
    readFile(options.protectionPath, "utf8"),
  ]);
  const config = parseProtectionBaseline(JSON.parse(protectionFile) as unknown);
  const workflowCheckNames = getWorkflowCheckNames(workflow);

  if (workflowCheckNames.dynamicMatrixJobs.length > 0) {
    throw new Error(
      "Cannot verify branch protection because the workflow contains " +
        `runtime-generated matrix checks from job(s) ${workflowCheckNames.dynamicMatrixJobs.join(", ")}. ` +
        "Their names cannot be known before GitHub expands the matrix. " +
        "Keep them out of branch protection or add a stable non-matrix aggregate job.",
    );
  }

  const missingFromWorkflow = findMissingRequiredCheckNames(
    workflowCheckNames.names,
    config.required_status_checks,
  );
  if (missingFromWorkflow.length > 0) {
    throw new Error(
      formatMissingRequiredChecksError(
        config.branch,
        missingFromWorkflow,
        workflowCheckNames.dynamicMatrixJobs,
      ),
    );
  }

  const [protection, rulesets] = await Promise.all([
    fetchBranchProtection(options.repository, config.branch, token),
    fetchBranchRulesets(options.repository, config.branch, token),
  ]);
  const actualNames = getActualRequiredCheckNames(protection);
  const mismatches = findCheckNameMismatches(
    actualNames,
    config.required_status_checks,
  );
  if (
    mismatches.workflowOnly.length > 0 ||
    mismatches.protectionOnly.length > 0
  ) {
    throw new Error(
      formatLiveProtectionMismatchError(
        config.branch,
        mismatches.protectionOnly,
        mismatches.workflowOnly,
      ),
    );
  }

  const actualProtection = normalizeLiveProtection(protection);
  const protectionMismatches = findProtectionMismatches(
    config.protection,
    actualProtection,
  );
  if (protectionMismatches.length > 0) {
    throw new Error(
      `GitHub branch protection for ${config.branch} differs from the version ${config.version} baseline.\n` +
        `Changed protection setting(s): ${protectionMismatches.join(", ")}\n` +
        "Update GitHub branch protection and .github/branch-protection-required-checks.json together.",
    );
  }

  const liveRulesets = normalizeLiveRulesets(rulesets);
  if (JSON.stringify(config.rulesets) !== JSON.stringify(liveRulesets)) {
    throw new Error(
      `GitHub rulesets applied to ${config.branch} differ from the version ${config.version} baseline.\n` +
        "Update the GitHub rulesets and .github/branch-protection-required-checks.json together.",
    );
  }

  console.log(
    `GitHub branch protection for ${options.repository}:${config.branch} matches ` +
      `${config.required_status_checks.length} local required check(s).`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}