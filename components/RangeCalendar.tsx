"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { addDays, daysBetween, overlaps } from "../lib/policy";
import { formatDay, formatRange } from "./format";

type Range = { start: string; end: string };
export type Selection = { start: string | null; end: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const monthStart = (day: string) => day.slice(0, 8) + "01";
const addMonths = (day: string, n: number) => {
  const [y, m] = parts(day);
  const d = new Date(y, m - 1 + n, 1);
  return iso(d.getFullYear(), d.getMonth(), 1);
};
const asDate = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d);
};

function firstWeekday() {
  // 0 = Sunday … 6 = Saturday, from the user's locale where the browser knows it.
  try {
    const info = (new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } });
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;
    return first % 7;
  } catch {
    return 1;
  }
}

// Two months side by side, one on narrow screens (rendered, not just hidden, so keyboard focus
// never lands in a month you can't see).
function useMonthCount() {
  const [count, setCount] = useState(2);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 560px)");
    const update = () => setCount(narrow.matches ? 1 : 2);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);
  return count;
}

// Date range picker that shows availability. Booked days, past days and days the rules don't
// allow can't be chosen; once a start is picked, the end can't run past the next booking.
// Keyboard: arrows move a day or a week, Page Up/Down a month, Home/End the week, Enter picks.
export function RangeCalendar({
  today,
  booked,
  maxDays,
  maxAhead,
  value,
  onChange,
  autoFocus = false,
}: {
  autoFocus?: boolean;
  today: string;
  booked: Range[];
  maxDays: number;
  maxAhead: number;
  value: Selection;
  onChange: (value: Selection) => void;
}) {
  const id = useId();
  const lastDay = addDays(today, maxAhead);
  const [view, setView] = useState(monthStart(value.start ?? today));
  const [focus, setFocus] = useState(value.start ?? today);
  const [hover, setHover] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const weekStart = useMemo(firstWeekday, []);
  const months = useMonthCount();
  const isBooked = (day: string) => booked.some((b) => b.start <= day && day <= b.end);

  function disabled(day: string) {
    if (day < today || day > lastDay || isBooked(day)) return true;
    const { start, end } = value;
    if (start && !end && day > start)
      return daysBetween(start, day) + 1 > maxDays || booked.some((b) => overlaps(start, day, b.start, b.end));
    return false;
  }

  function pick(day: string) {
    if (disabled(day)) return;
    const { start, end } = value;
    if (!start || end || day < start) onChange({ start: day, end: null });
    else onChange({ start, end: day });
  }

  // Start keyboard users on the calendar when it appears in a dialog.
  useEffect(() => {
    if (autoFocus) grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [autoFocus]);

  // Keep keyboard focus on the focused day after it moves (and show its month).
  useEffect(() => {
    if (focus < view || focus >= addMonths(view, months)) setView(monthStart(focus));
    if (moved.current) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, view, months]);

  function onKey(e: React.KeyboardEvent) {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1).slice(0, 8) + focus.slice(8),
      PageDown: () => addMonths(focus, 1).slice(0, 8) + focus.slice(8),
      Home: () => addDays(focus, -((asDate(focus).getDay() - weekStart + 7) % 7)),
      End: () => addDays(focus, 6 - ((asDate(focus).getDay() - weekStart + 7) % 7)),
    };
    if (step[e.key]) {
      e.preventDefault();
      let next = step[e.key]();
      if (next.slice(8) !== focus.slice(8) && (e.key === "PageUp" || e.key === "PageDown")) {
        // 31st -> a shorter month: stay inside it.
        while (asDate(next).getDate() !== Number(next.slice(8))) next = addDays(next, -1);
      }
      moved.current = true;
      setFocus(next < today ? today : next > lastDay ? lastDay : next);
    }
  }

  const { start, end } = value;
  const previewEnd = start && !end && hover && hover >= start && !disabled(hover) ? hover : end;
  const status = (day: string) => {
    const labels: string[] = [];
    if (day === today) labels.push("today");
    if (isBooked(day)) labels.push("booked");
    else if (day < today || day > lastDay) labels.push("not available");
    else if (disabled(day)) labels.push("not available with this start date");
    if (day === start) labels.push("start of your dates");
    if (day === end) labels.push("end of your dates");
    return labels.join(", ");
  };

  function month(first: string, index: number) {
    const [y, m] = parts(first);
    const lead = (new Date(y, m - 1, 1).getDay() - weekStart + 7) % 7;
    const days = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(y, m - 1, i + 1))];
    while (cells.length % 7) cells.push(null);
    const titleId = `${id}-m${index}`;
    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 7 + ((weekStart + i) % 7)).toLocaleDateString(undefined, { weekday: "short" }),
    );
    return (
      <div className={index ? "cal-month second" : "cal-month"} key={first}>
        <h3 id={titleId} className="cal-title">
          {new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h3>
        <table role="grid" aria-labelledby={titleId}>
          <thead>
            <tr>
              {weekdays.map((w) => (
                <th key={w} scope="col" abbr={w}>
                  {w.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, row) => (
              <tr key={row}>
                {cells.slice(row * 7, row * 7 + 7).map((day, i) => {
                  if (!day) return <td key={i} />;
                  const off = disabled(day);
                  const inRange = start && previewEnd && day >= start && day <= previewEnd;
                  const cls = [
                    "day",
                    isBooked(day) && "booked",
                    off && "off",
                    inRange && "in-range",
                    day === start && "edge",
                    day === previewEnd && "edge",
                    day === today && "today",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={day} role="gridcell" aria-selected={Boolean(inRange)}>
                      <button
                        type="button"
                        data-day={day}
                        className={cls}
                        tabIndex={day === focus ? 0 : -1}
                        aria-disabled={off}
                        aria-label={`${asDate(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${status(day) ? `, ${status(day)}` : ""}`}
                        onClick={() => {
                          setFocus(day);
                          pick(day);
                        }}
                        onMouseEnter={() => setHover(day)}
                        onMouseLeave={() => setHover(null)}
                      >
                        {Number(day.slice(8))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const nights = start ? daysBetween(start, end ?? start) + 1 : 0;
  return (
    <div className="calendar">
      <div className="cal-nav">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous month"
          disabled={view <= monthStart(today)}
          onClick={() => {
            const to = addMonths(view, -1);
            setView(to);
            setFocus(to < today ? today : to);
          }}
        >
          ‹
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          disabled={addMonths(view, 1) > monthStart(lastDay)}
          onClick={() => {
            const to = addMonths(view, 1);
            setView(to);
            setFocus(to);
          }}
        >
          ›
        </button>
      </div>
      <div className="cal-months" ref={grid} onKeyDown={onKey}>
        {month(view, 0)}
        {months === 2 && month(addMonths(view, 1), 1)}
      </div>
      <ul className="cal-legend" aria-hidden="true">
        <li>
          <span className="swatch free" /> Free
        </li>
        <li>
          <span className="swatch booked" /> Booked
        </li>
        <li>
          <span className="swatch picked" /> Your dates
        </li>
      </ul>
      <p className="cal-summary" aria-live="polite">
        {!start
          ? "Choose the first day you need it."
          : !end
            ? `${formatDay(start)}, 1 day. Choose a last day to borrow it longer, or send now.`
            : `${formatRange(start, end)} · ${nights} day${nights === 1 ? "" : "s"}`}
        {start && (
          <button type="button" className="text-button" onClick={() => onChange({ start: null, end: null })}>
            Clear
          </button>
        )}
      </p>
    </div>
  );
}
