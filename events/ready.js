const client = require('../bleed')
const db = require('quick.db')

client.on("ready", () => {
  console.log(`${client.user.username} is now up and running!`);

  // Persisted by the `status` command; falls back to the original default.
  const saved = db.get("bot_status");
  const name = (saved && saved.name) || "discord.gg/four";
  const type = (saved && saved.type) || "PLAYING";

  client.user.setActivity(name, { type });
})
