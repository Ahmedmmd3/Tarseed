import { eq } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  platformAdminSessionsTable,
  pool,
} from "@workspace/db";
import { hashPassword } from "../lib/team-auth";

const username = process.env.SUPER_ADMIN_USERNAME?.trim().toLowerCase() ?? "";
const password = process.env.SUPER_ADMIN_PASSWORD ?? "";
const displayName = process.env.SUPER_ADMIN_DISPLAY_NAME?.trim() || "مدير منصة ترصيد";

if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
  throw new Error("SUPER_ADMIN_USERNAME must be 3-64 lowercase letters, numbers, dots, underscores, or hyphens.");
}
if (password.length < 12) {
  throw new Error("SUPER_ADMIN_PASSWORD must contain at least 12 characters.");
}

try {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: platformAdminsTable.id })
      .from(platformAdminsTable)
      .where(eq(platformAdminsTable.username, username))
      .limit(1);
    if (existing) {
      await tx.update(platformAdminsTable).set({
        passwordHash,
        displayName,
        status: "active",
        updatedAt: new Date(),
      }).where(eq(platformAdminsTable.id, existing.id));
      await tx.update(platformAdminSessionsTable).set({ revokedAt: new Date() })
        .where(eq(platformAdminSessionsTable.adminId, existing.id));
    } else {
      await tx.insert(platformAdminsTable).values({ username, displayName, passwordHash });
    }
  });
  process.stdout.write("Super admin account is ready and existing sessions were revoked.\n");
} finally {
  await pool.end();
}