const Discord = require('discord.js');
const { color } = require("../../config.json");
const { warn } = require('../../emojis.json')
const { approve, deny } = require('../../emojis.json')

module.exports = {
  name: "purge",
  aliases: ["clear", "prune", "c"],

  run: async (client, message, args) => {
    if (!message.member.hasPermission("MANAGE_MESSAGES")) return message.channel.send({ embed: { color: "efa23a", description: `${warn} ${message.author}: You're **missing** permission: \`manage_messages\`` } });
    if (!message.guild.me.hasPermission("MANAGE_MESSAGES")) return message.channel.send({ embed: { color: "efa23a", description: `${warn} ${message.author}: I'm **missing** permission: \`manage_messages\`` } });
    const purgehelpEmbed = new Discord.MessageEmbed()
      .setAuthor(message.author.username, message.author.avatarURL({
        dynamic: true
      }))
      .setTitle('Command: purge')
      .setDescription('Deletes up to 50 messages from the current channel, or up to 50 messages from one user')
      .addField('**Aliases**', 'clear, prune, c', true)
      .addField('**Parameters**', 'amount or user ID / mention', true)
      .addField('**Information**', `${warn} Manage Messages`, true)
      .addField('**Usage**', '\`\`\`Syntax: purge <amount (2-50)> OR purge <user ID / mention>\nExamples: purge 30 | purge 123456789012345678 | purge @member\`\`\`')
      .setFooter(`Module: moderation`)
      .setTimestamp()
      .setColor(color)
    if (!args[0]) return message.channel.send(purgehelpEmbed);

    const userMention = message.mentions.users.first();
    const mentionId = args[0].match(/^<@!?(\d{17,20})>$/);
    const targetId = userMention && userMention.id || (mentionId && mentionId[1]) || (/^\d{17,20}$/.test(args[0]) ? args[0] : null);

    if (targetId) {
      let deleted = 0;
      let before;
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

      try {
        while (true) {
          const batch = await message.channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
          if (!batch.size) break;
          before = batch.last().id;

          const matching = batch.filter(msg => msg.author.id === targetId);
          if (!matching.size) continue;

          const remaining = 50 - deleted;
          const selectedIds = new Set(matching.first(remaining).map(msg => msg.id));
          const selected = matching.filter(msg => selectedIds.has(msg.id));

          const recent = selected.filter(msg => msg.createdTimestamp > cutoff);
          const older = selected.filter(msg => msg.createdTimestamp <= cutoff);

          if (recent.size > 1) {
            const removed = await message.channel.bulkDelete(recent, true);
            deleted += removed.size;
          } else if (recent.size === 1) {
            try { await recent.first().delete(); deleted++; }
            catch (error) { if (error.code !== 10008) throw error; }
          }

          // Discord rejects bulk deletion for messages older than 14 days.
          for (const oldMessage of older.values()) {
            try { await oldMessage.delete(); deleted++; }
            catch (error) { if (error.code !== 10008) throw error; }
          }
          if (deleted >= 50) break;
        }

        const response = await message.channel.send(`${approve} Deleted **${deleted}** messages from user ${targetId} in this channel.`);
        setTimeout(() => response.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error("[purge user]", error);
        const response = await message.channel.send(`${deny} Purge stopped after deleting **${deleted}** messages. Discord returned an error: ${error.message}`);
        setTimeout(() => response.delete().catch(() => {}), 8000);
      }
      return;
    }

    const amountToDelete = Number(args[0], 10);
    if (isNaN(amountToDelete)) return message.channel.send('Make sure you put in a number. Do \`purge\` to see the variables');
    if (!Number.isInteger(amountToDelete)) return message.channel.send('Make sure you put in a number and not an integer. Do \`purge\` to see the variables');
    if (!amountToDelete || amountToDelete < 2 || amountToDelete > 50) return message.channel.send(`${warn} Invalid amount. Make sure it is between **2-50**`)
    const fetched = await message.channel.messages.fetch({
      limit: amountToDelete
    });

    try {
      await message.channel.bulkDelete(fetched)
      return message.channel.send(`Purged **${fetched.size}** messages 👍`).then(msg => {
        msg.delete({ timeout: 1000 })
      })
    } catch (err) {
      console.log(err);
      return message.channel.send(`${deny} Unable to **purge**`)
    }
  }
}
