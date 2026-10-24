const Discord = require("discord.js");
const db = require("quick.db");

const CONFIG_PREFIX = "antinuke_";
const windows = new Map();
const seenAuditEntries = new Map();
const cooldowns = new Map();
const WINDOW_MS = 10000;
const AUDIT_LOOKBACK_MS = 12000;
const ALERT_COOLDOWN_MS = 30000;
const DANGEROUS_PERMISSIONS = [
  "ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES",
  "MANAGE_WEBHOOKS", "BAN_MEMBERS", "KICK_MEMBERS", "MANAGE_EMOJIS"
];

const configKey = guildId => CONFIG_PREFIX + guildId;
const defaultConfig = () => ({
  enabled: false,
  threshold: 3,
  windowSeconds: 10,
  watchCreates: false,
  action: "strip",
  managerRoleId: null,
  logChannelId: null,
  trustedUsers: [],
  trustedRoles: []
});
const getConfig = guildId => Object.assign(defaultConfig(), db.get(configKey(guildId)) || {});
const setConfig = (guildId, config) => db.set(configKey(guildId), config);

function isTrusted(config, guild, userId, member) {
  if (userId === guild.ownerID || config.trustedUsers.includes(userId)) return true;
  return !!(member && member.roles.cache.some(role => config.trustedRoles.includes(role.id)));
}

async function findExecutor(guild, auditAction, targetId) {
  // Audit entries can arrive just after the corresponding gateway event.
  await new Promise(resolve => setTimeout(resolve, 900));
  const logs = await guild.fetchAuditLogs({ type: auditAction, limit: 8 });
  const now = Date.now();
  return logs.entries.find(entry => {
    const entryTargetId = entry.target && entry.target.id;
    return entryTargetId === targetId && now - entry.createdTimestamp >= -2000 && now - entry.createdTimestamp <= AUDIT_LOOKBACK_MS;
  }) || null;
}

async function logAlert(client, guild, config, embed) {
  const channel = config.logChannelId && guild.channels.cache.get(config.logChannelId);
  const permissions = channel && channel.permissionsFor(guild.me);
  if (channel && channel.type === "text" && permissions && permissions.has("SEND_MESSAGES")) {
    await channel.send({ embed }).catch(error => console.error("[antinuke log]", error.message));
  }
}

async function punish(client, guild, executorId, config, eventNames) {
  const now = Date.now();
  const cooldownKey = `${guild.id}:${executorId}`;
  if ((cooldowns.get(cooldownKey) || 0) > now) return;
  cooldowns.set(cooldownKey, now + ALERT_COOLDOWN_MS);

  const actor = await guild.members.fetch(executorId).catch(() => null);
  if (!actor || isTrusted(config, guild, executorId, actor)) return;

  let response = "No punishment was applied.";
  const reason = `Anti-nuke: ${eventNames.length} destructive actions in ${config.windowSeconds}s`;
  try {
    if (config.action === "strip") {
      const roles = actor.roles.cache.filter(role => role.id !== guild.id && role.editable && DANGEROUS_PERMISSIONS.some(permission => role.permissions.has(permission)));
      if (roles.size && guild.me.hasPermission("MANAGE_ROLES")) {
        await actor.roles.remove(roles, reason);
        response = `Removed ${roles.size} dangerous role(s).`;
      } else response = "Could not remove roles; check my Manage Roles permission and role order.";
    } else if (config.action === "kick" && actor.kickable) {
      await actor.kick(reason);
      response = "Kicked the executor.";
    } else if (config.action === "ban" && actor.bannable) {
      await actor.ban({ reason });
      response = "Banned the executor.";
    } else {
      response = `Could not ${config.action} the executor; check my permissions and role order.`;
    }
  } catch (error) {
    console.error("[antinuke punish]", error);
    response = `Punishment failed: ${error.message}`;
  }

  const embed = new Discord.MessageEmbed()
    .setColor("#d83c3e")
    .setTitle("Anti-nuke threshold reached")
    .setDescription(`Executor: <@${executorId}>\nActions: **${eventNames.length}** in **${config.windowSeconds}s**\nDetected: ${eventNames.slice(-8).join(", ")}\nResponse: ${response}`)
    .setTimestamp();
  await logAlert(client, guild, config, embed);
}

async function record(client, guild, auditAction, targetId, label) {
  const config = getConfig(guild.id);
  if (!config.enabled || !guild.me.hasPermission("VIEW_AUDIT_LOG")) return;
  if (!config.watchCreates && (label === "channel create" || label === "role create")) return;
  try {
    const entry = await findExecutor(guild, auditAction, targetId);
    if (!entry || !entry.executor || entry.executor.id === client.user.id) return;
    const entryCache = seenAuditEntries.get(guild.id) || new Set();
    if (entryCache.has(entry.id)) return;
    entryCache.add(entry.id);
    seenAuditEntries.set(guild.id, entryCache);
    setTimeout(() => entryCache.delete(entry.id), 60000);

    const executorId = entry.executor.id;
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (isTrusted(config, guild, executorId, member)) return;

    const key = `${guild.id}:${executorId}`;
    const now = Date.now();
    const cutoff = now - config.windowSeconds * 1000;
    const recent = (windows.get(key) || []).filter(action => action.at >= cutoff);
    recent.push({ at: now, label });
    windows.set(key, recent);
    if (recent.length >= config.threshold) {
      windows.delete(key);
      await punish(client, guild, executorId, config, recent.map(action => action.label));
    }
  } catch (error) {
    console.error(`[antinuke ${guild.id} ${label}]`, error.message);
  }
}

module.exports = function (client) {
  client.on("channelDelete", channel => record(client, channel.guild, Discord.GuildAuditLogs.Actions.CHANNEL_DELETE, channel.id, "channel delete"));
  client.on("channelCreate", channel => record(client, channel.guild, Discord.GuildAuditLogs.Actions.CHANNEL_CREATE, channel.id, "channel create"));
  client.on("roleDelete", role => record(client, role.guild, Discord.GuildAuditLogs.Actions.ROLE_DELETE, role.id, "role delete"));
  client.on("roleCreate", role => record(client, role.guild, Discord.GuildAuditLogs.Actions.ROLE_CREATE, role.id, "role create"));
  client.on("roleUpdate", (oldRole, newRole) => {
    const gainedDanger = DANGEROUS_PERMISSIONS.some(permission => !oldRole.permissions.has(permission) && newRole.permissions.has(permission));
    if (gainedDanger) record(client, newRole.guild, Discord.GuildAuditLogs.Actions.ROLE_UPDATE, newRole.id, "dangerous role permission grant");
  });
  client.on("guildBanAdd", (guild, user) => record(client, guild, Discord.GuildAuditLogs.Actions.MEMBER_BAN_ADD, user.id, "member ban"));
  client.on("guildMemberRemove", member => record(client, member.guild, Discord.GuildAuditLogs.Actions.MEMBER_KICK, member.id, "member kick"));
  client.on("guildMemberAdd", member => {
    if (member.user.bot) record(client, member.guild, Discord.GuildAuditLogs.Actions.BOT_ADD, member.id, "bot added");
  });

  // Keep transient counters bounded if a server is very active.
  setInterval(() => {
    const now = Date.now();
    for (const [key, actions] of windows) {
      const recent = actions.filter(action => action.at >= now - 120000);
      if (recent.length) windows.set(key, recent);
      else windows.delete(key);
    }
    for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
  }, 30000);
};

module.exports.getConfig = getConfig;
module.exports.setConfig = setConfig;
module.exports.configKey = configKey;
