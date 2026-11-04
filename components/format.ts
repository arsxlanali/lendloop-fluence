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

export const STATUS: Record<string, string> = {
  pending: "Waiting for answer",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  returned: "Returned",
};
