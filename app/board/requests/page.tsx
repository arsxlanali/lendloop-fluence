"use client";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoadMore, LoanCard } from "../../../components/LoanCard";

export default function MyRequests() {
  const { results, status, loadMore } = usePaginatedQuery(api.loans.myRequests, {}, { initialNumItems: 20 });
  return (
    <section>
      <div className="section-heading">
        <h2>My requests</h2>
        <span>Things you asked to borrow</span>
      </div>
      {status === "LoadingFirstPage" ? (
        <p className="empty">Loading…</p>
      ) : results.length === 0 ? (
        <p className="empty">No requests yet. Find something in Explore.</p>
      ) : (
        <div className="loans">
          {results.map((l) => (
            <LoanCard key={l._id} loan={l} />
          ))}
        </div>
      )}
      <LoadMore status={status} loadMore={loadMore} />
    </section>
  );
}
