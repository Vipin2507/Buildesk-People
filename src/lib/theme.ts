import { useEffect, useRef, useState } from "react";

const THEME_PREFIX = "buildesk-people-theme";
const SWITCH_MS = 780;

export type ThemeChoice = "light" | "dark" | "system";
export type ThemeOrigin = { x: number; y: number };

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

export function themeStorageKey(userId: string): string {
  return `${THEME_PREFIX}:${userId}`;
}

export function readThemeChoice(userId: string | null): ThemeChoice {
  if (!userId) return "light";
  try {
    const raw = localStorage.getItem(themeStorageKey(userId));
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(choice: ThemeChoice): void {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setThemeOrigin(origin?: ThemeOrigin): void {
  const root = document.documentElement;
  if (origin) {
    root.style.setProperty("--theme-x", `${Math.round(origin.x)}px`);
    root.style.setProperty("--theme-y", `${Math.round(origin.y)}px`);
    return;
  }
  root.style.setProperty("--theme-x", `${Math.round(window.innerWidth - 72)}px`);
  root.style.setProperty("--theme-y", "34px");
}

/** Instant paint for boot / sign-out. Theme toggles use applyThemeAnimated. */
export function applyThemeAnimated(choice: ThemeChoice, origin?: ThemeOrigin): void {
  const run = () => applyTheme(choice);
  if (prefersReducedMotion()) {
    run();
    return;
  }

  setThemeOrigin(origin);
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition === "function") {
    const transition = doc.startViewTransition(run);
    void transition.finished.catch(() => undefined);
    return;
  }

  const root = document.documentElement;
  root.classList.add("theme-switching");
  run();
  window.setTimeout(() => root.classList.remove("theme-switching"), SWITCH_MS);
}

export function storeThemeChoice(userId: string, choice: ThemeChoice): void {
  try {
    localStorage.setItem(themeStorageKey(userId), choice);
  } catch {
    /* Theme still applies for this session if storage is blocked. */
  }
}

/** First paint and the signed-out screen stay light. A saved choice is applied after sign-in. */
export function applyStoredTheme(): void {
  applyTheme("light");
}

export function useThemeChoice(userId: string | null) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice(userId));
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readThemeChoice(userId)));
  const instant = useRef(true);
  const originRef = useRef<ThemeOrigin | undefined>(undefined);

  useEffect(() => {
    instant.current = true;
    setChoice(readThemeChoice(userId));
  }, [userId]);

  useEffect(() => {
    const nextResolved = resolveTheme(choice);
    setResolved(nextResolved);

    if (instant.current) {
      instant.current = false;
      applyTheme(choice);
    } else {
      const origin = originRef.current;
      originRef.current = undefined;
      applyThemeAnimated(choice, origin);
    }

    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      setResolved(resolveTheme("system"));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  useEffect(() => {
    return () => applyTheme("light");
  }, []);

  const update = (next: ThemeChoice, origin?: ThemeOrigin) => {
    if (userId) storeThemeChoice(userId, next);
    originRef.current = origin;
    setChoice(next);
  };

  return { choice, resolved, update };
}
