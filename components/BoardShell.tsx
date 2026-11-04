"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { RedirectToSignIn, UserButton, useUser } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import { Icon, Wordmark } from "./bits";

type Item = { href: string; label: string; icon: Parameters<typeof Icon>[0]["name"]; count?: number; noun?: string };

// Destinations grouped by what people come to do. Counts only on queues that need action.
function useNav() {
  const me = useQuery(api.users.me);
  const waiting = useQuery(api.loans.needsAnswer);
  const unread = useQuery(api.messages.unreadTotal);
  const groups: { label: string; items: Item[] }[] = [
    {
      label: "Borrow",
      items: [
        { href: "/board", label: "Explore", icon: "explore" },
        { href: "/board/requests", label: "My requests", icon: "requests" },
      ],
    },
    {
      label: "Lend",
      items: [
        { href: "/board/listings", label: "My listings", icon: "listings" },
        { href: "/board/incoming", label: "Incoming", icon: "incoming", count: waiting?.length, noun: "waiting for your answer" },
      ],
    },
    {
      label: "Talk",
      items: [{ href: "/board/messages", label: "Messages", icon: "messages", count: unread, noun: "unread" }],
    },
  ];
  if (me?.admin) groups.push({ label: "Manage", items: [{ href: "/board/admin", label: "Admin", icon: "admin" }] });
  return groups;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const groups = useNav();
  return (
    <nav aria-label="Board" className="side-nav">
      {groups.map((g) => (
        <div key={g.label} className="nav-group">
          <p className="nav-label">{g.label}</p>
          <ul>
            {g.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="nav-item"
                  aria-current={path === item.href ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.count ? (
                    <span className="count">
                      {item.count}
                      <span className="visually-hidden"> {item.noun}</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Account() {
  const { user } = useUser();
  return (
    <div className="account">
      <UserButton />
      <span>{user?.firstName ?? "Your account"}</span>
    </div>
  );
}

// Phone: a 52px bar with the brand, the menu and the account; the menu opens a full-screen sheet.
function MobileBar() {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  useEffect(() => {
    const d = sheet.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="mobilebar">
      <Wordmark />
      <div className="mobilebar-end">
        <UserButton />
        <button type="button" className="icon-button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
      </div>
      <dialog ref={sheet} className="sheet" aria-label="Menu" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
        <div className="sheet-head">
          <Wordmark />
          <button type="button" className="icon-button" aria-label="Close menu" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <NavList onNavigate={() => setOpen(false)} />
      </dialog>
    </header>
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
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Authenticated>
        <aside className="sidebar">
          <Wordmark />
          <NavList />
          <Account />
        </aside>
        <MobileBar />
      </Authenticated>
      <main id="main" tabIndex={-1} className="canvas">
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
    </div>
  );
}
