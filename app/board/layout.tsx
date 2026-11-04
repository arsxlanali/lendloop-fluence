import type { Metadata } from "next";
import { BoardShell } from "../../components/BoardShell";

export const metadata: Metadata = { title: "Explore" };

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <BoardShell>{children}</BoardShell>;
}
