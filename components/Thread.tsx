"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { LIMITS } from "../lib/policy";
import { useRunner } from "./hooks";

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayAndTime = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (at: number) =>
  new Date(at).toDateString() === new Date().toDateString() ? time.format(at) : dayAndTime.format(at);

// The conversation between the two people on a loan. Updates live for both sides; your own
// message shows at once (optimistic) and is replaced by the saved one a moment later.
export function Thread({ loanId }: { loanId: Id<"loans"> }) {
  const data = useQuery(api.messages.list, { loanId });
  const markRead = useMutation(api.messages.markRead);
  const send = useMutation(api.messages.send).withOptimisticUpdate((store, { loanId, body }) => {
    const current = store.getQuery(api.messages.list, { loanId });
    if (current)
      store.setQuery(api.messages.list, { loanId }, {
        ...current,
        messages: [...current.messages, { _id: `sending-${Date.now()}`, body: body.trim(), at: Date.now(), mine: true }],
      });
  });
  const [draft, setDraft] = useState("");
  const { error, run } = useRunner();
  const log = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // Reading the thread marks it read (also when a reply arrives while it is open).
  useEffect(() => {
    if (data?.unread) void markRead({ loanId });
  }, [data?.unread, loanId, markRead]);

  // Keep the newest message in view.
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [count]);

  if (!data) return <p className="thread-loading">Loading messages…</p>;

  async function submit() {
    const body = draft;
    if (!body.trim()) return;
    setDraft("");
    if (!(await run("send", () => send({ loanId, body })))) setDraft(body); // keep the text on failure
  }

  return (
    <div className="thread">
      {/* role="log": new messages are announced politely; the list inside keeps list semantics. */}
      <div ref={log} className="messages" role="log" aria-label={`Messages with ${data.otherName}`} tabIndex={0}>
        <ol>
        {data.messages.length === 0 && (
          <li className="thread-empty">No messages yet. Ask about pick-up, or say thanks.</li>
        )}
        {data.messages.map((m) => (
          <li key={m._id} className={m.mine ? "msg mine" : "msg"}>
            <p>{m.body}</p>
            <span className="msg-meta">
              {m.mine ? "You" : data.otherName} · {m._id.startsWith("sending-") ? "sending…" : when(m.at)}
            </span>
          </li>
        ))}
        </ol>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data.open ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={inputId} className="visually-hidden">
            Message to {data.otherName}
          </label>
          <textarea
            id={inputId}
            rows={1}
            value={draft}
            maxLength={LIMITS.messageLength}
            placeholder={`Message ${data.otherName}…`}
            aria-describedby={`${inputId}-hint`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a line (and IME composition is left alone).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button disabled={!draft.trim()}>Send</button>
          <span id={`${inputId}-hint`} className="composer-hint">
            Enter to send, Shift+Enter for a new line.
            {draft.length > LIMITS.messageLength - 100 && ` ${LIMITS.messageLength - draft.length} characters left.`}
          </span>
        </form>
      ) : (
        <p className="thread-closed">This conversation is closed because the loan is finished.</p>
      )}
    </div>
  );
}
