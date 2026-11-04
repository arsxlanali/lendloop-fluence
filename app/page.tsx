"use client";
import Link from "next/link";
import { Authenticated, Unauthenticated, usePaginatedQuery } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import { Header } from "../components/Header";
import { LoadMore } from "../components/LoanCard";
import { useToday } from "../components/hooks";

function PublicBoard() {
  const today = useToday();
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.publicTools,
    { today },
    { initialNumItems: 24 },
  );
  return (
    <section>
      <div className="section-heading">
        <h2>Around the neighborhood</h2>
        <span>Free to borrow today</span>
      </div>
      {status === "LoadingFirstPage" ? (
        <p className="empty">Loading tools…</p>
      ) : results.length ? (
        <div className="grid">
          {results.map((t, i) => (
            // The public list deliberately carries no IDs, so position is the only key.
            <article className="card" key={i}>
              <p className="eyebrow">{t.category}</p>
              <h3>{t.name}</h3>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">No tools free right now. Be the first neighbor to lend one.</p>
      )}
      <LoadMore status={status} loadMore={loadMore} />
    </section>
  );
}

export default function Home() {
  return (
    <main>
      <Header />
      <section className="hero">
        <p className="eyebrow">Less stuff. More community.</p>
        <h1>
          Borrow what you need.
          <br />
          <em>Lend what you don&apos;t.</em>
        </h1>
        <p>The drill for one shelf. A tent for one weekend. Share the things that make life happen.</p>
        <Unauthenticated>
          <SignInButton mode="modal" forceRedirectUrl="/board">
            <button>Sign in to lend or borrow</button>
          </SignInButton>
        </Unauthenticated>
        <Authenticated>
          <Link className="button" href="/board">
            Open your board
          </Link>
        </Authenticated>
      </section>
      <PublicBoard />
      <footer>Made for the neighborhood. Built on trust.</footer>
    </main>
  );
}
