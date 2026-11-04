import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { DM_Sans, Manrope } from "next/font/google";
import { Providers } from "./providers";
import "./style.css";

// Self-hosted at build time: visitors' browsers never contact Google.
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const display = Manrope({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: "LendLoop · Borrow what you need. Lend what you don't.", template: "%s · LendLoop" },
  description: "A neighborhood tool-lending board.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const configured =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.NEXT_PUBLIC_CONVEX_URL;
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        {configured ? (
          <ClerkProvider>
            <Providers>{children}</Providers>
          </ClerkProvider>
        ) : (
          <main className="container setup">
            <p className="eyebrow">LendLoop · setup needed</p>
            <h1>
              Good neighbors.
              <br />
              Great tools.
            </h1>
            <p>
              Set the Clerk and Convex variables from <code>.env.example</code> to connect the board.
              The README walks through it.
            </p>
          </main>
        )}
      </body>
    </html>
  );
}
