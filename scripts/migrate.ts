import { getDb, migrateDb } from "../src/lib/db";
import { seedStarterHarnesses } from "../src/lib/harness/starters";

const db = getDb();
migrateDb(db);
seedStarterHarnesses(db);
