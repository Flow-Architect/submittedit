import { describe, expect, it } from "vitest";
import { testDatabase } from "./database";

describe("fresh PostgreSQL migration", () => {
  it("creates every durable Goal 06 entity and records its version", async () => {
    const rows = await testDatabase`
      SELECT
        to_regclass('public.demo_submissions')::text AS submissions,
        to_regclass('public.demo_submission_status_history')::text AS history,
        to_regclass('public.demo_authority_signatures')::text AS signatures
    `;
    expect(rows[0]).toEqual({
      history: "demo_submission_status_history",
      signatures: "demo_authority_signatures",
      submissions: "demo_submissions",
    });

    const versions = await testDatabase`
      SELECT version
      FROM schema_migrations
      ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual(["0001_demo_filing"]);
  });

  it("keeps internal IDs separate from the public token digest", async () => {
    const columns = await testDatabase`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'demo_submissions'
      ORDER BY ordinal_position
    `;
    const names = columns.map((row) => row.column_name);
    expect(names).toContain("id");
    expect(names).toContain("public_token_hash");
    expect(names).not.toContain("public_token");
    expect(names).not.toContain("receipt_id");
    expect(names).not.toContain("attempted_event");
  });
});
