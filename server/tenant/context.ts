import { AsyncLocalStorage } from "node:async_hooks";

export type TenantContext = {
  workspaceId: string;
  slug: string;
  /** Absolute directory for this tenant's SQLite + files. */
  dataDir: string;
  /** Absolute path to tenant SQLite. */
  dbPath: string;
  /** True when serving the pre-multi-tenant single database. */
  legacy: boolean;
};

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export async function runWithTenantAsync<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** Bind tenant for the remainder of the current request's async chain (http handler). */
export function bindTenant(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

export function getTenantContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

export function requireTenantContext(): TenantContext {
  const ctx = getTenantContext();
  if (!ctx) throw new Error("Tenant context is missing for this request.");
  return ctx;
}
