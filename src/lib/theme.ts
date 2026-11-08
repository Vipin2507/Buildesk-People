import { useEffect, useState } from "react";

const THEME_PREFIX = "buildesk-people-theme";

export type ThemeChoice = "light" | "dark" | "system";

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

export function storeThemeChoice(userId: string, choice: ThemeChoice): void {
  try {
    localStorage.setItem(themeStorageKey(userId), choice);
  } catch {
    /* Theme still applies for this session if storage is blocked. */
  }
  applyTheme(choice);
}

/** First paint and the signed-out screen stay light. A saved choice is applied after sign-in. */
export function applyStoredTheme(): void {
  applyTheme("light");
}

export function useThemeChoice(userId: string | null) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice(userId));
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readThemeChoice(userId)));

  useEffect(() => {
    const stored = readThemeChoice(userId);
    setChoice(stored);
  }, [userId]);

  useEffect(() => {
    applyTheme(choice);
    setResolved(resolveTheme(choice));
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

  const update = (next: ThemeChoice) => {
    if (userId) storeThemeChoice(userId, next);
    else applyTheme(next);
    setChoice(next);
  };

  return { choice, resolved, update };
}
