import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { platformRequest } from "../lib/platform-api";
import type { PlatformOperator } from "../types/platform";

type PublicOperator = Omit<PlatformOperator, "passwordHash">;

type PlatformContextValue = {
  ready: boolean;
  operator: PublicOperator | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  completeSetup: (email: string, password: string, confirm: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [operator, setOperator] = useState<PublicOperator | null>(null);

  const refresh = useCallback(async () => {
    const { status, payload } = await platformRequest("/api/platform/bootstrap");
    if (status === 401 || !payload.authenticated) {
      setOperator(null);
      setReady(true);
      return;
    }
    setOperator((payload.operator as PublicOperator) || null);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { status, payload } = await platformRequest("/api/platform/auth/signin", { email, password });
    if (status === 401 || !payload.ok) {
      return { ok: false, message: String(payload.message || "The email or password is incorrect.") };
    }
    setOperator((payload.operator as PublicOperator) || null);
    return { ok: true, message: "" };
  }, []);

  const completeSetup = useCallback(async (email: string, password: string, confirm: string) => {
    const { status, payload } = await platformRequest("/api/platform/operators/setup", { email, password, confirm });
    if (status >= 400 || !payload.ok) {
      return { ok: false, message: String(payload.message || "Could not complete setup.") };
    }
    setOperator((payload.operator as PublicOperator) || null);
    return { ok: true, message: "" };
  }, []);

  const signOut = useCallback(async () => {
    await platformRequest("/api/platform/auth/signout", {});
    setOperator(null);
  }, []);

  const value = useMemo(
    () => ({ ready, operator, refresh, signIn, completeSetup, signOut }),
    [ready, operator, refresh, signIn, completeSetup, signOut],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used inside PlatformProvider");
  return ctx;
}
