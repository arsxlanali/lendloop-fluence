"use client";
import Link from "next/link";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";

export function Header() {
  return (
    <header>
      <Link className="brand" href="/">
        LendLoop<span className="brand-dot">●</span>
      </Link>
      <Authenticated>
        <UserButton />
      </Authenticated>
      <Unauthenticated>
        <SignInButton mode="modal" forceRedirectUrl="/board">
          <button className="secondary">Sign in</button>
        </SignInButton>
      </Unauthenticated>
    </header>
  );
}
