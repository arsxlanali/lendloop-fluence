"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import { Header } from "../components/Header";
import { useToday } from "../components/hooks";
import { CategoryChip } from "../components/bits";
import credits from "../public/photos/credits.json";

type PageInfo = { count: number; next: number | null };

// Open-collection photographs: they show the world of shared tools, never a neighbor's own item.
const SHARED = [
  { src: "/photos/20060513-toolbox.jpg", alt: "An open toolbox with pliers, a hammer, a saw and screwdrivers", title: "Hand tools", line: "The kit you need once a year, not once a week." },
  { src: "/photos/viking-lawn-mower.jpg", alt: "A push lawn mower standing on a lawn", title: "Garden", line: "Mowers, trimmers and spades for a weekend's work." },
  { src: "/photos/zagedan-ridge-camping-tent-caucasus-mountains.jpg", alt: "A small tent pitched in a mountain meadow", title: "Camping", line: "Tents and stoves for the trip you take every other summer." },
];

// Content rises into place as it scrolls in: transform and opacity only, never hidden without
// scripts (the class is added by script) and still with reduced motion.
function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    const watch = () => document.querySelectorAll("[data-reveal]:not(.in)").forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);
}

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
    <li className="tile" key={i} data-reveal style={{ "--i": i % 6 } as React.CSSProperties}>
      <CategoryChip category={t.category} />
      <h3>{t.name}</h3>
    </li>
  ));
}

function FreeToday() {
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
    setPages((prev) => (prev[i]?.count === info.count && prev[i]?.next === info.next ? prev : { ...prev, [i]: info }));
  return (
    <section aria-labelledby="free-today" className="container free">
      <div className="free-head">
        <h2 id="free-today">Free to borrow today</h2>
        {total > 0 && (
          <p>
            {total}
            {last?.next !== null ? "+" : ""} tools on the board right now. Sign in to see when each one is free.
          </p>
        )}
      </div>
      <ul className="tiles" aria-busy={!pages[0]}>
        {cursors.map((before, i) => (
          <PublicPage key={`${today}:${i}`} today={today} before={before} onLoaded={loaded(i)} />
        ))}
      </ul>
      {last && last.next === null && total === 0 && <p className="empty">Nothing free right now. Be the first neighbor to lend something.</p>}
      {last && last.count > 0 && last.next !== null && (
        <div className="load-more">
          <button className="secondary" onClick={() => setCursors((c) => [...c, last.next!])}>
            Show more tools
          </button>
        </div>
      )}
    </section>
  );
}

function Start() {
  return (
    <>
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
    </>
  );
}

export default function Home() {
  useReveal();
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1} className="home">
        <section className="container hero" aria-labelledby="hero-title">
          <div className="hero-text">
            <h1 id="hero-title" data-reveal>
              Your street&apos;s toolshed
            </h1>
            <p className="lead" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              Borrow what you need. Lend what you don&apos;t. Drills, ladders, tents and mixers from neighbors
              nearby, booked by the day and handed over at the door.
            </p>
            <div data-reveal style={{ "--i": 2 } as React.CSSProperties}>
              <Start />
            </div>
          </div>
          <figure className="hero-picture" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <Image
              src="/photos/garden-tools.jpg"
              alt="Spades, forks and rakes hanging on the stone wall of a garden shed"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 50vw"
            />
          </figure>
        </section>

        <section className="container share" aria-labelledby="share">
          <div className="share-head">
            <h2 id="share">What neighbors share</h2>
            <p>
              The things you use a few times a year. One drill on a street of forty houses is plenty, if
              everyone can borrow it.
            </p>
          </div>
          <ul className="share-grid">
            {SHARED.map((s, i) => (
              <li key={s.src} data-reveal style={{ "--i": i } as React.CSSProperties}>
                <figure>
                  <div className="share-picture">
                    <Image src={s.src} alt={s.alt} fill sizes="(max-width: 700px) 100vw, 33vw" />
                  </div>
                  <figcaption>
                    <strong>{s.title}</strong>
                    {s.line}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>

        <section className="how" aria-labelledby="how">
          <div className="container how-inner">
            <h2 id="how">How lending works</h2>
            <ol>
              <li data-reveal>
                <strong>List what you can spare.</strong> A name, its condition, a line about it. Your address
                and email stay private.
              </li>
              <li data-reveal style={{ "--i": 1 } as React.CSSProperties}>
                <strong>Ask for the days you need.</strong> The calendar shows when it&apos;s free; add a note and
                send.
              </li>
              <li data-reveal style={{ "--i": 2 } as React.CSSProperties}>
                <strong>Hand it over, bring it back.</strong> Arrange pick-up in messages; the owner confirms
                the return.
              </li>
            </ol>
          </div>
        </section>

        <FreeToday />
      </main>
      <footer className="container site-footer">
        <p>Made for the neighborhood. Built on trust.</p>
        <p className="credits">
          Pictures:{" "}
          {credits.map((c, i) => (
            <span key={c.file}>
              <a href={c.page}>“{c.title}”</a> by {c.creator}, <a href={c.licenseUrl}>{c.license}</a>, via {c.via}
              {i < credits.length - 1 ? "; " : "."}
            </span>
          ))}
        </p>
        <p className="footer-name" aria-hidden="true">
          LendLoop
        </p>
      </footer>
    </>
  );
}
