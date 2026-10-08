import type { SqlClient } from "@/lib/server/db";

/**
 * A plain local Postgres behind the SqlClient seam, for development only.
 * .env.local points DATABASE_URL at production Neon, so anything that
 * writes (an end to end run of the OAuth flow, say) must be able to aim
 * somewhere else: set LOCAL_DATABASE_URL (postgres://…@localhost/…) and
 * `pnpm dev` uses it instead. Ignored when NODE_ENV is production (see
 * db.ts), and `pg` is a devDependency loaded only here, at first query, so
 * it never reaches a production bundle.
 */
export function localPostgres(connectionString: string): SqlClient {
  type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void };
  type Pool = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; connect: () => Promise<Client> };
  let pool: Promise<Pool> | null = null;
  const getPool = () =>
    (pool ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "pg").then(
      (module) => new (module.default ?? module).Pool({ connectionString, max: 4 }) as unknown as Pool,
    ));
  return {
    query: async (text, params) => (await (await getPool()).query(text, params)).rows,
    transaction: async (statements) => {
      const client = await (await getPool()).connect();
      try {
        await client.query("begin");
        const out: unknown[][] = [];
        for (const statement of statements) out.push((await client.query(statement.text, statement.params)).rows);
        await client.query("commit");
        return out;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
