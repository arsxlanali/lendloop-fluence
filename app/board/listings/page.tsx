"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { ToolCard } from "../../../components/ToolCard";
import { ToolFormDialog } from "../../../components/Forms";
import { ConfirmDialog, PageTitle, Skeletons } from "../../../components/ui";
import { useToday } from "../../../components/hooks";

type Listing = FunctionReturnType<typeof api.tools.myListings>[number];

export default function MyListings() {
  const today = useToday();
  const listings = useQuery(api.tools.myListings, { today });
  const remove = useMutation(api.tools.removeTool);
  const [editing, setEditing] = useState<{ tool: Listing | null } | null>(null);
  const [removing, setRemoving] = useState<Listing | null>(null);
  return (
    <>
      <PageTitle title="My listings">
        <p className="lede">What you lend, and whether it's out right now.</p>
        <button onClick={() => setEditing({ tool: null })}>+ List a tool</button>
      </PageTitle>
      {listings && listings.length === 0 ? (
        <div className="empty-state">
          <p>You haven&apos;t listed anything yet. A ladder, a drill, a tent: what could a neighbor use?</p>
          <button onClick={() => setEditing({ tool: null })}>List your first tool</button>
        </div>
      ) : (
        <ul className="grid" aria-busy={listings === undefined}>
          {listings === undefined ? (
            <Skeletons count={3} kind="card" />
          ) : (
            listings.map((t) => (
              <ToolCard
                key={t._id}
                tool={t}
                admin={false}
                onEdit={() => setEditing({ tool: t })}
                onBorrow={() => {}}
                onTrust={() => {}}
                onRemove={() => setRemoving(t)}
              />
            ))
          )}
        </ul>
      )}
      {editing && <ToolFormDialog editing={editing.tool} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove the ${removing.name}?`}
          description={
            removing.pendingRequests > 0
              ? `It will disappear from the board. ${removing.pendingRequests} open request${removing.pendingRequests === 1 ? "" : "s"} will be declined, and ${removing.pendingRequests === 1 ? "that neighbor" : "those neighbors"} will be told. Approved loans stay as they are.`
              : "It will disappear from the board. Approved loans stay as they are."
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
