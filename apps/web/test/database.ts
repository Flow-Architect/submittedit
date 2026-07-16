import postgres from "postgres";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/submittedit_test";

const parsedDatabaseUrl = new URL(databaseUrl);
if (!parsedDatabaseUrl.pathname.toLowerCase().includes("test")) {
  throw new Error("Web integration tests require a database whose name contains 'test'.");
}

export const testDatabaseUrl = databaseUrl;
export const testDatabase = postgres(databaseUrl, {
  max: 2,
  onnotice: () => undefined,
  prepare: false,
});
