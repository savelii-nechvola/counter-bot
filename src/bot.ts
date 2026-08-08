import { type Api, Bot, type Context, type PollingOptions } from "grammy";
import { readFileSync } from "node:fs";
import {
  type BotLanguage,
  type BotMode,
  createUserTag,
  getBotLanguageByChatId,
  createTag,
  getBotModeByChatId,
  getTagByChatIdAndName,
  getTelegramUserByUsernameNormalized,
  getUserTagByChatIdUserIdAndTagName,
  getUserTagByUserIdAndTagId,
  listUserTagStateByChatId,
  listUserTagStateByChatIdAndUserId,
  listTags,
  setBotLanguageByChatId,
  setBotModeByChatId,
  type Tag,
  transaction,
  updateUserTagCount,
  updateUserTagCountAndLastGambleAt,
  updateTagByName,
  upsertTelegramUser,
} from "./db.js";
import { envVars } from "./env.js";
import { err, ok, type Result } from "./utils.js";

type AppBot = Bot<Context, Api>;

const CHECK_MAX_PLAYERS_PER_TAG = 10;

type Texts = {
  welcome: string;
  usageStartPlay: string;
  usageGamble: string;
  usageModifyTag: string;
  usageCheckUser: string;
  usageSetMode: string;
  usageSetLang: string;
  tagNameTooLong: string;
  tagMissing: string;
  registeredForTag: string;
  notRegisteredForTag: string;
  canGambleAgainAtUtc: string;
  unableToUpdateTagValue: string;
  gambleResult: string;
  numberMustBePositiveInteger: string;
  unknownUsername: string;
  noTagForTarget: string;
  modifyResult: string;
  noPlayersForTag: string;
  noPlayersInGame: string;
  noGameTagsForUser: string;
  modeUpdatedTo: string;
  currentModeIs: string;
  tagAlreadyExists: string;
  usageNewTag: string;
  usageUpdateTag: string;
  sameTagSuccess: string;
  tagByNameNotExists: string;
  tagByNameAlreadyExists: string;
  invalidLanguage: string;
  languageUpdatedTo: string;
  morePlayers: string;
};

const TEXTS = loadTexts();

function loadTexts(): Record<BotLanguage, Texts> {
  try {
    return JSON.parse(
      readFileSync(new URL("./texts.json", import.meta.url), "utf8"),
    ) as Record<BotLanguage, Texts>;
  } catch {
    // In production, transpiled files are in dist/src while texts.json remains in src.
    return JSON.parse(
      readFileSync(new URL("../../src/texts.json", import.meta.url), "utf8"),
    ) as Record<BotLanguage, Texts>;
  }
}

export function startBot(options?: PollingOptions): void {
  const bot = new Bot(envVars.BOT_TOKEN);
  registerCommands(bot);
  bot.catch((error) =>
    console.error(
      error.message,
      error.error,
      error.name,
      error.cause,
      error.stack,
    ),
  );

  void bot.start(options);
}

function registerCommands(bot: AppBot): void {
  startCommand(bot);
  startPlayCommand(bot);
  gambleCommand(bot);
  addToUserTagCommand(bot);
  subtractFromUserTagCommand(bot);
  checkCommand(bot);
  checkUserCommand(bot);
  setLanguageCommand(bot);
  setModeCommand(bot);
  getModeCommand(bot);
  echoCommand(bot);
  randomizeTagCommand(bot);
  listCommand(bot);
  createTagCommand(bot);
  updateTagCommand(bot);
  automodeMessageHandler(bot);
}

function startCommand(bot: AppBot): void {
  bot.command("start", (ctx) => {
    const texts = getTexts(ctx.chatId);
    return ctx.reply(texts.welcome);
  });
}

function startPlayCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("startplay", async (ctx) => {
    const tagName = (ctx.message.text.split(" ")[1] ?? "").trim();
    const texts = getTexts(ctx.chatId);
    if (!tagName) {
      await ctx.reply(texts.usageStartPlay);
      return;
    }
    if (tagName.length > 50) {
      await ctx.reply(texts.tagNameTooLong);
      return;
    }

    const res = transaction((): Result<{ count: number }, string> => {
      upsertTelegramUser({
        userId: ctx.from.id,
        username: ctx.from.username ?? null,
        usernameNormalized: normalizeUsername(ctx.from.username),
      });

      const tag = getTagByChatIdAndName(ctx.chatId, tagName);
      if (!tag) {
        return err(formatText(texts.tagMissing, { tagName }));
      }

      const existingUserTag = getUserTagByUserIdAndTagId(ctx.from.id, tag.id);
      if (existingUserTag) {
        return ok({ count: existingUserTag.count });
      }

      const createdUserTag = createUserTag({ userId: ctx.from.id, tagId: tag.id });
      return ok({ count: createdUserTag.count });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(formatText(texts.registeredForTag, { tagName, count: res.value.count }));
  });
}

function gambleCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("gamble", async (ctx) => {
    const tagName = (ctx.message.text.split(" ")[1] ?? "").trim();
    const texts = getTexts(ctx.chatId);
    if (!tagName) {
      await ctx.reply(texts.usageGamble);
      return;
    }

    const now = Date.now();
    const res = transaction((): Result<{ delta: number; count: number }, string> => {
      upsertTelegramUser({
        userId: ctx.from.id,
        username: ctx.from.username ?? null,
        usernameNormalized: normalizeUsername(ctx.from.username),
      });

      const userTag = getUserTagByChatIdUserIdAndTagName(ctx.chatId, ctx.from.id, tagName);
      if (!userTag) {
        return err(formatText(texts.notRegisteredForTag, { tagName }));
      }

      if (userTag.lastGambleAt && isSameUtcDay(userTag.lastGambleAt, now)) {
        const remainingMs = msUntilNextUtcDay(now);
        return err(formatText(texts.canGambleAgainAtUtc, { remaining: formatDuration(remainingMs) }));
      }

      const delta = randomIntInRange(-10, 10);
      const nextCount = userTag.count + delta;
      const updated = updateUserTagCountAndLastGambleAt(userTag.id, nextCount, now);
      if (!updated) {
        return err(texts.unableToUpdateTagValue);
      }

      return ok({ delta, count: updated.count });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(
      formatText(texts.gambleResult, {
        tagName,
        delta: formatDelta(res.value.delta),
        count: res.value.count,
      }),
    );
  });
}

function addToUserTagCommand(bot: AppBot): void {
  registerModifyUserTagCommand(bot, "add", 1);
}

function subtractFromUserTagCommand(bot: AppBot): void {
  registerModifyUserTagCommand(bot, "sub", -1);
}

function registerModifyUserTagCommand(
  bot: AppBot,
  commandName: "add" | "sub",
  direction: 1 | -1,
): void {
  bot.chatType(["group", "supergroup"]).command(commandName, async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const [, tagName, numberRaw, usernameRaw] = splitCommandArgs(ctx.message.text);
    if (!tagName || !numberRaw) {
      await ctx.reply(formatText(texts.usageModifyTag, { commandName }));
      return;
    }

    const amount = Number(numberRaw);
    if (!Number.isInteger(amount) || amount <= 0) {
      await ctx.reply(texts.numberMustBePositiveInteger);
      return;
    }

    const targetUsername = normalizeUsername(usernameRaw);

    const res = transaction((): Result<{ count: number; delta: number; target: string }, string> => {
      upsertTelegramUser({
        userId: ctx.from.id,
        username: ctx.from.username ?? null,
        usernameNormalized: normalizeUsername(ctx.from.username),
      });

      let targetUserId = ctx.from.id;
      let targetLabel = "you";

      if (targetUsername) {
        const targetUser = getTelegramUserByUsernameNormalized(targetUsername);
        if (!targetUser) {
          return err(formatText(texts.unknownUsername, { username: targetUsername }));
        }

        targetUserId = targetUser.userId;
        targetLabel = `@${targetUsername}`;
      }

      const userTag = getUserTagByChatIdUserIdAndTagName(ctx.chatId, targetUserId, tagName);
      if (!userTag) {
        return err(formatText(texts.noTagForTarget, { tagName, targetLabel }));
      }

      const delta = direction * amount;
      const nextCount = userTag.count + delta;
      const updated = updateUserTagCount(userTag.id, nextCount);
      if (!updated) {
        return err(texts.unableToUpdateTagValue);
      }

      return ok({ count: updated.count, delta, target: targetLabel });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(formatText(texts.modifyResult, {
      tagName,
      delta: formatDelta(res.value.delta),
      target: res.value.target,
      count: res.value.count,
    }));
  });
}

function checkCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("check", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const [, tagNameRaw] = splitCommandArgs(ctx.message.text);
    const tagName = tagNameRaw?.trim();

    const res = transaction((): Result<string, string> => {
      if (tagName) {
        const tag = getTagByChatIdAndName(ctx.chatId, tagName);
        if (!tag) {
          return err(formatText(texts.tagMissing, { tagName }));
        }
      }

      const rows = listUserTagStateByChatId(ctx.chatId, tagName);
      if (!rows.length) {
        return ok(tagName
          ? formatText(texts.noPlayersForTag, { tagName })
          : texts.noPlayersInGame);
      }

      return ok(formatCheckRows(rows, texts));
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(res.value);
  });
}

function setLanguageCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("lang", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const [, languageInput] = splitCommandArgs(ctx.message.text);
    if (!languageInput) {
      await ctx.reply(texts.usageSetLang);
      return;
    }

    const language = parseBotLanguage(languageInput);
    if (!language) {
      await ctx.reply(texts.invalidLanguage);
      return;
    }

    const updatedLanguage = transaction(() => setBotLanguageByChatId(ctx.chatId, language));
    const updatedTexts = TEXTS[updatedLanguage];
    await ctx.reply(
      formatText(updatedTexts.languageUpdatedTo, { language: formatBotLanguage(updatedLanguage) }),
    );
  });
}

function checkUserCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("checkuser", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const [, usernameRaw] = splitCommandArgs(ctx.message.text);
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      await ctx.reply(texts.usageCheckUser);
      return;
    }

    const res = transaction((): Result<string, string> => {
      const targetUser = getTelegramUserByUsernameNormalized(username);
      if (!targetUser) {
        return err(formatText(texts.unknownUsername, { username }));
      }

      const rows = listUserTagStateByChatIdAndUserId(ctx.chatId, targetUser.userId);
      if (!rows.length) {
        return ok(formatText(texts.noGameTagsForUser, { username }));
      }

      return ok(formatCheckUserRows(username, rows));
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(res.value);
  });
}

function setModeCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("setmode", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const modeInput = (ctx.message.text.split(" ")[1] ?? "").toLowerCase();
    const mode = parseBotMode(modeInput);
    if (!mode) {
      await ctx.reply(texts.usageSetMode);
      return;
    }

    const updatedMode = transaction(() => setBotModeByChatId(ctx.chatId, mode));
    await ctx.reply(formatText(texts.modeUpdatedTo, { mode: updatedMode }));
  });
}

function getModeCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("getmode", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const mode = getBotModeByChatId(ctx.chatId);
    await ctx.reply(formatText(texts.currentModeIs, { mode }));
  });
}

function echoCommand(bot: AppBot): void {
  bot
    .chatType(["group", "supergroup"])
    .command("echo", (ctx) => ctx.reply(ctx.message.text ?? ""));
}

function randomizeTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("randomize", async (ctx) => {
    const random = String(Math.random());
    await ctx.reply(random);
  });
}

function createTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("newtag", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const name = ctx.message.text.split(" ")[1];
    if (!name) {
      await ctx.reply(texts.usageNewTag);
      return;
    }
    if (name.length > 50) {
      await ctx.reply(texts.tagNameTooLong);
      return;
    }

    const res = transaction((): Result<Tag, string> => {
      const existingTag = getTagByChatIdAndName(ctx.chatId, name);
      if (existingTag) {
        return err(texts.tagAlreadyExists);
      }
      return ok(createTag({ chatId: ctx.chatId, name }));
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(JSON.stringify(res.value));
  });
}

function updateTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("updatetag", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const [, oldName, newName] = ctx.message.text.split(" ");
    if (!oldName || !newName) {
      await ctx.reply(texts.usageUpdateTag);
      return;
    }
    if (newName.length > 50) {
      await ctx.reply(texts.tagNameTooLong);
      return;
    }
    if (oldName === newName) {
      await ctx.reply(texts.sameTagSuccess);
      return;
    }

    const res = transaction((): Result<Tag, string> => {
      const existingByOldName = getTagByChatIdAndName(ctx.chatId, oldName);
      if (!existingByOldName) {
        return err(formatText(texts.tagByNameNotExists, { name: oldName }));
      }
      const existingTag = getTagByChatIdAndName(ctx.chatId, newName);
      if (existingTag) {
        return err(formatText(texts.tagByNameAlreadyExists, { name: newName }));
      }
      const updatedTag = updateTagByName(ctx.chatId, oldName, newName);
      if (!updatedTag) {
        return err(formatText(texts.tagByNameNotExists, { name: oldName }));
      }
      return ok(updatedTag);
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(JSON.stringify(res.value));
  });
}

function listCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("listtags", async (ctx) => {
    const tags = listTags(ctx.chatId);
    await ctx.reply(JSON.stringify(tags));
  });
}

function automodeMessageHandler(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) {
      return;
    }

    if (getBotModeByChatId(ctx.chatId) !== "automode") {
      return;
    }

    const tag = getTagByChatIdAndName(ctx.chatId, text);
    if (!tag) {
      return;
    }

    await ctx.reply(JSON.stringify(tag));
  });
}

function parseBotMode(mode: string): BotMode | null {
  if (mode === "automode" || mode === "manualmode") {
    return mode;
  }

  return null;
}

function randomIntInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function isSameUtcDay(timestampA: number, timestampB: number): boolean {
  const a = new Date(timestampA);
  const b = new Date(timestampB);

  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function msUntilNextUtcDay(nowTs: number): number {
  const now = new Date(nowTs);
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );

  return Math.max(0, nextUtcMidnight - nowTs);
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function formatCheckRows(
  rows: Array<{ tagName: string; userId: number; count: number; username: string | null }>,
  texts: Texts,
): string {
  const groups = new Map<string, Array<{ userId: number; count: number; username: string | null }>>();

  for (const row of rows) {
    const list = groups.get(row.tagName) ?? [];
    list.push({ userId: row.userId, count: row.count, username: row.username });
    groups.set(row.tagName, list);
  }

  const lines: string[] = [];
  for (const [tagName, players] of groups) {
    lines.push(`${tagName}:`);
    const topPlayers = players.slice(0, CHECK_MAX_PLAYERS_PER_TAG);
    for (const player of topPlayers) {
      const userLabel = player.username ? `@${player.username}` : `user:${player.userId}`;
      lines.push(`- ${userLabel} = ${player.count}`);
    }

    if (players.length > CHECK_MAX_PLAYERS_PER_TAG) {
      lines.push(formatText(texts.morePlayers, { count: players.length - CHECK_MAX_PLAYERS_PER_TAG }));
    }
  }

  return lines.join("\n");
}

function formatCheckUserRows(
  username: string,
  rows: Array<{ tagName: string; count: number }>,
): string {
  const lines = [`@${username}:`];
  for (const row of rows) {
    lines.push(`- ${row.tagName} = ${row.count}`);
  }

  return lines.join("\n");
}

function splitCommandArgs(text: string): string[] {
  return text.trim().split(/\s+/g);
}

function normalizeUsername(username: string | undefined | null): string | null {
  if (!username) {
    return null;
  }

  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  return normalized || null;
}

function formatText(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    if (!(key in values)) {
      return `{${key}}`;
    }

    return String(values[key]);
  });
}

function getTexts(chatId: number): Texts {
  return TEXTS[getBotLanguageByChatId(chatId)];
}

function parseBotLanguage(input: string): BotLanguage | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "eng") {
    return "eng";
  }
  if (normalized === "ukr") {
    return "ukr";
  }
  if (normalized === "rus") {
    return "rus";
  }

  return null;
}

function formatBotLanguage(language: BotLanguage): "Eng" | "Ukr" | "Rus" {
  if (language === "eng") {
    return "Eng";
  }
  if (language === "ukr") {
    return "Ukr";
  }

  return "Rus";
}
