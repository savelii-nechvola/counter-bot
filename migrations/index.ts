import type { DatabaseSync } from "node:sqlite";
import { _001Initial } from "./001_initial.js";
import { _002BotModes } from "./002_bot_modes.js";
import { _003UserTagGambleCooldown } from "./003_user_tag_gamble_cooldown.js";
import type { Migration } from "./types.js";

const migrations: Migration[] = [_001Initial, _002BotModes, _003UserTagGambleCooldown];

export function migrateAll(db: DatabaseSync): void {
  createMigrationsTable(db);
  console.log("Running migrations...");
  for (const [i, migration] of migrations.entries()) {
    const isMigrated = !!db
      .prepare("select 1 from __migrations where name = ?")
      .get(migration.name);
    if (isMigrated) {
      continue;
    }

    console.log(`Running migration #${i + 1}: ${migration.name}`);
    db.exec("begin");
    try {
      db.prepare("insert into __migrations (name) values (?)").run(
        migration.name,
      );
      migration.migrate(db);
      db.exec("commit");
      console.log(`Migration #${i + 1} completed successfully.`);
    } catch (e) {
      db.exec("rollback");
      throw e;
    }
  }

  console.log("All migrations completed successfully.");
}

function createMigrationsTable(db: DatabaseSync): void {
  db.exec(`
    create table if not exists __migrations (
      name text primary key
    )
  `);
}
