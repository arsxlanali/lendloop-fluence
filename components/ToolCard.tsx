"use client";
import Link from "next/link";
import { useId } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";
import { formatDay } from "./format";
import { Menu, Pill } from "./ui";
import { AvailabilityStrip, CategoryChip } from "./bits";
import { useToday } from "./hooks";

export type ToolView = FunctionReturnType<typeof api.tools.browse>["page"][number];
type Listing = FunctionReturnType<typeof api.tools.myListings>[number];

function Availability({ tool }: { tool: ToolView | Listing }) {
  if (tool.overdue) return <Pill tone="overdue">Overdue since {formatDay(tool.until!)}</Pill>;
  if (!tool.available) return <Pill tone="upcoming">On loan until {formatDay(tool.until!)}</Pill>;
  if (tool.nextBooked) return <Pill tone="active">Free until {formatDay(tool.nextBooked)}</Pill>;
  return <Pill tone="active">Available</Pill>;
}

export function ToolCard({
  tool,
  admin,
  onEdit,
  onRemove,
  onBorrow,
  onTrust,
}: {
  tool: ToolView | Listing;
  admin: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onBorrow: () => void;
  onTrust: () => void;
}) {
  const titleId = useId();
  const today = useToday();
  const requested = "requested" in tool && tool.requested;
  const pendingRequests = "pendingRequests" in tool ? tool.pendingRequests : 0;
  return (
    <li className="card tool" aria-labelledby={titleId}>
      <div className="card-top">
        <CategoryChip category={tool.category} />
        <Availability tool={tool} />
        {admin && !tool.mine && (
          <Menu label="Moderate" describedBy={titleId} down>
            <button type="button" onClick={onTrust}>
              {tool.trusted ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
            </button>
            <button type="button" className="danger-text" onClick={onRemove}>
              Remove listing…
            </button>
          </Menu>
        )}
      </div>
      {/* Cards sit directly under the page's h1, so their titles are h2 (styled like h3). */}
      <h2 id={titleId} className="card-title">
        {tool.name}
      </h2>
      {tool.description && <p className="clamp">{tool.description}</p>}
      <AvailabilityStrip today={today} booked={tool.soon} overdue={tool.overdue} />
      <ul className="meta">
        <li>{tool.condition}</li>
        {tool.mine && <li className="tag">Your listing</li>}
        {tool.trusted && !tool.mine && <li className="tag trusted">Trusted lender</li>}
      </ul>
      {pendingRequests > 0 && (
        <Link className="notice" href="/board/incoming">
          {pendingRequests} request{pendingRequests === 1 ? "" : "s"} waiting for your answer →
        </Link>
      )}
      <div className="card-actions">
        {tool.mine ? (
          <>
            <button className="secondary" onClick={onEdit} aria-describedby={titleId}>
              Edit
            </button>
            {/* Destructive, so quiet and kept apart from Edit; it always asks before removing. */}
            <button className="quiet-danger" onClick={onRemove} aria-describedby={titleId}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.8 7v4M9.2 7v4" />
              </svg>
              Remove
            </button>
          </>
        ) : requested ? (
          <Link className="button secondary" href="/board/requests" aria-describedby={titleId}>
            Requested · view
          </Link>
        ) : (
          <button onClick={onBorrow} aria-describedby={titleId}>
            Choose dates
          </button>
        )}
        {!tool.mine && (
          <Link className="button secondary" href={`/board/messages?tool=${tool._id}`} aria-describedby={titleId}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
              <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
            </svg>
            Ask the owner
          </Link>
        )}
      </div>
    </li>
  );
}
