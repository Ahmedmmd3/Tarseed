import { sql } from "drizzle-orm";
import { db, platformAdminsTable } from "@workspace/db";
import { hashPassword } from "./team-auth";

const PLATFORM_ADMIN_BOOTSTRAP_LOCK = 7_714_219;

export async function ensureInitialPlatformAdmin(): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLATFORM_ADMIN_BOOTSTRAP_LOCK})`);

    const [existing] = await tx
      .select({ id: platformAdminsTable.id })
      .from(platformAdminsTable)
      .limit(1);

    if (existing) return false;

    const username = process.env.SUPER_ADMIN_USERNAME?.trim().toLowerCase() ?? "";
    const password = process.env.SUPER_ADMIN_PASSWORD ?? "";
    const displayName = process.env.SUPER_ADMIN_DISPLAY_NAME?.trim() || "مدير منصة ترصيد";

    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      throw new Error("SUPER_ADMIN_USERNAME is required to create the initial platform administrator.");
    }
    if (password.length < 12) {
      throw new Error("SUPER_ADMIN_PASSWORD must contain at least 12 characters to create the initial platform administrator.");
    }

    await tx.insert(platformAdminsTable).values({
      username,
      displayName,
      passwordHash: await hashPassword(password),
      status: "active",
    });

    return true;
  });
}