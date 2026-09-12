import { drizzle } from "drizzle-orm/sqlite-proxy";
import { execute, select } from "@/lib/ipc/database";
import * as schema from "./schema";

/**
 * Drizzle over the plugin's SQL, via the `sqlite-proxy` driver (ADR 0004).
 *
 * The proxy wants positional row arrays, while the plugin returns objects keyed
 * by column name in SELECT order, so rows are converted here. Drizzle always
 * lists columns explicitly, which is what makes that conversion safe.
 */
export const db = drizzle(
  async (sql, params, method) => {
    if (method === "run") {
      await execute(sql, params as (string | number | null)[]);
      return { rows: [] };
    }

    const rows = await select(sql, params as (string | number | null)[]);
    return { rows: rows.map((row) => Object.values(row)) };
  },
  { schema },
);

export { schema };
