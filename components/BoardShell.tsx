"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { RedirectToSignIn } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import { Header } from "./Header";

function Nav() {
  const path = usePathname();
  const me = useQuery(api.users.me);
  const waiting = useQuery(api.loans.needsAnswer);
  const unread = useQuery(api.messages.unreadCounts);
  const active = useRef<HTMLAnchorElement>(null);
  const tabs = [
    { href: "/board", label: "Explore" },
    { href: "/board/listings", label: "My listings" },
    { href: "/board/requests", label: "My requests", count: unread?.requests },
    { href: "/board/incoming", label: "Incoming", count: (waiting?.length ?? 0) + (unread?.incoming ?? 0) },
    ...(me?.admin ? [{ href: "/board/admin", label: "Admin" }] : []),
  ];
  // On narrow screens the tab bar scrolls: keep the current tab in view.
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  return (
    <nav aria-label="Board" className="container tabs">
      <ul>
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              ref={path === t.href ? active : undefined}
              href={t.href}
              className={path === t.href ? "tab active" : "tab"}
              aria-current={path === t.href ? "page" : undefined}
            >
              {t.label}
              {t.count ? (
                <span className="count">
                  {t.count}
                  <span className="visually-hidden"> need your attention</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Keeps the name other participants see in step with the Clerk account.
function SyncProfile() {
  const sync = useMutation(api.users.syncProfile);
  useEffect(() => {
    void sync();
  }, [sync]);
  return null;
}

export function BoardShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header>
        <Authenticated>
          <Nav />
        </Authenticated>
      </Header>
      <main id="main" tabIndex={-1} className="container">
        <AuthLoading>
          <p className="empty" role="status">
            Connecting securely…
          </p>
        </AuthLoading>
        <Unauthenticated>
          <RedirectToSignIn />
        </Unauthenticated>
        <Authenticated>
          <SyncProfile />
          {children}
        </Authenticated>
      </main>
    </>
  );
}
