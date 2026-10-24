const client = require('../bleed')
const db = require("quick.db");
const { default_prefix, color } = require("../config.json");
const Discord = require('discord.js');

client.on("message", async message => {
  if (message.partial) return
  if (message.author.bot) return;

  if (message.author.bot) return;
  if (db.has(`afk-${message.author.id}+${message.guild.id}`)) {
    const info = db.get(`afk-${message.author.id}+${message.guild.id}`)
    await db.delete(`afk-${message.author.id}+${message.guild.id}`)
    message.channel.send({ embed: { color: "#6495ED", description: `:wave: ${message.author}: Welcome back, you're no longer **AFK**` } });
  }

  if (message.mentions.members.first()) {
    if (db.has(`afk-${message.mentions.members.first().id}+${message.guild.id}`)) {
      const embed = new Discord.MessageEmbed()
        .setColor("#6495ED")
        .setDescription(`:zzz: ${message.mentions.members.first()} is AFK: ` + db.get(`afk-${message.mentions.members.first().id}+${message.guild.id}`))
      message.channel.send(embed)
    } else return;
  } else;
})

client.on("message", async message => {
  if (message.author.bot) return;

  let prefix2 = db.get(`prefix_${message.guild.id}`)

  const args1 = message.content.trim().split(/ +/g);
  if (prefix2 === null) { prefix2 = default_prefix; }
  if (args1.length === 1 && message.mentions.users.has(client.user.id)) {

    const prefixEmbed = new Discord.MessageEmbed()
      .setDescription(`${message.author}: Guild prefix: \`${prefix2}\``)
      .setColor(`#6495ED`)
    message.channel.send(prefixEmbed);
  }

  if (!message.guild) return;
  let prefix = db.get(`prefix_${message.guild.id}`);
  if (prefix === null) prefix = default_prefix;

  if (!message.content.startsWith(prefix)) return;


  const args = message.content
    .slice(prefix.length)
    .trim()
    .split(/ +/g);
  const cmd = args.shift().toLowerCase();

  if (cmd.length === 0) return;

  let cmdx = db.get(`cmd_${message.guild.id}`)

  if (cmdx) {
    let cmdy = cmdx.find(x => x.name === cmd)
    if (cmdy) message.channel.send(cmdy.responce)
  }

  let command = client.commands.get(cmd);
  if (!command) command = client.commands.get(client.aliases.get(cmd));


  if (command) {
    try {
      // Command allowlists are guild-scoped. They grant access to invoke a
      // command, but never replace the command's own Discord permission checks.
      const canonicalName = command.name.toLowerCase();
      if (canonicalName !== "permissions") {
        const access = db.get(`command_access_${message.guild.id}_${canonicalName}`);
        const allowedUsers = access && Array.isArray(access.users) ? access.users : [];
        const allowedRoles = access && Array.isArray(access.roles) ? access.roles : [];
        const isOwner = require("../config.json").owner === message.author.id;
        const isManager = message.member && message.member.hasPermission("MANAGE_GUILD");
        const isAllowed = allowedUsers.includes(message.author.id) ||
          (message.member && message.member.roles.cache.some(role => allowedRoles.includes(role.id)));
        if ((allowedUsers.length || allowedRoles.length) && !isOwner && !isManager && !isAllowed) {
          const { warn } = require("../emojis.json");
          return message.reply(`${warn || ""} You don't have permission to use **${canonicalName}**.`);
        }
      }
      const result = command.run(client, message, args);
      if (result && typeof result.catch === "function") {
        result.catch(err => console.error(`[command:${cmd}]`, err));
      }
    } catch (err) {
      console.error(`[command:${cmd}]`, err);
    }
  }

  // return addexp(message);

})

client.on('message', message => {
  if (message.author.bot) return;
  if (message.content === 'bleed') {
    message.channel.send('what')
  }
});
