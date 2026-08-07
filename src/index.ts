import { migrateAll } from "../migrations/index.js";
import { startBot } from "./bot.js";
import { db } from "./db.js";

function main(): void {
  migrateAll(db);
  startBot();
}

main();
