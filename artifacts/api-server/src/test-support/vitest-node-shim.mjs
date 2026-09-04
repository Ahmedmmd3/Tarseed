import {
  after,
  before,
  describe as nodeDescribe,
  it as nodeIt,
} from "node:test";
import { isDeepStrictEqual } from "node:util";

const ASYMMETRIC = Symbol("asymmetric");

function asymmetric(kind, value) {
  return { [ASYMMETRIC]: kind, value };
}

function matches(actual, expected, subset = false) {
  if (expected && typeof expected === "object" && expected[ASYMMETRIC]) {
    if (expected[ASYMMETRIC] === "stringContaining") {
      return typeof actual === "string" && actual.includes(expected.value);
    }
    if (expected[ASYMMETRIC] === "arrayContaining") {
      return Array.isArray(actual)
        && expected.value.every((item) => actual.some((candidate) => matches(candidate, item)));
    }
    if (expected[ASYMMETRIC] === "objectContaining") {
      return matches(actual, expected.value, true);
    }
  }

  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((item, index) => matches(actual[index], item));
  }

  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    const expectedKeys = Object.keys(expected);
    if (!subset && Object.keys(actual).length !== expectedKeys.length) return false;
    return expectedKeys.every((key) => Object.hasOwn(actual, key) && matches(actual[key], expected[key]));
  }

  return isDeepStrictEqual(actual, expected);
}

function fail(message) {
  throw new Error(message);
}

export function expect(actual) {
  const assertions = {
    toBe(expected) {
      if (!Object.is(actual, expected)) fail(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
    },
    toBeTruthy() {
      if (!actual) fail(`Expected ${JSON.stringify(actual)} to be truthy`);
    },
    toBeFalsy() {
      if (actual) fail(`Expected ${JSON.stringify(actual)} to be falsy`);
    },
    toBeGreaterThanOrEqual(expected) {
      if (!(actual >= expected)) fail(`Expected ${JSON.stringify(actual)} to be >= ${JSON.stringify(expected)}`);
    },
    toContain(expected) {
      if (!actual?.includes?.(expected)) fail(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    },
    toEqual(expected) {
      if (!matches(actual, expected)) fail(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
    },
    toHaveLength(expected) {
      if (actual?.length !== expected) fail(`Expected length ${expected}, received ${actual?.length}`);
    },
    toMatchObject(expected) {
      if (!matches(actual, expected, true)) fail(`Expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`);
    },
  };

  return {
    ...assertions,
    not: {
      toEqual(expected) {
        if (matches(actual, expected)) fail(`Expected ${JSON.stringify(actual)} not to equal ${JSON.stringify(expected)}`);
      },
    },
  };
}

expect.arrayContaining = (value) => asymmetric("arrayContaining", value);
expect.objectContaining = (value) => asymmetric("objectContaining", value);
expect.stringContaining = (value) => asymmetric("stringContaining", value);

function options(timeoutOrOptions) {
  return typeof timeoutOrOptions === "number" ? { timeout: timeoutOrOptions } : timeoutOrOptions;
}

export const describe = (name, fn, timeoutOrOptions) => nodeDescribe(name, options(timeoutOrOptions), fn);
describe.sequential = describe;
export const it = (name, fn, timeoutOrOptions) => nodeIt(name, options(timeoutOrOptions), fn);
export const beforeAll = (fn, timeoutOrOptions) => before(fn, options(timeoutOrOptions));
export const afterAll = (fn, timeoutOrOptions) => after(fn, options(timeoutOrOptions));