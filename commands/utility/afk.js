const db = require('quick.db')
const Discord = require('discord.js');
const { approve } = require('../../emojis.json');

module.exports = {
    name : 'afk',
    category: "utility",
    usage: "afk",

    run : async(client, message, args) => {
        const content = args.join(" ") ? args.join(' ') : "AFK"
        await db.set(`afk-${message.author.id}+${message.guild.id}`, content)
        
        const afkEmbed = new Discord.MessageEmbed()
        .setColor("#a3eb7b")
        .setDescription(`${approve} ${message.author}: You're now AFK with the status: **${content}**`)
        message.channel.send(afkEmbed)                
    }
}
