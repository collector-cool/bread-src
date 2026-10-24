const { owner } = require("../../config.json");
const { approve } = require("../../emojis.json");

module.exports = {
  name: "leave",
  category: "owner",

  run: async (client, message, args) => {
    if (message.author.id === owner) {
      client.guilds.fetch(args[0]).then(guild => guild.leave().catch(console.error).then(message.channel.send({ embed: { color: "#a3eb7b", description: `${approve} ${message.author}: Successfully left **${guild.name}**` } })))
    }
  }
}
