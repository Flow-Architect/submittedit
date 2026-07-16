import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { testDatabase } from "./database";

const migrationUrl = new URL("../db/migrations/0001_demo_filing.sql", import.meta.url);

beforeAll(async () => {
  const migrationSql = await readFile(fileURLToPath(migrationUrl), "utf8");
  await testDatabase`DROP TABLE IF EXISTS demo_authority_signatures CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS demo_submission_status_history CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS demo_submissions CASCADE`;
  await testDatabase`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await testDatabase`DROP FUNCTION IF EXISTS prevent_demo_submission_outcome_rewrite CASCADE`;
  await testDatabase`
    CREATE TABLE schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await testDatabase.unsafe(migrationSql);
  await testDatabase`
    INSERT INTO schema_migrations (version)
    VALUES ('0001_demo_filing')
  `;
});

beforeEach(async () => {
  await testDatabase`
    TRUNCATE TABLE
      demo_authority_signatures,
      demo_submission_status_history,
      demo_submissions
    RESTART IDENTITY CASCADE
  `;
});

afterAll(async () => {
  await testDatabase.end();
});
