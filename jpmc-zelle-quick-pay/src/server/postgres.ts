import type { Pool } from "pg";
import { emptyState } from "./memory";
import type { PaymentStore, StoreState } from "./contracts";
const tables = [
  "sessions",
  "preferences",
  "recipients",
  "events",
  "allocations",
  "outbox",
  "exceptions",
  "audit",
] as const;
/** Reference implementation: one advisory lock per deployment namespace.
 * Atomic and deliberately conservative; partition stores before high-volume use.
 */
export class PostgresStore implements PaymentStore {
  constructor(
    private pool: Pool,
    private namespace = "default",
  ) {}
  async transaction<T>(fn: (state: StoreState) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["jpmc-zelle:" + this.namespace],
      );
      const state = emptyState();
      for (const table of tables) {
        const rows = await client.query(
          `SELECT id,payload FROM zelle_quick_pay.${table} WHERE namespace=$1`,
          [this.namespace],
        );
        for (const row of rows.rows)
          (state[table] as Record<string, unknown>)[row.id] = row.payload;
      }
      const before = structuredClone(state);
      const result = await fn(state);
      for (const table of tables) {
        for (const [id, payload] of Object.entries(state[table])) {
          if (
            JSON.stringify(payload) !==
            JSON.stringify((before[table] as Record<string, unknown>)[id])
          )
            await client.query(
              `INSERT INTO zelle_quick_pay.${table}(namespace,id,payload) VALUES($1,$2,$3) ON CONFLICT(namespace,id) DO UPDATE SET payload=EXCLUDED.payload`,
              [this.namespace, id, payload],
            );
        }
        for (const id of Object.keys(before[table]))
          if (!(id in state[table]))
            await client.query(
              `DELETE FROM zelle_quick_pay.${table} WHERE namespace=$1 AND id=$2`,
              [this.namespace, id],
            );
      }
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
