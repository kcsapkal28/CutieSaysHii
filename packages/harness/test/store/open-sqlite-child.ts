// Child process for the concurrent-open test: waits for a shared start time, then opens the db.
import { openSqlite } from "../../src/adapters/sqlite/db.ts";

const [path, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) {
  // Spin so all children hit the fresh file at the same moment.
}
const sqlite = await openSqlite(path!);
const row = sqlite.raw.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get();
sqlite.close();
process.stdout.write(JSON.stringify(row));
