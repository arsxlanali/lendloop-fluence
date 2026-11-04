const ACTIVITY: Record<string, string> = {
  requested: "Request sent",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Request cancelled",
  expired: "Expired: the dates passed",
  return_reported: "Borrower reported the return",
  return_disputed: "Owner says it isn't back yet",
  booking_cancelled: "Booking cancelled",
  returned: "Return confirmed",
  notification_sent: "Notification sent",
  notification_failed: "Notification failed",
  reminder_sent: "Overdue reminder sent",
  reminder_failed: "Overdue reminder failed",
};

export function activityLabel(kind: string, by: string) {
  const label = ACTIVITY[kind] ?? kind.replaceAll("_", " ");
  return by === "automation" || by === "system" ? label : `${label} by ${by}`;
}

export const isAutomation = (kind: string) =>
  kind.startsWith("notification_") || kind.startsWith("reminder_");

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(at: number, now = Date.now()) {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

const asDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const thisYear = new Date().getFullYear();
const dayFormat = (withYear: boolean) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });

// "Nov 8", or "Nov 8, 2027" outside the current year.
export function formatDay(day: string) {
  const date = asDate(day);
  return dayFormat(date.getFullYear() !== thisYear).format(date);
}

// "Nov 5 – 7", "Nov 30 – Dec 2", "Nov 5": the locale decides what to repeat.
export function formatRange(start: string, end: string) {
  const a = asDate(start);
  const b = asDate(end);
  const format = dayFormat(a.getFullYear() !== thisYear || b.getFullYear() !== thisYear);
  return start === end ? format.format(a) : format.formatRange(a, b);
}

export type Tone = "pending" | "upcoming" | "active" | "overdue" | "done";

// What a loan means today, for its status pill: label and colour (the label always carries
// the meaning; colour only repeats it).
export function loanState(
  loan: { status: string; start: string; end: string; returnReported: boolean },
  today: string,
): { label: string; tone: Tone } {
  switch (loan.status) {
    case "pending":
      return { label: "Waiting for answer", tone: "pending" };
    case "approved":
      if (loan.returnReported) return { label: "Return reported", tone: "pending" };
      if (loan.start > today) return { label: "Upcoming", tone: "upcoming" };
      if (loan.end < today) return { label: "Overdue", tone: "overdue" };
      return { label: "On loan", tone: "active" };
    case "returned":
      return { label: "Returned", tone: "done" };
    case "declined":
      return { label: "Declined", tone: "done" };
    case "cancelled":
      return { label: "Cancelled", tone: "done" };
    default:
      return { label: "Expired", tone: "done" };
  }
}

// A loan change as a line in a conversation: "Sam requested Nov 5 – 7", "You approved".
export function eventText(
  event: string,
  by: "me" | "them" | "system",
  otherName: string,
  dates: { start: string; end: string } | null,
) {
  const who = by === "me" ? "You" : by === "them" ? otherName : "";
  const range = dates ? ` ${formatRange(dates.start, dates.end)}` : "";
  switch (event) {
    case "requested":
      return `${who} requested${range}`;
    case "approved":
      return `${who} approved${range}`;
    case "declined":
      return `${who} declined the request`;
    case "cancelled":
      return `${who} cancelled the request`;
    case "expired":
      return `The request for${range} expired`;
    case "return_reported":
      return `${who} reported the return`;
    case "return_disputed":
      return `${who} said it isn't back yet`;
    case "returned":
      return `${who} confirmed the return`;
    case "booking_cancelled":
      return `${who} cancelled the booking for${range}`;
    default:
      return event.replaceAll("_", " ");
  }
}

export const STATUS: Record<string, string> = {
  pending: "Waiting for answer",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  returned: "Returned",
};

// Each category has its own pale tint with the dark of the same hue as ink (the screen's face).
const CATEGORY_CLASS: Record<string, string> = {
  "Power tools": "cat-power",
  Garden: "cat-garden",
  Kitchen: "cat-kitchen",
  Camping: "cat-camping",
  Other: "cat-other",
};
export const categoryClass = (category: string) => CATEGORY_CLASS[category] ?? "cat-other";

// A stable hue per person, so the same neighbor always has the same initial colour.
export function personHue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
