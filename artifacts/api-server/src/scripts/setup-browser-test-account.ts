import { eq } from "drizzle-orm";
import {
  authSessionsTable,
  db,
  organizationsTable,
  pool,
  teamUsersTable,
} from "@workspace/db";
import { seedDemoData } from "../lib/seed-demo-data";
import { hashPassword, isEmail, verifyPassword } from "../lib/team-auth";

const email = process.env.PROD_TEST_EMAIL?.trim().toLowerCase() ?? "";
const password = process.env.PROD_TEST_PASSWORD ?? "";
const organizationName = "مساحة اختبار المتصفح";
const permissions = {
  dashboard: true,
  sales: true,
  accounting: true,
  inventory: true,
  hr: true,
  operations: true,
  reports: true,
};

if (!isEmail(email)) {
  throw new Error("PROD_TEST_EMAIL must be a valid email address.");
}
if (!password) {
  throw new Error("PROD_TEST_PASSWORD must not be empty.");
}

const now = new Date();
const subscriptionEndsAt = new Date(now);
subscriptionEndsAt.setFullYear(subscriptionEndsAt.getFullYear() + 1);

try {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(teamUsersTable)
      .where(eq(teamUsersTable.email, email))
      .for("update")
      .limit(1);

    if (existing) {
      const [organization] = await tx.select().from(organizationsTable)
        .where(eq(organizationsTable.id, existing.organizationId))
        .for("update")
        .limit(1);
      if (!organization) throw new Error("The browser test account organization is missing.");

      const passwordMatches = await verifyPassword(password, existing.passwordHash);
      await tx.update(organizationsTable).set({
        name: organizationName,
        planId: "pro",
        subscriptionStatus: "active",
        subscriptionStartedAt: organization.subscriptionStartedAt ?? now,
        subscriptionEndsAt,
        trialEndsAt: subscriptionEndsAt,
        platformAccessSuspendedAt: null,
        isTestWorkspace: true,
      }).where(eq(organizationsTable.id, organization.id));
      await tx.update(teamUsersTable).set({
        ...(passwordMatches ? {} : { passwordHash: await hashPassword(password) }),
        emailVerifiedAt: existing.emailVerifiedAt ?? now,
        phoneVerifiedAt: existing.phone ? existing.phoneVerifiedAt ?? now : null,
        name: "مالك اختبار المتصفح",
        roleId: "owner",
        permissions,
        locationScope: "all",
        warehouseIds: [],
        status: "active",
        updatedAt: now,
      }).where(eq(teamUsersTable.id, existing.id));
      if (!passwordMatches) {
        await tx.update(authSessionsTable).set({ revokedAt: now })
          .where(eq(authSessionsTable.userId, existing.id));
      }
      await seedDemoData(organization.id, organization.dataGeneration, tx);
      return;
    }

    const [organization] = await tx.insert(organizationsTable).values({
      name: organizationName,
      dataGeneration: 1,
      planId: "pro",
      subscriptionStatus: "active",
      trialStartedAt: now,
      trialEndsAt: subscriptionEndsAt,
      subscriptionStartedAt: now,
      subscriptionEndsAt,
      isTestWorkspace: true,
    }).returning();
    await tx.insert(teamUsersTable).values({
      organizationId: organization.id,
      email,
      phone: null,
      emailVerifiedAt: now,
      phoneVerifiedAt: null,
      name: "مالك اختبار المتصفح",
      passwordHash: await hashPassword(password),
      roleId: "owner",
      permissions,
      locationScope: "all",
      warehouseIds: [],
      status: "active",
    });
    await seedDemoData(organization.id, organization.dataGeneration, tx);
  });
  process.stdout.write("Browser test account is ready.\n");
} finally {
  await pool.end();
}