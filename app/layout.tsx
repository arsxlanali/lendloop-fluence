import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers";
import "./style.css";
export const metadata: Metadata = {
  title: "LendLoop | A little less buying. A lot more sharing.",
  description:
    "A neighborhood tool-lending board with secure, automated workflows.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const configured =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CONVEX_URL;
  return (
    <html lang="en">
      <body>
        {configured ? (
          <ClerkProvider>
            <Providers>{children}</Providers>
          </ClerkProvider>
        ) : (
          <main className="setup">
            <p className="eyebrow">LENDLOOP / DEVELOPMENT SETUP</p>
            <h1>
              Good neighbors.
              <br />
              Great tools.
            </h1>
            <p>
              Add your Clerk and Convex development configuration to connect the
              live board. This screen is not a simulated authenticated app.
            </p>
            <p>
              Follow the README for setup, environment variables and security
              checks.
            </p>
          </main>
        )}
      </body>
    </html>
  );
}
