export const categories = [
  "Power tools",
  "Garden",
  "Kitchen",
  "Camping",
  "Other",
];
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function overlaps(a: string, b: string, c: string, d: string) {
  return a <= d && c <= b;
}
export function validateDates(
  start: string,
  end: string,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!validDate(start) || !validDate(end) || start > end || start < today)
    throw new Error("Choose a valid future date range");
  if (Date.parse(end) - Date.parse(start) > 90 * 86400000)
    throw new Error("Maximum loan length is 90 days");
}
