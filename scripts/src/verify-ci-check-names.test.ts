import assert from "node:assert/strict";
import test from "node:test";

import {
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
  test:
    name: Test
    runs-on: ubuntu-latest
`;

  assert.deepEqual(getWorkflowJobNames(workflow), ["Lint", "Test"]);
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
    new Error("Could not find any jobs in the CI workflow."),
  );
});
