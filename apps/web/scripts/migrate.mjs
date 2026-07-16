import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run SubmittedIt web migrations.");
}

const migrationVersion = "0001_demo_filing";
const migrationUrl = new URL("../db/migrations/0001_demo_filing.sql", import.meta.url);
const migrationSql = await readFile(fileURLToPath(migrationUrl), "utf8");
const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

try {
  await sql.begin(async (transaction) => {
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const existing = await transaction`
      SELECT version
      FROM schema_migrations
      WHERE version = ${migrationVersion}
    `;
    if (existing.length === 0) {
      await transaction.unsafe(migrationSql);
      await transaction`
        INSERT INTO schema_migrations (version)
        VALUES (${migrationVersion})
      `;
    }
  });
  console.log(`Database migration ${migrationVersion} is applied.`);
} finally {
  await sql.end();
}
