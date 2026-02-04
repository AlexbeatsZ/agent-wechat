import type { DatabaseInstance } from "../db/index.js";
import type { AppState, Context as IContext, Session } from "../ia/types.js";
import { createDefaultAppState } from "../ia/types.js";
import { sql } from "drizzle-orm";

/**
 * Context manages the persistent FSM state.
 *
 * It wraps AppState and provides load/save functionality
 * to persist state across executions.
 */
export class Context implements IContext {
  public state: AppState;

  constructor(
    public readonly sessionId: string,
    public readonly session: Session,
    public readonly db: DatabaseInstance
  ) {
    this.state = createDefaultAppState();
  }

  /**
   * Load context from database.
   * Called at the start of an execution.
   */
  async load(): Promise<void> {
    try {
      const rows = this.db.all<{ app_state: string }>(
        sql`SELECT app_state FROM context WHERE session_id = ${this.sessionId}`
      );

      if (rows.length > 0 && rows[0].app_state) {
        const parsed = JSON.parse(rows[0].app_state) as AppState;
        this.state = parsed;
      }
    } catch {
      // If load fails, use default state
      this.state = createDefaultAppState();
    }
  }

  /**
   * Save context to database.
   * Called after each step of an execution.
   */
  async save(): Promise<void> {
    try {
      const appStateJson = JSON.stringify(this.state);

      this.db.run(sql`
        INSERT INTO context (session_id, app_state, updated_at)
        VALUES (${this.sessionId}, ${appStateJson}, datetime('now'))
        ON CONFLICT(session_id) DO UPDATE SET
          app_state = excluded.app_state,
          updated_at = datetime('now')
      `);
    } catch {
      // Ignore save errors - best effort
    }
  }
}

/**
 * Create a Context for a session.
 *
 * If the session has persisted state, it will be loaded.
 * Otherwise, a default state is created.
 */
export async function createContext(
  session: Session,
  db: DatabaseInstance
): Promise<Context> {
  const context = new Context(session.id, session, db);
  await context.load();
  return context;
}
