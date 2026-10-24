const Discord = require("discord.js");
const db = require("quick.db");
const { default_prefix, color, owner } = require("../../config.json");
const { approve, warn } = require("../../emojis.json");

const KEY_PREFIX = "command_access_";
const key = (guildId, commandName) => `${KEY_PREFIX}${guildId}_${commandName}`;
const idFrom = value => value && value.match(/\d{17,20}/)?.[0];

module.exports = {
  name: "permissions",
  aliases: ["perms", "commandperms"],
  category: "configuration",
  description: "Set which users or roles can run bot commands",
  run: async (client, message, args) => {
    if (!message.guild) return;
    const prefix = db.get(`prefix_${message.guild.id}`) || default_prefix;
    if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply(`${warn} You need Manage Server to change command permissions.`);

    const subcommand = (args.shift() || "list").toLowerCase();
    if (subcommand === "list") {
      const restrictions = Array.from(client.commands.values()).map(command => {
        const access = db.get(key(message.guild.id, command.name)) || {};
        const users = Array.isArray(access.users) ? access.users : [];
        const roles = Array.isArray(access.roles) ? access.roles : [];
        if (!users.length && !roles.length) return null;
        const targets = [
          ...roles.map(id => `<@&${id}>`),
          ...users.map(id => `<@${id}>`)
        ];
        return `**${command.name}**: ${targets.join(", ")}`;
      }).filter(Boolean);
      return message.channel.send(new Discord.MessageEmbed()
        .setColor(color)
        .setTitle("Command access rules")
        .setDescription(restrictions.join("\n") || "No command-specific access rules are set. All commands use their normal Discord permission checks.")
        .addField("Usage", `\`${prefix}permissions set <command> <@role|@user>\`\n\`${prefix}permissions add/remove <command> <@role|@user>\`\n\`${prefix}permissions clear <command>\` · \`${prefix}permissions view <command>\``)
        .setFooter("Manage Server members and the configured bot owner bypass these access rules."));
    }

    const operation = ["set", "add", "remove", "clear", "view"].includes(subcommand) ? subcommand : "";
    if (!operation) return message.reply(`Use \`${prefix}permissions list\` to view rules.`);
    const requestedName = (args.shift() || "").toLowerCase();
    let command = client.commands.get(requestedName);
    if (!command) command = client.commands.get(client.aliases.get(requestedName));
    if (!command) return message.reply(`I couldn't find command \`${requestedName}\`.`);

    const accessKey = key(message.guild.id, command.name);
    const storedAccess = db.get(accessKey) || {};
    const access = {
      users: Array.isArray(storedAccess.users) ? storedAccess.users : [],
      roles: Array.isArray(storedAccess.roles) ? storedAccess.roles : []
    };
    if (operation === "view") {
      const targets = [
        ...access.roles.map(id => `<@&${id}>`),
        ...access.users.map(id => `<@${id}>`)
      ];
      return message.channel.send(targets.length
        ? `Only ${targets.join(", ")} can run **${command.name}** (plus Manage Server and bot owner).`
        : `**${command.name}** has no additional access restriction.`);
    }
    if (operation === "clear") {
      db.delete(accessKey);
      return message.channel.send(`${approve} Cleared the access rule for **${command.name}**.`);
    }

    const role = message.mentions.roles.first() || (args[0] && message.guild.roles.cache.get(idFrom(args[0])));
    const member = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(idFrom(args[0])).catch(() => null));
    const target = role || member;
    if (!target) return message.reply(`Mention a role or user: \`${prefix}permissions ${operation} ${command.name} @target\`.`);
    const list = role ? access.roles : access.users;
    if (operation === "set") {
      access.users = [];
      access.roles = [];
      (role ? access.roles : access.users).push(target.id);
    } else if (operation === "add") {
      if (!list.includes(target.id)) list.push(target.id);
    } else {
      const index = list.indexOf(target.id);
      if (index === -1) return message.reply(`${target} isn't on the **${command.name}** access list.`);
      list.splice(index, 1);
    }

    if (!access.users.length && !access.roles.length) db.delete(accessKey);
    else db.set(accessKey, access);
    return message.channel.send(`${approve} Updated **${command.name}** access for ${role ? target : target.user}.`);
  }
};
