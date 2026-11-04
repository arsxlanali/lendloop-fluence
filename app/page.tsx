"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import { Header } from "../components/Header";
import { useToday } from "../components/hooks";
import { Skeletons } from "../components/ui";

type PageInfo = { count: number; next: number | null };

function PublicPage({
  today,
  before,
  onLoaded,
}: {
  today: string;
  before: number | undefined;
  onLoaded: (info: PageInfo) => void;
}) {
  const data = useQuery(api.tools.publicTools, { today, before });
  useEffect(() => {
    if (data) onLoaded({ count: data.tools.length, next: data.next });
  }, [data, onLoaded]);
  return data?.tools.map((t, i) => (
    // The public list deliberately carries no IDs, so position is the only key.
    <li className="card compact" key={i}>
      <p className="eyebrow">{t.category}</p>
      <h3>{t.name}</h3>
    </li>
  ));
}

function PublicBoard() {
  const today = useToday();
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const [pages, setPages] = useState<Record<number, PageInfo>>({});
  useEffect(() => {
    setCursors([undefined]);
    setPages({});
  }, [today]);
  const last = pages[cursors.length - 1];
  const total = Object.values(pages).reduce((n, p) => n + p.count, 0);
  // A page with no free tools but older ones behind it: keep looking without a click.
  useEffect(() => {
    if (last && last.count === 0 && last.next !== null) setCursors((c) => [...c, last.next!]);
  }, [last]);
  const loaded = (i: number) => (info: PageInfo) =>
    setPages((prev) =>
      prev[i]?.count === info.count && prev[i]?.next === info.next ? prev : { ...prev, [i]: info },
    );
  return (
    <section aria-labelledby="free-today" className="section">
      <div className="section-heading">
        <h2 id="free-today">Free to borrow today</h2>
        <span>{total > 0 ? `${total}${last?.next !== null ? "+" : ""} tools nearby` : ""}</span>
      </div>
      <ul className="grid compact" aria-busy={!pages[0]}>
        {!pages[0] && <Skeletons count={6} kind="card" />}
        {cursors.map((before, i) => (
          <PublicPage key={`${today}:${i}`} today={today} before={before} onLoaded={loaded(i)} />
        ))}
      </ul>
      {last && last.next === null && total === 0 && (
        <p className="empty">No tools free right now. Be the first neighbor to lend one.</p>
      )}
      {last && last.count > 0 && last.next !== null && (
        <div className="load-more">
          <button className="secondary" onClick={() => setCursors((c) => [...c, last.next!])}>
            Load more
          </button>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1} className="container">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Less stuff. More community.</p>
          <h1 id="hero-title">
            Borrow what you need.
            <br />
            <em>Lend what you don&apos;t.</em>
          </h1>
          <p className="lede">The drill for one shelf. A tent for one weekend. Share the things that make life happen.</p>
          <Unauthenticated>
            <SignInButton mode="modal" forceRedirectUrl="/board">
              <button className="cta">Sign in to lend or borrow</button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <Link className="button cta" href="/board">
              Open your board
            </Link>
          </Authenticated>
        </section>
        <section aria-labelledby="how" className="section how">
          <h2 id="how" className="visually-hidden">
            How it works
          </h2>
          <ol>
            <li>
              <strong>List</strong> what you&apos;re happy to lend.
            </li>
            <li>
              <strong>Request</strong> dates for what you need, with a short note.
            </li>
            <li>
              <strong>Hand over</strong> once the owner approves, and return it on time.
            </li>
          </ol>
        </section>
        <PublicBoard />
      </main>
      <footer className="container">
        <p className="site-footer">Made for the neighborhood. Built on trust.</p>
      </footer>
    </>
  );
}
