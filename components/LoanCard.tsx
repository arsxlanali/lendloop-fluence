"use client";
import { useMutation } from "convex/react";
import type { LoanView } from "../convex/model";
import { api } from "../convex/_generated/api";
import { activityLabel, ago, formatDay, isAutomation, STATUS } from "./format";
import { useRunner, useToday } from "./hooks";

export function LoanCard({ loan }: { loan: LoanView }) {
  const decide = useMutation(api.loans.decide);
  const cancel = useMutation(api.loans.cancelRequest);
  const report = useMutation(api.loans.reportReturn);
  const confirm = useMutation(api.loans.confirmReturn);
  const today = useToday();
  const { busy, error, run } = useRunner();
  const overdue = loan.status === "approved" && loan.end < today;
  const lastAutomation = loan.activity.find((a) => isAutomation(a.kind));
  const disabled = busy !== null;
  return (
    <article className="loan">
      <div>
        <span className={overdue ? "eyebrow warn-text" : "eyebrow"}>
          {overdue ? "Overdue" : STATUS[loan.status]}
          {loan.toolRemoved ? " · listing removed" : ""}
        </span>
        <h3>{loan.toolName}</h3>
        <p>
          {formatDay(loan.start)} → {formatDay(loan.end)}
        </p>
        {loan.counterpart && (
          <p>
            {loan.role === "owner" ? "Requested by" : "Lent by"} {loan.counterpart.name}
            {loan.counterpart.email && (
              <>
                {" · "}
                <a href={`mailto:${loan.counterpart.email}`}>{loan.counterpart.email}</a>
              </>
            )}
          </p>
        )}
        {loan.role === "admin" && (
          <p>
            {loan.borrowerName} borrows from {loan.ownerName}
          </p>
        )}
        {loan.status === "approved" && loan.returnReported && (
          <p className="notice">
            {loan.role === "owner"
              ? "The borrower says it's back. Confirm once you have it."
              : "Return reported. Waiting for the owner to confirm."}
          </p>
        )}
        {lastAutomation && (
          <p className="automation">
            {activityLabel(lastAutomation.kind, lastAutomation.by)} {ago(lastAutomation.at)}
          </p>
        )}
        {loan.activity.length > 0 && (
          <details>
            <summary>Recent activity</summary>
            <ul>
              {loan.activity.map((a, i) => (
                <li key={i}>
                  {activityLabel(a.kind, a.by)} · {ago(a.at)}
                </li>
              ))}
            </ul>
          </details>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <div className="actions">
        {loan.role === "owner" && loan.status === "pending" && (
          <>
            <button disabled={disabled} onClick={() => run("approve", () => decide({ id: loan._id, approve: true, today }))}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => run("decline", () => decide({ id: loan._id, approve: false, today }))}
            >
              Decline
            </button>
          </>
        )}
        {loan.role === "owner" && loan.status === "approved" && (
          <button
            className={loan.returnReported ? "" : "secondary"}
            disabled={disabled}
            onClick={() => run("confirm", () => confirm({ id: loan._id }))}
          >
            Confirm returned
          </button>
        )}
        {loan.role === "borrower" && loan.status === "pending" && (
          <button className="secondary" disabled={disabled} onClick={() => run("cancel", () => cancel({ id: loan._id }))}>
            Cancel request
          </button>
        )}
        {loan.role === "borrower" && loan.status === "approved" && !loan.returnReported && (
          <button disabled={disabled} onClick={() => run("report", () => report({ id: loan._id }))}>
            I&apos;ve returned it
          </button>
        )}
      </div>
    </article>
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
