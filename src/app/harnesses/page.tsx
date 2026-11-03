import Link from "next/link";
import { asc, max } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { harnesses, harnessVersions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default function HarnessesPage() {
  const db = getDb();
  const rows = db.select().from(harnesses).orderBy(asc(harnesses.name)).all();
  const latest = new Map(
    db
      .select({ harnessId: harnessVersions.harnessId, version: max(harnessVersions.version) })
      .from(harnessVersions)
      .groupBy(harnessVersions.harnessId)
      .all()
      .map((r) => [r.harnessId, r.version]),
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Harnesses</h1>
        <Link href="/harnesses/new" className={buttonVariants()}>New Harness</Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Latest version</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => (
            <TableRow key={h.id}>
              <TableCell><Link href={`/harnesses/${h.id}`} className="underline underline-offset-2">{h.name}</Link></TableCell>
              <TableCell>v{latest.get(h.id)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
