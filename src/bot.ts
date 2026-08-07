import { Bot, type PollingOptions } from "grammy";
import { envVars } from "./env.js";

export function startBot(options?: PollingOptions): void {
  const bot = new Bot(envVars.BOT_TOKEN);
  bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
  bot.on("message", (ctx) => ctx.reply("Got another message!"));
  bot.catch((handler) => console.error(handler));

  void bot.start(options);
}
