import { type Api, Bot, type Context, type PollingOptions } from "grammy";
import {
  type BotMode,
  createTag,
  getBotModeByChatId,
  getTagByChatIdAndName,
  listTags,
  setBotModeByChatId,
  type Tag,
  transaction,
  updateTagByName,
} from "./db.js";
import { envVars } from "./env.js";
import { err, ok, type Result } from "./utils.js";

type AppBot = Bot<Context, Api>;

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
