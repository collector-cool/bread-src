const Discord = require("discord.js");
const db = require("quick.db");
const { default_prefix } = require("../../config.json");

const SETUP = "vmsetup_";
const ROOM = "vmroom_";
const PANEL = "vmpanel_";
const manager = require("../../voicemaster");

const findRoom = channelId => db.get(ROOM + channelId);
const parseId = value => value && value.match(/\d{17,20}/)?.[0];
const getRoomFor = member => member.voice.channelID && findRoom(member.voice.channelID);
const isManager = member => member.permissions.has("MANAGE_CHANNELS");

module.exports = {
  name: "voicemaster",
  aliases: ["vm", "jtc", "tempvoice"],
  run: async (client, message, args) => {
    if (!message.guild) return;
    const guild = message.guild;
    const prefix = db.get(`prefix_${guild.id}`) || default_prefix;
    const sub = (args.shift() || "config").toLowerCase();
    let cfg = db.get(SETUP + guild.id);

    if (sub === "setup") {
      if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply("You need Manage Server to configure VoiceMaster.");
      try {
        const result = await manager.setupGuild(client, guild);
        return message.channel.send({ embed: new Discord.MessageEmbed().setColor("#a3eb7b").setTitle("VoiceMaster is ready").setDescription(`Join ${result.trigger} to create a room.\nShared controls are in ${result.panel}.`).addField("Category", result.category.name) });
      } catch (err) {
        console.error("[voicemaster setup]", err);
        return message.reply(`Setup failed: ${err.message}`);
      }
    }

    if (sub === "config") {
      if (args.length) {
        if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply("You need Manage Server to change VoiceMaster configuration.");
        const field = args[0].toLowerCase();
        const id = parseId(args[1]);
        const selected = id && guild.channels.cache.get(id);
        if (!cfg) cfg = { categoryId: null, triggerId: null, panelId: null };
        if (field === "trigger" && selected && selected.type === "voice") cfg.triggerId = selected.id;
        else if (field === "category" && selected && selected.type === "category") cfg.categoryId = selected.id;
        else if (field === "panel" && selected && selected.type === "text") { cfg.panelId = selected.id; cfg.panelChannelId = selected.id; }
        else return message.reply(`Usage: \`${prefix}vm config <trigger|category|panel> #channel\` (use a voice channel, category, or text channel as appropriate).`);
        db.set(SETUP + guild.id, cfg);
        if (cfg.triggerId) db.set(`vm_${guild.id}`, cfg.triggerId);
        if (cfg.panelId) db.set(`vmcontrols_${guild.id}`, cfg.panelId);
        return message.reply(`VoiceMaster ${field} channel saved.`);
      }
      if (!cfg) {
        const legacyTrigger = db.get(`vm_${guild.id}`);
        if (legacyTrigger) cfg = { triggerId: legacyTrigger, panelId: db.get(`vmcontrols_${guild.id}`), categoryId: guild.channels.cache.get(legacyTrigger)?.parentID };
      }
      const trigger = cfg && guild.channels.cache.get(cfg.triggerId);
      const category = cfg && guild.channels.cache.get(cfg.categoryId);
      const panel = cfg && guild.channels.cache.get(cfg.panelChannelId || cfg.panelId);
      const embed = new Discord.MessageEmbed().setColor("#6495ED").setTitle("VoiceMaster configuration").setDescription(trigger ? `Join ${trigger} to create a room.` : "VoiceMaster is not configured.")
        .addField("Category", category ? category.name : "Not set", true).addField("Join to create", trigger ? trigger.name : "Not set", true).addField("Control panel", panel ? `${panel}` : "Not set", true)
        .addField("Commands", `\`${prefix}vm setup\`, \`${prefix}vm panel\`, \`${prefix}vm rename <name>\`, \`${prefix}vm limit <0-99>\`, \`${prefix}vm lock/unlock\`, \`${prefix}vm hide/reveal\`, \`${prefix}vm permit/reject @member\`, \`${prefix}vm transfer @member\`, \`${prefix}vm claim\`, \`${prefix}vm delete\``)
        .setFooter("This bot uses its existing prefix command system; discord.js 12 has no native buttons or slash-command support.");
      return message.channel.send(embed);
    }

    if (sub === "panel") {
      if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply("You need Manage Server to post the setup panel.");
      try {
        const id = await manager.ensurePanel(client, guild);
        cfg = db.get(SETUP + guild.id);
        return message.reply(`Shared VoiceMaster panel refreshed in <#${cfg.panelChannelId}> (message ${id}).`);
      } catch (err) { return message.reply(`Panel refresh failed: ${err.message}`); }
    }

    if (["clear", "off"].includes(sub)) {
      if (!message.member.hasPermission("MANAGE_GUILD")) return message.reply("You need Manage Server to disable VoiceMaster.");
      db.delete(SETUP + guild.id); db.delete(`vm_${guild.id}`); db.delete(`vmcontrols_${guild.id}`);
      return message.reply("VoiceMaster is disabled. Existing rooms will still be cleaned up normally.");
    }

    let room = getRoomFor(message.member);
    let channel = room && guild.channels.cache.get(message.member.voice.channelID);
    if (!room && ["claim"].includes(sub)) {
      channel = message.member.voice.channel;
      room = channel && findRoom(channel.id);
    }
    if (!room || !channel) return message.reply("Join your temporary VoiceMaster room first.");
    const botPermissions = channel.permissionsFor(guild.me);
    if (!botPermissions || !botPermissions.has("MANAGE_CHANNELS")) return message.reply("I need Manage Channels in this room to change it.");
    const admin = isManager(message.member);
    if (sub === "claim") {
      if (channel.members.has(room.ownerId) || !channel.members.has(message.author.id)) return message.reply("You can claim this room only while its owner is absent and you are in the room.");
      room.ownerId = message.author.id;
      await channel.updateOverwrite(message.author.id, { MANAGE_CHANNELS: true, VIEW_CHANNEL: true, CONNECT: true });
      db.set(ROOM + channel.id, room);
      return message.reply("You now own this room.");
    }
    if (message.author.id !== room.ownerId && !admin) return message.reply("Only the room owner or a channel manager can do that.");

    try {
      if (sub === "rename") {
        const name = args.join(" ").slice(0, 100); if (!name) return message.reply("Usage: `vm rename <name>`"); await channel.setName(name);
      } else if (sub === "limit") {
        const limit = Number(args[0]); if (!Number.isInteger(limit) || limit < 0 || limit > 99) return message.reply("Choose a user limit from 0 (unlimited) to 99."); await channel.setUserLimit(limit);
      } else if (["lock", "unlock", "hide", "reveal"].includes(sub)) {
        if (sub === "lock" || sub === "unlock") { room.locked = sub === "lock"; await channel.updateOverwrite(guild.id, { CONNECT: room.locked ? false : null }); }
        else { room.hidden = sub === "hide"; await channel.updateOverwrite(guild.id, { VIEW_CHANNEL: room.hidden ? false : null }); }
        db.set(ROOM + channel.id, room);
      } else if (["permit", "reject"].includes(sub)) {
        const id = parseId(args[0]); const target = id && await guild.members.fetch(id).catch(() => null); if (!target) return message.reply(`Mention a valid member: ${prefix}vm ${sub} @member`);
        if (sub === "reject" && target.voice.channelID === channel.id && !botPermissions.has("MOVE_MEMBERS")) return message.reply("I need Move Members to remove them from the room.");
        room.permitted = (room.permitted || []).filter(x => x !== id); room.rejected = (room.rejected || []).filter(x => x !== id);
        if (sub === "permit") { room.permitted.push(id); await channel.updateOverwrite(id, { CONNECT: true, VIEW_CHANNEL: true }); }
        else { room.rejected.push(id); await channel.updateOverwrite(id, { CONNECT: false, VIEW_CHANNEL: false }); if (target.voice.channelID === channel.id) await target.voice.kick(); }
        db.set(ROOM + channel.id, room);
      } else if (sub === "transfer") {
        const id = parseId(args[0]); const target = id && await guild.members.fetch(id).catch(() => null); if (!target || !channel.members.has(id)) return message.reply("Mention a member currently in your room.");
        await channel.updateOverwrite(room.ownerId, { MANAGE_CHANNELS: false }); room.ownerId = id; await channel.updateOverwrite(id, { MANAGE_CHANNELS: true, VIEW_CHANNEL: true, CONNECT: true }); db.set(ROOM + channel.id, room);
      } else if (sub === "delete") {
        if (admin && message.author.id !== room.ownerId && args[0] !== "confirm") return message.reply("As an admin, confirm deletion with `vm delete confirm`.");
        const panelId = room.panelId; await channel.delete("VoiceMaster room deleted by its owner"); db.delete(ROOM + channel.id); if (panelId) { db.delete(PANEL + panelId); const panel = cfg && guild.channels.cache.get(cfg.panelId); if (panel) panel.messages.delete(panelId).catch(() => {}); } return;
      } else return message.reply(`Unknown action. See \`${prefix}vm config\`.`);
      db.set(ROOM + channel.id, room);
      if (manager.refreshPanel) await manager.refreshPanel(guild, room, channel);
      return message.reply(`Updated **${channel.name}**.`);
    } catch (err) {
      console.error(`[voicemaster ${sub}]`, err);
      return message.reply(`That change failed: ${err.message}`);
    }
  }
};
