"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { LIMITS } from "../lib/policy";
import { eventText, formatRange, loanState } from "./format";
import { useRunner, useToday } from "./hooks";
import { ConfirmDialog, Menu, Pill } from "./ui";
import { Avatar } from "./bits";

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayAndTime = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (at: number) =>
  new Date(at).toDateString() === new Date().toDateString() ? time.format(at) : dayAndTime.format(at);

// One conversation between a tool's owner and a borrower: questions, requests and status
// changes in one thread. With a toolId and no conversation yet, the first message starts it.
// Updates live for both sides; your own message shows at once (optimistic).
export function Conversation({
  conversationId,
  toolId,
  onCreated,
  backHref,
}: {
  conversationId?: Id<"conversations">;
  toolId?: Id<"tools">;
  onCreated: (id: Id<"conversations">) => void;
  backHref: string;
}) {
  const args = conversationId ? { conversationId } : { toolId };
  const data = useQuery(api.messages.conversation, args);
  const markRead = useMutation(api.messages.markRead);
  const block = useMutation(api.messages.setBlocked);
  const send = useMutation(api.messages.send).withOptimisticUpdate((store, { conversationId, body }) => {
    if (!conversationId) return;
    const current = store.getQuery(api.messages.conversation, { conversationId });
    if (current)
      store.setQuery(api.messages.conversation, { conversationId }, {
        ...current,
        messages: [
          ...current.messages,
          { _id: `sending-${Date.now()}`, body: body.trim(), at: Date.now(), by: "me", event: null, dates: null },
        ],
      });
  });
  const today = useToday();
  const [draft, setDraft] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const { error, run } = useRunner();
  const log = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // Seeing the conversation marks it read (also when a reply arrives while it is open).
  useEffect(() => {
    if (data?.conversationId && data.unread > 0) void markRead({ conversationId: data.conversationId });
  }, [data?.conversationId, data?.unread, markRead]);

  const count = data?.messages.length ?? 0;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [count]);

  if (!data) return <p className="empty" role="status">Loading conversation…</p>;
  const loansHref = data.role === "owner" ? "/board/incoming" : "/board/requests";
  const state = data.loan && loanState(data.loan, today);

  async function submit() {
    const body = draft;
    if (!body.trim() || !data) return;
    setDraft("");
    let created: Id<"conversations"> | null = null;
    const ok = await run("send", async () => {
      created = data.conversationId
        ? await send({ conversationId: data.conversationId, body })
        : await send({ toolId: data.toolId, body });
    });
    if (!ok) setDraft(body); // keep the text if sending failed
    else if (!data.conversationId && created) onCreated(created);
  }

  return (
    <div className="conversation">
      <header className="conversation-head">
        <Link className="back-link" href={backHref}>
          ← All messages
        </Link>
        <Avatar name={data.otherName} size={40} />
        <div className="conversation-title">
          <h2>{data.toolName}</h2>
          <p className="loan-meta">
            <span>
              {data.role === "owner" ? `${data.otherName} wants to borrow` : `Lent by ${data.otherName}`}
            </span>
            {data.loan && state && (
              <Link href={loansHref} className="pill-link">
                <Pill tone={state.tone}>
                  {state.label} · {formatRange(data.loan.start, data.loan.end)}
                </Pill>
              </Link>
            )}
          </p>
        </div>
        {data.conversationId && (
          <Menu label="Conversation options" down>
            {data.reason === "blocked-by-me" ? (
              <button
                type="button"
                onClick={() => void run("unblock", () => block({ conversationId: data.conversationId!, blocked: false }), `${data.otherName} is unblocked.`)}
              >
                Unblock {data.otherName}
              </button>
            ) : (
              <button type="button" className="danger-text" onClick={() => setConfirmBlock(true)}>
                Block {data.otherName}…
              </button>
            )}
          </Menu>
        )}
      </header>

      <div ref={log} className="messages" role="log" aria-label={`Messages with ${data.otherName}`} tabIndex={0}>
        <ol>
          {data.messages.length === 0 && (
            <li className="thread-empty">
              {data.role === "borrower"
                ? `Ask ${data.otherName} anything about the ${data.toolName}: what's included, when you could pick it up.`
                : "No messages yet."}
            </li>
          )}
          {data.messages.map((m) =>
            m.event ? (
              <li key={m._id} className="msg-event">
                {eventText(m.event, m.by, data.otherName, m.dates)} · {when(m.at)}
              </li>
            ) : (
              <li key={m._id} className={m.by === "me" ? "msg mine" : "msg"}>
                <p>{m.body}</p>
                <span className="msg-meta">
                  {m.by === "me" ? "You" : data.otherName} · {m._id.startsWith("sending-") ? "sending…" : when(m.at)}
                </span>
              </li>
            ),
          )}
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
              // Enter sends; Shift+Enter adds a line (IME composition is left alone).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button disabled={!draft.trim()}>Send</button>
          <span id={`${inputId}-hint`} className="composer-hint">
            Enter to send, Shift+Enter for a new line. Your email stays private.
            {draft.length > LIMITS.messageLength - 100 && ` ${LIMITS.messageLength - draft.length} characters left.`}
          </span>
        </form>
      ) : (
        <p className="thread-closed">
          {data.reason === "blocked-by-me"
            ? `You blocked ${data.otherName}. Unblock them from “More” to write again.`
            : data.reason === "blocked"
              ? "You can't reply in this conversation."
              : "This listing was removed, so the conversation is closed."}
        </p>
      )}

      {confirmBlock && data.conversationId && (
        <ConfirmDialog
          title={`Block ${data.otherName}?`}
          description={`${data.otherName} won't be able to message you or send requests for any of your tools, and you won't be able to contact them. You can unblock them here any time.`}
          confirmLabel={`Block ${data.otherName}`}
          done={`${data.otherName} is blocked.`}
          onConfirm={() => block({ conversationId: data.conversationId!, blocked: true })}
          onClose={() => setConfirmBlock(false)}
        />
      )}
    </div>
  );
}
