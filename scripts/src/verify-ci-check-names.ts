import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type BranchProtectionConfig = {
  branch: string;
  required_status_checks: string[];
};

function parseYamlScalar(value: string): string {
  let quote: "'" | '"' | undefined;
  let commentStart = value.length;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = undefined;
      }
      continue;
    }

    if (quote === '"') {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (
      character === "#" &&
      (index === 0 || /\s/.test(value[index - 1]))
    ) {
      commentStart = index;
      break;
    }
  }

  const withoutComment = value.slice(0, commentStart).trim();

  if (
    withoutComment.length >= 2 &&
    withoutComment.startsWith("'") &&
    withoutComment.endsWith("'")
  ) {
    return withoutComment.slice(1, -1).replace(/''/g, "'");
  }

  if (
    withoutComment.length >= 2 &&
    withoutComment.startsWith('"') &&
    withoutComment.endsWith('"')
  ) {
    return JSON.parse(withoutComment) as string;
  }

  return withoutComment;
}

export function getWorkflowJobNames(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));

  if (jobsLine === -1) {
    throw new Error(
      "Could not find the top-level jobs section in the CI workflow.",
    );
  }

  const names: string[] = [];
  let currentJobId: string | undefined;
  let currentJobName: string | undefined;

  const finishJob = () => {
    if (currentJobId) {
      names.push(currentJobName ?? currentJobId);
    }
    currentJobId = undefined;
    currentJobName = undefined;
  };

  for (const line of lines.slice(jobsLine + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") {
      break;
    }

    const jobHeader = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(?:#.*)?$/.exec(line);
    if (jobHeader) {
      finishJob();
      currentJobId = jobHeader[1];
      continue;
    }

    if (currentJobId) {
      const jobName = /^ {4}name:\s*(.*?)\s*$/.exec(line);
      if (jobName) {
        currentJobName = parseYamlScalar(jobName[1]);
      }
    }
  }

  finishJob();

  if (names.length === 0) {
    throw new Error("Could not find any jobs in the CI workflow.");
  }

  return names;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function findCheckNameMismatches(
  workflowJobNames: string[],
  requiredCheckNames: string[],
): { workflowOnly: string[]; protectionOnly: string[] } {
  const workflowNames = new Set(sortedUnique(workflowJobNames));
  const protectionNames = new Set(sortedUnique(requiredCheckNames));

  return {
    workflowOnly: [...workflowNames].filter(
      (name) => !protectionNames.has(name),
    ),
    protectionOnly: [...protectionNames].filter(
      (name) => !workflowNames.has(name),
    ),
  };
}

async function main() {
  const workspaceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const [workflowArgument, protectionArgument] = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  const workflowPath = resolve(
    workspaceRoot,
    workflowArgument ?? ".github/workflows/ci.yml",
  );
  const protectionPath = resolve(
    workspaceRoot,
    protectionArgument ?? ".github/branch-protection-required-checks.json",
  );

  const [workflow, protectionFile] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(protectionPath, "utf8"),
  ]);
  const protection = JSON.parse(protectionFile) as BranchProtectionConfig;

  if (
    !protection.branch ||
    !Array.isArray(protection.required_status_checks) ||
    protection.required_status_checks.some((name) => typeof name !== "string")
  ) {
    throw new Error(
      `Invalid branch protection config in ${protectionPath}. ` +
        'Expected "branch" and a string array named "required_status_checks".',
    );
  }

  const workflowJobNames = getWorkflowJobNames(workflow);
  const mismatches = findCheckNameMismatches(
    workflowJobNames,
    protection.required_status_checks,
  );

  if (mismatches.workflowOnly.length || mismatches.protectionOnly.length) {
    const details = [
      mismatches.workflowOnly.length
        ? `Jobs in .github/workflows/ci.yml but not required on ${protection.branch}: ${mismatches.workflowOnly.join(", ")}`
        : "",
      mismatches.protectionOnly.length
        ? `Checks required on ${protection.branch} but missing from .github/workflows/ci.yml: ${mismatches.protectionOnly.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    throw new Error(
      `CI job names do not match the protected-branch checks.\n${details}\n` +
        "Update the job name and GitHub branch protection together, then update " +
        ".github/branch-protection-required-checks.json to match the protected branch.",
    );
  }

  console.log(
    `CI job names match the ${protection.branch} branch protection checks: ${sortedUnique(workflowJobNames).join(", ")}`,
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
