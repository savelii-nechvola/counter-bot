import type { DatabaseSync } from "node:sqlite";
import { _001Initial } from "./001_initial.js";

const migrations = [_001Initial];

export function migrateAll(db: DatabaseSync): void {
  console.log("Running migrations...");
  for (const [i, upMigration] of migrations.entries()) {
    console.log(`Running migration #${i + 1}: ${upMigration.name}`);
    upMigration(db);
  }
}
