type RecordValue = Record<string, unknown>;
type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };

export type CheckIdentity = { context: string; app_id: number };
export type ProtectionSettings = {
  required_status_checks: { strict: boolean; checks: CheckIdentity[] };
  required_pull_request_reviews: null;
  enforce_admins: boolean;
  restrictions: null;
  required_linear_history: boolean;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
  block_creations: boolean;
  required_conversation_resolution: boolean;
  required_signatures: boolean;
  required_deployments: string[];
  required_merge_queue: JsonValue;
  lock_branch: boolean;
  allow_fork_syncing: boolean;
};

export type ProtectionBaseline = {
  version: 1;
  branch: string;
  required_status_checks: string[];
  rulesets: JsonValue[];
  protection: ProtectionSettings;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedChecks(checks: CheckIdentity[]): CheckIdentity[] {
  return [...checks].sort(
    (left, right) =>
      left.context.localeCompare(right.context) || left.app_id - right.app_id,
  );
}

function parseChecks(value: unknown, source: string): CheckIdentity[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (check) =>
        !isRecord(check) ||
        typeof check.context !== "string" ||
        typeof check.app_id !== "number",
    )
  ) {
    throw new Error(`${source} must be an array of { context, app_id } values.`);
  }
  return sortedChecks(value as CheckIdentity[]);
}

export function parseProtectionBaseline(value: unknown): ProtectionBaseline {
  if (!isRecord(value) || value.version !== 1 || typeof value.branch !== "string") {
    throw new Error("Branch protection baseline must use version 1 and name a branch.");
  }
  if (
    !Array.isArray(value.required_status_checks) ||
    value.required_status_checks.some((name) => typeof name !== "string")
  ) {
    throw new Error("Branch protection baseline must list required status checks.");
  }
  if (!Array.isArray(value.rulesets) || value.rulesets.some((rule) => !isJsonValue(rule))) {
    throw new Error("Branch protection baseline must list JSON rulesets.");
  }
  if (!isRecord(value.protection)) {
    throw new Error("Branch protection baseline must define protection settings.");
  }

  const protection = value.protection;
  const statusChecks = protection.required_status_checks;
  if (
    !isRecord(statusChecks) ||
    typeof statusChecks.strict !== "boolean"
  ) {
    throw new Error("Protection baseline must define status-check strictness.");
  }
  const booleanSettings = [
    "enforce_admins",
    "required_linear_history",
    "allow_force_pushes",
    "allow_deletions",
    "block_creations",
    "required_conversation_resolution",
    "required_signatures",
    "lock_branch",
    "allow_fork_syncing",
  ] as const;
  if (
    protection.required_pull_request_reviews !== null ||
    protection.restrictions !== null ||
    !Array.isArray(protection.required_deployments) ||
    protection.required_deployments.some(
      (environment) => typeof environment !== "string",
    ) ||
    !isJsonValue(protection.required_merge_queue) ||
    booleanSettings.some((key) => typeof protection[key] !== "boolean")
  ) {
    throw new Error("Protection baseline contains unsupported protection settings.");
  }

  const checks = parseChecks(
    statusChecks.checks,
    "Protection baseline required_status_checks.checks",
  );
  const requiredNames = [...value.required_status_checks].sort();
  if (checks.map((check) => check.context).join("\n") !== requiredNames.join("\n")) {
    throw new Error(
      "Protection baseline check identities must match required_status_checks.",
    );
  }

  return {
    version: 1,
    branch: value.branch,
    required_status_checks: requiredNames,
    rulesets: sortJsonValues(
      value.rulesets.map((rule) =>
        normalizeJson(rule, "Protection baseline rulesets"),
      ),
    ),
    protection: {
      required_status_checks: { strict: statusChecks.strict, checks },
      required_pull_request_reviews: null,
      enforce_admins: protection.enforce_admins as boolean,
      restrictions: null,
      required_linear_history: protection.required_linear_history as boolean,
      allow_force_pushes: protection.allow_force_pushes as boolean,
      allow_deletions: protection.allow_deletions as boolean,
      block_creations: protection.block_creations as boolean,
      required_conversation_resolution:
        protection.required_conversation_resolution as boolean,
      required_signatures: protection.required_signatures as boolean,
      required_deployments: [...protection.required_deployments].sort() as string[],
      required_merge_queue: normalizeJson(
        protection.required_merge_queue,
        "Protection baseline required_merge_queue",
      ),
      lock_branch: protection.lock_branch as boolean,
      allow_fork_syncing: protection.allow_fork_syncing as boolean,
    },
  };
}

function enabled(value: unknown, name: string): boolean {
  if (typeof value === "boolean") return value;
  if (isRecord(value) && typeof value.enabled === "boolean") return value.enabled;
  throw new Error(`GitHub returned an invalid ${name} protection setting.`);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function normalizeJson(value: unknown, source: string): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error(`${source} must contain only JSON values.`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item, source));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "url")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeJson(item, source)]),
  );
}

function sortJsonValues(values: JsonValue[]): JsonValue[] {
  return [...values].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

export function normalizeLiveRulesets(value: unknown): JsonValue[] {
  if (!isRecord(value) || !Array.isArray(value.rules)) {
    throw new Error("GitHub returned an invalid branch rulesets response.");
  }
  return sortJsonValues(
    value.rules.map((rule) => normalizeJson(rule, "GitHub branch rulesets")),
  );
}

export function normalizeLiveProtection(value: unknown): ProtectionSettings {
  if (!isRecord(value) || !isRecord(value.required_status_checks)) {
    throw new Error("GitHub returned an invalid branch protection response.");
  }
  const statusChecks = value.required_status_checks;
  if (typeof statusChecks.strict !== "boolean") {
    throw new Error("GitHub returned invalid status-check strictness.");
  }
  const deployments = value.required_deployments;
  if (
    !isRecord(deployments) ||
    !Array.isArray(deployments.required_deployment_environments) ||
    deployments.required_deployment_environments.some(
      (environment) => typeof environment !== "string",
    )
  ) {
    throw new Error("GitHub returned invalid required deployment environments.");
  }
  return {
    required_status_checks: {
      strict: statusChecks.strict,
      checks: parseChecks(statusChecks.checks, "GitHub required status checks"),
    },
    required_pull_request_reviews: value.required_pull_request_reviews === null ? null : (() => { throw new Error("This baseline expects pull-request reviews to be disabled."); })(),
    enforce_admins: enabled(value.enforce_admins, "enforce_admins"),
    restrictions: value.restrictions === null ? null : (() => { throw new Error("This baseline expects branch restrictions to be disabled."); })(),
    required_linear_history: enabled(value.required_linear_history, "required_linear_history"),
    allow_force_pushes: enabled(value.allow_force_pushes, "allow_force_pushes"),
    allow_deletions: enabled(value.allow_deletions, "allow_deletions"),
    block_creations: enabled(value.block_creations, "block_creations"),
    required_conversation_resolution: enabled(value.required_conversation_resolution, "required_conversation_resolution"),
    required_signatures: enabled(value.required_signatures, "required_signatures"),
    required_deployments: [
      ...deployments.required_deployment_environments,
    ].sort() as string[],
    required_merge_queue: normalizeJson(
      value.required_merge_queue,
      "GitHub required_merge_queue",
    ),
    lock_branch: enabled(value.lock_branch, "lock_branch"),
    allow_fork_syncing: enabled(value.allow_fork_syncing, "allow_fork_syncing"),
  };
}

export function findProtectionMismatches(
  expected: ProtectionSettings,
  actual: ProtectionSettings,
): string[] {
  const mismatches: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof ProtectionSettings>) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      mismatches.push(key);
    }
  }
  return mismatches;
}