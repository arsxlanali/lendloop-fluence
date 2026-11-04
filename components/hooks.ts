"use client";
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ConvexError } from "convex/values";

const pad = (n: number) => String(n).padStart(2, "0");

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The user's own calendar day, shared app-wide: one timer rolls it over at local midnight
// (instead of one per card), and every query that takes it re-runs then.
const TodayContext = createContext<string | null>(null);

export function TodayProvider({ children }: { children: React.ReactNode }) {
  const [today, setToday] = useState(localDay);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => setToday(localDay()), midnight.getTime() - now.getTime() + 1000);
    return () => clearTimeout(timer);
  }, [today]);
  return createElement(TodayContext.Provider, { value: today }, children);
}

export function useToday() {
  return useContext(TodayContext) ?? localDay();
}

// Short confirmations after an action, read out by screen readers (polite live region).
type Toast = { id: number; text: string };
const ToastContext = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((text: string) => {
    const id = ++next.current;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return createElement(
    ToastContext.Provider,
    { value: show },
    children,
    createElement(
      "div",
      { className: "toasts", role: "status", "aria-live": "polite" },
      toasts.map((t) => createElement("p", { key: t.id, className: "toast" }, t.text)),
    ),
  );
}

export const useToast = () => useContext(ToastContext);

export function errorMessage(error: unknown) {
  // Convex hides unexpected server errors in production; only ConvexError text is meant for users.
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Something went wrong. Please try again.";
}

// Runs one action at a time per component and keeps the last error to show next to it.
// On success it can announce a short confirmation.
export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const toast = useToast();
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>, done?: string) => {
      setBusy(key);
      setError("");
      try {
        await action();
        if (done) toast(done);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy((current) => (current === key ? null : current));
      }
    },
    [toast],
  );
  return { busy, error, run, clearError: () => setError("") };
}

// Waits until typing pauses before passing a value on (search as you type).
export function useDebounced<T>(value: T, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
