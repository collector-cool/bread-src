module.exports = {
  name: "say",
  category: "utility",
  run: async (client, message, args) => {
    const text = args.join(" ").trim();
    if (!text) return message.reply("Usage: `say <message>`");

    const botPermissions = message.channel.permissionsFor(message.guild.me);
    if (!botPermissions || !botPermissions.has("MANAGE_MESSAGES")) {
      return message.reply("I need Manage Messages permission to delete your command message.");
    }

    try { await message.delete(); }
    catch (error) {
      console.error("[say] delete", error);
      return message.reply("I couldn't delete your command message, so I didn't send the requested text.").catch(() => {});
    }

    try { await message.channel.send(text); }
    catch (error) {
      console.error("[say] send", error);
      await message.channel.send("I couldn't send that message.").catch(() => {});
    }
  }
};
