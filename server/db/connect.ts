import { Pool } from 'pg';

// Single pool for the process. Connection details come from the environment so the
// same code points at the compose container locally and a managed instance in prod.
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://estate:estate@localhost:5433/estate',
  max: 8,
});

export async function query<T extends object>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/** True when the schema has been applied and holds data. */
export async function isReady(): Promise<boolean> {
  try {
    const [row] = await query<{ n: string }>('select count(*)::text as n from repository');
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
