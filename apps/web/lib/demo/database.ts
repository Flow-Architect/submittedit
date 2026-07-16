import postgres from "postgres";

export type DemoDatabase = ReturnType<typeof postgres>;

let database: DemoDatabase | undefined;

export const getDemoDatabase = (): DemoDatabase => {
  if (database) {
    return database;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the SubmittedIt demo filing portal.");
  }

  database = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: process.env.NODE_ENV === "production" ? 5 : 2,
    onnotice: () => undefined,
    prepare: false,
  });
  return database;
};

export const closeDemoDatabase = async (): Promise<void> => {
  if (database) {
    await database.end();
    database = undefined;
  }
};
