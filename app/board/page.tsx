"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { categories } from "../../lib/policy";
import { ToolCard, type ToolView } from "../../components/ToolCard";
import { BorrowDialog, ToolFormDialog } from "../../components/Forms";
import { LoadMore } from "../../components/LoanCard";
import { ConfirmDialog, PageTitle, Skeletons } from "../../components/ui";
import { useDebounced, useRunner, useToday } from "../../components/hooks";

export default function Explore() {
  const today = useToday();
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const [editing, setEditing] = useState<{ tool: ToolView | null } | null>(null);
  const [borrowing, setBorrowing] = useState<ToolView | null>(null);
  const [removing, setRemoving] = useState<ToolView | null>(null);
  const me = useQuery(api.users.me);
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.browse,
    { today, category: category || undefined, search: search || undefined },
    { initialNumItems: 24 },
  );
  const remove = useMutation(api.tools.removeTool);
  const trust = useMutation(api.tools.setTrusted);
  const { error, run } = useRunner();
  const loading = status === "LoadingFirstPage";
  const filtered = Boolean(category || search);
  return (
    <>
      <PageTitle title="Explore">
        <p className="lede">Tools your neighbors are happy to lend.</p>
        <button onClick={() => setEditing({ tool: null })}>+ List a tool</button>
      </PageTitle>
      <div role="search" className="toolbar" aria-label="Find tools">
        <label className="search">
          <span className="visually-hidden">Search tools by name</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools" />
        </label>
        <div className="chips" role="group" aria-label="Category">
          {["", ...categories].map((c) => (
            <button
              key={c || "all"}
              type="button"
              className={category === c ? "chip active" : "chip"}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c || "All"}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {loading ? "" : `${results.length}${status === "Exhausted" ? "" : "+"} tools shown`}
      </p>
      {!loading && results.length === 0 ? (
        <div className="empty-state">
          <p>{filtered ? "No tools match. Try another category or search." : "Nothing listed yet."}</p>
          {filtered ? (
            <button className="secondary" onClick={() => (setCategory(""), setQuery(""))}>
              Clear filters
            </button>
          ) : (
            <button onClick={() => setEditing({ tool: null })}>List the first tool</button>
          )}
        </div>
      ) : (
        <ul className="grid" aria-busy={loading}>
          {loading ? (
            <Skeletons count={6} kind="card" />
          ) : (
            results.map((t) => (
              <ToolCard
                key={t._id}
                tool={t}
                admin={me?.admin ?? false}
                onEdit={() => setEditing({ tool: t })}
                onBorrow={() => setBorrowing(t)}
                onRemove={() => setRemoving(t)}
                onTrust={() =>
                  void run(
                    `trust:${t._id}`,
                    () => trust({ toolId: t._id, trusted: !t.trusted }),
                    t.trusted ? "Trusted Lender removed." : "Marked as Trusted Lender.",
                  )
                }
              />
            ))
          )}
        </ul>
      )}
      <LoadMore status={status} loadMore={loadMore} />
      {editing && <ToolFormDialog editing={editing.tool} onClose={() => setEditing(null)} />}
      {borrowing && <BorrowDialog tool={borrowing} onClose={() => setBorrowing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove the ${removing.name}?`}
          description={
            removing.mine
              ? "It will disappear from the board, and any open requests will be declined. Approved loans stay as they are."
              : "The owner will be told, and any open requests will be declined. Approved loans stay as they are."
          }
          confirmLabel="Remove listing"
          done="Listing removed."
          onConfirm={() => remove({ id: removing._id })}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
