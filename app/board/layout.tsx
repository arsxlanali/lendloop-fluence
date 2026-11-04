"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { RedirectToSignIn } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";
import { Header } from "../../components/Header";

function Nav() {
  const path = usePathname();
  const me = useQuery(api.users.me);
  const waiting = useQuery(api.loans.needsAnswer);
  const tabs = [
    { href: "/board", label: "Explore" },
    { href: "/board/listings", label: "My listings" },
    { href: "/board/requests", label: "My requests" },
    { href: "/board/incoming", label: "Incoming requests", count: waiting?.length },
    ...(me?.admin ? [{ href: "/board/admin", label: "Admin" }] : []),
  ];
  return (
    <nav aria-label="Board views">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={path === t.href ? "tab active" : "tab"}
          aria-current={path === t.href ? "page" : undefined}
        >
          {t.label}
          {t.count ? <span className="count">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

// Keeps the name and email other participants see in step with the Clerk account.
function SyncProfile() {
  const sync = useMutation(api.users.syncProfile);
  useEffect(() => {
    void sync();
  }, [sync]);
  return null;
}

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Header />
      <AuthLoading>
        <p className="empty">Connecting securely…</p>
      </AuthLoading>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
      <Authenticated>
        <SyncProfile />
        <Nav />
        {children}
      </Authenticated>
    </main>
  );
}
