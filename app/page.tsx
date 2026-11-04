"use client";
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useMutation,
  useQuery,
} from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { categories } from "../lib/policy";
import { useState } from "react";
type Tool = {
  _id: Id<"tools">;
  name: string;
  category: string;
  condition: string;
  description: string;
  mine: boolean;
  trusted: boolean;
  available: boolean;
};
type Loan = {
  _id: Id<"loans">;
  toolId: Id<"tools">;
  name: string;
  start: string;
  end: string;
  status: string;
  incoming: boolean;
  mine: boolean;
  lastReminder?: string;
  activity: { kind: string; at: number }[];
};
function PublicBoard() {
  const tools = useQuery(api.board.publicTools) as
    | { name: string; category: string }[]
    | undefined;
  return (
    <section>
      <div className="section-heading">
        <h2>Around the neighborhood</h2>
        <span>Available to borrow</span>
      </div>
      <div className="grid">
        {tools === undefined ? (
          <p>Loading tools...</p>
        ) : tools.length ? (
          tools.map((t, i) => (
            <article className="card" key={i}>
              <p className="eyebrow">{t.category}</p>
              <h3>{t.name}</h3>
            </article>
          ))
        ) : (
          <p>No tools listed yet. Be the first neighbor to lend one.</p>
        )}
      </div>
    </section>
  );
}
export default function Page() {
  return (
    <main>
      <header>
        <a className="brand" href="/">
          LendLoop<span className="brand-dot">●</span>
        </a>
        <Authenticated>
          <UserButton />
        </Authenticated>
        <Unauthenticated>
          <SignInButton mode="modal">
            <button className="secondary">Join your neighbors ↗</button>
          </SignInButton>
        </Unauthenticated>
      </header>
      <section className="hero">
        <p className="eyebrow">LESS STUFF. MORE COMMUNITY.</p>
        <h1>
          Borrow what you need.
          <br />
          <em>Lend what you don’t.</em>
        </h1>
        <p>
          The drill for one shelf. A tent for one weekend. Share the things that
          make life happen.
        </p>
        <Unauthenticated>
          <SignInButton mode="modal">
            <button>Sign in to lend or borrow ↗</button>
          </SignInButton>
        </Unauthenticated>
      </section>
      <AuthLoading>
        <p>Connecting securely...</p>
      </AuthLoading>
      <Unauthenticated>
        <PublicBoard />
      </Unauthenticated>
      <Authenticated>
        <Dashboard />
      </Authenticated>
      <footer>Made for the neighborhood. Built on trust.</footer>
    </main>
  );
}
function Dashboard() {
  const data = useQuery(api.board.dashboard) as
    | { admin: boolean; tools: Tool[]; loans: Loan[] }
    | undefined;
  const save = useMutation(api.board.saveTool),
    remove = useMutation(api.board.removeTool),
    request = useMutation(api.board.requestLoan),
    decide = useMutation(api.board.decide),
    returned = useMutation(api.board.returned),
    trust = useMutation(api.board.trustOwner);
  const [tab, setTab] = useState("Explore"),
    [category, setCategory] = useState("All"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(false),
    [editing, setEditing] = useState<Tool | null>(null),
    [borrowing, setBorrowing] = useState<Tool | null>(null);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>Loading your neighborhood...</p>;
  const shown = data.tools.filter(
    (t) =>
      (category === "All" || t.category === category) &&
      (tab !== "My listings" || t.mine),
  );
  const loans = data.loans.filter(
    (l) =>
      tab === "Admin" ||
      (tab === "My requests" && l.mine) ||
      (tab === "Incoming requests" && l.incoming),
  );
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR SHARED TOOLSHED</p>
          <h2>Good things, closer to home.</h2>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setForm(true);
          }}
        >
          + List a tool
        </button>
      </div>
      <nav aria-label="Board views">
        {[
          "Explore",
          "My listings",
          "My requests",
          "Incoming requests",
          ...(data.admin ? ["Admin"] : []),
        ].map((t) => (
          <button
            className={tab === t ? "tab active" : "tab"}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {form && (
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await run(() =>
                save({
                  ...(editing ? { id: editing._id } : {}),
                  name: String(f.get("name")),
                  category: String(f.get("category")),
                  condition: String(f.get("condition")),
                  description: String(f.get("description")),
                }),
              )
            )
              setForm(false);
          }}
        >
          <h3>{editing ? "Edit your listing" : "What can you share?"}</h3>
          <label>
            Tool name
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={editing?.name}
            />
          </label>
          <div className="form-row">
            <label>
              Category
              <select name="category" defaultValue={editing?.category}>
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
                maxLength={100}
                defaultValue={editing?.condition}
                placeholder="Good, gently used"
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              maxLength={1000}
              defaultValue={editing?.description}
            />
          </label>
          <div className="actions">
            <button disabled={busy}>Save listing</button>
            <button
              type="button"
              className="secondary"
              onClick={() => setForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {borrowing && (
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await run(() =>
                request({
                  toolId: borrowing._id,
                  start: String(f.get("start")),
                  end: String(f.get("end")),
                }),
              )
            )
              setBorrowing(null);
          }}
        >
          <h3>Borrow {borrowing.name}</h3>
          <div className="form-row">
            <label>
              From
              <input
                name="start"
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label>
              Through
              <input
                name="end"
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
              />
            </label>
          </div>
          <p>Your neighbor confirms the dates. Loans can be up to 90 days.</p>
          <div className="actions">
            <button disabled={busy}>Request to borrow</button>
            <button
              type="button"
              className="secondary"
              onClick={() => setBorrowing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {tab === "Explore" || tab === "My listings" ? (
        <>
          <label className="filter">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {["All", ...categories].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="grid">
            {shown.map((t) => (
              <article className="card" key={t._id}>
                <div className="card-top">
                  <span className="eyebrow">{t.category}</span>
                  <span className={t.available ? "badge" : "badge muted"}>
                    {t.available ? "Available" : "Booked"}
                  </span>
                </div>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <small>
                  {t.condition}
                  {t.trusted ? " · Trusted Lender" : ""}
                </small>
                <div className="actions">
                  {t.mine ? (
                    <>
                      <button
                        className="secondary"
                        onClick={() => {
                          setEditing(t);
                          setForm(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Retire this listing and decline its pending requests?",
                            )
                          )
                            void run(() => remove({ id: t._id }));
                        }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button disabled={busy} onClick={() => setBorrowing(t)}>
                      Choose dates ↗
                    </button>
                  )}
                  {data.admin && !t.mine && (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Remove this listing?"))
                            void run(() => remove({ id: t._id }));
                        }}
                      >
                        Remove
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            trust({ toolId: t._id, trusted: !t.trusted }),
                          )
                        }
                      >
                        {t.trusted ? "Untrust" : "Trust lender"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!shown.length && (
            <p className="empty">
              Nothing here yet. Your next good find could start with a listing.
            </p>
          )}
        </>
      ) : (
        <div className="loans">
          {!loans.length && <p className="empty">No requests here yet.</p>}
          {loans.map((l) => (
            <article className="loan" key={l._id}>
              <div>
                <span className="eyebrow">{l.status}</span>
                <h3>{l.name}</h3>
                <p>
                  {l.start} → {l.end}
                </p>
                {l.lastReminder && (
                  <small>Reminder logged {l.lastReminder}</small>
                )}
                <details>
                  <summary>Recent activity</summary>
                  {l.activity.map((a, i) => (
                    <p key={i}>
                      {a.kind.replaceAll("_", " ")} ·{" "}
                      {new Date(a.at).toLocaleString()}
                    </p>
                  ))}
                </details>
              </div>
              <div className="actions">
                {l.incoming && l.status === "pending" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() => decide({ id: l._id, approve: true }))
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(() => decide({ id: l._id, approve: false }))
                      }
                    >
                      Decline
                    </button>
                  </>
                )}
                {(l.mine || l.incoming) && l.status === "approved" && (
                  <button
                    disabled={busy}
                    onClick={() => void run(() => returned({ id: l._id }))}
                  >
                    Mark returned
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
