const Discord = require('discord.js');
const google = require('google');
const { color } = require("../../config.json");

module.exports = {
  name: "google",
  aliases: ["g"],
  category: "utility",

  run: async (client, message, args) => {
    if (!args.length) return message.reply("Please provide something to search for.");
    let mentionedMember = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!mentionedMember) mentionedMember = message.member;

    message.channel.startTyping();
    google.resultsPerPage = 3;

    google(args.join("+"), function (err, res) {
      try {
      const links = res && Array.isArray(res.links) ? res.links : [];
      const link = links.find(result => result && result.href && result.title);
      if (err || !link) {
        message.channel.stopTyping(true);
        return message.channel.send({ embed: { color: "#6495ED", description: `:mag_right: ${message.author}: No results found for **${args.join(' ')}**` } });
      }
      let googleIcon = 'https://maxcdn.icons8.com/Share/icon/Logos//google_logo1600.png';

      const embed = new Discord.MessageEmbed()
        .setColor(mentionedMember.displayHexColor || color)
        .setAuthor(`${message.author.username}`, message.author.displayAvatarURL({
          dynamic: true,
          size: 2048
        }))
        .setTitle(`Search Results for ${args.join(' ')}`)
        .setFooter("Google search")
        .addField(`**${link.title}**`, `${link.href}${link.description ? `\n${link.description}` : ""}`)

      message.channel.stopTyping(true);
      message.channel.send(embed).catch(e => message.channel.send("There was an error: " + e.message));
      } catch (error) {
        console.error("[google search]", error);
        message.channel.send("Google search failed. Please try again later.").catch(() => {});
      } finally {
        message.channel.stopTyping(true);
      }
    });
  }
}
