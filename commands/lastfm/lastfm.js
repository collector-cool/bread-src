const Discord = require('discord.js')
const { default_prefix, color } = require("../../config.json");
const { approve } = require("../../emojis.json");
const { warn } = require("../../emojis.json");
const { deny } = require("../../emojis.json");
const db = require("quick.db");
const request = require("request-promise");

const key = id => `lastfm_${id}`;
const API_KEY = "43693facbb24d1ac893a7d33846b15cc";

module.exports = {
    name: "lastfm",
    aliases: ["lf"],
    usage: "lastfm set [user]",
    category: "lastfm",

    run: async (client, message, args) => {
        if (message.author.bot) return;

        let prefix = db.get(`prefix_${message.guild.id}`);
        if (prefix === null) { prefix = default_prefix; };

        if (!args[0]) return message.channel.send({ embed: { color: color, description: `${message.author}: To set your **Last.fm** account: \`${prefix}lastfm set <username>\`` } })

        if (args[0].toLowerCase() == "set") {
            const fmUser = args.slice(1).join(" ").trim();
            if (!fmUser) {
                let embed = new Discord.MessageEmbed()
                    .setColor("#efa23a")
                    .setDescription(`${warn} ${message.author}: You must provide a **Last.fm** username`)
                return message.channel.send(embed);
            }

            let profile;
            try {
                profile = await request({
                    uri: "https://ws.audioscrobbler.com/2.0/",
                    qs: { method: "user.getInfo", user: fmUser, api_key: API_KEY, format: "json" },
                    json: true
                });
            } catch (error) {
                console.error("[lastfm set]", error.message);
                return message.channel.send({ embed: { color: "#efa23a", description: `${warn} ${message.author}: Couldn't verify **${fmUser}** with Last.fm. Check the username and try again.` } });
            }
            if (!profile || !profile.user || !profile.user.name) {
                return message.channel.send({ embed: { color: "#efa23a", description: `${warn} ${message.author}: Last.fm couldn't find **${fmUser}**.` } });
            }

            const canonicalName = profile.user.name;

            const existingUser = db.get(key(message.author.id));

            if (existingUser && existingUser.toLowerCase() === canonicalName.toLowerCase()) {
                return message.channel.send(
                    { embed: { color: "#efa23a", description: `${warn} ${message.author}: Your **Last.fm** profile is already set to **${canonicalName}**` } }
                );
            }

            db.set(key(message.author.id), canonicalName);

            return message.channel.send(
                { embed: { color: "#a3eb7b", description: `${approve} ${message.author}: Your **Last.fm** username has been ${existingUser ? "updated" : "set"} to **${canonicalName}**` } }
            );
        } else if (args[0].toLowerCase() == "unlink") {
            const existingUser = db.get(key(message.author.id));

            if (existingUser) {
                db.delete(key(message.author.id));
                return message.channel.send(
                    { embed: { color: "#a3eb7b", description: `${approve} ${message.author}: The **Last.fm** username **${existingUser}** has been unlinked` } }
                );
            }
            return message.channel.send(
                { embed: { color: "#939393", description: `${deny} ${message.author}: **Username** not found` } }
            );

        }
        return message.channel.send({ embed: { color: color, description: `${message.author}: Use \`${prefix}lastfm set <username>\` or \`${prefix}lastfm unlink\`.` } });
    }
}
