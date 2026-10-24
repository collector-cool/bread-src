const Discord = require('discord.js');
const moment = require('moment');
const { color } = require("../../config.json");
const { verifiedBotDev } = require("../../emojis.json");
const { bugHunter } = require("../../emojis.json");
const { bugHunterPlus } = require("../../emojis.json");
const { discordPartner } = require("../../emojis.json");
const { discordStaff } = require("../../emojis.json");
const { hypeSquad } = require("../../emojis.json");
const { hypeSquadBravery } = require("../../emojis.json");
const { hypeSquadBril } = require("../../emojis.json");
const { hypeSquadBal } = require("../../emojis.json");
const { verifiedBot } = require("../../emojis.json");
const { earlySupporter } = require("../../emojis.json");

const flags = {
  DISCORD_EMPLOYEE: `${discordStaff}`,
  DISCORD_PARTNER: `${discordPartner}`,
  BUGHUNTER_LEVEL_1: `${bugHunter}`,
  BUGHUNTER_LEVEL_2: `${bugHunterPlus}`,
  HYPESQUAD_EVENTS: `${hypeSquad}`,
  HOUSE_BRAVERY: `${hypeSquadBravery}`,
  HOUSE_BRILLIANCE: `${hypeSquadBril}`,
  HOUSE_BALANCE: `${hypeSquadBal}`,
  EARLY_SUPPORTER: `${earlySupporter}`,
  VERIFIED_BOT: `${verifiedBot}`,
  VERIFIED_DEVELOPER: `${verifiedBotDev}`
};

module.exports = {
  name: "userinfo",
  aliases: ["ui", "whois", "info"],

  run: async (client, message, args) => {
    let mentionedMember = await message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(r => r.user.username.toLowerCase() === args.join(' ').toLocaleLowerCase()) || message.guild.members.cache.find(r => r.displayName.toLowerCase() === args.join(' ').toLocaleLowerCase()) || args[0] || message.member;

    const member = (mentionedMember && mentionedMember.roles) ? mentionedMember : message.member;
    let user = await client.users.fetch(member.id).catch(() => null);
    if (!user) user = message.author;
    const userFlags = user.flags.toArray();

    let nickname = member.nickname
    if (nickname) {
      nickname = `∙ ${member.nickname}`;
    } else {
      nickname = ''
    }

    let flags2 = user.flags2
    if (flags) {
      flags2 = `∙ ${userFlags.length ? userFlags.map(flag => flags[flag]).join(' ') : ' '}`;
    } else {
      flags2 = ''
    }

    const activities = [];
    let customStatus;
    for (const activity of (member.presence ? member.presence.activities.values() : [])) {
      switch (activity.type) {
        case 'LISTENING':
          if (user.bot) activities.push(`Listening to **${activity.name}**`);
          else activities.push(`Listening to [**${activity.details}**](https://open.spotify.com/) by **${activity.state}**`);
          break;
        case 'CUSTOM_STATUS':
          customStatus = activity.state;
          break;
      }
    }

    const userPos = message.guild.members.cache
      .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp)
      .array();

    const position = new Promise((fui) => {
      for (let i = 1; i < userPos.length + 1; i++) {
        if (userPos[i - 1].id === user.id) fui(i);
      }
    });

    let bot;
    if (user.bot === true) {
      bot = "Discord Bot";
    } else {
      bot = "N/A";
    }

    const roles = member.roles.cache
      .sort((a, b) => b.position - a.position)
      .map(role => role.toString())
      .slice(0, -1);

    const embed = new Discord.MessageEmbed()
      .setAuthor(`${message.author.username}`, message.author.displayAvatarURL({
        dynamic: true,
        size: 2048
      }))
      .setTitle(`${user.tag} ${nickname} ${flags2}`)
      .setDescription(`${activities.join('\n')}\n\`\`${user.id}\`\` ∙ Join position: ${await position || "N/A"}`)
      .setColor(member.displayHexColor || color)
      .setThumbnail(user.displayAvatarURL({ format: "png", dynamic: true, size: 2048 }))
      .setFooter(`${bot}`)
      .setTimestamp()
      .addFields(
        {
          name: "**Joined Discord On**",
          value: `${moment(user.createdAt).format("dddd, MMMM Do YYYY, h:mm A")}`,
          inline: true
        },
        {
          name: "**Joined Guild On**",
          value: `${member.joinedAt === 0
            ? `N/A`
            : `${moment(member.joinedAt).format("dddd, MMMM Do YYYY, h:mm A")}`
            }`,
          inline: true
        },
        {
          name: '**Boosted Guild On**',
          value: `${member.premiumSinceTimestamp === 0
            ? `N/A`
            : `${moment(member.premiumSince).format("dddd, MMMM Do YYYY, h:mm A")}`
            }`,
          inline: true
        },
        {
          name: `**Roles List [${roles.length}]** `,
          value: member.roles.cache
            .sort((a, b) => b.position - a.position)
            .filter(role => role.toString() !== "@everyone")
            .map(role => role.toString())
            .join(", "),
          inline: true
        }
      )

    await message.channel.send(embed)
  }
}