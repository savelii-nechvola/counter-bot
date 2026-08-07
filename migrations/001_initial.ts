import type { Migration } from "./types.js";

export const _001Initial: Migration = {
  name: "001_initial",
  migrate: (db) => {
    db.exec(`
      create table tag (
        id integer primary key autoincrement,
        chat_id integer not null,
        name varchar(50) not null,
        unique (chat_id, name)
      )
    `);

    db.exec(`
      create table user_tag (
        id integer primary key autoincrement,
        user_id integer not null,
        tag_id integer not null,
        count integer not null default 0,
        unique (user_id, tag_id),
        foreign key (tag_id) references tag(id)
      )
    `);
  },
};
