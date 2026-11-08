import { useSearchParams } from "react-router-dom";

export function useTab(allowed: string[], fallback: string) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? fallback;
  const tab = allowed.includes(raw) ? raw : fallback;
  const setTab = (next: string) => {
    const updated = new URLSearchParams(params);
    updated.set("tab", next);
    setParams(updated, { replace: true });
  };
  return [tab, setTab] as const;
}
