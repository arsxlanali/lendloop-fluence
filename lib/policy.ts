import { ConvexError } from "convex/values";

export const categories = [
  "Power tools",
  "Garden",
  "Kitchen",
  "Camping",
  "Other",
] as const;

export const LIMITS = {
  nameLength: 100,
  conditionLength: 100,
  descriptionLength: 1000,
  noteLength: 500,
  // Abuse controls: one account cannot flood the board or a neighbor's inbox.
  activeListingsPerUser: 50,
  pendingRequestsPerBorrower: 10,
  maxLoanDays: 90,
  maxDaysAhead: 365,
};

const DAY = 86_400_000;

export function isDay(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}

export function utcToday(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number) {
  return new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

// Loan dates are calendar days in the user's own time zone. The client sends its local
// "today"; every real time zone is within a day of UTC, so anything further off is a bad clock.
export function checkClientToday(today: string, now = Date.now()) {
  if (!isDay(today) || Math.abs(daysBetween(utcToday(now), today)) > 1)
    throw new ConvexError("Your device's date looks wrong. Check it and try again.");
  return today;
}

// Both ends are inclusive: a loan ending on the 7th and one starting on the 7th overlap.
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function validateDates(start: string, end: string, today: string) {
  if (!isDay(start) || !isDay(end) || start > end || start < today)
    throw new ConvexError("Choose a valid date range that starts today or later.");
  if (daysBetween(start, end) + 1 > LIMITS.maxLoanDays)
    throw new ConvexError(`Loans can last at most ${LIMITS.maxLoanDays} days.`);
  if (daysBetween(today, start) > LIMITS.maxDaysAhead)
    throw new ConvexError("Requests can start at most a year ahead.");
}

export function cleanText(value: string, max: number, label: string, required = true) {
  const text = value.trim();
  if ((required && !text) || text.length > max)
    throw new ConvexError(
      required
        ? `${label} is required (at most ${max} characters).`
        : `${label} can be at most ${max} characters.`,
    );
  return text;
}
