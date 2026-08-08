import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync("db.db");

export type BotMode = "automode" | "manualmode";

const DEFAULT_BOT_MODE: BotMode = "manualmode";

export function transaction<T>(fn: () => T): T {
  db.exec("begin");
  try {
    const res = fn();
    db.exec("commit");
    return res;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}

type NewTag = {
  chatId: number;
  name: string;
};

export type Tag = {
  id: number;
  chatId: number;
  name: string;
};

export function getTagByChatIdAndName(
  chatId: number,
  name: string,
): Tag | null {
  return (db
    .prepare(`select id, chat_id, name from tag where chat_id = ? and name = ?`)
    .get(chatId, name) ?? null) as Tag | null;
}

export function createTag(input: NewTag): Tag {
  return db
    .prepare(`
      insert into tag (chat_id, name)
      values (?, ?)
      returning id, chat_id, name
    `)
    .get(input.chatId, input.name) as Tag;
}

export function listTags(chatId: number): Tag[] {
  return db
    .prepare(`select id, chat_id, name from tag where chat_id = ?`)
    .all(chatId) as Tag[];
}

export function updateTagByName(
  chatId: number,
  oldName: string,
  newName: string,
): Tag | null {
  return (db
    .prepare(`
      update tag set name = ?
      where chat_id = ? and name = ?
      returning id, chat_id, name`)
    .get(newName, chatId, oldName) ?? null) as Tag | null;
}

export function getBotModeByChatId(chatId: number): BotMode {
  const row = db
    .prepare(`select mode from chat_mode where chat_id = ?`)
    .get(chatId) as { mode: BotMode } | undefined;

  return row?.mode ?? DEFAULT_BOT_MODE;
}

export function setBotModeByChatId(chatId: number, mode: BotMode): BotMode {
  const updated = db
    .prepare(`
      insert into chat_mode (chat_id, mode)
      values (?, ?)
      on conflict(chat_id) do update set mode = excluded.mode
      returning mode
    `)
    .get(chatId, mode) as { mode: BotMode };

  return updated.mode;
}
