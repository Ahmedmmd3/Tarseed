import assert from "node:assert/strict";
import test from "node:test";

import {
  findMissingRequiredCheckNames,
  findCheckNameMismatches,
  getWorkflowJobNames,
} from "./verify-ci-check-names";

test("uses explicitly named jobs for required check names", () => {
  const workflow = `
name: CI

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - name: Check lint
        run: |
          pnpm lint
  test:
    name: Test
    runs-on: ubuntu-latest
`;

  assert.deepEqual(getWorkflowJobNames(workflow), ["Lint", "Test"]);
});

test("expands explicitly named matrix jobs using each matrix value", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
jobs:
  test:
    name: Test (Node \${{ matrix.node }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
`),
    ["Test (Node 20)", "Test (Node 22)"],
  );
});

test("falls back to job IDs when jobs have no display name", () => {
  const workflow = `
jobs:
  build:
    runs-on: ubuntu-latest
  deploy:
    runs-on: ubuntu-latest
`;

  assert.deepEqual(getWorkflowJobNames(workflow), ["build", "deploy"]);
});

test("expands fallback matrix job names across multiple axes", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
        target: [api, frontend]
`),
    [
      "test (20, api)",
      "test (20, frontend)",
      "test (22, api)",
      "test (22, frontend)",
    ],
  );
});

test("expands matrix jobs inherited through a job merge alias", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
base-job: &base_job
  runs-on: ubuntu-latest
  strategy:
    matrix:
      node: [20, 22]
jobs:
  test:
    <<: *base_job
`),
    ["test (20)", "test (22)"],
  );
});

test("expands matrix strategies inherited through a nested merge alias", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
base-strategy: &base_strategy
  matrix:
    node: [20, 22]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      <<: *base_strategy
`),
    ["test (20)", "test (22)"],
  );
});

test("expands matrix strategies inherited through flow-map merges", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
base: &base { matrix: { node: [20, 22] } }
jobs: { test: { runs-on: ubuntu-latest, strategy: { <<: *base } } }
`),
    ["test (20)", "test (22)"],
  );
});

test("uses declared matrix names inherited through job and matrix merges", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
matrix-axes: &matrix_axes
  node: [20, 22]
base-job: &base_job
  name: Base (Node \${{ matrix.node }})
  strategy:
    matrix:
      <<: *matrix_axes
jobs:
  inherited:
    <<: *base_job
  overridden:
    <<: *base_job
    name: Overridden (Node \${{ matrix.node }})
`),
    [
      "Base (Node 20)",
      "Base (Node 22)",
      "Overridden (Node 20)",
      "Overridden (Node 22)",
    ],
  );
});

test("applies matrix include and exclude entries before naming checks", () => {
  assert.deepEqual(
    getWorkflowJobNames(`
linux-node-24: &linux_node_24 { node: 24, os: linux }
windows-node-22: &windows_node_22 { node: 22, os: windows }
jobs:
  test:
    name: Test \${{ matrix.os }} \${{ matrix.node }}
    strategy:
      matrix:
        node: [20, 22]
        os: [linux, windows]
        exclude:
          - <<: *windows_node_22
        include:
          - <<: *linux_node_24
`),
    [
      "Test linux 20",
      "Test windows 20",
      "Test linux 22",
      "Test linux 24",
    ],
  );
});

test("parses single- and double-quoted job names", () => {
  const workflow = `
jobs:
  lint:
    name: 'Lint: Ruby''s rules'
    runs-on: ubuntu-latest
  test:
    name: "Test #1"
    runs-on: ubuntu-latest
`;

  assert.deepEqual(getWorkflowJobNames(workflow), [
    "Lint: Ruby's rules",
    "Test #1",
  ]);
});

test("supports anchors, aliases, quoted keys, flow collections, and scalar modifiers", () => {
  const workflow = `
shared-name: &shared_name "Lint"
shared-settings: &shared_settings
  runs-on: ubuntu-latest
"jobs":
  "lint":
    "name": *shared_name
    <<: *shared_settings
  test:
    <<: *shared_settings
    name: >-2
      Continuous
      Integration
`;

  assert.deepEqual(getWorkflowJobNames(workflow), [
    "Lint",
    "Continuous Integration",
  ]);
});

test("supports flow mappings for jobs and job definitions", () => {
  const workflow = `
jobs: {
  lint: { name: Lint, runs-on: ubuntu-latest },
  test: { runs-on: ubuntu-latest }
}
`;

  assert.deepEqual(getWorkflowJobNames(workflow), ["Lint", "test"]);
});

test("supports aliases for job definitions while preserving fallback job IDs", () => {
  const workflow = `
jobs:
  lint: &base_job
    runs-on: ubuntu-latest
  test: *base_job
`;

  assert.deepEqual(getWorkflowJobNames(workflow), ["lint", "test"]);
});

test("rejects unsupported YAML constructs with an actionable error", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name: !custom Lint
    runs-on: ubuntu-latest
`),
    /Unsupported YAML construct in the CI workflow.*Unresolved tag: !custom/,
  );
});

test("reports a renamed job as a workflow/protection mismatch", () => {
  const workflow = `
jobs:
  checks:
    name: Continuous Integration
    runs-on: ubuntu-latest
`;

  const mismatches = findCheckNameMismatches(getWorkflowJobNames(workflow), [
    "CI",
  ]);

  assert.deepEqual(mismatches, {
    workflowOnly: ["Continuous Integration"],
    protectionOnly: ["CI"],
  });
});

test("allows advisory workflow jobs outside protected-branch checks", () => {
  assert.deepEqual(
    findMissingRequiredCheckNames(
      ["API server clean typecheck", "Frontend typecheck", "Matrix typecheck (Node 24)"],
      ["API server clean typecheck", "Frontend typecheck"],
    ),
    [],
  );
});

test("reports protected checks missing from the workflow", () => {
  assert.deepEqual(
    findMissingRequiredCheckNames(
      ["Frontend typecheck"],
      ["API server clean typecheck", "Frontend typecheck"],
    ),
    ["API server clean typecheck"],
  );
});

test("rejects workflows without a top-level jobs section", () => {
  assert.throws(
    () => getWorkflowJobNames("name: CI\n"),
    new Error("Could not find the top-level jobs section in the CI workflow."),
  );
});

test("rejects an empty jobs section", () => {
  assert.throws(
    () => getWorkflowJobNames("jobs:\n  # jobs will be added later\n"),
    new Error("Could not find any jobs in the CI workflow."),
  );
});

test("rejects incomplete job definitions", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  build
`),
    new Error("Could not parse a job definition in the CI workflow."),
  );
});

test("rejects malformed job definitions alongside valid jobs", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
  build
`),
    new Error("Could not parse a job definition in the CI workflow."),
  );
});

test("rejects unsupported nested job names alongside valid settings", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name:
      value: Lint
    runs-on: ubuntu-latest
`),
    new Error(
      "Unsupported nested structure in a CI job definition. Job names must be scalar values.",
    ),
  );
});

test("rejects flow collections for job names", () => {
  for (const name of [
    "[Lint]",
    "{value: Lint}",
    "!!map {value: Lint}",
    "&collection [Lint]",
  ]) {
    assert.throws(
      () =>
        getWorkflowJobNames(`
jobs:
  lint:
    name: ${name}
    runs-on: ubuntu-latest
`),
      new Error(
        "Unsupported nested structure in a CI job definition. Job names must be scalar values.",
      ),
    );
  }
});

test("rejects malformed nested job content alongside valid settings", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name: Lint
    steps:
      - name: Check lint
        broken
`),
    new Error("Could not parse nested content in a CI job definition."),
  );
});

test("rejects malformed flow values in nested job settings", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name: Lint
    steps:
      - name: [unterminated
`),
    new Error("Could not parse nested content in a CI job definition."),
  );
});

test("rejects nested job settings with inconsistent indentation", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name: Lint
    steps:
      - name: Check lint
      run: pnpm lint
`),
    new Error("Could not parse nested content in a CI job definition."),
  );
});

test("rejects malformed step continuation indentation", () => {
  assert.throws(
    () =>
      getWorkflowJobNames(`
jobs:
  lint:
    name: Lint
    steps:
      - name: Check lint
       run: pnpm lint
`),
    new Error("Could not parse nested content in a CI job definition."),
  );
});
