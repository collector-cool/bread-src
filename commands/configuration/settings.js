const Discord = require("discord.js");
const db = require("quick.db");
const { default_prefix, color } = require("../../config.json");
const { warn } = require("../../emojis.json");

const yes = v => (v === null || v === undefined || v === "" ? "`not set`" : `\`${v}\``);
const channel = (client, id) => {
  if (!id) return "`not set`";
  const ch = client.channels.cache.get(id);
  return ch ? `${ch}` : `\`${id}\` (missing)`;
};

module.exports = {
  name: "settings",
  aliases: ["config", "cfg"],

  run: async (client, message, args) => {
    if (!message.member.hasPermission("MANAGE_GUILD")) {
      return message.channel.send({ embed: { color: "#efa23a", description: `${warn} ${message.author}: You're **missing** permission: \`manage_guild\`` } });
    }

    const gid = message.guild.id;
    const prefix = db.get(`prefix_${gid}`) || default_prefix;
    const status = db.get("bot_status");

    const embed = new Discord.MessageEmbed()
      .setColor(color)
      .setTitle(`Settings — ${message.guild.name}`)
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .addField("**Prefix**", `\`${prefix}\``, true)
      .addField("**Bot status**", status ? `\`${status.name}\`` : "`default`", true)
      .addField("\u200b", "\u200b", true)
      .addField("**Welcome channel**", channel(client, db.get(`welchannel_${gid}`)), true)
      .addField("**Autorole**", yes(db.get(`autorole_${gid}`)), true)
      .addField("**Modlogs**", channel(client, db.get(`logschannel_${gid}`)), true)
      .addField("**Anti-invite**", db.get(`antilink_${gid}`) ? "`on`" : "`off`", true)
      .addField("**Alt detector**", db.get(`anti-new_${gid}`) ? "`on`" : "`off`", true)
      .addField("**Custom commands**", `\`${(db.get(`cmd_${gid}`) || []).length}\``, true)
      .setFooter(`Data stored in json.sqlite • ${prefix}settings`)
      .setTimestamp();

    const welcome = db.get(`welmessage_${gid}`);
    if (welcome) embed.addField("**Welcome message**", `\`\`\`${welcome.slice(0, 1000)}\`\`\``);

    message.channel.send(embed);
  }
};
