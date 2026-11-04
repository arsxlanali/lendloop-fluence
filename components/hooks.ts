"use client";
import { useCallback, useEffect, useState } from "react";
import { ConvexError } from "convex/values";

const pad = (n: number) => String(n).padStart(2, "0");

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The user's own calendar day. Sent with queries and mutations so dates follow their time
// zone; it rolls over at local midnight so availability updates without a reload.
export function useToday() {
  const [today, setToday] = useState(localDay);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => setToday(localDay()), midnight.getTime() - now.getTime() + 1000);
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

export function errorMessage(error: unknown) {
  // Convex hides unexpected server errors in production; only ConvexError text is meant for users.
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Something went wrong. Please try again.";
}

// Runs one action at a time per key, so one slow button doesn't freeze the others, and keeps
// the last error to show next to the thing that failed.
export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const run = useCallback(async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy((current) => (current === key ? null : current));
    }
  }, []);
  return { busy, error, run, clearError: () => setError("") };
}
