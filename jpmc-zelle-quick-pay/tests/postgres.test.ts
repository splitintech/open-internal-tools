import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, it, expect } from "vitest";
import { PostgresStore } from "../src/server";
import { createSyntheticFixture } from "../src/testing";
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Postgres transaction integration",
  () => {
    it("persists sessions, deduplicates receipts, and resumes outbox after restart", async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
      });
      const namespace = "test-" + crypto.randomUUID();
      try {
        await pool.query(
          await readFile(
            new URL("../migrations/001_initial.sql", import.meta.url),
            "utf8",
          ),
        );
        await pool.query(await readFile(new URL("../migrations/002_active_sessions.sql", import.meta.url),"utf8"));
        const f = createSyntheticFixture(new PostgresStore(pool, namespace));
        const sessions = await Promise.all([
          f.engine.create(f.actor, f.context.obligationId, "bank_app"),
          f.engine.create(f.actor, f.context.obligationId, "bank_app"),
        ]);
        expect(sessions[0]!.id).toBe(sessions[1]!.id);
        const receipt = f.receipt(sessions[0]!);
        await f.ingest(receipt);
        const restarted = createSyntheticFixture(
          new PostgresStore(pool, namespace),
        );
        expect(await restarted.ingest(receipt)).toEqual(["duplicate"]);
        expect(
          (await restarted.engine.get(f.actor, sessions[0]!.id)).financial,
        ).toBe("received");
        await restarted.engine.deliverOutbox();
        expect(restarted.delivered.size).toBe(1);
        await expect(
          new PostgresStore(pool, namespace).transaction(async (state) => {
            state.sessions = {};
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(
          (await restarted.engine.get(f.actor, sessions[0]!.id)).financial,
        ).toBe("received");
      } finally {
        for (const table of [
          "sessions",
          "preferences",
          "recipients",
          "events",
          "allocations",
          "outbox",
          "exceptions",
          "audit",
        ])
          await pool.query(
            `DELETE FROM zelle_quick_pay.${table} WHERE namespace=$1`,
            [namespace],
          );
        await pool.end();
      }
    });
  },
);
