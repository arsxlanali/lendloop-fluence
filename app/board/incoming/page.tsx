"use client";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoadMore, LoanCard } from "../../../components/LoanCard";

export default function Incoming() {
  const waiting = useQuery(api.loans.needsAnswer);
  const { results, status, loadMore } = usePaginatedQuery(api.loans.incoming, {}, { initialNumItems: 20 });
  const waitingIds = new Set(waiting?.map((l) => l._id));
  const history = results.filter((l) => !waitingIds.has(l._id));
  return (
    <section>
      <div className="section-heading">
        <h2>Needs your answer</h2>
        <span>Requests and returns for your tools</span>
      </div>
      {waiting === undefined ? (
        <p className="empty">Loading…</p>
      ) : waiting.length === 0 ? (
        <p className="empty">You&apos;re all caught up.</p>
      ) : (
        <div className="loans">
          {waiting.map((l) => (
            <LoanCard key={l._id} loan={l} />
          ))}
        </div>
      )}
      <div className="section-heading">
        <h2>All requests</h2>
      </div>
      {status === "LoadingFirstPage" ? (
        <p className="empty">Loading…</p>
      ) : history.length === 0 ? (
        <p className="empty">Nothing else yet.</p>
      ) : (
        <div className="loans">
          {history.map((l) => (
            <LoanCard key={l._id} loan={l} />
          ))}
        </div>
      )}
      <LoadMore status={status} loadMore={loadMore} />
    </section>
  );
}
