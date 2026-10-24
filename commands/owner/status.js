const { owner } = require("../../config.json");
const db = require("quick.db");

module.exports = {
  name: "status",

  run: async (client, message, args) => {

    if (message.author.id !== owner) return;

    let status = args.join(" ")
    if (!status) return message.channel.send('You need to input **status**')

    // Stored so the activity survives restarts (see events/ready.js).
    db.set("bot_status", { name: status, type: "PLAYING" });

    client.user.setPresence({
      activity: {
        name: status,
        type: 0,
      }
    })
      .then(message.channel.send(`Set the bot status to **${status}** (saved)`))
      .catch(err => {
        return message.channel.send(`There was an error (${err})`)
      })
  }
}
