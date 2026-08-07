import { type Api, Bot, type Context, type PollingOptions } from "grammy";
import { envVars } from "./env.js";

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
}

function startCommand(bot: AppBot): void {
  bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
}

function echoCommand(bot: AppBot): void {
  bot.command("echo", (ctx) => ctx.reply(ctx.message?.text ?? ""));
}

function randomizeTagCommand(bot: AppBot): void {
  bot.chatType(["group", "supergroup"]).command("randomize", async (ctx) => {
    const random = String(Math.random());
    await ctx.reply(random);
  });
}
