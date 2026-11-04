"use client";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoadMore, LoanSection } from "../../../components/LoanCard";
import { PageTitle } from "../../../components/ui";

const OPEN = new Set(["pending", "approved"]);

export default function MyRequests() {
  const waiting = useQuery(api.loans.byStatus, { as: "borrower", status: "pending" });
  const current = useQuery(api.loans.byStatus, { as: "borrower", status: "approved" });
  const past = usePaginatedQuery(api.loans.myRequests, {}, { initialNumItems: 20 });
  return (
    <>
      <PageTitle title="My requests">
        <p className="lede">
          Things you asked to borrow. <Link href="/board">Find something new</Link>
        </p>
      </PageTitle>
      <LoanSection title="Borrowing now & upcoming" loans={current} empty="Nothing borrowed right now." />
      <LoanSection title="Waiting for an answer" loans={waiting} empty="No open requests." />
      <LoanSection
        title="Past"
        loans={past.status === "LoadingFirstPage" ? undefined : past.results.filter((l) => !OPEN.has(l.status))}
        empty="Nothing here yet."
        footer={<LoadMore status={past.status} loadMore={past.loadMore} />}
      />
    </>
  );
}
