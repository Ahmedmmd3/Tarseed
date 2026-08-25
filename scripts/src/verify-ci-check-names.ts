import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
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

function findMapValue(
  map: unknown,
  key: string,
  document: Document,
  visited = new Set<object>(),
): unknown {
  if (!isMap(map)) {
    return undefined;
  }
  if (visited.has(map)) {
    throw unsupportedYamlConstruct(
      `Merge key resolution for "${key}" is recursive.`,
    );
  }
  visited.add(map);

  try {
    for (const item of map.items) {
      const itemKey = resolveYamlAliases(item.key, document);
      if (isScalar(itemKey) && itemKey.value === key) {
        return item.value;
      }
    }

    for (const item of map.items) {
      const itemKey = resolveYamlAliases(item.key, document);
      if (!isScalar(itemKey) || itemKey.value !== "<<") {
        continue;
      }

      const mergeValue = resolveYamlAliases(item.value, document);
      const mergeValues = isMap(mergeValue)
        ? [mergeValue]
        : isSeq(mergeValue)
          ? mergeValue.items
          : undefined;
      if (mergeValues === undefined) {
        throw unsupportedYamlConstruct(
          `Merge key for "${key}" must reference a mapping or a sequence of mappings.`,
        );
      }

      for (const merged of mergeValues) {
        const resolvedMerged = resolveYamlAliases(merged, document);
        if (!isMap(resolvedMerged)) {
          throw unsupportedYamlConstruct(
            `Merge key for "${key}" must reference a mapping or a sequence of mappings.`,
          );
        }
        const value = findMapValue(resolvedMerged, key, document, visited);
        if (value !== undefined) {
          return value;
        }
      }
    }
  } finally {
    visited.delete(map);
  }

  return undefined;
}

type MapEntry = { key: string; value: unknown };

function getMapEntries(
  map: unknown,
  document: Document,
  visited = new Set<object>(),
): MapEntry[] {
  if (!isMap(map)) {
    return [];
  }
  if (visited.has(map)) {
    throw unsupportedYamlConstruct("Mapping merge resolution is recursive.");
  }
  visited.add(map);

  try {
    const entries: MapEntry[] = [];
    const seenKeys = new Set<string>();
    const mergeValues: unknown[] = [];
    for (const item of map.items) {
      const itemKey = resolveYamlAliases(item.key, document);
      if (!isScalar(itemKey) || typeof itemKey.value !== "string") {
        throw unsupportedMatrix("Matrix mapping keys must be scalar string values.");
      }
      if (itemKey.value === "<<") {
        mergeValues.push(item.value);
        continue;
      }
      seenKeys.add(itemKey.value);
      entries.push({ key: itemKey.value, value: item.value });
    }

    for (const mergeValue of mergeValues) {
      const resolvedMergeValue = resolveYamlAliases(mergeValue, document);
      const mergeMaps = isMap(resolvedMergeValue)
        ? [resolvedMergeValue]
        : isSeq(resolvedMergeValue)
          ? resolvedMergeValue.items.map((item) =>
              resolveYamlAliases(item, document),
            )
          : undefined;
      if (mergeMaps === undefined || mergeMaps.some((item) => !isMap(item))) {
        throw unsupportedYamlConstruct(
          "Merge keys must reference a mapping or a sequence of mappings.",
        );
      }

      for (const mergeMap of mergeMaps) {
        for (const entry of getMapEntries(mergeMap, document, visited)) {
          if (seenKeys.has(entry.key)) {
            continue;
          }
          seenKeys.add(entry.key);
          entries.push(entry);
        }
      }
    }

    return entries;
  } finally {
    visited.delete(map);
  }
}

function unsupportedMatrix(details: string): Error {
  return new Error(
    "Could not determine the expanded check names for a matrix job. " + details,
  );
}

function yamlNodeToValue(value: unknown, document: Document): unknown {
  const resolved = resolveYamlAliases(value, document);
  if (isScalar(resolved)) {
    return resolved.value;
  }
  if (isSeq(resolved)) {
    return resolved.items.map((item) => yamlNodeToValue(item, document));
  }
  if (isMap(resolved)) {
    const result: Record<string, unknown> = {};
    for (const entry of getMapEntries(resolved, document)) {
      result[entry.key] = yamlNodeToValue(entry.value, document);
    }
    return result;
  }
  throw unsupportedMatrix("Matrix values must be scalar or collection values.");
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        valuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

type MatrixCombination = Record<string, unknown>;

function combinationMatches(
  combination: MatrixCombination,
  values: MatrixCombination,
): boolean {
  return Object.keys(values).every(
    (key) =>
      Object.prototype.hasOwnProperty.call(combination, key) &&
      valuesEqual(combination[key], values[key]),
  );
}

function combinationCanInclude(
  combination: MatrixCombination,
  values: MatrixCombination,
): boolean {
  return Object.keys(values).every(
    (key) =>
      !Object.prototype.hasOwnProperty.call(combination, key) ||
      valuesEqual(combination[key], values[key]),
  );
}

function expandMatrix(
  strategy: unknown,
  document: Document,
): { combinations: MatrixCombination[]; keys: string[] } | undefined {
  const resolvedStrategy = resolveYamlAliases(strategy, document);
  if (!isMap(resolvedStrategy)) {
    return undefined;
  }

  const matrix = findMapValue(resolvedStrategy, "matrix", document);
  if (matrix === undefined) {
    return undefined;
  }
  const resolvedMatrix = resolveYamlAliases(matrix, document);
  if (!isMap(resolvedMatrix)) {
    throw unsupportedMatrix(
      "The matrix definition must be a mapping with explicit values.",
    );
  }

  const axes: Array<{ key: string; values: unknown[] }> = [];
  let include: MatrixCombination[] = [];
  let exclude: MatrixCombination[] = [];
  for (const entry of getMapEntries(resolvedMatrix, document)) {
    const value = resolveYamlAliases(entry.value, document);
    if (entry.key === "include" || entry.key === "exclude") {
      if (!isSeq(value)) {
        throw unsupportedMatrix(
          `Matrix "${entry.key}" must be a sequence of mappings.`,
        );
      }
      const entries = value.items.map((entry) => yamlNodeToValue(entry, document));
      if (
        entries.some(
          (entry) =>
            typeof entry !== "object" ||
            entry === null ||
            Array.isArray(entry),
        )
      ) {
        throw unsupportedMatrix(
          `Matrix "${entry.key}" must contain only mappings.`,
        );
      }
      if (entry.key === "include") {
        include = entries as MatrixCombination[];
      } else {
        exclude = entries as MatrixCombination[];
      }
      continue;
    }

    if (!isSeq(value)) {
      throw unsupportedMatrix(
        `Matrix axis "${entry.key}" must contain an explicit sequence of values.`,
      );
    }
    if (value.items.length === 0) {
      throw unsupportedMatrix(`Matrix axis "${entry.key}" cannot be empty.`);
    }
    axes.push({
      key: entry.key,
      values: value.items.map((entry) => yamlNodeToValue(entry, document)),
    });
  }

  let combinations: MatrixCombination[] = [{}];
  for (const axis of axes) {
    const expanded: MatrixCombination[] = [];
    for (const combination of combinations) {
      for (const value of axis.values) {
        expanded.push({ ...combination, [axis.key]: value });
      }
    }
    combinations = expanded;
  }

  const baseCombinations = combinations.map((combination) => ({ ...combination }));
  for (const entry of include) {
    let merged = false;
    for (let index = 0; index < baseCombinations.length; index += 1) {
      if (!combinationCanInclude(baseCombinations[index], entry)) {
        continue;
      }
      merged = true;
      combinations[index] = { ...combinations[index], ...entry };
    }
    if (!merged) {
      combinations.push({ ...entry });
    }
  }

  combinations = combinations.filter(
    (combination) =>
      !exclude.some((entry) => combinationMatches(combination, entry)),
  );
  if (combinations.length === 0) {
    throw unsupportedMatrix("The matrix produces no job combinations.");
  }

  const keys = [
    ...axes.map(({ key }) => key),
    ...include.flatMap((entry) => Object.keys(entry)),
  ].filter((key, index, all) => all.indexOf(key) === index);
  return { combinations, keys };
}

function matrixValueAtPath(
  combination: MatrixCombination,
  path: string,
): unknown | undefined {
  if (!path.startsWith("matrix.")) {
    return undefined;
  }

  let remainder = path.slice("matrix.".length);
  const parts: string[] = [];
  const firstPart = remainder.match(/^[A-Za-z_][A-Za-z0-9_-]*/);
  if (!firstPart) {
    return undefined;
  }
  parts.push(firstPart[0]);
  remainder = remainder.slice(firstPart[0].length);

  while (remainder) {
    if (remainder.startsWith(".")) {
      const part = remainder
        .slice(1)
        .match(/^[A-Za-z_][A-Za-z0-9_-]*/);
      if (!part) {
        return undefined;
      }
      parts.push(part[0]);
      remainder = remainder.slice(part[0].length + 1);
      continue;
    }

    const bracketPart = remainder.match(/^\[['"]([^'"]+)['"]\]/);
    if (!bracketPart) {
      return undefined;
    }
    parts.push(bracketPart[1]);
    remainder = remainder.slice(bracketPart[0].length);
  }

  let value: unknown = combination[parts.shift() ?? ""];
  for (const part of parts) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function formatMatrixValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderMatrixJobName(
  name: string,
  combination: MatrixCombination,
  jobKey: string,
): string {
  return name.replace(/\$\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression) => {
    const value = matrixValueAtPath(combination, expression.trim());
    if (value === undefined) {
      throw unsupportedMatrix(
        `Job "${jobKey}" uses an unsupported or unavailable matrix expression "${expression.trim()}".`,
      );
    }
    return formatMatrixValue(value);
  });
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
    const jobKeyValue = jobKey.value;

    const strategy = findMapValue(jobDefinition, "strategy", document);
    const matrix = strategy === undefined ? undefined : expandMatrix(strategy, document);

    const jobName = findMapValue(jobDefinition, "name", document);
    if (matrix === undefined) {
      if (jobName === undefined) {
        return jobKey.value;
      }
      const resolvedJobName = resolveYamlAliases(jobName, document);
      if (!isScalar(resolvedJobName)) {
        throw new Error(unsupportedNestedJobDefinitionMessage);
      }
      return String(resolvedJobName.value ?? "");
    }

    if (jobName !== undefined) {
      const resolvedJobName = resolveYamlAliases(jobName, document);
      if (!isScalar(resolvedJobName)) {
        throw new Error(unsupportedNestedJobDefinitionMessage);
      }
      const name = String(resolvedJobName.value ?? "");
      return matrix.combinations.map((combination) =>
        renderMatrixJobName(name, combination, jobKeyValue),
      );
    }

    return matrix.combinations.map(
      (combination) =>
        `${jobKeyValue} (${matrix.keys
          .map((key) => formatMatrixValue(combination[key]))
          .join(", ")})`,
    );
  }).flat();
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

export function findMissingRequiredCheckNames(
  workflowJobNames: string[],
  requiredCheckNames: string[],
): string[] {
  const workflowNames = new Set(workflowJobNames);
  return sortedUnique(requiredCheckNames).filter((name) => !workflowNames.has(name));
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
  const missingRequiredChecks = findMissingRequiredCheckNames(
    workflowJobNames,
    protection.required_status_checks,
  );

  if (missingRequiredChecks.length) {
    throw new Error(
      `Required CI checks are missing from the workflow.\n` +
        `Checks required on ${protection.branch} but missing from .github/workflows/ci.yml: ${missingRequiredChecks.join(", ")}\n` +
        "Update the job name and GitHub branch protection together, then update " +
        ".github/branch-protection-required-checks.json to match the protected branch.",
    );
  }

  console.log(
    `Required CI checks exist for the ${protection.branch} branch: ${sortedUnique(protection.required_status_checks).join(", ")}. ` +
      `Additional workflow jobs are advisory unless listed in branch protection.`,
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
