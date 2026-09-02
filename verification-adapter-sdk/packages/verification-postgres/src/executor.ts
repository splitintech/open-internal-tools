export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/**
 * Injected SQL executor compatible with `pg` Pool/Client and serverless clients.
 */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlQueryResult<T>>;
}

export interface PostgresStoreOptions {
  hashSecret: string;
  now?: () => Date;
}

export class RecordingExecutor implements SqlExecutor {
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];
  responses: Array<{ match: string; rows: Record<string, unknown>[] }> = [];

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlQueryResult<T>> {
    this.statements.push({ sql, params: [...params] });
    const hit = [...this.responses].reverse().find((item) => sql.includes(item.match));
    const rows = (hit?.rows ?? []) as T[];
    return { rows, rowCount: rows.length };
  }
}
