"use client";
import Link from "next/link";
import { addDays } from "../lib/policy";
import { categoryClass, formatDay, formatRange, personHue } from "./format";

export function CategoryChip({ category }: { category: string }) {
  return <span className={`cat ${categoryClass(category)}`}>{category}</span>;
}

// A neighbor's initial on a pale tint of their own hue (identity, not data).
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ "--h": personHue(name), width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.45)) } as React.CSSProperties}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

// The next 14 days at a glance: free days pale, booked days in the data hue. The sentence under
// it says the same thing in words (and is what a screen reader hears).
export function AvailabilityStrip({
  today,
  booked,
  overdue,
  days = 14,
}: {
  today: string;
  booked: { start: string; end: string }[];
  overdue: boolean;
  days?: number;
}) {
  const cells = Array.from({ length: days }, (_, i) => addDays(today, i));
  const isBooked = (day: string) => overdue || booked.some((b) => b.start <= day && day <= b.end);
  const last = cells[cells.length - 1];
  const summary = overdue
    ? "Out until it's returned"
    : booked.length === 0
      ? "Free for the next 2 weeks"
      : `Booked ${booked.map((b) => formatRange(b.start < today ? today : b.start, b.end > last ? last : b.end)).join(", ")}`;
  return (
    <div className="strip">
      <div className="strip-cells" aria-hidden="true">
        {cells.map((day) => (
          <span key={day} className={isBooked(day) ? "strip-cell taken" : "strip-cell"} title={formatDay(day)} />
        ))}
      </div>
      <p className="strip-text">
        <span className="visually-hidden">Next 2 weeks: </span>
        {summary}
      </p>
    </div>
  );
}

const paths: Record<string, string> = {
  explore: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14",
  listings: "M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3v-5ZM2.5 5.5 8 8.5l5.5-3M8 8.5v5",
  requests: "M3 8h10M9 4l4 4-4 4",
  incoming: "M2.5 9.5h3l1 2h3l1-2h3M2.5 9.5 4 3.5h8l1.5 6v3h-11v-3Z",
  messages: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2v-7Z",
  admin: "M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4l5-2Z",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

// The mark: a loop, from the name. A thing goes out and comes back.
export function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="LendLoop home">
      <svg className="mark" aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4.2a6.8 6.8 0 1 1-6.4 4.5" stroke="currentColor" strokeWidth="2.6" />
        <path d="M2.6 4.4 4.6 8.9l4.5-1.6" stroke="currentColor" strokeWidth="2.6" />
      </svg>
      LendLoop
    </Link>
  );
}
