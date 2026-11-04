"use client";
import { useId, useState } from "react";
import { useMutation } from "convex/react";
import type { LoanView } from "../convex/model";
import { api } from "../convex/_generated/api";
import { activityLabel, ago, formatRange, isAutomation, loanState } from "./format";
import { useRunner, useToday } from "./hooks";
import { ConfirmDialog, Modal, Pill, Skeletons } from "./ui";
import { Thread } from "./Thread";
import { LIMITS } from "../lib/policy";

type Dialog = "approve" | "decline" | "cancelRequest" | "cancelBooking" | null;

function ApproveDialog({ loan, onClose }: { loan: LoanView; onClose: () => void }) {
  const decide = useMutation(api.loans.decide);
  const today = useToday();
  const [note, setNote] = useState("");
  const { busy, error, run } = useRunner();
  return (
    <Modal
      title={`Approve ${loan.counterpart?.name}'s request`}
      description={`${loan.toolName}, ${formatRange(loan.start, loan.end)}. Other requests for these dates will be declined.`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            "approve",
            () => decide({ id: loan._id, approve: true, today, note }),
            `Approved. ${loan.counterpart?.name} has been told.`,
          );
          if (ok) onClose();
        }}
      >
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <label>
          Hand-over details (optional)
          <textarea
            value={note}
            maxLength={LIMITS.noteLength}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Where and when to pick it up. Only they will see this."
          />
        </label>
        <div className="actions end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy !== null}>{busy ? "Approving…" : "Approve"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function LoanCard({ loan, readOnly = false }: { loan: LoanView; readOnly?: boolean }) {
  const decide = useMutation(api.loans.decide);
  const cancel = useMutation(api.loans.cancelRequest);
  const cancelBooking = useMutation(api.loans.cancelBooking);
  const report = useMutation(api.loans.reportReturn);
  const confirm = useMutation(api.loans.confirmReturn);
  const dispute = useMutation(api.loans.disputeReturn);
  const today = useToday();
  const titleId = useId();
  const historyId = useId();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const messagesId = useId();
  const { busy, error, run } = useRunner();
  const state = loanState(loan, today);
  const started = loan.start <= today;
  const owner = !readOnly && loan.role === "owner";
  const borrower = !readOnly && loan.role === "borrower";
  const other = loan.counterpart?.name ?? "them";
  const lastAutomation = loan.activity.find((a) => isAutomation(a.kind));
  const disabled = busy !== null;
  const act = (key: string, fn: () => Promise<unknown>, done: string) => () => void run(key, fn, done);
  return (
    <li className="loan" aria-labelledby={titleId}>
      <div className="loan-main">
        <div className="loan-head">
          <Pill tone={state.tone}>{state.label}</Pill>
          {loan.toolRemoved && <span className="tag">Listing removed</span>}
        </div>
        <h3 id={titleId}>{loan.toolName}</h3>
        <p className="loan-meta">
          <span>{formatRange(loan.start, loan.end)}</span>
          {loan.counterpart && (
            <span>
              {loan.role === "owner" ? "Requested by" : "Lent by"} {loan.counterpart.name}
            </span>
          )}
          {loan.role === "admin" && (
            <span>
              {loan.borrowerName} borrows from {loan.ownerName}
            </span>
          )}
        </p>
        {loan.lastMessage && !showMessages && (
          <p className="preview">
            <span>{loan.lastMessage.mine ? "You" : other}:</span> {loan.lastMessage.body}
          </p>
        )}
        {loan.handoverNote && (
          <blockquote>
            <span>{loan.role === "owner" ? "Your hand-over details" : "Hand-over details"}</span>
            {loan.handoverNote}
          </blockquote>
        )}
        {loan.status === "approved" && loan.returnReported && !readOnly && (
          <p className="notice">
            {owner
              ? `${other} says it's back. Confirm once you have it, or say it isn't back yet.`
              : "You reported the return. Waiting for the owner to confirm."}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {/* The toggle stays put; the timeline opens in its own row underneath. */}
        <div className="loan-foot">
          {loan.activity.length > 0 && (
            <button
              type="button"
              className="history-toggle"
              aria-expanded={showHistory}
              aria-controls={historyId}
              onClick={() => setShowHistory((open) => !open)}
            >
              <span className="chevron" aria-hidden="true" />
              History<span className="visually-hidden"> of the {loan.toolName} loan</span>
            </button>
          )}
          {(owner || borrower) && (
            <button
              type="button"
              className={loan.unread ? "history-toggle has-unread" : "history-toggle"}
              aria-expanded={showMessages}
              aria-controls={messagesId}
              onClick={() => setShowMessages((open) => !open)}
            >
              <span className="chevron" aria-hidden="true" />
              Messages<span className="visually-hidden"> with {other}</span>
              {loan.unread > 0 && (
                <span className="unread">
                  {loan.unread}
                  <span className="visually-hidden"> unread</span>
                </span>
              )}
            </button>
          )}
          {lastAutomation && (
            <span className="automation">
              {activityLabel(lastAutomation.kind, lastAutomation.by)} {ago(lastAutomation.at)}
            </span>
          )}
        </div>
        {loan.activity.length > 0 && (
          <ol id={historyId} className="timeline" hidden={!showHistory}>
            {loan.activity.map((a, i) => (
              <li key={i} className={isAutomation(a.kind) ? "automated" : undefined}>
                <span>{activityLabel(a.kind, a.by)}</span>
                <time dateTime={new Date(a.at).toISOString()} title={new Date(a.at).toLocaleString()}>
                  {ago(a.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
        {/* Mounted only while open: a closed card holds no message subscription. */}
        <div id={messagesId}>{showMessages && <Thread loanId={loan._id} />}</div>
      </div>
      <div className="loan-actions">
        {owner && loan.status === "pending" && (
          <>
            <button disabled={disabled} onClick={() => setDialog("approve")} aria-describedby={titleId}>
              Approve…
            </button>
            <button className="secondary" disabled={disabled} onClick={() => setDialog("decline")} aria-describedby={titleId}>
              Decline
            </button>
          </>
        )}
        {owner && loan.status === "approved" && started && (
          <button
            className={loan.returnReported ? "" : "secondary"}
            disabled={disabled}
            aria-describedby={titleId}
            onClick={act("confirm", () => confirm({ id: loan._id, today }), "Return confirmed. Thanks for lending!")}
          >
            {busy === "confirm" ? "Saving…" : "Confirm returned"}
          </button>
        )}
        {owner && loan.status === "approved" && loan.returnReported && (
          <button
            className="secondary"
            disabled={disabled}
            aria-describedby={titleId}
            onClick={act("dispute", () => dispute({ id: loan._id }), `${other} has been told it isn't back yet.`)}
          >
            Not back yet
          </button>
        )}
        {borrower && loan.status === "approved" && started && !loan.returnReported && (
          <button
            disabled={disabled}
            aria-describedby={titleId}
            onClick={act("report", () => report({ id: loan._id, today }), `${other} has been asked to confirm the return.`)}
          >
            {busy === "report" ? "Saving…" : "I've returned it"}
          </button>
        )}
        {borrower && loan.status === "pending" && (
          <button className="secondary" disabled={disabled} onClick={() => setDialog("cancelRequest")} aria-describedby={titleId}>
            Cancel request
          </button>
        )}
        {(owner || borrower) && loan.status === "approved" && !started && (
          <button className="secondary" disabled={disabled} onClick={() => setDialog("cancelBooking")} aria-describedby={titleId}>
            Cancel booking
          </button>
        )}
      </div>
      {dialog === "approve" && <ApproveDialog loan={loan} onClose={() => setDialog(null)} />}
      {dialog === "decline" && (
        <ConfirmDialog
          title={`Decline ${other}'s request?`}
          description={`${loan.toolName}, ${formatRange(loan.start, loan.end)}. ${other} will be told.`}
          confirmLabel="Decline request"
          done="Request declined."
          onConfirm={() => decide({ id: loan._id, approve: false, today })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "cancelRequest" && (
        <ConfirmDialog
          title="Cancel your request?"
          description={`${loan.toolName}, ${formatRange(loan.start, loan.end)}. The owner will be told.`}
          confirmLabel="Cancel request"
          done="Request cancelled."
          onConfirm={() => cancel({ id: loan._id })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "cancelBooking" && (
        <ConfirmDialog
          title="Cancel this booking?"
          description={`${loan.toolName}, ${formatRange(loan.start, loan.end)}. ${other} will be told.`}
          confirmLabel="Cancel booking"
          done="Booking cancelled."
          onConfirm={() => cancelBooking({ id: loan._id, today })}
          onClose={() => setDialog(null)}
        />
      )}
    </li>
  );
}

// A titled list of loans with its own loading and empty states.
export function LoanSection({
  title,
  loans,
  empty,
  readOnly,
  footer,
}: {
  title: string;
  loans: LoanView[] | undefined;
  empty: string;
  readOnly?: boolean;
  footer?: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="section">
      <h2 id={headingId}>
        {title}
        {loans && loans.length > 0 && <span className="section-count">{loans.length}</span>}
      </h2>
      {loans && loans.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul className="loans" aria-busy={loans === undefined}>
          {loans === undefined ? (
            <Skeletons count={2} kind="loan" />
          ) : (
            loans.map((l) => <LoanCard key={l._id} loan={l} readOnly={readOnly} />)
          )}
        </ul>
      )}
      {footer}
    </section>
  );
}

export function LoadMore({
  status,
  loadMore,
}: {
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (n: number) => void;
}) {
  if (status === "Exhausted" || status === "LoadingFirstPage") return null;
  return (
    <div className="load-more">
      <button className="secondary" disabled={status === "LoadingMore"} onClick={() => loadMore(24)}>
        {status === "LoadingMore" ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
