import { Bot } from "grammy";
import { envVars } from "./env.js";

const bot = new Bot(envVars.BOT_TOKEN);

bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
bot.on("message", (ctx) => ctx.reply("Got another message!"));

void bot.start();
