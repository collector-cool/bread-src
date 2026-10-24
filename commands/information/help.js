const Discord = require("discord.js");
const db = require("quick.db");
const { default_prefix, color } = require("../../config.json");
const interactionApi = require("../../voicemaster");

const titleFor = value => value.charAt(0).toUpperCase() + value.slice(1);

function visibleCategories(client, userId) {
  const ownerId = require("../../config.json").owner;
  return [...new Set(client.commands.map(command => command.category || "other"))]
    .filter(category => category !== "owner" || userId === ownerId)
    .sort();
}

function embedFor(client, prefix, category) {
  const commands = client.commands
    .filter(command => (command.category || "other") === category)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lines = commands.map(command => {
    const aliases = command.aliases && command.aliases.length ? ` · aliases: ${command.aliases.map(alias => `\`${alias}\``).join(", ")}` : "";
    const description = command.description || command.help && command.help.description;
    return `**${prefix}${command.name}**${description ? ` — ${description}` : ""}${aliases}`;
  });

  return new Discord.MessageEmbed()
    .setColor(color)
    .setAuthor(`${client.user.username} help`, client.user.displayAvatarURL())
    .setTitle(`${titleFor(category)} Commands`)
    .setDescription(lines.join("\n").slice(0, 4000) || "No commands are available in this category.")
    .setFooter(`Use ${prefix}help to select another category.`);
}

function componentsFor(categories, selected) {
  return [{ type: 1, components: [{
    type: 3,
    custom_id: "help:category",
    placeholder: "Choose a command category",
    min_values: 1,
    max_values: 1,
    options: categories.map(category => ({
      label: titleFor(category),
      value: category,
      description: `Browse ${titleFor(category)} commands`.slice(0, 100),
      default: category === selected
    }))
  }] }];
}

module.exports = {
  name: "help",
  category: "information",
  description: "Browse bot commands by category",
  run: async (client, message) => {
    if (!message.guild || message.author.bot) return;
    const prefix = db.get(`prefix_${message.guild.id}`) || default_prefix;
    const categories = visibleCategories(client, message.author.id);
    const initialCategory = categories.includes("information") ? "information" : categories[0];
    const embed = embedFor(client, prefix, initialCategory);
    const helpMessage = await message.channel.send({ embed });

    try {
      await interactionApi.api(`/channels/${helpMessage.channel.id}/messages/${helpMessage.id}`, "PATCH", {
        embeds: [embed.toJSON()],
        components: componentsFor(categories, initialCategory)
      });
    } catch (error) {
      console.error("[help menu]", error.message);
      await helpMessage.edit({ embed: new Discord.MessageEmbed(embed).setFooter(`Use ${prefix}help; the category menu could not be attached.`) }).catch(() => {});
    }
  },

  buildCategory: (client, prefix, category) => embedFor(client, prefix, category).toJSON(),
  componentsFor
};
