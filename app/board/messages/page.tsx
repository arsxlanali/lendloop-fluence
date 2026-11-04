"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Conversation } from "../../../components/Conversation";
import { LoadMore } from "../../../components/LoanCard";
import { ago } from "../../../components/format";
import { ErrorBoundary, PageTitle } from "../../../components/ui";
import { Avatar } from "../../../components/bits";

type Role = "" | "owner" | "borrower";

function Inbox({ selected, role, setRole }: { selected: string | null; role: Role; setRole: (r: Role) => void }) {
  const inbox = usePaginatedQuery(api.messages.inbox, { role: role || undefined }, { initialNumItems: 30 });
  return (
    <section className="inbox" aria-label="Conversations">
      <div className="chips" role="group" aria-label="Show">
        {(
          [
            ["", "All"],
            ["owner", "Lending"],
            ["borrower", "Borrowing"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            type="button"
            className={role === value ? "chip active" : "chip"}
            aria-pressed={role === value}
            onClick={() => setRole(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {inbox.status === "LoadingFirstPage" ? (
        <p className="empty" role="status">
          Loading…
        </p>
      ) : inbox.results.length === 0 ? (
        <p className="empty">
          No conversations yet. Use “Ask the owner” on any tool in <Link href="/board">Explore</Link>.
        </p>
      ) : (
        <ul className="inbox-list">
          {inbox.results.map((c) => (
            <li key={c._id}>
              <Link
                href={`/board/messages?c=${c._id}`}
                className={c.unread ? "inbox-item unread-item" : "inbox-item"}
                aria-current={selected === c._id ? "true" : undefined}
              >
                <Avatar name={c.otherName} size={36} />
                <span className="inbox-top">
                  <strong>{c.toolName}</strong>
                  <time dateTime={new Date(c.lastMessageAt).toISOString()}>{ago(c.lastMessageAt)}</time>
                </span>
                <span className="inbox-who">
                  {c.otherName} · {c.role === "owner" ? "wants to borrow" : "lends it"}
                </span>
                <span className="inbox-preview">
                  {c.preview ? `${c.preview.mine ? "You: " : ""}${c.preview.body}` : "No messages yet"}
                </span>
                {c.unread > 0 && (
                  <span className="unread inbox-unread">
                    {c.unread}
                    <span className="visually-hidden"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <LoadMore status={inbox.status} loadMore={inbox.loadMore} />
    </section>
  );
}

function Messages() {
  const params = useSearchParams();
  const router = useRouter();
  const [role, setRole] = useState<Role>("");
  const conversationId = params.get("c") as Id<"conversations"> | null;
  const toolId = params.get("tool") as Id<"tools"> | null;
  const selected = conversationId ?? (toolId ? `tool:${toolId}` : null);
  return (
    <div className={selected ? "messenger has-selection" : "messenger"}>
      <Inbox selected={conversationId} role={role} setRole={setRole} />
      <section className="conversation-pane" aria-label="Conversation">
        {selected ? (
          <ErrorBoundary
            key={selected}
            fallback={(message) => (
              <div className="empty-state">
                <p>{message}</p>
                <Link className="button secondary" href="/board/messages">
                  Back to messages
                </Link>
              </div>
            )}
          >
            <Conversation
              conversationId={conversationId ?? undefined}
              toolId={conversationId ? undefined : (toolId ?? undefined)}
              backHref="/board/messages"
              onCreated={(id) => router.replace(`/board/messages?c=${id}`)}
            />
          </ErrorBoundary>
        ) : (
          <p className="empty pane-empty">Choose a conversation to read it here.</p>
        )}
      </section>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <>
      <PageTitle title="Messages">
        <p className="lede">Questions, requests and hand-overs, one conversation per tool and neighbor.</p>
      </PageTitle>
      {/* useSearchParams needs a Suspense boundary on a statically rendered page. */}
      <Suspense fallback={<p className="empty">Loading…</p>}>
        <Messages />
      </Suspense>
    </>
  );
}
