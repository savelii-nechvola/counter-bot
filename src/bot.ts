import { type Api, Bot, type Context, type PollingOptions } from "grammy";
import {
  createTag,
  getTagByChatIdAndName,
  listTags,
  type Tag,
  transaction,
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
  echoCommand(bot);
  randomizeTagCommand(bot);
  listCommand(bot);
  createTagCommand(bot);
}

function startCommand(bot: AppBot): void {
  bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
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
      await ctx.reply("Provide a tag name as a command argument");
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

function listCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("listtags", async (ctx) => {
    const tags = listTags(ctx.chatId);
    await ctx.reply(JSON.stringify(tags));
  });
}
