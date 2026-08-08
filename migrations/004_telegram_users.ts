import type { Migration } from "./types.js";

export const _004TelegramUsers: Migration = {
  name: "004_telegram_users",
  migrate: (db) => {
    db.exec(`
      create table if not exists telegram_user (
        user_id integer primary key,
        username text,
        username_normalized text unique
      )
    `);
  },
};