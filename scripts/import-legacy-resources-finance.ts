import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import {
  auditLogs,
  expenditures,
  feeStructures,
  grades,
  learners,
  payments,
  resourcesFinanceState,
  schoolSettings,
  storeItems,
  storeMovements,
} from "../drizzle/schema";
import { validateResourcesFinanceState } from "../server/resources-finance";
import { buildLegacyResourcesFinanceState } from "../server/resources-finance-legacy";

const connectionString = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the legacy Finance import");

const apply = process.argv.includes("--apply");
const pool = createPool(connectionString);
const db = drizzle(pool);

async function main() {
  try {
    const result = await db.transaction(async tx => {
      const existing = await tx.select({ id: resourcesFinanceState.id })
        .from(resourcesFinanceState)
        .where(eq(resourcesFinanceState.id, 1))
        .limit(1)
        .for("update");
      if (existing.length) return { status: "existing-state", written: false, counts: null };

      const settings = await tx.select().from(schoolSettings).limit(1);
      const gradeRows = await tx.select().from(grades);
      const learnerRows = await tx.select().from(learners);
      const feeRows = await tx.select().from(feeStructures);
      const paymentRows = await tx.select().from(payments);
      const expenditureRows = await tx.select().from(expenditures);
      const itemRows = await tx.select().from(storeItems);
      const movementRows = await tx.select().from(storeMovements);
      const { state, summary } = buildLegacyResourcesFinanceState({
        school: settings[0] ?? null,
        grades: gradeRows,
        learners: learnerRows,
        feeStructures: feeRows,
        payments: paymentRows,
        expenditures: expenditureRows,
        storeItems: itemRows,
        storeMovements: movementRows,
      });
      const data = JSON.stringify(state);
      validateResourcesFinanceState(data);
      if (!apply) return { status: "dry-run-ready", written: false, counts: summary, bytes: Buffer.byteLength(data, "utf8") };

      await tx.insert(resourcesFinanceState).values({ id: 1, data, version: 1, updatedByUserId: null });
      await tx.insert(auditLogs).values({
        userId: null,
        action: "resources_finance.legacy_import",
        entityType: "resources_finance",
        entityId: "1",
        metadata: JSON.stringify({ migration: "legacy-finance-v1", ...summary, bytes: Buffer.byteLength(data, "utf8") }),
      });
      return { status: "imported", written: true, counts: summary, bytes: Buffer.byteLength(data, "utf8") };
    });

    if (result.status === "existing-state") {
      console.error("Refusing import: resources_finance_state id=1 already exists. No data was changed.");
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Unknown import error";
  console.error(`Legacy Finance import failed; the transaction was rolled back: ${message}`);
  process.exitCode = 1;
});
