"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { categories, LIMITS, addDays } from "../lib/policy";
import { useRunner, useToday } from "./hooks";

type Editable = {
  _id: Id<"tools">;
  name: string;
  category: string;
  condition: string;
  description: string;
};

export function ToolForm({ editing, onDone }: { editing: Editable | null; onDone: () => void }) {
  const save = useMutation(api.tools.saveTool);
  const { busy, error, run } = useRunner();
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await run("save", () =>
          save({
            ...(editing ? { id: editing._id } : {}),
            name: String(f.get("name")),
            category: String(f.get("category")),
            condition: String(f.get("condition")),
            description: String(f.get("description")),
          }),
        );
        if (ok) onDone();
      }}
    >
      <h3>{editing ? "Edit your listing" : "What can you share?"}</h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        Tool name
        <input name="name" required maxLength={LIMITS.nameLength} defaultValue={editing?.name} />
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
          Condition
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
        />
      </label>
      <p className="hint">Don't include your address or phone number: borrowers see your name and email once you approve them.</p>
      <div className="actions">
        <button disabled={busy !== null}>{busy ? "Saving…" : "Save listing"}</button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BorrowForm({
  tool,
  onDone,
}: {
  tool: { _id: Id<"tools">; name: string };
  onDone: (sent: boolean) => void;
}) {
  const request = useMutation(api.loans.requestLoan);
  const today = useToday();
  const [start, setStart] = useState(today);
  const { busy, error, run } = useRunner();
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await run("request", () =>
          request({ toolId: tool._id, start: String(f.get("start")), end: String(f.get("end")), today }),
        );
        if (ok) onDone(true);
      }}
    >
      <h3>Borrow {tool.name}</h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-row">
        <label>
          From
          <input
            name="start"
            type="date"
            required
            min={today}
            max={addDays(today, LIMITS.maxDaysAhead)}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            name="end"
            type="date"
            required
            min={start || today}
            max={addDays(start || today, LIMITS.maxLoanDays - 1)}
          />
        </label>
      </div>
      <p className="hint">
        The owner confirms the dates. Loans last up to {LIMITS.maxLoanDays} days, both days included.
      </p>
      <div className="actions">
        <button disabled={busy !== null}>{busy ? "Sending…" : "Request to borrow"}</button>
        <button type="button" className="secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
