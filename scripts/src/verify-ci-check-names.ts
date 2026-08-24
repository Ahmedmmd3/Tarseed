import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAlias,
  isMap,
  isScalar,
  parseDocument,
  type Alias,
  type Document,
} from "yaml";

type BranchProtectionConfig = {
  branch: string;
  required_status_checks: string[];
};

const malformedJobDefinitionMessage =
  "Could not parse a job definition in the CI workflow.";
const malformedNestedJobDefinitionMessage =
  "Could not parse nested content in a CI job definition.";
const unsupportedNestedJobDefinitionMessage =
  "Unsupported nested structure in a CI job definition. Job names must be scalar values.";
const unsupportedYamlConstructMessage =
  "Unsupported YAML construct in the CI workflow. Use mappings, sequences, " +
  "scalar values, anchors, aliases, flow collections, or block scalars.";

function unsupportedYamlConstruct(details: string): Error {
  return new Error(`${unsupportedYamlConstructMessage} ${details}`);
}

function resolveYamlAliases(
  value: unknown,
  document: Document,
  aliases = new Set<Alias>(),
): unknown {
  if (!isAlias(value)) {
    return value;
  }

  if (aliases.has(value)) {
    throw unsupportedYamlConstruct(
      `Alias "*${value.source}" resolves recursively.`,
    );
  }
  aliases.add(value);

  const resolved = value.resolve(document);
  if (resolved === undefined) {
    throw unsupportedYamlConstruct(
      `Alias "*${value.source}" does not reference a defined anchor.`,
    );
  }

  return resolveYamlAliases(resolved, document, aliases);
}

function hasMalformedSiblingJobDefinition(workflow: string): boolean {
  const lines = workflow.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));

  if (jobsLine === -1) {
    return false;
  }

  for (const line of lines.slice(jobsLine + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") {
      break;
    }
    if (line.trim() === "" || /^ {2}#/.test(line)) {
      continue;
    }
    if (
      /^ {2}\S/.test(line) &&
      !/^ {2}[A-Za-z_][A-Za-z0-9_-]*:\s*(?:#.*)?$/.test(line)
    ) {
      return true;
    }
  }

  return false;
}

export function getWorkflowJobNames(workflow: string): string[] {
  const document = parseDocument(workflow, {
    prettyErrors: false,
    strict: true,
  });

  if (document.errors.length) {
    throw new Error(
      hasMalformedSiblingJobDefinition(workflow)
        ? malformedJobDefinitionMessage
        : malformedNestedJobDefinitionMessage,
    );
  }

  if (document.warnings.length) {
    throw unsupportedYamlConstruct(
      document.warnings.map((warning) => warning.message).join(" "),
    );
  }

  if (!isMap(document.contents)) {
    throw new Error(
      "Could not find the top-level jobs section in the CI workflow.",
    );
  }

  const jobs = resolveYamlAliases(
    document.contents.get("jobs", true),
    document,
  );
  if (jobs === undefined) {
    throw new Error(
      "Could not find the top-level jobs section in the CI workflow.",
    );
  }

  if (!isMap(jobs)) {
    if (isScalar(jobs) && jobs.value === null) {
      throw new Error("Could not find any jobs in the CI workflow.");
    }
    throw new Error(malformedJobDefinitionMessage);
  }

  if (jobs.items.length === 0) {
    throw new Error("Could not find any jobs in the CI workflow.");
  }

  return jobs.items.map((job) => {
    const jobKey = resolveYamlAliases(job.key, document);
    const jobDefinition = resolveYamlAliases(job.value, document);
    if (
      !isScalar(jobKey) ||
      typeof jobKey.value !== "string" ||
      !isMap(jobDefinition)
    ) {
      throw new Error(malformedJobDefinitionMessage);
    }

    const jobName = jobDefinition.items.find((setting) => {
      const settingKey = resolveYamlAliases(setting.key, document);
      return isScalar(settingKey) && settingKey.value === "name";
    })?.value;
    if (jobName === undefined) {
      return jobKey.value;
    }
    const resolvedJobName = resolveYamlAliases(jobName, document);
    if (!isScalar(resolvedJobName)) {
      throw new Error(unsupportedNestedJobDefinitionMessage);
    }

    return String(resolvedJobName.value ?? "");
  });
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
