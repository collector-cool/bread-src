const Discord = require("discord.js");
const db = require("quick.db");
const fetch = require("node-fetch");

// The host bot is discord.js 12. Its gateway emits raw dispatch packets, so
// VoiceMaster uses Discord's documented Interactions HTTP API for components
// while leaving the rest of this legacy bot on its current library version.
const API = "https://discord.com/api/v10";
const ROOM = "vmroom_";
const SETUP = "vmsetup_";
const OWNER = "vmowner_";
const createLocks = new Set();
const EMBED = {
  title: "🎙️ VoiceMaster",
  description: "Create and manage your own temporary voice room with the shared controls below.",
  color: 0x5865f2,
  footer: { text: "Only channel owners and authorized administrators can perform restricted actions." }
};
const button = (id, label, emoji, style = 2) => ({ type: 2, style, custom_id: `vm:${id}`, label, emoji: { name: emoji } });
const components = [
  { type: 1, components: [button("rename", "Rename", "✏️"), button("lock", "Lock / Unlock", "🔒"), button("hide", "Hide / Reveal", "👁️"), button("limit", "Set Limit", "👥")] },
  { type: 1, components: [button("permit", "Permit", "➕"), button("reject", "Reject", "➖"), button("disconnect", "Disconnect", "🔇"), button("transfer", "Transfer Owner", "👑")] },
  { type: 1, components: [button("region", "Set Region", "🌍"), button("delete", "Delete Room", "🗑️", 4), button("refresh", "My Room Status", "🔄", 1)] }
];
const commands = [
  { name: "voicemaster", description: "Set up and manage temporary voice rooms", options: [
    { type: 1, name: "setup", description: "Create VoiceMaster channels and the shared button panel" },
    { type: 1, name: "panel", description: "Refresh or recreate the shared VoiceMaster panel" }
  ] }
];
const cfgFor = guildId => db.get(SETUP + guildId) || null;
const roomFor = channelId => db.get(ROOM + channelId) || null;
const ownerKey = (guildId, userId) => `${OWNER}${guildId}_${userId}`;
const singleFlight = async (locks, key, work) => {
  if (locks.has(key)) return false;
  locks.add(key);
  try { await work(); return true; }
  finally { locks.delete(key); }
};
const isManagedRoom = (guildId, channel, room) => !!(channel && room && room.guildId === guildId && channel.id === room.channelId && channel.type === "voice");
const clean = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
const idOf = member => member && (member.user ? member.user.id : member.id);

async function api(path, method, body) {
  const token = process.env.TOKEN;
  if (!token) throw new Error("TOKEN is not configured");
  const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && data.message ? data.message : `Discord API returned ${response.status}`);
  return data;
}

function panelPayload(cfg) {
  return { embeds: [{
    ...EMBED,
    fields: [
      { name: "🚪 Create your room", value: cfg.triggerId ? `Join <#${cfg.triggerId}> and your room will be created automatically.` : "Join the configured Join to Create voice channel; your room will appear automatically." },
      { name: "⚙️ Customize", value: "Use the buttons to rename, lock, hide, set capacity, or change your room region." },
      { name: "👥 Manage members", value: "Permit or reject members, disconnect someone, or transfer ownership. Only you and authorized managers can change your room." }
    ]
  }], components };
}
async function ensurePanel(client, guild) {
  const cfg = cfgFor(guild.id);
  if (!cfg) throw new Error("Run /voicemaster setup first");
  const channel = guild.channels.cache.get(cfg.panelChannelId || cfg.panelId);
  if (!channel || channel.type !== "text") throw new Error("Configured panel text channel is missing");
  let messageId = cfg.panelMessageId;
  if (messageId) {
    try {
      await api(`/channels/${channel.id}/messages/${messageId}`, "PATCH", panelPayload(cfg));
      return messageId;
    } catch (error) {
      if (!/Unknown Message|10008/i.test(error.message)) throw error;
      messageId = null;
    }
  }
  const created = await api(`/channels/${channel.id}/messages`, "POST", panelPayload(cfg));
  cfg.panelChannelId = channel.id;
  cfg.panelMessageId = created.id;
  db.set(SETUP + guild.id, cfg);
  return created.id;
}

async function setupGuild(client, guild) {
  if (!guild.me.hasPermission("MANAGE_CHANNELS") || !guild.me.hasPermission("MOVE_MEMBERS")) throw new Error("Bot requires Manage Channels and Move Members");
  let cfg = cfgFor(guild.id);
  const made = [];
  try {
    let category = cfg && guild.channels.cache.get(cfg.categoryId);
    if (!category || category.type !== "category") { category = await guild.channels.create("VoiceMaster", { type: "category" }); made.push(category); }
    let trigger = cfg && guild.channels.cache.get(cfg.triggerId);
    if (!trigger || trigger.type !== "voice") { trigger = await guild.channels.create("Join to Create", { type: "voice", parent: category.id }); made.push(trigger); }
    let panel = guild.channels.cache.get(cfg && (cfg.panelChannelId || cfg.panelId));
    if (!panel || panel.type !== "text") { panel = await guild.channels.create("voice-master", { type: "text", parent: category.id, topic: "Shared VoiceMaster control panel" }); made.push(panel); }
    cfg = Object.assign({}, cfg, { guildId: guild.id, categoryId: category.id, triggerId: trigger.id, panelChannelId: panel.id });
    db.set(SETUP + guild.id, cfg);
    // Backward compatibility with the former prefix-trigger configuration.
    db.set(`vm_${guild.id}`, trigger.id);
    db.set(`vmcontrols_${guild.id}`, panel.id);
    const messageId = await ensurePanel(client, guild);
    return { category, trigger, panel, messageId };
  } catch (error) {
    // Only roll back newly created channels if setup never persisted successfully.
    if (!cfgFor(guild.id)) await Promise.all(made.reverse().map(ch => ch.delete("VoiceMaster setup rollback").catch(() => {})));
    throw error;
  }
}

function respondPath(interaction) { return `/interactions/${interaction.id}/${interaction.token}/callback`; }
async function reply(interaction, content, ephemeral = true, embeds) {
  const body = { type: 4, data: { content, flags: ephemeral ? 64 : 0, ...(embeds ? { embeds } : {}) } };
  return api(respondPath(interaction), "POST", body);
}
async function showModal(interaction, title, customId, fields) {
  return api(respondPath(interaction), "POST", { type: 9, data: { custom_id: customId, title, components: fields.map(field => ({ type: 1, components: [{ type: 4, custom_id: field.id, label: field.label, style: 1, min_length: field.min || 1, max_length: field.max || 100, required: true, ...(field.placeholder ? { placeholder: field.placeholder } : {}) }] })) } });
}
async function defer(interaction) {
  const result = await api(respondPath(interaction), "POST", { type: 5, data: { flags: 64 } });
  interaction._vmDeferred = true;
  return result;
}
async function editReply(interaction, content, embeds) {
  return api(`/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, "PATCH", { content, embeds: embeds || [], components: [] });
}
function ephemeralMenu(title, customId, type, options) {
  const select = type === 5
    ? { type: 5, custom_id: customId, min_values: 1, max_values: 1, placeholder: title }
    : { type: 3, custom_id: customId, min_values: 1, max_values: 1, placeholder: title, options };
  return { type: 4, data: { content: title, flags: 64, components: [{ type: 1, components: [select] }] } };
}
function permission(member, bit) {
  const value = member && member.permissions;
  if (Array.isArray(value)) return value.includes(bit);
  try { return (BigInt(value || 0) & BigInt(bit)) === BigInt(bit); } catch (error) { return false; }
}

async function resolveRoom(client, interaction) {
  const guild = client.guilds.cache.get(interaction.guild_id);
  if (!guild) throw new Error("This control is available only in a server.");
  const memberId = idOf(interaction.member);
  const indexed = db.get(ownerKey(guild.id, memberId));
  let room = indexed && roomFor(indexed);
  let channel = room && guild.channels.cache.get(indexed);
  if (!room || room.guildId !== guild.id || room.ownerId !== memberId || !channel || channel.type !== "voice") {
    const cached = guild.members.cache.get(memberId);
    const currentId = cached && cached.voice && cached.voice.channelID;
    channel = currentId && guild.channels.cache.get(currentId);
    room = channel && roomFor(channel.id);
  }
  if (!room || !channel || room.guildId !== guild.id || channel.type !== "voice") throw new Error("You don't have an active VoiceMaster channel. Join the Join to Create channel first.");
  const isOwner = room.ownerId === memberId;
  const isAdmin = permission(interaction.member, "16"); // MANAGE_CHANNELS
  if (!isOwner && !isAdmin) throw new Error("Only this room's owner or an authorized administrator can use that control.");
  const botPermissions = channel.permissionsFor(guild.me);
  if (!botPermissions || !botPermissions.has("MANAGE_CHANNELS")) throw new Error("I need Manage Channels in your room.");
  return { guild, memberId, room, channel, isOwner, isAdmin, botPermissions };
}

function statusEmbed(room, channel) {
  return { title: `🎙️ ${channel.name}`, color: 0x5865f2, fields: [
    { name: "Owner", value: `<@${room.ownerId}>`, inline: true },
    { name: "Members", value: `${channel.members.size} / ${channel.userLimit || "Unlimited"}`, inline: true },
    { name: "Lock", value: room.locked ? "Locked" : "Unlocked", inline: true },
    { name: "Visibility", value: room.hidden ? "Hidden" : "Visible", inline: true }
  ] };
}

async function interactionHandler(client, interaction) {
  const data = interaction.data || {};
  if (interaction.type === 3 && data.custom_id === "help:category") {
    try {
      const category = data.values && data.values[0];
      const helpCommand = client.commands.get("help");
      const ownerId = require("./config.json").owner;
      const valid = category && client.commands.some(command => (command.category || "other") === category);
      if (!valid || (category === "owner" && idOf(interaction.member) !== ownerId)) throw new Error("That help category is unavailable.");
      const guildId = interaction.guild_id;
      const prefix = db.get(`prefix_${guildId}`) || require("./config.json").default_prefix;
      return api(respondPath(interaction), "POST", { type: 7, data: {
        embeds: [helpCommand.buildCategory(client, prefix, category)],
        components: helpCommand.componentsFor(visibleHelpCategories(client, idOf(interaction.member)), category)
      } });
    } catch (error) {
      console.error("[help category]", error);
      return reply(interaction, error.message);
    }
  }
  if (interaction.type === 2 && data.name === "voicemaster") {
    const action = data.options && data.options[0] && data.options[0].name;
    try {
      await defer(interaction);
      if (!permission(interaction.member, "32")) throw new Error("You need Manage Server to configure VoiceMaster.");
      const guild = client.guilds.cache.get(interaction.guild_id);
      if (!guild) throw new Error("This command is only available in a server.");
      if (action === "setup") {
        const result = await setupGuild(client, guild);
        await editReply(interaction, `VoiceMaster is ready. Join <#${result.trigger.id}> to create a room. Shared controls are in <#${result.panel.id}>.`);
      } else {
        const id = await ensurePanel(client, guild);
        const cfg = cfgFor(guild.id);
        await editReply(interaction, `Shared VoiceMaster panel is ready: <#${cfg.panelChannelId}> (message ${id}).`);
      }
    } catch (error) {
      console.error("[voicemaster slash]", error);
      try { await editReply(interaction, `VoiceMaster: ${error.message}`); } catch (_) {}
    }
    return;
  }
  if (interaction.type !== 3 && interaction.type !== 5) return;
  const custom = data.custom_id || "";
  try {
    if (interaction.type === 5 && custom.startsWith("vm:modal:")) {
      await defer(interaction);
      const kind = custom.slice("vm:modal:".length);
      const resolved = await resolveRoom(client, interaction);
      const fields = data.components || [];
      const text = fields[0] && fields[0].components && clean(fields[0].components[0].value);
      if (kind === "rename") {
        if (!text || text.length > 100) throw new Error("Channel names must be between 1 and 100 characters.");
        await resolved.channel.setName(text);
        await editReply(interaction, `Renamed your room to **${text}**.`);
      } else if (kind === "limit") {
        const limit = Number(text);
        if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new Error("Choose a whole number from 0 (unlimited) to 99.");
        await resolved.channel.setUserLimit(limit);
        await editReply(interaction, `Room limit set to **${limit || "unlimited"}**.`);
      }
      return;
    }
    if (interaction.type === 3 && custom.startsWith("vm:delete:")) {
      if (custom.endsWith(":no")) return reply(interaction, "Room deletion cancelled.");
      const confirmed = custom.endsWith(":yes");
      const resolved = await resolveRoom(client, interaction);
      if (!confirmed) {
        return api(respondPath(interaction), "POST", { type: 4, data: { content: "Delete your temporary room? This cannot be undone.", flags: 64, components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: "vm:delete:yes", label: "Delete room" }, { type: 2, style: 2, custom_id: "vm:delete:no", label: "Cancel" }] }] } });
      }
      await defer(interaction);
      if (resolved.channel.members.size > 0 && resolved.channel.members.size > 1) {
        const others = [...resolved.channel.members.values()].filter(m => m.id !== resolved.memberId);
        if (others.length) throw new Error("Move everyone else out before deleting this room.");
      }
      const channelId = resolved.channel.id;
      await resolved.channel.delete("VoiceMaster room deleted by owner");
      db.delete(ROOM + channelId); db.delete(ownerKey(resolved.guild.id, resolved.room.ownerId));
      await editReply(interaction, "Your temporary room was deleted.");
      return;
    }
    if (interaction.type === 3 && custom.startsWith("vm:select:")) {
      await defer(interaction);
      const kind = custom.slice("vm:select:".length);
      const resolved = await resolveRoom(client, interaction);
      const selectedId = (data.values || [])[0];
      const target = selectedId && await resolved.guild.members.fetch(selectedId).catch(() => null);
      if (!target) throw new Error("That member is no longer available in this server.");
      if (["disconnect", "reject"].includes(kind) && target.id === resolved.guild.ownerId) throw new Error("Server administrators cannot be disconnected or rejected.");
      if (kind === "permit") {
        resolved.room.permitted = [...new Set([...(resolved.room.permitted || []), target.id])];
        resolved.room.rejected = (resolved.room.rejected || []).filter(id => id !== target.id);
        await resolved.channel.updateOverwrite(target.id, { VIEW_CHANNEL: true, CONNECT: true });
        db.set(ROOM + resolved.channel.id, resolved.room);
        await editReply(interaction, `Permitted <@${target.id}> to join **${resolved.channel.name}**.`);
      } else if (kind === "reject") {
        if (target.permissions.has("ADMINISTRATOR")) throw new Error("Administrator access cannot be overridden.");
        resolved.room.rejected = [...new Set([...(resolved.room.rejected || []), target.id])];
        resolved.room.permitted = (resolved.room.permitted || []).filter(id => id !== target.id);
        await resolved.channel.updateOverwrite(target.id, { VIEW_CHANNEL: false, CONNECT: false });
        if (target.voice.channelID === resolved.channel.id) {
          if (!resolved.botPermissions.has("MOVE_MEMBERS")) throw new Error("I need Move Members to disconnect that member.");
          await target.voice.kick();
        }
        db.set(ROOM + resolved.channel.id, resolved.room);
        await editReply(interaction, `Rejected <@${target.id}> from **${resolved.channel.name}**.`);
      } else if (kind === "disconnect") {
        if (target.voice.channelID !== resolved.channel.id) throw new Error("That member is no longer in your room.");
        if (!resolved.botPermissions.has("MOVE_MEMBERS")) throw new Error("I need Move Members to disconnect someone.");
        await target.voice.kick();
        await editReply(interaction, `Disconnected <@${target.id}>.`);
      } else if (kind === "transfer") {
        if (!resolved.channel.members.has(target.id)) throw new Error("Ownership can only be transferred to a member in your room.");
        const oldOwner = resolved.room.ownerId;
        await resolved.channel.updateOverwrite(oldOwner, { MANAGE_CHANNELS: false });
        resolved.room.ownerId = target.id;
        await resolved.channel.updateOverwrite(target.id, { MANAGE_CHANNELS: true, VIEW_CHANNEL: true, CONNECT: true });
        db.delete(ownerKey(resolved.guild.id, oldOwner));
        db.set(ownerKey(resolved.guild.id, target.id), resolved.channel.id);
        db.set(ROOM + resolved.channel.id, resolved.room);
        await editReply(interaction, `Ownership transferred to <@${target.id}>.`);
      }
      return;
    }
    if (interaction.type === 3 && custom === "vm:region-select") {
      await defer(interaction);
      const resolved = await resolveRoom(client, interaction);
      const region = (data.values || [])[0];
      await api(`/channels/${resolved.channel.id}`, "PATCH", { rtc_region: region === "auto" ? null : region });
      await editReply(interaction, `Voice region set to **${region === "auto" ? "Automatic" : region}**.`);
      return;
    }
    if (interaction.type === 3 && custom.startsWith("vm:")) {
      const action = custom.slice(3);
      if (["rename", "lock", "hide", "limit", "permit", "reject", "disconnect", "transfer", "region", "delete", "refresh"].includes(action)) {
        const cfg = cfgFor(interaction.guild_id);
        if (!cfg || interaction.message.id !== cfg.panelMessageId || interaction.channel_id !== cfg.panelChannelId) throw new Error("Use the current VoiceMaster panel in its configured channel.");
      }
      const resolved = await resolveRoom(client, interaction);
      if (action === "rename") return showModal(interaction, "Rename your room", "vm:modal:rename", [{ id: "name", label: "New room name", max: 100, placeholder: resolved.channel.name }]);
      if (action === "limit") return showModal(interaction, "Set room capacity", "vm:modal:limit", [{ id: "limit", label: "Capacity (0 = unlimited)", max: 2, placeholder: `${resolved.channel.userLimit || 0}` }]);
      if (["permit", "reject", "disconnect", "transfer"].includes(action)) {
        const prompt = { permit: "Choose a member to permit", reject: "Choose a member to reject", disconnect: "Choose a connected member", transfer: "Choose the new owner" }[action];
        const body = ephemeralMenu(prompt, `vm:select:${action}`, 5);
        if (action === "disconnect") body.data.components[0].components[0].max_values = 1;
        return api(respondPath(interaction), "POST", body);
      }
      if (action === "region") {
        const options = ["auto", "us-east", "us-west", "us-central", "us-south", "singapore", "south-korea", "sydney", "japan", "india", "rotterdam", "russia", "brazil"].map(value => ({ label: value === "auto" ? "Automatic" : value, value }));
        return api(respondPath(interaction), "POST", ephemeralMenu("Choose a supported voice region", "vm:region-select", 3, options));
      }
      if (action === "delete") return api(respondPath(interaction), "POST", { type: 4, data: { content: "Delete your temporary room?", flags: 64, components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: "vm:delete:yes", label: "Delete room" }, { type: 2, style: 2, custom_id: "vm:delete:no", label: "Cancel" }] }] } });
      await defer(interaction);
      if (action === "lock") {
        resolved.room.locked = !resolved.room.locked;
        await resolved.channel.updateOverwrite(resolved.guild.id, { CONNECT: resolved.room.locked ? false : null });
        for (const id of resolved.room.permitted || []) await resolved.channel.updateOverwrite(id, { CONNECT: true, VIEW_CHANNEL: true });
        db.set(ROOM + resolved.channel.id, resolved.room);
        return editReply(interaction, `Your room is now **${resolved.room.locked ? "locked" : "unlocked"}**.`);
      }
      if (action === "hide") {
        resolved.room.hidden = !resolved.room.hidden;
        await resolved.channel.updateOverwrite(resolved.guild.id, { VIEW_CHANNEL: resolved.room.hidden ? false : null });
        await resolved.channel.updateOverwrite(resolved.room.ownerId, { VIEW_CHANNEL: true, CONNECT: true, MANAGE_CHANNELS: true });
        for (const id of resolved.room.permitted || []) await resolved.channel.updateOverwrite(id, { VIEW_CHANNEL: true, CONNECT: true });
        db.set(ROOM + resolved.channel.id, resolved.room);
        return editReply(interaction, `Your room is now **${resolved.room.hidden ? "hidden" : "visible"}**.`);
      }
      if (action === "refresh") return editReply(interaction, "Your VoiceMaster room status:", [statusEmbed(resolved.room, resolved.channel)]);
    }
  } catch (error) {
    console.error("[voicemaster interaction]", error);
    try {
      if (interaction._vmDeferred || interaction.type === 5 || custom.startsWith("vm:delete:") || custom.startsWith("vm:select:") || custom === "vm:region-select") {
        try { await editReply(interaction, error.message); }
        catch (_) { await reply(interaction, error.message); }
      } else if (interaction.type === 3 && (custom.startsWith("vm:") || custom === "help:category")) await reply(interaction, error.message);
    } catch (_) {}
  }
}

function visibleHelpCategories(client, userId) {
  const ownerId = require("./config.json").owner;
  return [...new Set(client.commands.map(command => command.category || "other"))]
    .filter(category => category !== "owner" || userId === ownerId)
    .sort();
}

module.exports = function (client) {
  async function createRoom(state) {
    const guild = state.guild;
    const member = state.member;
    const cfg = cfgFor(guild.id);
    if (!member || !cfg || state.channelID !== cfg.triggerId) return;
    const key = `${guild.id}:${member.id}`;
    return singleFlight(createLocks, key, async () => {
      let created;
      try {
      if (member.voice.channelID !== cfg.triggerId) return;
      const existingId = db.get(ownerKey(guild.id, member.id));
      const existing = existingId && guild.channels.cache.get(existingId);
      if (existing && roomFor(existingId)) { await member.voice.setChannel(existing).catch(() => {}); return; }
      if (existingId) { db.delete(ownerKey(guild.id, member.id)); db.delete(ROOM + existingId); }
      const category = guild.channels.cache.get(cfg.categoryId);
      if (!category || category.type !== "category") return;
      if (!guild.me.hasPermission("MANAGE_CHANNELS") || !guild.me.hasPermission("MOVE_MEMBERS")) return;
      const room = { guildId: guild.id, ownerId: member.id, createdAt: Date.now(), locked: false, hidden: false, permitted: [], rejected: [] };
      created = await guild.channels.create(`${member.user.username}'s room`.slice(0, 100), { type: "voice", parent: category.id, userLimit: cfg.defaultLimit || 0, permissionOverwrites: [
        { id: guild.id, allow: ["VIEW_CHANNEL", "CONNECT"] },
        { id: member.id, allow: ["VIEW_CHANNEL", "CONNECT", "MANAGE_CHANNELS"] }
      ] });
      room.channelId = created.id;
      db.set(ROOM + created.id, room);
      db.set(ownerKey(guild.id, member.id), created.id);
      await member.voice.setChannel(created);
      } catch (error) {
        console.error("[voicemaster create]", error);
        if (created && created.members.size === 0) await created.delete("VoiceMaster creation failed").catch(() => {});
        if (created) { db.delete(ROOM + created.id); db.delete(ownerKey(guild.id, member.id)); }
      }
    });
  }

  client.on("voiceStateUpdate", (oldState, newState) => {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const cfg = cfgFor(guild.id);
    if (cfg && newState.channelID === cfg.triggerId && oldState.channelID !== cfg.triggerId) createRoom(newState);
    if (oldState.channelID && roomFor(oldState.channelID)) {
      const channel = guild.channels.cache.get(oldState.channelID);
      if (channel && channel.members.size === 0) setTimeout(async () => {
        const room = roomFor(oldState.channelID);
        if (!room || room.guildId !== guild.id) return;
        const current = guild.channels.cache.get(oldState.channelID);
        if (isManagedRoom(guild.id, current, room) && current.members.size === 0) {
          try { await current.delete("VoiceMaster room is empty"); }
          catch (error) { console.error("[voicemaster cleanup]", error.message); return; }
          db.delete(ROOM + oldState.channelID);
          db.delete(ownerKey(guild.id, room.ownerId));
        }
      }, 1500);
    }
  });

  client.on("raw", async packet => {
    try {
      if (packet && packet.t === "INTERACTION_CREATE") await interactionHandler(client, packet.d);
    } catch (error) { console.error("[voicemaster raw interaction]", error); }
  });

  client.on("ready", async () => {
    for (const guild of client.guilds.cache.values()) {
      try { await api(`/applications/${client.user.id}/guilds/${guild.id}/commands`, "PUT", commands); }
      catch (error) { console.error(`[voicemaster command registration ${guild.id}]`, error.message); }
    }
    for (const row of db.all()) {
      if (!row.ID.startsWith(ROOM)) continue;
      let room = row.data;
      if (typeof room === "string") { try { room = JSON.parse(room); } catch (_) { room = null; } }
      if (!room) { db.delete(row.ID); continue; }
      const guild = room && client.guilds.cache.get(room.guildId);
      // A temporarily unavailable guild is not evidence that its persisted room
      // was deleted. Keep its ownership record until that guild is available.
      if (!guild) continue;
      const channel = guild && guild.channels.cache.get(row.ID.slice(ROOM.length));
      if (!channel || channel.type !== "voice") {
        db.delete(row.ID);
        if (room) db.delete(ownerKey(room.guildId, room.ownerId));
      } else {
        room.channelId = channel.id;
        db.set(row.ID, room);
        db.set(ownerKey(room.guildId, room.ownerId), channel.id);
      }
      if (isManagedRoom(guild.id, channel, room) && channel.members.size === 0 && Date.now() - (room.createdAt || channel.createdTimestamp) > 30000) {
        try { await channel.delete("VoiceMaster stale room recovery"); db.delete(row.ID); db.delete(ownerKey(guild.id, room.ownerId)); }
        catch (error) { console.error("[voicemaster recovery]", error.message); }
      }
    }
    for (const guild of client.guilds.cache.values()) {
      try { const cfg = cfgFor(guild.id); if (cfg && cfg.panelChannelId) await ensurePanel(client, guild); }
      catch (error) { console.error(`[voicemaster panel recovery ${guild.id}]`, error.message); }
    }
  });

  module.exports.ensurePanel = ensurePanel;
  module.exports.setupGuild = setupGuild;
  module.exports.refreshPanel = async (guild, room, channel) => {
    const cfg = cfgFor(guild.id);
    if (cfg) await ensurePanel(client, guild);
  };
};

module.exports.ensurePanel = ensurePanel;
module.exports.setupGuild = setupGuild;
module.exports.constants = { ROOM, OWNER, SETUP };
module.exports._test = { ownerKey, singleFlight, isManagedRoom };
module.exports.api = api;
