import { useEffect, useState } from "react";

/**
 * useNow re-renders the calling component on a fixed interval so relative time
 * displays ("2 minutes ago") stay fresh without a manual refresh.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
