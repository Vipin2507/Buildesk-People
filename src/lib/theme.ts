import { useEffect, useState } from "react";

export const THEME_KEY = "buildesk-people-theme";

export type ThemeChoice = "light" | "dark" | "system";

export function readThemeChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
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

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* Theme still applies for this session if storage is blocked. */
  }
  applyTheme(choice);
}

export function applyStoredTheme(): void {
  applyTheme(readThemeChoice());
}

export function useThemeChoice() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readThemeChoice()));
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
  const update = (next: ThemeChoice) => {
    storeThemeChoice(next);
    setChoice(next);
  };
  return { choice, resolved, update };
}
