import { describe, expect, it } from "vitest";
import { testDatabase } from "./database";

describe("fresh PostgreSQL migration", () => {
  it("creates the durable demo and relay entities and records every version", async () => {
    const rows = await testDatabase`
      SELECT
        to_regclass('public.demo_submissions')::text AS submissions,
        to_regclass('public.demo_submission_status_history')::text AS history,
        to_regclass('public.demo_authority_signatures')::text AS signatures,
        to_regclass('public.relay_encrypted_blobs')::text AS relay_blobs,
        to_regclass('public.relay_operations')::text AS relay_operations,
        to_regclass('public.relay_operation_history')::text AS relay_history,
        to_regclass('public.relay_rate_limit_counters')::text AS relay_limits,
        to_regclass('public.relay_daily_budgets')::text AS relay_budgets,
        to_regclass('public.relay_signer_nonces')::text AS relay_nonces
    `;
    expect(rows[0]).toEqual({
      history: "demo_submission_status_history",
      relay_blobs: "relay_encrypted_blobs",
      relay_budgets: "relay_daily_budgets",
      relay_history: "relay_operation_history",
      relay_limits: "relay_rate_limit_counters",
      relay_nonces: "relay_signer_nonces",
      relay_operations: "relay_operations",
      signatures: "demo_authority_signatures",
      submissions: "demo_submissions",
    });

    const versions = await testDatabase`
      SELECT version
      FROM schema_migrations
      ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual([
      "0001_demo_filing",
      "0002_relay_foundation",
      "0003_relay_blob_idempotency",
    ]);
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

  it("keeps relay ciphertext separate from decryption, signer, and plaintext fields", async () => {
    const rows = await testDatabase`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE
        table_schema = 'public'
        AND table_name IN ('relay_encrypted_blobs', 'relay_operations')
      ORDER BY table_name, ordinal_position
    `;
    const names = rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(names).toContain("relay_encrypted_blobs.encrypted_envelope");
    expect(names).toContain("relay_operations.event_hash");
    for (const forbidden of [
      "decryption_key",
      "private_key",
      "raw_ip",
      "request_body",
      "signature",
      "event_core",
      "plaintext",
    ]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
