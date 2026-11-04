"use client";
import { Component, useEffect, useId, useRef, useState } from "react";
import { useRunner } from "./hooks";
import type { Tone } from "./format";

// Modal dialog on the native <dialog>: the browser traps focus, closes on Escape and hides the
// page behind it from assistive technology. Focus goes to the first field (or the element marked
// data-autofocus) and returns to whatever opened the dialog.
export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[data-autofocus], input, textarea, select");
    first?.focus();
    return () => {
      dialog.close();
      opener?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // a click on the backdrop
      }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="modal-description">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}

// "Are you sure?" for actions that can't be undone. Focus starts on Cancel, the safe choice.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  done,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  done: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { busy, error, run } = useRunner();
  return (
    <Modal title={title} description={description} onClose={onClose}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions end">
        <button type="button" className="secondary" data-autofocus onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy !== null}
          onClick={async () => {
            if (await run("confirm", onConfirm, done)) onClose();
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// A small disclosure menu for secondary actions (admin moderation, blocking), behind a "⋯" button
// named by `label`. Plain buttons inside, so Tab moves through them; Escape or a click outside closes it.
export function Menu({
  label,
  children,
  down = false,
  describedBy,
}: {
  label: string;
  children: React.ReactNode;
  down?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("click", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={down ? "menu down" : "menu"} ref={ref}>
      <button
        type="button"
        className="icon-button menu-trigger"
        aria-label={label}
        aria-describedby={describedBy}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3.5" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="12.5" cy="8" r="1.4" />
        </svg>
      </button>
      <div id={id} className="menu-list" hidden={!open} onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

// Placeholders with the size of real cards, so the page doesn't jump when data arrives.
export function Skeletons({ count, kind }: { count: number; kind: "card" | "loan" }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={`skeleton ${kind}`} aria-hidden="true" />
      ))}
    </>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

// Shows a readable message instead of a broken page when a query fails (a conversation you
// can't open, a link to something removed). Only ConvexError text is shown to users.
export class ErrorBoundary extends Component<
  { fallback: (message: string) => React.ReactNode; children: React.ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    const data = (error as { data?: unknown })?.data;
    return { message: typeof data === "string" ? data : "This couldn't be loaded." };
  }
  render() {
    return this.state.message ? this.props.fallback(this.state.message) : this.props.children;
  }
}
