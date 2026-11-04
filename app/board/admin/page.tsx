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
  const retry = useMutation(api.notify.retry);
  const { busy, error, run } = useRunner();
  const problems = failures ? failures.deliveries.length + failures.runs.length : 0;
  return (
    <section aria-labelledby="health" className="section">
      <h2 id="health">Automation health</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!failures ? (
        <p className="empty">Loading…</p>
      ) : problems === 0 ? (
        <p className="health ok">All notifications delivered and every workflow run succeeded.</p>
      ) : (
        <ul className="failures">
          {failures.deliveries.map((d) => (
            <li key={d._id}>
              <span>
                <strong>Notification “{d.kind.replaceAll("_", " ")}” failed</strong> after {d.attempts} attempts,{" "}
                {ago(d.at)}: {d.error}
              </span>
              <button
                className="secondary"
                disabled={busy !== null}
                onClick={() => run(`retry:${d._id}`, () => retry({ id: d._id }), "Notification queued again.")}
              >
                Retry
              </button>
            </li>
          ))}
          {failures.runs.map((r) => (
            <li key={r._id}>
              <span>
                <strong>{r.workflow}</strong> failed at “{r.node}” {ago(r.at)}: {r.message}
              </span>
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
