import type { Migration } from "./types.js";

export const _007PseudonymLock: Migration = {
  name: "007_pseudonym_lock",
  migrate: (db) => {
    db.exec(`alter table telegram_user add column pseudonym_locked integer not null default 0`);
  },
};
