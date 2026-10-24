const client = require('../bleed')
const Discord = require('discord.js')
const { joinLogChannel } = require("../config.json")

client.on("guildDelete", guild => {
  const embed = new Discord.MessageEmbed()
    .setDescription(`Left guild: **${guild.name}**, owned by ${guild.owner.user.tag} (\`${guild.id}\`) | **${guild.memberCount}** members`)
    .setColor("#939393")
  const logChannel = joinLogChannel && client.channels.cache.get(joinLogChannel);
  if (logChannel) logChannel.send(embed)
})