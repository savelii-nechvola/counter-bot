import { type Api, Bot, type Context, type PollingOptions } from "grammy";
import {
  type BotMode,
  createUserTag,
  createTag,
  getBotModeByChatId,
  getTagByChatIdAndName,
  getTelegramUserByUsernameNormalized,
  getUserTagByChatIdUserIdAndTagName,
  getUserTagByUserIdAndTagId,
  listUserTagStateByChatId,
  listUserTagStateByChatIdAndUserId,
  listTags,
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
  bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
}

function startPlayCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("startplay", async (ctx) => {
    const tagName = (ctx.message.text.split(" ")[1] ?? "").trim();
    if (!tagName) {
      await ctx.reply("Command usage: /startplay <tagName>");
      return;
    }
    if (tagName.length > 50) {
      await ctx.reply("Tag name should be <= 50 chars");
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
        return err(`Tag ${tagName} does not exist. Create it first with /newtag ${tagName}`);
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

    await ctx.reply(`You are registered for ${tagName}. Current value: ${res.value.count}`);
  });
}

function gambleCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("gamble", async (ctx) => {
    const tagName = (ctx.message.text.split(" ")[1] ?? "").trim();
    if (!tagName) {
      await ctx.reply("Command usage: /gamble <tagName>");
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
        return err(`You are not registered for ${tagName}. Use /startplay ${tagName}`);
      }

      if (userTag.lastGambleAt && isSameUtcDay(userTag.lastGambleAt, now)) {
        const remainingMs = msUntilNextUtcDay(now);
        return err(
          `You can gamble this tag again at 00:00 UTC (in ${formatDuration(remainingMs)})`,
        );
      }

      const delta = randomIntInRange(-10, 10);
      const nextCount = userTag.count + delta;
      const updated = updateUserTagCountAndLastGambleAt(userTag.id, nextCount, now);
      if (!updated) {
        return err("Unable to update tag value");
      }

      return ok({ delta, count: updated.count });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(
      `${tagName}: ${formatDelta(res.value.delta)}. Current value: ${res.value.count}`,
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
    const [, tagName, numberRaw, usernameRaw] = splitCommandArgs(ctx.message.text);
    if (!tagName || !numberRaw) {
      await ctx.reply(`Command usage: /${commandName} <tagName> <number> <username>`);
      return;
    }

    const amount = Number(numberRaw);
    if (!Number.isInteger(amount) || amount <= 0) {
      await ctx.reply("<number> should be a positive integer");
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
          return err(`Unknown username @${targetUsername}. User should interact with bot first.`);
        }

        targetUserId = targetUser.userId;
        targetLabel = `@${targetUsername}`;
      }

      const userTag = getUserTagByChatIdUserIdAndTagName(ctx.chatId, targetUserId, tagName);
      if (!userTag) {
        return err(
          `No ${tagName} for ${targetLabel}. Use /startplay ${tagName} from target user first.`,
        );
      }

      const delta = direction * amount;
      const nextCount = userTag.count + delta;
      const updated = updateUserTagCount(userTag.id, nextCount);
      if (!updated) {
        return err("Unable to update tag value");
      }

      return ok({ count: updated.count, delta, target: targetLabel });
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(
      `${tagName}: ${formatDelta(res.value.delta)} for ${res.value.target}. Current value: ${res.value.count}`,
    );
  });
}

function checkCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("check", async (ctx) => {
    const [, tagNameRaw] = splitCommandArgs(ctx.message.text);
    const tagName = tagNameRaw?.trim();

    const res = transaction((): Result<string, string> => {
      if (tagName) {
        const tag = getTagByChatIdAndName(ctx.chatId, tagName);
        if (!tag) {
          return err(`Tag ${tagName} does not exist. Create it first with /newtag ${tagName}`);
        }
      }

      const rows = listUserTagStateByChatId(ctx.chatId, tagName);
      if (!rows.length) {
        return ok(tagName ? `No players for tag ${tagName}` : "No players in game yet");
      }

      return ok(formatCheckRows(rows));
    });

    if (!res.ok) {
      await ctx.reply(res.error);
      return;
    }

    await ctx.reply(res.value);
  });
}

function checkUserCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("checkuser", async (ctx) => {
    const [, usernameRaw] = splitCommandArgs(ctx.message.text);
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      await ctx.reply("Command usage: /checkuser <username>");
      return;
    }

    const res = transaction((): Result<string, string> => {
      const targetUser = getTelegramUserByUsernameNormalized(username);
      if (!targetUser) {
        return err(`Unknown username @${username}. User should interact with bot first.`);
      }

      const rows = listUserTagStateByChatIdAndUserId(ctx.chatId, targetUser.userId);
      if (!rows.length) {
        return ok(`No game tags for @${username}`);
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
    const modeInput = (ctx.message.text.split(" ")[1] ?? "").toLowerCase();
    const mode = parseBotMode(modeInput);
    if (!mode) {
      await ctx.reply("Command usage: /setmode <automode|manualmode>");
      return;
    }

    const updatedMode = transaction(() => setBotModeByChatId(ctx.chatId, mode));
    await ctx.reply(`Mode updated to ${updatedMode}`);
  });
}

function getModeCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("getmode", async (ctx) => {
    const mode = getBotModeByChatId(ctx.chatId);
    await ctx.reply(`Current mode is ${mode}`);
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
    const name = ctx.message.text.split(" ")[1];
    if (!name) {
      await ctx.reply("Command usage: /newtag <tagName>");
      return;
    }
    if (name.length > 50) {
      await ctx.reply("Tag name should be <= 50 chars");
      return;
    }

    const res = transaction((): Result<Tag, string> => {
      const existingTag = getTagByChatIdAndName(ctx.chatId, name);
      if (existingTag) {
        return err("Tag with this name already exists");
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
    const [, oldName, newName] = ctx.message.text.split(" ");
    if (!oldName || !newName) {
      await ctx.reply("Command usage: /updatetag <oldName> <newName>");
      return;
    }
    if (newName.length > 50) {
      await ctx.reply("Tag name should be <= 50 chars");
      return;
    }
    if (oldName === newName) {
      await ctx.reply("Wow! Great Success!");
      return;
    }

    const res = transaction((): Result<Tag, string> => {
      const existingByOldName = getTagByChatIdAndName(ctx.chatId, oldName);
      if (!existingByOldName) {
        return err(`Tag with the name "${oldName}" does not exist`);
      }
      const existingTag = getTagByChatIdAndName(ctx.chatId, newName);
      if (existingTag) {
        return err(`Tag with the name "${newName}" already exists`);
      }
      const updatedTag = updateTagByName(ctx.chatId, oldName, newName);
      if (!updatedTag) {
        return err(`Tag with the name "${oldName}" does not exist`);
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

function formatCheckRows(rows: Array<{ tagName: string; userId: number; count: number; username: string | null }>): string {
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
      lines.push(`- ... and ${players.length - CHECK_MAX_PLAYERS_PER_TAG} more`);
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
