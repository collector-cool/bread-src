const request = require("request-promise");
const { MessageEmbed } = require("discord.js");
const db = require("quick.db");
const { default_prefix, color } = require("../../config.json");
const { lastfm, nowplaying, warn } = require("../../emojis.json");

const API_KEY = "43693facbb24d1ac893a7d33846b15cc";
const api = params => request({ uri: "https://ws.audioscrobbler.com/2.0/", qs: { ...params, api_key: API_KEY, format: "json" }, json: true });
const count = value => value === undefined || value === null || value === "" ? "?" : Number(value).toLocaleString("en-US");
const largestImage = images => {
  if (!Array.isArray(images)) return null;
  const preferred = images.find(image => image.size === "extralarge" && image["#text"])
    || images.find(image => image.size === "large" && image["#text"])
    || [...images].reverse().find(image => image["#text"]);
  const url = preferred && preferred["#text"];
  return url && /^https:\/\//i.test(url) ? url : null;
};

module.exports = {
  name: "fm",
  aliases: ["lfm", "np"],
  usage: "fm",
  category: "lastfm",
  description: "Show a recent track from Last.fm",

  run: async (client, message, args) => {
    let username;
    let savedProfile = null;
    if (args[0] && args[0].toLowerCase() === "set") {
      const requestedUser = args.slice(1).join(" ").trim();
      if (!requestedUser) return message.reply("Usage: `fm set <Last.fm username>`");
      try {
        savedProfile = await api({ method: "user.getInfo", user: requestedUser });
      } catch (error) {
        console.error("[lastfm fm set]", error.message);
        return message.channel.send(`${warn} Last.fm couldn't verify **${requestedUser}**. Check the username and try again.`);
      }
      if (!savedProfile || !savedProfile.user || !savedProfile.user.name) {
        return message.channel.send(`${warn} Last.fm couldn't find **${requestedUser}**.`);
      }
      username = savedProfile.user.name;
      db.set(`lastfm_${message.author.id}`, username);
    } else {
      username = args[0] || db.get(`lastfm_${message.author.id}`);
    }

    if (!username) {
      const prefix = db.get(`prefix_${message.guild.id}`) || default_prefix;
      return message.channel.send(`${lastfm} ${message.author}: You haven't set a Last.fm username. Use \`${prefix}fm set <username>\` or \`${prefix}lastfm set <username>\`.`);
    }

    try {
      const recent = await api({ method: "user.getrecenttracks", user: username, limit: 1, extended: 1 });
      const rawTrack = recent.recenttracks && recent.recenttracks.track;
      const track = Array.isArray(rawTrack) ? rawTrack[0] : rawTrack;
      if (!track) return message.channel.send(`${warn} No recent Last.fm track was found for **${username}**.`);

      const artist = track.artist && (track.artist.name || track.artist["#text"]) || "Unknown artist";
      const album = track.album && track.album["#text"] || "";
      const trackName = track.name || "Unknown track";
      const usernameEncoded = encodeURIComponent(username);
      const artistEncoded = encodeURIComponent(artist);
      const trackEncoded = encodeURIComponent(trackName);
      const profileUrl = `https://www.last.fm/user/${usernameEncoded}`;
      const trackUrl = track.url || `https://www.last.fm/music/${artistEncoded}/_/${trackEncoded}`;
      const [trackInfo, albumInfo, userInfo] = await Promise.all([
        api({ method: "track.getInfo", artist, track: trackName, username }).catch(() => null),
        album ? api({ method: "album.getInfo", artist, album, username }).catch(() => null) : Promise.resolve(null),
        savedProfile ? Promise.resolve(savedProfile) : api({ method: "user.getInfo", user: username }).catch(() => null)
      ]);

      const currentTrackPlays = trackInfo && trackInfo.track && trackInfo.track.userplaycount;
      const currentAlbumPlays = albumInfo && albumInfo.album && albumInfo.album.userplaycount;
      const scrobbles = userInfo && userInfo.user && userInfo.user.playcount;
      const artwork = largestImage(track.image) || largestImage(albumInfo && albumInfo.album && albumInfo.album.image);
      const displayAlbum = album || "Unknown album";
      const status = track["@attr"] && track["@attr"].nowplaying === "true" ? "Now playing" : "Last played";
      const embed = new MessageEmbed()
        .setColor(color)
        .setDescription(`-# ${nowplaying} ${status} • [${username}](${profileUrl})\n### [${trackName}](${trackUrl})\n**${artist}** • *${displayAlbum}*`)
        .setFooter(`${count(currentAlbumPlays)} plays of this album • ${count(currentTrackPlays)} plays of this track • ${count(scrobbles)} scrobbles`);
      if (artwork) embed.setThumbnail(artwork);

      return message.channel.send(embed);
    } catch (error) {
      console.error("[lastfm track]", error);
      return message.channel.send(`${warn} **Last.fm** couldn't load that track. Try again shortly.`);
    }
  }
};
