import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { testDatabase } from "./database";

const migrationUrls = [
  new URL("../db/migrations/0001_demo_filing.sql", import.meta.url),
  new URL("../db/migrations/0002_relay_foundation.sql", import.meta.url),
];

beforeAll(async () => {
  const migrations = await Promise.all(
    migrationUrls.map(async (url) => ({
      sql: await readFile(fileURLToPath(url), "utf8"),
      version:
        url.pathname
          .split("/")
          .at(-1)
          ?.replace(/\.sql$/u, "") ?? "unknown",
    })),
  );
  await testDatabase`DROP TABLE IF EXISTS relay_operation_history CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS relay_signer_nonces CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS relay_daily_budgets CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS relay_rate_limit_counters CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS relay_operations CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS relay_encrypted_blobs CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS demo_authority_signatures CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS demo_submission_status_history CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS demo_submissions CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await testDatabase`DROP FUNCTION IF EXISTS prevent_demo_submission_outcome_rewrite CASCADE`;
  await testDatabase`DROP FUNCTION IF EXISTS enforce_relay_operation_update CASCADE`;
  await testDatabase`DROP FUNCTION IF EXISTS record_relay_operation_history CASCADE`;
  await testDatabase`
    CREATE TABLE schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  for (const migration of migrations) {
    await testDatabase.unsafe(migration.sql);
    await testDatabase`
      INSERT INTO schema_migrations (version)
      VALUES (${migration.version})
    `;
  }
});

beforeEach(async () => {
  await testDatabase`
    TRUNCATE TABLE
      demo_authority_signatures,
      demo_submission_status_history,
      demo_submissions,
      relay_operation_history,
      relay_operations,
      relay_encrypted_blobs,
      relay_rate_limit_counters,
      relay_daily_budgets,
      relay_signer_nonces
    RESTART IDENTITY CASCADE
  `;
});

afterAll(async () => {
  await testDatabase.end();
});
