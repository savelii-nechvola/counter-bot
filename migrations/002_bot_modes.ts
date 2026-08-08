import type { Migration } from "./types.js";

export const _002BotModes: Migration = {
  name: "002_bot_modes",
  migrate: (db) => {
    db.exec(`
      create table if not exists chat_mode (
        chat_id integer primary key,
        mode text not null check (mode in ('automode', 'manualmode'))
      )
    `);
  },
};