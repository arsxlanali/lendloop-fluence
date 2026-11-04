"use client";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";
import { formatDay } from "./format";

export type ToolView = FunctionReturnType<typeof api.tools.browse>["page"][number];
type Listing = FunctionReturnType<typeof api.tools.myListings>[number];

function Availability({ tool }: { tool: ToolView | Listing }) {
  if (tool.overdue) return <span className="badge warn">Overdue since {formatDay(tool.until!)}</span>;
  if (!tool.available) return <span className="badge muted">On loan until {formatDay(tool.until!)}</span>;
  if (tool.nextBooked) return <span className="badge">Free until {formatDay(tool.nextBooked)}</span>;
  return <span className="badge">Available</span>;
}

export function ToolCard({
  tool,
  admin,
  busy,
  onEdit,
  onRemove,
  onBorrow,
  onTrust,
}: {
  tool: ToolView | Listing;
  admin: boolean;
  busy: string | null;
  onEdit: () => void;
  onRemove: () => void;
  onBorrow: () => void;
  onTrust: () => void;
}) {
  const requested = "requested" in tool && tool.requested;
  const pendingRequests = "pendingRequests" in tool ? tool.pendingRequests : 0;
  return (
    <article className="card">
      <div className="card-top">
        <span className="eyebrow">{tool.category}</span>
        <Availability tool={tool} />
      </div>
      <h3>{tool.name}</h3>
      <p>{tool.description || "No description."}</p>
      <small>
        Condition: {tool.condition}
        {tool.trusted ? " · Trusted Lender" : ""}
      </small>
      {pendingRequests > 0 && (
        <Link className="notice" href="/board/incoming">
          {pendingRequests} request{pendingRequests === 1 ? "" : "s"} waiting →
        </Link>
      )}
      <div className="actions">
        {tool.mine ? (
          <>
            <button className="secondary" onClick={onEdit}>
              Edit
            </button>
            <button className="text-button" disabled={busy === `remove:${tool._id}`} onClick={onRemove}>
              Remove
            </button>
          </>
        ) : requested ? (
          <Link className="button secondary" href="/board/requests">
            Requested · view
          </Link>
        ) : (
          <button onClick={onBorrow}>Choose dates</button>
        )}
        {admin && !tool.mine && (
          <>
            <button className="text-button" disabled={busy === `remove:${tool._id}`} onClick={onRemove}>
              Remove listing
            </button>
            <button className="text-button" disabled={busy === `trust:${tool._id}`} onClick={onTrust}>
              {tool.trusted ? "Remove Trusted Lender" : "Mark Trusted Lender"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
