"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { ToolCard } from "../../../components/ToolCard";
import { ToolForm } from "../../../components/Forms";
import { useRunner, useToday } from "../../../components/hooks";

type Listing = FunctionReturnType<typeof api.tools.myListings>[number];

export default function MyListings() {
  const today = useToday();
  const listings = useQuery(api.tools.myListings, { today });
  const remove = useMutation(api.tools.removeTool);
  const [form, setForm] = useState<{ editing: Listing | null } | null>(null);
  const { busy, error, run } = useRunner();
  return (
    <section>
      <div className="section-heading">
        <h2>My listings</h2>
        <button onClick={() => setForm({ editing: null })}>+ List a tool</button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {form && <ToolForm editing={form.editing} onDone={() => setForm(null)} />}
      {listings === undefined ? (
        <p className="empty">Loading…</p>
      ) : listings.length === 0 ? (
        <p className="empty">You haven&apos;t listed anything yet.</p>
      ) : (
        <div className="grid">
          {listings.map((t) => (
            <ToolCard
              key={t._id}
              tool={t}
              admin={false}
              busy={busy}
              onEdit={() => setForm({ editing: t })}
              onBorrow={() => {}}
              onTrust={() => {}}
              onRemove={() => {
                if (window.confirm(`Remove “${t.name}”? Open requests for it will be declined.`))
                  void run(`remove:${t._id}`, () => remove({ id: t._id }));
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
