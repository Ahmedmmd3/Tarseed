import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const databaseSchemaPushCommand =
  "pnpm --filter @workspace/db run push";
const requiredSchemaInitializationPrefix = `${databaseSchemaPushCommand} &&`;
const testFilePattern = /(?:^|[\s"'=])((?:\.\/)?test\/[A-Za-z0-9._/-]+\.mjs)\b/g;
const databaseWritePattern =
  /\b(?:db|tx|database)\.(?:insert|update|delete|transaction)\s*\(/;
const httpWritePattern =
  /\b(?:fetch|request)\s*\([\s\S]*?\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/;

export type ApiTestSchemaCheckInput = {
  scripts: Record<string, string>;
  testSources: Map<string, string>;
};

export type ApiTestSchemaViolation = {
  scriptName: string;
  testPath: string;
  reason: "direct database write" | "HTTP write request";
};

function normalizeTestPath(testPath: string): string {
  return testPath.replace(/^\.\/+/, "");
}

export function extractApiTestPaths(command: string): string[] {
  const paths: string[] = [];
  for (const match of command.matchAll(testFilePattern)) {
    const path = normalizeTestPath(match[1]);
    if (path.split("/").at(-1)?.startsWith(".") === true) {
      continue;
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

export function detectsDatabaseWrite(testSource: string): boolean {
  return databaseWritePattern.test(testSource) || httpWritePattern.test(testSource);
}

export function initializesSchemaBeforeTests(command: string): boolean {
  return command.trimStart().startsWith(requiredSchemaInitializationPrefix);
}

function databaseWriteReason(
  testSource: string,
): ApiTestSchemaViolation["reason"] | undefined {
  if (databaseWritePattern.test(testSource)) {
    return "direct database write";
  }
  if (httpWritePattern.test(testSource)) {
    return "HTTP write request";
  }
  return undefined;
}

export function findApiTestSchemaViolations({
  scripts,
  testSources,
}: ApiTestSchemaCheckInput): ApiTestSchemaViolation[] {
  const violations: ApiTestSchemaViolation[] = [];

  for (const [scriptName, command] of Object.entries(scripts)) {
    if (!scriptName.startsWith("test:")) {
      continue;
    }

    const initializesSchema = initializesSchemaBeforeTests(command);
    for (const testPath of extractApiTestPaths(command)) {
      const testSource = testSources.get(testPath);
      if (testSource === undefined) {
        throw new Error(
          `The API test script "${scriptName}" references missing test file "${testPath}".`,
        );
      }

      const reason = databaseWriteReason(testSource);
      if (reason !== undefined && !initializesSchema) {
        violations.push({ scriptName, testPath, reason });
      }
    }
  }

  return violations;
}

export function formatApiTestSchemaViolations(
  violations: ApiTestSchemaViolation[],
): string {
  const details = violations
    .map(
      ({ scriptName, testPath, reason }) =>
        `- ${scriptName} -> ${testPath} (${reason})`,
    )
    .join("\n");

  return (
    "Database-writing API test scripts must initialize the @workspace/db schema " +
    `before any test command. Start each script with "${requiredSchemaInitializationPrefix}":\n${details}`
  );
}

async function loadCheckInput(workspaceRoot: string): Promise<ApiTestSchemaCheckInput> {
  const apiPackagePath = join(
    workspaceRoot,
    "artifacts",
    "api-server",
    "package.json",
  );
  const testDirectory = join(workspaceRoot, "artifacts", "api-server", "test");
  const [packageContents, testFileNames] = await Promise.all([
    readFile(apiPackagePath, "utf8"),
    readdir(testDirectory),
  ]);
  const packageJson = JSON.parse(packageContents) as {
    scripts?: Record<string, unknown>;
  };
  const scripts = Object.fromEntries(
    Object.entries(packageJson.scripts ?? {}).filter(
      ([, command]) => typeof command === "string",
    ),
  ) as Record<string, string>;
  const testFiles = testFileNames.filter(
    (fileName) => fileName.endsWith(".test.mjs") && !fileName.startsWith("."),
  );
  const testContents = await Promise.all(
    testFiles.map(async (fileName) => [
      `test/${fileName}`,
      await readFile(join(testDirectory, fileName), "utf8"),
    ] as const),
  );

  return { scripts, testSources: new Map(testContents) };
}

export async function checkApiTestSchemaInitialization(
  workspaceRoot: string,
): Promise<ApiTestSchemaViolation[]> {
  return findApiTestSchemaViolations(await loadCheckInput(workspaceRoot));
}

async function main() {
  const workspaceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const violations = await checkApiTestSchemaInitialization(workspaceRoot);
  if (violations.length > 0) {
    throw new Error(formatApiTestSchemaViolations(violations));
  }

  console.log(
    "All database-writing API test scripts initialize the @workspace/db schema.",
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