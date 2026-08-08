import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync("db.db");

export type BotMode = "adminmode" | "usermode";
export type BotLanguage = "eng" | "ukr" | "rus";

const DEFAULT_BOT_MODE: BotMode = "usermode";
const DEFAULT_BOT_LANGUAGE: BotLanguage = "eng";

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

type NewUserTag = {
  userId: number;
  tagId: number;
};

export type Tag = {
  id: number;
  chatId: number;
  name: string;
};

export type UserTag = {
  id: number;
  userId: number;
  tagId: number;
  count: number;
  lastGambleAt: number | null;
};

export type TelegramUser = {
  userId: number;
  pseudonym: string | null;
  pseudonymNormalized: string | null;
  pseudonymLocked: number;
};

export type UserTagState = {
  tagName: string;
  userId: number;
  count: number;
  pseudonym: string | null;
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

export function createUserTag(input: NewUserTag): UserTag {
  return db
    .prepare(`
      insert into user_tag (user_id, tag_id, count)
      values (?, ?, 0)
      returning id, user_id as userId, tag_id as tagId, count, last_gamble_at as lastGambleAt
    `)
    .get(input.userId, input.tagId) as UserTag;
}

export function getUserTagByUserIdAndTagId(
  userId: number,
  tagId: number,
): UserTag | null {
  return (db
    .prepare(`
      select id, user_id as userId, tag_id as tagId, count, last_gamble_at as lastGambleAt
      from user_tag
      where user_id = ? and tag_id = ?
    `)
    .get(userId, tagId) ?? null) as UserTag | null;
}

export function getUserTagByChatIdUserIdAndTagName(
  chatId: number,
  userId: number,
  tagName: string,
): UserTag | null {
  return (db
    .prepare(`
      select ut.id, ut.user_id as userId, ut.tag_id as tagId, ut.count, ut.last_gamble_at as lastGambleAt
      from user_tag ut
      join tag t on t.id = ut.tag_id
      where t.chat_id = ? and ut.user_id = ? and t.name = ?
    `)
    .get(chatId, userId, tagName) ?? null) as UserTag | null;
}

export function updateUserTagCountAndLastGambleAt(
  id: number,
  count: number,
  lastGambleAt: number,
): UserTag | null {
  return (db
    .prepare(`
      update user_tag
      set count = ?, last_gamble_at = ?
      where id = ?
      returning id, user_id as userId, tag_id as tagId, count, last_gamble_at as lastGambleAt
    `)
    .get(count, lastGambleAt, id) ?? null) as UserTag | null;
}

export function updateUserTagCount(id: number, count: number): UserTag | null {
  return (db
    .prepare(`
      update user_tag
      set count = ?
      where id = ?
      returning id, user_id as userId, tag_id as tagId, count, last_gamble_at as lastGambleAt
    `)
    .get(count, id) ?? null) as UserTag | null;
}

export function setUserPseudonym(
  userId: number,
  pseudonym: string,
  pseudonymNormalized: string,
): TelegramUser {
  return db
    .prepare(`
      insert into telegram_user (user_id, pseudonym, pseudonym_normalized)
      values (?, ?, ?)
      on conflict(user_id) do update set
        pseudonym = excluded.pseudonym,
        pseudonym_normalized = excluded.pseudonym_normalized
      returning user_id as userId, pseudonym, pseudonym_normalized as pseudonymNormalized, pseudonym_locked as pseudonymLocked
    `)
    .get(userId, pseudonym, pseudonymNormalized) as TelegramUser;
}

export function setUserPseudonymLocked(userId: number, locked: boolean): void {
  db.prepare(`update telegram_user set pseudonym_locked = ? where user_id = ?`).run(locked ? 1 : 0, userId);
}

export function getTelegramUserById(userId: number): TelegramUser | null {
  return (db
    .prepare(`
      select user_id as userId, pseudonym, pseudonym_normalized as pseudonymNormalized, pseudonym_locked as pseudonymLocked
      from telegram_user
      where user_id = ?
    `)
    .get(userId) ?? null) as TelegramUser | null;
}

export function getTelegramUserByPseudonymNormalized(
  pseudonymNormalized: string,
): TelegramUser | null {
  return (db
    .prepare(`
      select user_id as userId, pseudonym, pseudonym_normalized as pseudonymNormalized, pseudonym_locked as pseudonymLocked
      from telegram_user
      where pseudonym_normalized = ?
    `)
    .get(pseudonymNormalized) ?? null) as TelegramUser | null;
}

export function listUserTagStateByChatId(
  chatId: number,
  tagName?: string,
): UserTagState[] {
  if (tagName) {
    return db
      .prepare(`
        select
          t.name as tagName,
          ut.user_id as userId,
          ut.count,
          tu.pseudonym
        from user_tag ut
        join tag t on t.id = ut.tag_id
        left join telegram_user tu on tu.user_id = ut.user_id
        where t.chat_id = ? and t.name = ?
        order by t.name asc, ut.count desc, ut.user_id asc
      `)
      .all(chatId, tagName) as UserTagState[];
  }

  return db
    .prepare(`
      select
        t.name as tagName,
        ut.user_id as userId,
        ut.count,
        tu.pseudonym
      from user_tag ut
      join tag t on t.id = ut.tag_id
      left join telegram_user tu on tu.user_id = ut.user_id
      where t.chat_id = ?
      order by t.name asc, ut.count desc, ut.user_id asc
    `)
    .all(chatId) as UserTagState[];
}

export function listUserTagStateByChatIdAndUserId(
  chatId: number,
  userId: number,
): UserTagState[] {
  return db
    .prepare(`
      select
        t.name as tagName,
        ut.user_id as userId,
        ut.count,
        tu.pseudonym
      from user_tag ut
      join tag t on t.id = ut.tag_id
      left join telegram_user tu on tu.user_id = ut.user_id
      where t.chat_id = ? and ut.user_id = ?
      order by t.name asc
    `)
    .all(chatId, userId) as UserTagState[];
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

export function getBotLanguageByChatId(chatId: number): BotLanguage {
  const row = db
    .prepare(`select language from chat_language where chat_id = ?`)
    .get(chatId) as { language: BotLanguage } | undefined;

  return row?.language ?? DEFAULT_BOT_LANGUAGE;
}

export function setBotLanguageByChatId(
  chatId: number,
  language: BotLanguage,
): BotLanguage {
  const updated = db
    .prepare(`
      insert into chat_language (chat_id, language)
      values (?, ?)
      on conflict(chat_id) do update set language = excluded.language
      returning language
    `)
    .get(chatId, language) as { language: BotLanguage };

  return updated.language;
}
