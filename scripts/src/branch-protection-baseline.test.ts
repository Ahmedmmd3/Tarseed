import assert from "node:assert/strict";
import test from "node:test";

import {
  findProtectionMismatches,
  normalizeLiveProtection,
  normalizeLiveRulesets,
  parseProtectionBaseline,
} from "./branch-protection-baseline";

const baseline = parseProtectionBaseline({
  version: 1,
  branch: "main",
  required_status_checks: ["CI"],
  rulesets: [],
  protection: {
    required_status_checks: {
      strict: true,
      checks: [{ context: "CI", app_id: 15368 }],
    },
    required_pull_request_reviews: null,
    enforce_admins: true,
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    required_signatures: false,
    required_deployments: [],
    required_merge_queue: null,
    lock_branch: false,
    allow_fork_syncing: false,
  },
});

function liveProtection(overrides: Record<string, unknown> = {}) {
  return normalizeLiveProtection({
    required_status_checks: {
      strict: true,
      checks: [{ context: "CI", app_id: 15368 }],
    },
    required_pull_request_reviews: null,
    enforce_admins: { enabled: true },
    restrictions: null,
    required_linear_history: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    block_creations: { enabled: false },
    required_conversation_resolution: { enabled: true },
    required_signatures: { enabled: false },
    required_deployments: { required_deployment_environments: [] },
    required_merge_queue: null,
    lock_branch: { enabled: false },
    allow_fork_syncing: { enabled: false },
    ...overrides,
  });
}

test("detects a status-check strictness change", () => {
  assert.deepEqual(
    findProtectionMismatches(
      baseline.protection,
      liveProtection({
        required_status_checks: {
          strict: false,
          checks: [{ context: "CI", app_id: 15368 }],
        },
      }),
    ),
    ["required_status_checks"],
  );
});

test("detects a required check supplied by another GitHub App", () => {
  assert.deepEqual(
    findProtectionMismatches(
      baseline.protection,
      liveProtection({
        required_status_checks: {
          strict: true,
          checks: [{ context: "CI", app_id: 1 }],
        },
      }),
    ),
    ["required_status_checks"],
  );
});

test("detects signed-commit and deployment gate changes", () => {
  assert.deepEqual(
    findProtectionMismatches(
      baseline.protection,
      liveProtection({
        required_signatures: { enabled: true },
        required_deployments: {
          required_deployment_environments: ["production"],
        },
      }),
    ),
    ["required_signatures", "required_deployments"],
  );
});

test("detects merge queue enablement and configuration changes", () => {
  assert.deepEqual(
    findProtectionMismatches(
      baseline.protection,
      liveProtection({
        required_merge_queue: {
          enabled: true,
          grouping_strategy: "ALLGREEN",
        },
      }),
    ),
    ["required_merge_queue"],
  );
});

test("normalizes applied rulesets so they can be compared to the baseline", () => {
  assert.notDeepEqual(
    baseline.rulesets,
    normalizeLiveRulesets({
      rules: [{ type: "required_pull_request_reviews", parameters: {} }],
    }),
  );
});