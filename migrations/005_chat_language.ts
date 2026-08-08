import type { Migration } from "./types.js";

export const _005ChatLanguage: Migration = {
  name: "005_chat_language",
  migrate: (db) => {
    db.exec(`
      create table if not exists chat_language (
        chat_id integer primary key,
        language text not null check (language in ('en', 'ua', 'ru'))
      )
    `);
  },
};