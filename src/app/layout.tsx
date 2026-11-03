import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workerHeartbeat } from "@/lib/db/schema";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Client Test Lab",
  description: "Test how well LLM Models mark exam Answers.",
};

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/experiments", label: "Experiments" },
  { href: "/compare", label: "Compare" },
  { href: "/harnesses", label: "Harnesses" },
  { href: "/connections", label: "Connections" },
];

function setupProblems(): string[] {
  const problems: string[] = [];
  if (!process.env.MARKING_LAB_URL || !process.env.MARKING_LAB_KEY) {
    problems.push("MARKING_LAB_URL and MARKING_LAB_KEY aren't set. Add them to .env.local, then restart.");
  }
  try {
    const beat = getDb().select().from(workerHeartbeat).where(eq(workerHeartbeat.id, 1)).get();
    if (!beat || Date.now() - beat.beatAt > 10_000) {
      problems.push("The worker isn't running, so Experiments won't progress. Start the app with npm run dev.");
    }
  } catch {
    problems.push("The database isn't ready. Run npm run db:migrate.");
  }
  return problems;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
            <Link href="/experiments" className="font-semibold">LLM Client Test Lab</Link>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-muted-foreground hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        {setupProblems().map((problem) => (
          <p key={problem} role="alert" className="border-b border-border bg-muted px-4 py-2 text-center text-sm">
            {problem}
          </p>
        ))}
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
