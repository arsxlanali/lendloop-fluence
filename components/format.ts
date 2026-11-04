const ACTIVITY: Record<string, string> = {
  requested: "Request sent",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Request cancelled",
  expired: "Expired: the dates passed",
  return_reported: "Borrower reported the return",
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

export function formatDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const STATUS: Record<string, string> = {
  pending: "Waiting for answer",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  returned: "Returned",
};
