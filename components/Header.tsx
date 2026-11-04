"use client";
import Link from "next/link";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";

// Site header: a skip link (first stop for keyboard users), the brand, sign-in or the account
// menu, and optionally the section navigation.
export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="container bar">
        <Link className="brand" href="/" aria-label="LendLoop home">
          LendLoop<span className="brand-dot" aria-hidden="true">●</span>
        </Link>
        <Authenticated>
          <UserButton />
        </Authenticated>
        <Unauthenticated>
          <SignInButton mode="modal" forceRedirectUrl="/board">
            <button className="secondary">Sign in</button>
          </SignInButton>
        </Unauthenticated>
      </div>
      {children}
    </header>
  );
}
