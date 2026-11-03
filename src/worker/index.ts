import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workerHeartbeat } from "@/lib/db/schema";
import { getCodeState } from "@/lib/git";
import { callModel } from "@/lib/llm/client";
import { markingLabFromEnv } from "@/lib/marking-lab/client";
import { Worker } from "./loop";

const HEARTBEAT_MS = 2000;
const STALE_MS = 10_000;
const TICK_MS = 500;

const db = getDb();

// Two workers would dispatch the same Calls and could send the same batch twice.
const other = db.select().from(workerHeartbeat).where(eq(workerHeartbeat.id, 1)).get();
if (other && other.pid !== process.pid && Date.now() - other.beatAt < STALE_MS) {
  console.error(`Another worker (pid ${other.pid}) is already running. Stop it first.`);
  process.exit(1);
}

function beat() {
  const row = { id: 1, pid: process.pid, beatAt: Date.now() };
  db.insert(workerHeartbeat).values(row).onConflictDoUpdate({ target: workerHeartbeat.id, set: row }).run();
}

beat();
setInterval(beat, HEARTBEAT_MS);

const worker = new Worker({ db, lab: markingLabFromEnv, caller: callModel, codeState: getCodeState });
worker.recover();
console.log("Worker started.");

setInterval(() => {
  try {
    worker.tick();
  } catch (err) {
    console.error(err);
  }
}, TICK_MS);
