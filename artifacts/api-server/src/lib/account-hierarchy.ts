export type AccountHierarchyRow = {
  id: number;
  data: Record<string, unknown>;
};

export type AccountHierarchyIssue =
  | {
    kind: "type_mismatch";
    accountId: number;
    accountCode: string;
    accountName: string;
    accountType: unknown;
    parentId: number;
    parentCode: string;
    parentName: string;
    parentType: unknown;
  }
  | {
    kind: "inactive_parent";
    accountId: number;
    accountCode: string;
    accountName: string;
    accountType: unknown;
    parentId: number;
  }
  | {
    kind: "missing_parent";
    accountId: number;
    accountCode: string;
    accountName: string;
    accountType: unknown;
    parentId: number;
  }
  | {
    kind: "invalid_parent";
    accountId: number;
    accountCode: string;
    accountName: string;
    accountType: unknown;
  }
  | {
    kind: "cycle";
    accountId: number;
    accountCode: string;
    accountName: string;
    accountType: unknown;
    cycleAccountIds: number[];
    cycleAccounts: Array<{ accountId: number; accountCode: string; accountName: string }>;
  };

const ACCOUNT_HIERARCHY_ISSUE_KIND_ORDER: Record<AccountHierarchyIssue["kind"], number> = {
  invalid_parent: 0,
  missing_parent: 1,
  inactive_parent: 2,
  type_mismatch: 3,
  cycle: 4,
};

export function parseAccountParentId(parent: unknown): number | null | undefined {
  if (parent == null || parent === "") return null;
  if (typeof parent === "number") {
    return Number.isSafeInteger(parent) && parent > 0 ? parent : undefined;
  }
  if (typeof parent !== "string" || !/^[1-9]\d*$/.test(parent)) return undefined;
  const parentId = Number(parent);
  return Number.isSafeInteger(parentId) ? parentId : undefined;
}

export function findAccountHierarchyIssues(rows: AccountHierarchyRow[]): AccountHierarchyIssue[] {
  const accounts = new Map(rows.map((row) => [row.id, row.data]));
  const issues: AccountHierarchyIssue[] = [];
  for (const row of rows) {
    const parentId = parseAccountParentId(row.data.parent);
    const details = {
      accountId: row.id,
      accountCode: String(row.data.code ?? ""),
      accountName: String(row.data.name ?? ""),
      accountType: row.data.type,
    };
    if (parentId === null) continue;
    if (parentId === undefined) {
      issues.push({ kind: "invalid_parent", ...details });
      continue;
    }
    const parent = accounts.get(parentId);
    if (!parent) {
      issues.push({ kind: "missing_parent", ...details, parentId });
      continue;
    }
    if (parent.status !== "active" && row.data.status === "active") {
      issues.push({ kind: "inactive_parent", ...details, parentId });
    }
    if (parent.type !== row.data.type) {
      issues.push({
        kind: "type_mismatch",
        ...details,
        parentId,
        parentCode: String(parent.code ?? ""),
        parentName: String(parent.name ?? ""),
        parentType: parent.type,
      });
    }
  }

  const reportedCycles = new Set<string>();
  const resolvedAccounts = new Set<number>();
  for (const row of rows) {
    if (resolvedAccounts.has(row.id)) continue;
    const path: number[] = [];
    const pathIndex = new Map<number, number>();
    let cursor: number | null = row.id;
    while (cursor !== null && accounts.has(cursor)) {
      if (resolvedAccounts.has(cursor)) break;
      const existingIndex = pathIndex.get(cursor);
      if (existingIndex !== undefined) {
        const cycleAccountIds = path.slice(existingIndex);
        const cycleKey = [...cycleAccountIds].sort((left, right) => left - right).join(":");
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          const representativeId = Math.min(...cycleAccountIds);
          const representative = accounts.get(representativeId) ?? {};
          issues.push({
            kind: "cycle",
            accountId: representativeId,
            accountCode: String(representative.code ?? ""),
            accountName: String(representative.name ?? ""),
            accountType: representative.type,
            cycleAccountIds,
            cycleAccounts: cycleAccountIds.map((accountId) => {
              const account = accounts.get(accountId) ?? {};
              return {
                accountId,
                accountCode: String(account.code ?? ""),
                accountName: String(account.name ?? ""),
              };
            }),
          });
        }
        break;
      }
      pathIndex.set(cursor, path.length);
      path.push(cursor);
      const parentId = parseAccountParentId(accounts.get(cursor)?.parent);
      cursor = parentId === undefined ? null : parentId;
    }
    for (const accountId of path) resolvedAccounts.add(accountId);
  }
  return issues.sort((left, right) => (
    left.accountId - right.accountId
    || ACCOUNT_HIERARCHY_ISSUE_KIND_ORDER[left.kind] - ACCOUNT_HIERARCHY_ISSUE_KIND_ORDER[right.kind]
  ));
}