"use client";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoadMore, LoanSection } from "../../../components/LoanCard";
import { PageTitle } from "../../../components/ui";

const OPEN = new Set(["pending", "approved"]);

export default function Incoming() {
  const waiting = useQuery(api.loans.needsAnswer);
  const lent = useQuery(api.loans.byStatus, { as: "owner", status: "approved" });
  const past = usePaginatedQuery(api.loans.incoming, {}, { initialNumItems: 20 });
  return (
    <>
      <PageTitle title="Incoming">
        <p className="lede">Requests for your tools, and what&apos;s lent out.</p>
      </PageTitle>
      <LoanSection title="Needs your answer" loans={waiting} empty="You're all caught up." />
      <LoanSection
        title="Lent out & upcoming"
        loans={lent?.filter((l) => !l.returnReported)}
        empty="Nothing lent out right now."
      />
      <LoanSection
        title="Past"
        loans={past.status === "LoadingFirstPage" ? undefined : past.results.filter((l) => !OPEN.has(l.status))}
        empty="Nothing here yet."
        footer={<LoadMore status={past.status} loadMore={past.loadMore} />}
      />
    </>
  );
}
