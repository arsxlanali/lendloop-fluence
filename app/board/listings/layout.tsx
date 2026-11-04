import type { Metadata } from "next";

export const metadata: Metadata = { title: "My listings" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
