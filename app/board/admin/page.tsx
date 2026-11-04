"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoadMore, LoanCard } from "../../../components/LoanCard";
import { ago, STATUS } from "../../../components/format";
import { useRunner } from "../../../components/hooks";
import { PageTitle, Skeletons } from "../../../components/ui";

type Status = "pending" | "approved" | "declined" | "cancelled" | "expired" | "returned";

function AutomationHealth() {
  const failures = useQuery(api.notify.failures);
  const retryAll = useMutation(api.notify.retryAll);
  const dismiss = useMutation(api.notify.dismissRuns);
  const { busy, error, run } = useRunner();
  const failedNotifications = failures?.deliveries.reduce((n, d) => n + d.count, 0) ?? 0;
  return (
    <section aria-labelledby="health" className="section">
      <div className="section-title-row">
        <h2 id="health">Automation health</h2>
        {failedNotifications > 0 && (
          <button
            className="secondary"
            disabled={busy !== null}
            onClick={() =>
              run("retry", () => retryAll({}), `${failedNotifications} notification${failedNotifications === 1 ? "" : "s"} queued again.`)
            }
          >
            Retry all failed notifications
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!failures ? (
        <p className="empty">Loading…</p>
      ) : failures.deliveries.length + failures.runs.length === 0 ? (
        <p className="health ok">All notifications delivered and every workflow run succeeded.</p>
      ) : (
        <ul className="failures">
          {failures.deliveries.map((d) => (
            <li key={`d:${d.kind}:${d.error}`}>
              <span className="failure-count" aria-label={`${d.count} times`}>
                ×{d.count}
              </span>
              <span className="failure-text">
                <strong>“{d.kind.replaceAll("_", " ")}” notification{d.count === 1 ? "" : "s"} failed</strong>
                <span>
                  {d.error} · latest {ago(d.latestAt)}
                </span>
              </span>
            </li>
          ))}
          {failures.runs.map((r) => (
            <li key={`r:${r.workflow}:${r.node}:${r.message}`}>
              <span className="failure-count" aria-label={`${r.count} times`}>
                ×{r.count}
              </span>
              <span className="failure-text">
                <strong>{r.workflow}</strong>
                <span>
                  Failed at “{r.node}”: {r.message} · latest {ago(r.latestAt)}
                </span>
              </span>
              <button
                className="secondary"
                disabled={busy !== null}
                onClick={() =>
                  run(`dismiss:${r.workflow}${r.node}${r.message}`, () => dismiss({ workflow: r.workflow, node: r.node, message: r.message }), "Marked as handled.")
                }
              >
                Dismiss<span className="visually-hidden"> {r.workflow} failures</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Admin() {
  const me = useQuery(api.users.me);
  const [status, setStatus] = useState<Status | "">("");
  const loans = usePaginatedQuery(api.loans.adminLoans, me?.admin ? { status: status || undefined } : "skip", {
    initialNumItems: 20,
  });
  if (me && !me.admin)
    return (
      <>
        <PageTitle title="Admin" />
        <p className="empty">This page is for admins.</p>
      </>
    );
  return (
    <>
      <PageTitle title="Admin">
        <p className="lede">Automation health and every loan, read-only.</p>
      </PageTitle>
      <AutomationHealth />
      <section aria-labelledby="all-loans" className="section">
        <h2 id="all-loans">All loans</h2>
        <div className="chips" role="group" aria-label="Filter by status">
          {(["", ...Object.keys(STATUS)] as (Status | "")[]).map((s) => (
            <button
              key={s || "all"}
              type="button"
              className={status === s ? "chip active" : "chip"}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {s ? STATUS[s] : "All"}
            </button>
          ))}
        </div>
        {loans.status !== "LoadingFirstPage" && loans.results.length === 0 ? (
          <p className="empty">No loans{status ? " with this status" : ""}.</p>
        ) : (
          <ul className="loans" aria-busy={loans.status === "LoadingFirstPage"}>
            {loans.status === "LoadingFirstPage" ? (
              <Skeletons count={3} kind="loan" />
            ) : (
              loans.results.map((l) => <LoanCard key={l._id} loan={l} readOnly />)
            )}
          </ul>
        )}
        <LoadMore status={loans.status} loadMore={loans.loadMore} />
      </section>
    </>
  );
}
