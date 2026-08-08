import type { Migration } from "./types.js";

export const _006Pseudonym: Migration = {
  name: "006_pseudonym",
  migrate: (db) => {
    db.exec(`
      create table telegram_user_new (
        user_id integer primary key,
        pseudonym text,
        pseudonym_normalized text unique
      )
    `);
    db.exec(`insert into telegram_user_new(user_id) select user_id from telegram_user`);
    db.exec(`drop table telegram_user`);
    db.exec(`alter table telegram_user_new rename to telegram_user`);
  },
};
