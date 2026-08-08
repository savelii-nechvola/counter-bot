import type { Migration } from "./types.js";

export const _003UserTagGambleCooldown: Migration = {
  name: "003_user_tag_gamble_cooldown",
  migrate: (db) => {
    const columns = db
      .prepare("pragma table_info(user_tag)")
      .all() as Array<{ name: string }>;
    const hasLastGambleAt = columns.some((column) => column.name === "last_gamble_at");
    if (hasLastGambleAt) {
      return;
    }

    db.exec("alter table user_tag add column last_gamble_at integer");
  },
};