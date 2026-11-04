"use client";
import Link from "next/link";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { Wordmark } from "./bits";

// Public site header: a skip link, the wordmark, and one action.
export function Header() {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="container bar">
        <Wordmark />
        <Authenticated>
          <div className="bar-end">
            <Link className="button secondary" href="/board">
              Open your board
            </Link>
            <UserButton />
          </div>
        </Authenticated>
        <Unauthenticated>
          <SignInButton mode="modal" forceRedirectUrl="/board">
            <button className="secondary">Sign in</button>
          </SignInButton>
        </Unauthenticated>
      </div>
    </header>
  );
}
