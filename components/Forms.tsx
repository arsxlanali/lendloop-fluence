"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { categories, LIMITS } from "../lib/policy";
import { useRunner, useToday } from "./hooks";
import { Modal } from "./ui";
import { formatRange } from "./format";
import { RangeCalendar, type Selection } from "./RangeCalendar";

type Editable = {
  _id: Id<"tools">;
  name: string;
  category: string;
  condition: string;
  description: string;
};

function FormError({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : null;
}

export function ToolFormDialog({ editing, onClose }: { editing: Editable | null; onClose: () => void }) {
  const save = useMutation(api.tools.saveTool);
  const { busy, error, run } = useRunner();
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "List a tool"}
      description="Everyone signed in can read this listing."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await run(
            "save",
            () =>
              save({
                ...(editing ? { id: editing._id } : {}),
                name: String(f.get("name")),
                category: String(f.get("category")),
                condition: String(f.get("condition")),
                description: String(f.get("description")),
              }),
            editing ? "Listing updated." : "Listing published.",
          );
          if (ok) onClose();
        }}
      >
        <FormError error={error} />
        <label>
          <span className="label-text">
            Tool name <span className="required">(required)</span>
          </span>
          <input name="name" required maxLength={LIMITS.nameLength} defaultValue={editing?.name} autoComplete="off" />
        </label>
        <div className="form-row">
          <label>
            Category
            <select name="category" defaultValue={editing?.category ?? categories[0]}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-text">
              Condition <span className="required">(required)</span>
            </span>
            <input
              name="condition"
              required
              maxLength={LIMITS.conditionLength}
              defaultValue={editing?.condition}
              placeholder="Good, gently used"
            />
          </label>
        </div>
        <label>
          Short description
          <textarea
            name="description"
            maxLength={LIMITS.descriptionLength}
            defaultValue={editing?.description}
            placeholder="What's included, anything to know before borrowing"
            aria-describedby="description-hint"
          />
        </label>
        <p className="hint" id="description-hint">
          Keep addresses and phone numbers out of it. You can share hand-over details privately when
          you approve a request.
        </p>
        <div className="actions end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy !== null}>{busy ? "Saving…" : editing ? "Save changes" : "Publish listing"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function BorrowDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string };
  onClose: () => void;
}) {
  const request = useMutation(api.loans.requestLoan);
  const today = useToday();
  const booked = useQuery(api.tools.bookings, { toolId: tool._id, today });
  const [dates, setDates] = useState<Selection>({ start: null, end: null });
  const [note, setNote] = useState("");
  const { busy, error, run } = useRunner();
  return (
    <Modal
      title={`Borrow the ${tool.name}`}
      description="Pick your dates. Booked days can't be chosen. The owner sees your name and your message."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!dates.start) return;
          const ok = await run(
            "request",
            () =>
              request({ toolId: tool._id, start: dates.start!, end: dates.end ?? dates.start!, today, note }),
            `Request sent for the ${tool.name}. You'll find the answer in My requests.`,
          );
          if (ok) onClose();
        }}
      >
        <FormError error={error} />
        {booked === undefined ? (
          <p className="calendar-loading" role="status">
            Checking availability…
          </p>
        ) : (
          <>
            {booked.length > 0 && (
              <p className="booked-note">
                <strong>Already booked:</strong> {booked.map((b) => formatRange(b.start, b.end)).join(", ")}
              </p>
            )}
            <RangeCalendar
              today={today}
              booked={booked}
              maxDays={LIMITS.maxLoanDays}
              maxAhead={LIMITS.maxDaysAhead}
              value={dates}
              onChange={setDates}
              autoFocus
            />
          </>
        )}
        <label>
          Message to the owner (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={LIMITS.noteLength}
            placeholder="What it's for, when you could pick it up"
          />
        </label>
        <p className="hint">Your email stays private. Loans last up to {LIMITS.maxLoanDays} days.</p>
        <div className="actions end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy !== null || !dates.start}>{busy ? "Sending…" : "Send request"}</button>
        </div>
      </form>
    </Modal>
  );
}
