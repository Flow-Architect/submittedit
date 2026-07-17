import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run SubmittedIt web migrations.");
}

const migrationsUrl = new URL("../db/migrations/", import.meta.url);
const migrationsPath = fileURLToPath(migrationsUrl);
const migrationFiles = (await readdir(migrationsPath))
  .filter((entry) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(entry))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No SubmittedIt web migrations were found.");
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

try {
  for (const migrationFile of migrationFiles) {
    const migrationVersion = migrationFile.replace(/\.sql$/u, "");
    const migrationSql = await readFile(new URL(migrationFile, migrationsUrl), "utf8");
    let applied = false;
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
        applied = true;
      }
    });
    console.log(`Database migration ${migrationVersion} is ${applied ? "applied" : "current"}.`);
  }
} finally {
  await sql.end();
}
