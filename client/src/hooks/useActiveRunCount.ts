import { useState, useEffect, useCallback } from "react";
import { listRuns } from "../api/runs";
import { useInterval } from "./useInterval";

/**
 * Hook that returns the count of active (pending/running) runs.
 * Polls every 10s to keep the nav badge updated.
 */
export function useActiveRunCount(): number {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const data = await listRuns();
      const active = data.runs.filter(
        (r) => r.status === "pending" || r.status === "running"
      );
      setCount(active.length);
    } catch {
      // Silently ignore — badge is cosmetic
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Poll every 10s (lightweight — just checking for active count)
  useInterval(fetchCount, 10000);

  return count;
}
