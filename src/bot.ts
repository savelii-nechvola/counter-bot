import { type Api, Bot, type Context, type PollingOptions } from "grammy";
import { readFileSync } from "node:fs";
import {
  db,
  type BotLanguage,
  type BotMode,
  createUserTag,
  getBotLanguageByChatId,
  createTag,
  getBotModeByChatId,
  getTagByChatIdAndName,
  getTelegramUserById,
  getTelegramUserByPseudonymNormalized,
  getUserTagByChatIdUserIdAndTagName,
  getUserTagByUserIdAndTagId,
  listUserTagStateByChatId,
  listUserTagStateByChatIdAndUserId,
  listTags,
  setBotLanguageByChatId,
  setBotModeByChatId,
  setUserPseudonym,
  type Tag,
  transaction,
  updateUserTagCount,
  updateUserTagCountAndLastGambleAt,
  updateTagByName,
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
  usageForce: string;
  usageForcetag: string;
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
  unknownPseudonym: string;
  userNotActiveInGroup: string;
  usageJoin: string;
  joinSuccess: string;
  pseudonymTaken: string;
  pseudonymTooLong: string;
  notJoined: string;
  noTagForTarget: string;
  forceAssigned: string;
  forceAlreadyAssigned: string;
  forcetagAssigned: string;
  forcetagNoUsers: string;
  modifyResult: string;
  noPlayersForTag: string;
  noPlayersInGame: string;
  noGameTagsForUser: string;
  modeUpdatedTo: string;
  currentModeIs: string;
  adminOnlyInadminmode: string;
  adminOnlyCommand: string;
  tagAlreadyExists: string;
  tagCreated: string;
  usageNewTag: string;
  usageUpdateTag: string;
  sameTagSuccess: string;
  helpMessage: string;
  tagByNameNotExists: string;
  tagByNameAlreadyExists: string;
  invalidLanguage: string;
  languageUpdatedTo: string;
  morePlayers: string;
  noTagsInGroup: string;
  tagsListTitle: string;
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
  requirePseudonymMiddleware(bot);
  startCommand(bot);
  helpCommand(bot);
  joinCommand(bot);
  startPlayCommand(bot);
  gambleCommand(bot);
  forceTagCommand(bot);
  forceTagToAllCommand(bot);
  addToUserTagCommand(bot);
  subtractFromUserTagCommand(bot);
  checkCommand(bot);
  checkUserCommand(bot);
  setLanguageCommand(bot);
  setModeCommand(bot);
  getModeCommand(bot);
  listCommand(bot);
  createTagCommand(bot);
  updateTagCommand(bot);
  adminmodeMessageHandler(bot);
}

function requirePseudonymMiddleware(bot: AppBot): void {
  const freeCommands = new Set(["start", "help", "join"]);
  bot.chatType(["group", "supergroup"]).use(async (ctx, next) => {
    const command = ctx.message?.text?.match(/^\/([a-zA-Z_]+)/)?.[1]?.toLowerCase();
    if (command && freeCommands.has(command)) {
      await next();
      return;
    }

    if (!ctx.from || !getTelegramUserById(ctx.from.id)?.pseudonym) {
      await ctx.reply(getTexts(ctx.chat.id).notJoined);
      return;
    }

    await next();
  });
}

function startCommand(bot: AppBot): void {
  bot.command("start", (ctx) => {
    const texts = getTexts(ctx.chatId);
    return ctx.reply(texts.welcome);
  });
}

function helpCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("help", (ctx) => {
    const texts = getTexts(ctx.chatId);
    return ctx.reply(texts.helpMessage);
  });
}

function joinCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("join", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    const [, pseudonymRaw] = splitCommandArgs(ctx.message.text);
    if (!pseudonymRaw) {
      await ctx.reply(texts.usageJoin);
      return;
    }

    const pseudonymNormalized = normalizePseudonym(pseudonymRaw);
    if (!pseudonymNormalized || pseudonymNormalized.length > 32) {
      await ctx.reply(texts.pseudonymTooLong);
      return;
    }

    const res = transaction((): Result<string, string> => {
      const existing = getTelegramUserByPseudonymNormalized(pseudonymNormalized);
      if (existing && existing.userId !== ctx.from.id) {
        return err(formatText(texts.pseudonymTaken, { pseudonym: pseudonymRaw }));
      }
      const user = setUserPseudonym(ctx.from.id, pseudonymRaw.trim(), pseudonymNormalized);
      return ok(user.pseudonym!);
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(formatText(texts.joinSuccess, { pseudonym: res.value }));
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

function forceTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("force", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    if (!(await canUseAdminOnlyCommands(ctx, texts))) {
      return;
    }

    const [, tagName, usernameRaw] = splitCommandArgs(ctx.message.text);
    if (!tagName || !usernameRaw) {
      await ctx.reply(texts.usageForce);
      return;
    }

    const pseudonym = normalizePseudonym(usernameRaw);
    if (!pseudonym) {
      await ctx.reply(texts.usageForce);
      return;
    }

    const targetUser = getTelegramUserByPseudonymNormalized(pseudonym);
    if (!targetUser) {
      await ctx.reply(formatText(texts.unknownPseudonym, { pseudonym }));
      return;
    }

    if (!(await isUserActiveInChat(ctx, targetUser.userId))) {
      await ctx.reply(texts.userNotActiveInGroup);
      return;
    }

    const res = transaction((): Result<{ count: number; forced: boolean }, string> => {
      const tag = getTagByChatIdAndName(ctx.chatId, tagName);
      if (!tag) {
        return err(formatText(texts.tagMissing, { tagName }));
      }

      const existingUserTag = getUserTagByUserIdAndTagId(targetUser.userId, tag.id);
      if (existingUserTag) {
        return ok({ count: existingUserTag.count, forced: false });
      }

      const createdUserTag = createUserTag({ userId: targetUser.userId, tagId: tag.id });
      return ok({ count: createdUserTag.count, forced: true });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    const displayPseudonym = targetUser.pseudonym ?? pseudonym;
    if (res.value.forced) {
      await ctx.reply(formatText(texts.forceAssigned, {
        tagName,
        pseudonym: displayPseudonym,
        count: res.value.count,
      }));
      return;
    }

    await ctx.reply(formatText(texts.forceAlreadyAssigned, {
      tagName,
      pseudonym: displayPseudonym,
      count: res.value.count,
    }));
  });
}

function forceTagToAllCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("forcetag", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    if (!(await canUseAdminOnlyCommands(ctx, texts))) {
      return;
    }

    const [, tagNameRaw] = splitCommandArgs(ctx.message.text);
    const tagName = tagNameRaw?.trim();
    if (!tagName) {
      await ctx.reply(texts.usageForcetag);
      return;
    }
    if (tagName.length > 50) {
      await ctx.reply(texts.tagNameTooLong);
      return;
    }

    const users = getJoinedTelegramUsers();
    const activeUserIds = new Set<number>();
    for (const user of users) {
      if (await isUserActiveInChat(ctx, user.userId)) {
        activeUserIds.add(user.userId);
      }
    }

    const res = transaction((): Result<{ assignedCount: number }, string> => {
      const tag = getTagByChatIdAndName(ctx.chatId, tagName);
      if (!tag) {
        return err(formatText(texts.tagMissing, { tagName }));
      }

      const existingUserIds = new Set<number>(
        (db.prepare(`select user_id from user_tag where tag_id = ?`).all(tag.id) as Array<{ user_id: number }>).map((row) => row.user_id),
      );

      let assignedCount = 0;
      for (const userId of activeUserIds) {
        if (existingUserIds.has(userId)) {
          continue;
        }

        createUserTag({ userId, tagId: tag.id });
        existingUserIds.add(userId);
        assignedCount += 1;
      }

      return ok({ assignedCount });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    if (res.value.assignedCount === 0) {
      await ctx.reply(formatText(texts.forcetagNoUsers, { tagName }));
      return;
    }

    await ctx.reply(formatText(texts.forcetagAssigned, {
      tagName,
      count: res.value.assignedCount,
    }));
  });
}

function registerModifyUserTagCommand(
  bot: AppBot,
  commandName: "add" | "sub",
  direction: 1 | -1,
): void {
  bot.chatType(["group", "supergroup"]).command(commandName, async (ctx) => {
    const texts = getTexts(ctx.chatId);
    if (!(await canUseAdminOnlyCommands(ctx, texts))) {
      return;
    }

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

    const targetPseudonym = normalizePseudonym(usernameRaw);

    let targetUserId = ctx.from.id;
    let targetLabel = "you";

    if (targetPseudonym) {
      const targetUser = getTelegramUserByPseudonymNormalized(targetPseudonym);
      if (!targetUser) {
        await ctx.reply(formatText(texts.unknownPseudonym, { pseudonym: targetPseudonym }));
        return;
      }

      if (!(await isUserActiveInChat(ctx, targetUser.userId))) {
        await ctx.reply(texts.userNotActiveInGroup);
        return;
      }

      targetUserId = targetUser.userId;
      targetLabel = targetUser.pseudonym ?? targetPseudonym;
    }

    const res = transaction((): Result<{ count: number; delta: number; target: string }, string> => {

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

    const res = transaction((): Result<Array<{ tagName: string; userId: number; count: number; pseudonym: string | null }>, string> => {
      if (tagName) {
        const tag = getTagByChatIdAndName(ctx.chatId, tagName);
        if (!tag) {
          return err(formatText(texts.tagMissing, { tagName }));
        }
      }

      const rows = listUserTagStateByChatId(ctx.chatId, tagName);
      return ok(rows);
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    const visibleRows = [] as Array<{ tagName: string; userId: number; count: number; pseudonym: string | null }>;
    for (const row of res.value) {
      if (await isUserActiveInChat(ctx, row.userId)) {
        visibleRows.push(row);
      }
    }

    if (!visibleRows.length) {
      await ctx.reply(tagName
        ? formatText(texts.noPlayersForTag, { tagName })
        : texts.noPlayersInGame);
      return;
    }

    await ctx.reply(formatCheckRows(visibleRows, texts));
  });
}

function setLanguageCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("lang", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    if (!(await canUseAdminOnlyCommands(ctx, texts))) {
      return;
    }

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
    const [, pseudonymRaw] = splitCommandArgs(ctx.message.text);
    const pseudonym = normalizePseudonym(pseudonymRaw);
    if (!pseudonym) {
      await ctx.reply(texts.usageCheckUser);
      return;
    }

    const targetUser = getTelegramUserByPseudonymNormalized(pseudonym);
    if (!targetUser) {
      await ctx.reply(formatText(texts.unknownPseudonym, { pseudonym }));
      return;
    }

    if (!(await isUserActiveInChat(ctx, targetUser.userId))) {
      await ctx.reply(texts.userNotActiveInGroup);
      return;
    }

    const res = transaction((): Result<string, string> => {
      const rows = listUserTagStateByChatIdAndUserId(ctx.chatId, targetUser.userId);
      if (!rows.length) {
        return ok(formatText(texts.noGameTagsForUser, { pseudonym: targetUser.pseudonym ?? pseudonym }));
      }

      return ok(formatCheckUserRows(targetUser.pseudonym ?? pseudonym, rows));
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
    if (!(await canUseAlwaysAdminCommands(ctx, texts))) {
      return;
    }

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

function createTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("newtag", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    if (!(await canUseAdminOnlyCommands(ctx, texts))) {
      return;
    }

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

    await ctx.reply(formatText(texts.tagCreated, { tagName: res.value.name }));
  });
}

function updateTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("updatetag", async (ctx) => {
    const texts = getTexts(ctx.chatId);
    if (!(await canUseAdminOnlyCommands(ctx, texts))) {
      return;
    }

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
  const handleList = async (ctx: Context): Promise<void> => {
    if (ctx.chatId === undefined) {
      return;
    }

    const texts = getTexts(ctx.chatId);
    const tags = listTags(ctx.chatId);
    if (!tags.length) {
      await ctx.reply(texts.noTagsInGroup);
      return;
    }

    const lines = [texts.tagsListTitle, ...tags.map((tag) => `- ${tag.name}`)];
    await ctx.reply(lines.join("\n"));
  };

  bot.chatType(["group", "supergroup"]).command("listtags", handleList);
  bot.chatType(["group", "supergroup"]).command("listtag", handleList);
}

function adminmodeMessageHandler(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) {
      return;
    }

    if (getBotModeByChatId(ctx.chatId) !== "adminmode") {
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
  if (mode === "adminmode" || mode === "usermode") {
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
  rows: Array<{ tagName: string; userId: number; count: number; pseudonym: string | null }>,
  texts: Texts,
): string {
  const groups = new Map<string, Array<{ userId: number; count: number; pseudonym: string | null }>>();

  for (const row of rows) {
    const list = groups.get(row.tagName) ?? [];
    list.push({ userId: row.userId, count: row.count, pseudonym: row.pseudonym });
    groups.set(row.tagName, list);
  }

  const lines: string[] = [];
  for (const [tagName, players] of groups) {
    lines.push(`${tagName}:`);
    const topPlayers = players.slice(0, CHECK_MAX_PLAYERS_PER_TAG);
    for (const player of topPlayers) {
      const userLabel = player.pseudonym ?? `user:${player.userId}`;
      lines.push(`- ${userLabel} = ${player.count}`);
    }

    if (players.length > CHECK_MAX_PLAYERS_PER_TAG) {
      lines.push(formatText(texts.morePlayers, { count: players.length - CHECK_MAX_PLAYERS_PER_TAG }));
    }
  }

  return lines.join("\n");
}

function formatCheckUserRows(
  pseudonym: string,
  rows: Array<{ tagName: string; count: number }>,
): string {
  const lines = [`${pseudonym}:`];
  for (const row of rows) {
    lines.push(`- ${row.tagName} = ${row.count}`);
  }

  return lines.join("\n");
}

function splitCommandArgs(text: string): string[] {
  return text.trim().split(/\s+/g);
}

function getJoinedTelegramUsers(): Array<{ userId: number }> {
  return db.prepare(`select user_id as userId from telegram_user where pseudonym is not null order by user_id`).all() as Array<{ userId: number }>;
}

async function isUserActiveInChat(ctx: Context, userId: number): Promise<boolean> {
  const chatId = ctx.chatId;
  if (chatId === undefined) {
    return false;
  }

  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === "creator" || member.status === "administrator" || member.status === "member";
  } catch {
    return false;
  }
}

function normalizePseudonym(pseudonym: string | undefined | null): string | null {
  if (!pseudonym) {
    return null;
  }

  return pseudonym.trim().replace(/^@/, "").toLowerCase() || null;
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

async function canUseAdminOnlyCommands(ctx: Context, texts: Texts): Promise<boolean> {
  const chatId = ctx.chatId;
  const from = ctx.from;
  if (chatId === undefined || !from) {
    return false;
  }

  if (getBotModeByChatId(chatId) !== "adminmode") {
    return true;
  }

  const member = await ctx.api.getChatMember(chatId, from.id);
  const isAdmin = member.status === "creator" || member.status === "administrator";
  if (isAdmin) {
    return true;
  }

  await ctx.reply(texts.adminOnlyInadminmode);
  return false;
}

async function canUseAlwaysAdminCommands(ctx: Context, texts: Texts): Promise<boolean> {
  const chatId = ctx.chatId;
  const from = ctx.from;
  if (chatId === undefined || !from) {
    return false;
  }

  const member = await ctx.api.getChatMember(chatId, from.id);
  const isAdmin = member.status === "creator" || member.status === "administrator";
  if (isAdmin) {
    return true;
  }

  await ctx.reply(texts.adminOnlyCommand);
  return false;
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
