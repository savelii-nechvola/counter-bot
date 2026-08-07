import { Bot } from "grammy";
import { migrateAll } from "../migrations/index.js";
import { db } from "./db.js";
import { envVars } from "./env.js";

function main(): void {
  migrateAll(db);
  const bot = new Bot(envVars.BOT_TOKEN);
  bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
  bot.on("message", (ctx) => ctx.reply("Got another message!"));

  void bot.start();
}

main();
