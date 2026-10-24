require("dotenv").config();

const { default_prefix, color } = require("./config.json");
const Discord = require("discord.js");
require("@haileybot/sanitize-role-mentions")();
const client = new Discord.Client({
  disableMentions: "everyone",
  // Attachment uploads can take longer than discord.js v12's 15s default.
  // Allow media downloads enough time to upload before the REST request aborts.
  restRequestTimeout: 120000,
  // Was true: discord.js waits for guild.members.fetch() on every guild before
  // emitting "ready". That fetch hangs unless the Server Members intent is
  // enabled, which leaves the bot connected but permanently offline.
  fetchAllMembers: false,
  partials: ['MESSAGE', 'REACTION']
});
const voicemaster = require("./voicemaster");
voicemaster(client);
client.commands = new Discord.Collection();
client.aliases = new Discord.Collection();
client.events = new Discord.Collection();
client.db = require("quick.db");
require("./antinuke")(client);
module.exports = client;
["command", "event"].forEach(handler => {
  require(`./handlers/${handler}`)(client);
});
Discord.Constants.DefaultOptions.ws.properties.$browser = "Discord Android"

const token = process.env.TOKEN;
if (!token) {
  console.error("Missing TOKEN in .env — copy .env.example to .env and fill it in.");
  process.exit(1);
}

// Keep one bad command or rejected promise from taking the whole bot down.
process.on("unhandledRejection", err => console.error("[unhandledRejection]", err));
process.on("uncaughtException", err => console.error("[uncaughtException]", err));

client.login(token)
