"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { categories } from "../../lib/policy";
import { ToolCard, type ToolView } from "../../components/ToolCard";
import { BorrowForm, ToolForm } from "../../components/Forms";
import { LoadMore } from "../../components/LoanCard";
import { useRunner, useToday } from "../../components/hooks";

export default function Explore() {
  const today = useToday();
  const [category, setCategory] = useState("");
  const [form, setForm] = useState<{ editing: ToolView | null } | null>(null);
  const [borrowing, setBorrowing] = useState<ToolView | null>(null);
  const [sent, setSent] = useState("");
  const me = useQuery(api.users.me);
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.browse,
    { today, category: category || undefined },
    { initialNumItems: 24 },
  );
  const remove = useMutation(api.tools.removeTool);
  const trust = useMutation(api.tools.setTrusted);
  const { busy, error, run } = useRunner();
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your shared toolshed</p>
          <h2>Good things, closer to home.</h2>
        </div>
        <button onClick={() => setForm({ editing: null })}>+ List a tool</button>
      </div>
      {sent && (
        <p role="status" className="success">
          {sent}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {form && <ToolForm editing={form.editing} onDone={() => setForm(null)} />}
      {borrowing && (
        <BorrowForm
          tool={borrowing}
          onDone={(ok) => {
            if (ok) setSent(`Request sent for ${borrowing.name}. You'll see the answer in My requests.`);
            setBorrowing(null);
          }}
        />
      )}
      <label className="filter">
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {status === "LoadingFirstPage" ? (
        <p className="empty">Loading tools…</p>
      ) : results.length === 0 ? (
        <p className="empty">Nothing here yet. Your next good find could start with a listing.</p>
      ) : (
        <div className="grid">
          {results.map((t) => (
            <ToolCard
              key={t._id}
              tool={t}
              admin={me?.admin ?? false}
              busy={busy}
              onEdit={() => setForm({ editing: t })}
              onBorrow={() => {
                setSent("");
                setBorrowing(t);
              }}
              onRemove={() => {
                if (window.confirm(`Remove “${t.name}”? Open requests for it will be declined.`))
                  void run(`remove:${t._id}`, () => remove({ id: t._id }));
              }}
              onTrust={() => void run(`trust:${t._id}`, () => trust({ toolId: t._id, trusted: !t.trusted }))}
            />
          ))}
        </div>
      )}
      <LoadMore status={status} loadMore={loadMore} />
    </section>
  );
}
