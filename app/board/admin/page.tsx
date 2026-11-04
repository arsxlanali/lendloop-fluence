"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoadMore, LoanCard } from "../../../components/LoanCard";
import { ago, STATUS } from "../../../components/format";
import { useRunner } from "../../../components/hooks";

type Status = "pending" | "approved" | "declined" | "cancelled" | "expired" | "returned";

function AutomationHealth() {
  const failures = useQuery(api.notify.failures);
  const retry = useMutation(api.notify.retry);
  const { busy, error, run } = useRunner();
  if (!failures) return <p className="empty">Loading…</p>;
  const { deliveries, runs } = failures;
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {deliveries.length === 0 && runs.length === 0 ? (
        <p className="empty">No failed notifications or workflow runs.</p>
      ) : (
        <ul className="failures">
          {deliveries.map((d) => (
            <li key={d._id}>
              <strong>Notification “{d.kind.replaceAll("_", " ")}” failed</strong> after {d.attempts} attempts,{" "}
              {ago(d.at)}: {d.error}
              <button
                className="text-button"
                disabled={busy !== null}
                onClick={() => run(`retry:${d._id}`, () => retry({ id: d._id }))}
              >
                Retry
              </button>
            </li>
          ))}
          {runs.map((r) => (
            <li key={r._id}>
              <strong>{r.workflow}</strong> failed at “{r.node}” {ago(r.at)}: {r.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function Admin() {
  const me = useQuery(api.users.me);
  const [status, setStatus] = useState<Status | "">("");
  const { results, status: page, loadMore } = usePaginatedQuery(
    api.loans.adminLoans,
    me?.admin ? { status: status || undefined } : "skip",
    { initialNumItems: 20 },
  );
  if (me && !me.admin) return <p className="empty">This page is for admins.</p>;
  return (
    <section>
      <div className="section-heading">
        <h2>Automation health</h2>
        <span>Failures stay here until handled</span>
      </div>
      <AutomationHealth />
      <div className="section-heading">
        <h2>All loans</h2>
      </div>
      <label className="filter">
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
          <option value="">All</option>
          {Object.entries(STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {page === "LoadingFirstPage" ? (
        <p className="empty">Loading…</p>
      ) : results.length === 0 ? (
        <p className="empty">No loans.</p>
      ) : (
        <div className="loans">
          {results.map((l) => (
            <LoanCard key={l._id} loan={l} />
          ))}
        </div>
      )}
      <LoadMore status={page} loadMore={loadMore} />
    </section>
  );
}
