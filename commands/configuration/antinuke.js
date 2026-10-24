const Discord = require("discord.js");
const { default_prefix } = require("../../config.json");
const { approve, warn } = require("../../emojis.json");
const protection = require("../../antinuke");

const idFrom = value => value && value.match(/\d{17,20}/)?.[0];

module.exports = {
  name: "antinuke",
  aliases: ["anti-nuke"],
  category: "configuration",
  description: "Configure audit-log-based anti-nuke protection",
  run: async (client, message, args) => {
    if (!message.guild) return;
    const prefix = client.db.get(`prefix_${message.guild.id}`) || default_prefix;

    const guild = message.guild;
    const config = protection.getConfig(guild.id);
    const subcommand = (args.shift() || "status").toLowerCase();
    const save = () => protection.setConfig(guild.id, config);
    const showStatus = () => {
      const logChannel = config.logChannelId && guild.channels.cache.get(config.logChannelId);
      const embed = new Discord.MessageEmbed()
        .setColor(config.enabled ? "#a3eb7b" : "#939393")
        .setTitle("Anti-nuke protection")
        .setDescription(`Status: **${config.enabled ? "Enabled" : "Disabled"}**\nThreshold: **${config.threshold} destructive actions**\nWindow: **${config.windowSeconds} seconds**\nResponse: **${config.action}**\nCreate flood guard: **${config.watchCreates ? "Enabled" : "Disabled"}**\nSettings role: ${config.managerRoleId ? `<@&${config.managerRoleId}>` : "Manage Server permission"}\nAlert channel: ${logChannel || "Not set"}`)
        .addField("Trusted users", config.trustedUsers.length ? config.trustedUsers.map(id => `<@${id}>`).join(", ") : "None", true)
        .addField("Trusted roles", config.trustedRoles.length ? config.trustedRoles.map(id => `<@&${id}>`).join(", ") : "None", true)
        .addField("Commands", `\`${prefix}antinuke enable|disable\` · \`${prefix}antinuke threshold <2-20>\` · \`${prefix}antinuke window <5-120>\`\n\`${prefix}antinuke action <strip|kick|ban>\` · \`${prefix}antinuke createguard <on|off>\`\n\`${prefix}antinuke log #channel|off\` · \`${prefix}antinuke whitelist <user|role> <add|remove> <mention|ID>\`\n\`${prefix}antinuke permissions [set @role|clear]\``);
      return message.channel.send(embed);
    };

    if (subcommand === "permissions") {
      const operation = (args[0] || "").toLowerCase();
      if (operation === "set") {
        if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply("Only someone with Manage Server can set the anti-nuke manager role.");
        const role = message.mentions.roles.first() || (args[1] && guild.roles.cache.get(idFrom(args[1])));
        if (!role || role.id === guild.id) return message.reply(`Usage: \`${prefix}antinuke permissions set @role\`.`);
        config.managerRoleId = role.id;
        save();
        return message.channel.send(`${approve} ${role} can now manage anti-nuke settings. Manage Server members can still configure it.`);
      }
      if (operation === "clear") {
        if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply("Only someone with Manage Server can clear the anti-nuke manager role.");
        config.managerRoleId = null;
        save();
        return message.channel.send(`${approve} Anti-nuke settings are now limited to members with Manage Server.`);
      }
      const bot = guild.me;
      const checks = [
        ["View Audit Log", bot.hasPermission("VIEW_AUDIT_LOG")],
        ["Manage Roles (strip response)", bot.hasPermission("MANAGE_ROLES")],
        ["Kick Members (kick response)", bot.hasPermission("KICK_MEMBERS")],
        ["Ban Members (ban response)", bot.hasPermission("BAN_MEMBERS")]
      ];
      const permissionsEmbed = new Discord.MessageEmbed()
        .setColor("#5865f2")
        .setTitle("Anti-nuke permissions")
        .setDescription(checks.map(([name, granted]) => `${granted ? "✅" : "❌"} **${name}**`).join("\n"))
        .addField("Settings access", config.managerRoleId ? `<@&${config.managerRoleId}> or Manage Server` : "Manage Server")
        .setFooter("Bot permissions must be granted in Discord server settings; commands cannot grant them to the bot.");
      return message.channel.send(permissionsEmbed);
    }

    const delegated = config.managerRoleId && message.member.roles.cache.has(config.managerRoleId);
    if (!message.member.hasPermission("MANAGE_GUILD") && !delegated) return message.reply("You need Manage Server or the configured anti-nuke manager role.");

    if (subcommand === "status") return showStatus();
    if (subcommand === "enable") {
      if (!guild.me.hasPermission("VIEW_AUDIT_LOG")) return message.reply(`${warn} I need **View Audit Log** to identify who performed destructive actions.`);
      const required = config.action === "strip" ? "MANAGE_ROLES" : config.action === "kick" ? "KICK_MEMBERS" : "BAN_MEMBERS";
      if (!guild.me.hasPermission(required)) return message.reply(`${warn} I need **${required.replace(/_/g, " ")}** for the configured anti-nuke response.`);
      config.enabled = true;
      save();
      return message.channel.send(`${approve} Anti-nuke protection is now **enabled**. It watches audit logs and uses a threshold of ${config.threshold} actions in ${config.windowSeconds}s.`);
    }
    if (subcommand === "disable") {
      config.enabled = false;
      save();
      return message.channel.send(`${approve} Anti-nuke protection is now **disabled**.`);
    }
    if (subcommand === "threshold") {
      const threshold = Number(args[0]);
      if (!Number.isInteger(threshold) || threshold < 2 || threshold > 20) return message.reply("Set the threshold to a whole number from 2 to 20.");
      config.threshold = threshold;
      save();
      return message.channel.send(`${approve} Anti-nuke threshold set to **${threshold} actions**.`);
    }
    if (subcommand === "window") {
      const seconds = Number(args[0]);
      if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) return message.reply("Set the detection window to a whole number from 5 to 120 seconds.");
      config.windowSeconds = seconds;
      save();
      return message.channel.send(`${approve} Anti-nuke window set to **${seconds} seconds**.`);
    }
    if (subcommand === "createguard") {
      const value = (args[0] || "").toLowerCase();
      if (!["on", "off", "enable", "disable"].includes(value)) return message.reply("Choose `on` or `off` for create flood detection.");
      config.watchCreates = value === "on" || value === "enable";
      save();
      return message.channel.send(`${approve} Channel and role create flood detection is now **${config.watchCreates ? "enabled" : "disabled"}**.`);
    }
    if (subcommand === "action") {
      const action = (args[0] || "").toLowerCase();
      if (!["strip", "kick", "ban"].includes(action)) return message.reply("Choose a response: `strip`, `kick`, or `ban`.");
      const permission = action === "strip" ? "MANAGE_ROLES" : action === "kick" ? "KICK_MEMBERS" : "BAN_MEMBERS";
      if (!guild.me.hasPermission(permission)) return message.reply(`${warn} I need **${permission.replace(/_/g, " ")}** before you can use that response.`);
      config.action = action;
      save();
      return message.channel.send(`${approve} Anti-nuke response set to **${action}**.`);
    }
    if (subcommand === "log") {
      const channel = message.mentions.channels.first() || (args[0] && guild.channels.cache.get(idFrom(args[0])));
      const channelPermissions = channel && channel.permissionsFor(guild.me);
      if ((args[0] || "").toLowerCase() === "off") config.logChannelId = null;
      else if (channel && channel.type === "text" && channelPermissions && channelPermissions.has("SEND_MESSAGES")) config.logChannelId = channel.id;
      else return message.reply(`Usage: \`${prefix}antinuke log #text-channel\` or \`${prefix}antinuke log off\`.`);
      save();
      return message.channel.send(`${approve} Anti-nuke alert channel ${config.logChannelId ? `set to <#${config.logChannelId}>` : "cleared"}.`);
    }
    if (subcommand === "whitelist") {
      const type = (args[0] || "").toLowerCase();
      const operation = (args[1] || "").toLowerCase();
      const targetId = idFrom(args[2]) || idFrom(message.mentions.users.first()?.id) || idFrom(message.mentions.roles.first()?.id);
      if (!["user", "role"].includes(type) || !["add", "remove"].includes(operation) || !targetId) {
        return message.reply(`Usage: \`${prefix}antinuke whitelist <user|role> <add|remove> <mention|ID>\`.`);
      }
      const list = type === "user" ? config.trustedUsers : config.trustedRoles;
      if (operation === "add" && !list.includes(targetId)) list.push(targetId);
      if (operation === "remove") {
        const index = list.indexOf(targetId);
        if (index !== -1) list.splice(index, 1);
      }
      save();
      return message.channel.send(`${approve} ${type === "user" ? `<@${targetId}>` : `<@&${targetId}>`} ${operation === "add" ? "added to" : "removed from"} the trusted ${type} list.`);
    }

    return showStatus();
  }
};
