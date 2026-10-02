import { openDatabase } from "./connection";
import { config } from "../config";

const cmd = process.argv[2];
if (cmd === "migrate") {
  const db = openDatabase(config.dbFile);
  console.log(`migrated ${config.dbFile} → schema v${db.schemaVersion()}`);
  db.close();
} else {
  console.log("usage: tsx server/db/cli.ts migrate");
  process.exit(1);
}
