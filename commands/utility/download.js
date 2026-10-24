const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const Discord = require("discord.js");
const db = require("quick.db");
const { color } = require("../../config.json");

const MAX_FILE_SIZE = Math.max(1, Number(process.env.DOWNLOAD_MAX_SIZE_MB) || 8) * 1024 * 1024;
const TIMEOUT_MS = 120000;

function classifyUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (_) {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    return { platform: "YouTube", tool: "yt-dlp", spotifyTrack: false };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return { platform: "TikTok", tool: "yt-dlp", spotifyTrack: false };
  }
  if (host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it") {
    return { platform: "Pinterest", tool: "yt-dlp", spotifyTrack: false };
  }
  if (host === "open.spotify.com" || host === "spotify.com") {
    return { platform: "Spotify", tool: "spotdl", spotifyTrack: /\/track\//.test(url.pathname) };
  }
  return null;
}

async function serverInviteFor(message) {
  const configured = process.env.DISCORD_SERVER_INVITE;
  if (configured) return configured.replace(/^<|>$/g, "");
  if (message.guild.vanityURLCode) return `https://discord.gg/${message.guild.vanityURLCode}`;
  const key = `download_invite_${message.guild.id}`;
  const saved = db.get(key);
  if (saved) return saved;
  try {
    const invite = await message.channel.createInvite({ maxAge: 0, maxUses: 0, unique: false }, "Add server invite to download embeds");
    db.set(key, invite.url);
    return invite.url;
  } catch (_) {
    return null;
  }
}

async function sendDownloadEmbed(client, message, source, input, file) {
  const attachmentName = path.basename(file);
  const extension = path.extname(attachmentName).toLowerCase();
  const serverInvite = await serverInviteFor(message);
  const botInvite = process.env.BOT_INVITE_URL || `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands&permissions=0`;
  const embed = new Discord.MessageEmbed()
    .setColor(color || "#5865f2")
    .setTitle(`${source.platform} download`)
    .setDescription(`[Open the original source](${input})${[".mp4", ".webm", ".mov", ".m4v"].includes(extension) ? "\n\nVideo attached below." : ""}`)
    .addField("Invites", `${serverInvite ? `[Join this server](${serverInvite})` : "Server invite unavailable"} • [Invite the bot](${botInvite})`)
    .setFooter(`Server: ${serverInvite || "invite unavailable"} | Invite bot: ${botInvite}`)
    .setTimestamp();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
    embed.setImage(`attachment://${attachmentName}`);
  }
  return message.channel.send({ embed, files: [{ attachment: file, name: attachmentName }] });
}

function runDownloader(executable, args, onProgress) {
  return new Promise((resolve, reject) => {
    const installedPath = ["/usr/local/bin", "/usr/bin"].map(dir => path.join(dir, executable)).find(file => fs.existsSync(file));
    const child = spawn(installedPath || executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let progressBuffer = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    const collect = (stream, chunk) => {
      const text = chunk.toString();
      if (stream === "stdout") stdout = (stdout + text).slice(-1200);
      else stderr = (stderr + text).slice(-1200);
      progressBuffer = (progressBuffer + text).slice(-300);
      const matches = progressBuffer.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/g);
      if (matches && onProgress) {
        const match = matches[matches.length - 1].match(/(\d{1,3}(?:\.\d+)?)%/);
        const percentage = match && Number(match[1]);
        if (Number.isFinite(percentage) && percentage >= 0 && percentage <= 100) onProgress(percentage);
      }
    };
    child.stdout.on("data", chunk => collect("stdout", chunk));
    child.stderr.on("data", chunk => collect("stderr", chunk));
    child.once("error", error => {
      clearTimeout(timer);
      error.details = String(stderr || stdout).slice(-1200);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      if (timedOut || code !== 0) {
        const error = new Error(timedOut ? "Download timed out" : `Downloader exited with code ${code}`);
        error.killed = timedOut;
        error.code = code;
        error.details = String(stderr || stdout).slice(-1200);
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = {
  name: "download",
  aliases: ["dl"],
  category: "utility",
  description: "Download supported public media links",
  run: async (client, message, args) => {
    const input = args[0];
    if (!input) return message.reply("Usage: `download <YouTube, TikTok, Pinterest, or Spotify track URL>`");

    const source = classifyUrl(input);
    if (!source) return message.reply("That link isn't supported. Use a YouTube, TikTok, Pinterest, or Spotify URL.");
    if (source.tool === "spotdl" && !source.spotifyTrack) {
      return message.reply("Spotify downloads currently support individual track links only.");
    }

    const workDir = path.join(os.tmpdir(), `bleed-download-${crypto.randomBytes(8).toString("hex")}`);
    fs.mkdirSync(workDir, { recursive: true });
    if (message.channel.startTyping) message.channel.startTyping();
    let progressMessage;
    let progressTimer;
    let lastProgressEdit = 0;
    let pendingPercentage = 0;
    const updateProgress = percentage => {
      pendingPercentage = Math.floor(percentage);
      if (!progressMessage || progressTimer) return;
      const delay = Math.max(0, 2500 - (Date.now() - lastProgressEdit));
      progressTimer = setTimeout(() => {
        progressTimer = null;
        lastProgressEdit = Date.now();
        progressMessage.edit(`Downloading from ${source.platform}… **${pendingPercentage}%**`).catch(() => {});
      }, delay);
    };
    try {
      progressMessage = await message.channel.send(`Downloading from ${source.platform}… **0%**`);
      if (source.tool === "yt-dlp") {
        const downloaderArgs = ["--no-playlist", "--no-warnings", "--socket-timeout", "15", "--retries", "2", "--fragment-retries", "2"];
        if (source.platform === "Pinterest") {
          // Prefer a pre-combined stream to avoid downloading separate audio/video
          // files and merging them when Pinterest provides one.
          downloaderArgs.push("-f", "best/bestvideo+bestaudio");
        }
        downloaderArgs.push("--newline", "--progress", "--max-filesize", `${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}M`, "-o", path.join(workDir, "media.%(ext)s"), input);
        await runDownloader("yt-dlp", downloaderArgs, updateProgress);
      } else {
        await runDownloader("spotdl", ["download", input, "--output", path.join(workDir, "{title}.{output-ext}"), "--simple-tui"], updateProgress);
      }

      const files = fs.readdirSync(workDir)
        .map(name => path.join(workDir, name))
        .filter(file => fs.statSync(file).isFile());
      if (!files.length) throw new Error("The downloader returned no media file.");
      const file = files[0];
      const size = fs.statSync(file).size;
      if (size > MAX_FILE_SIZE) {
        const response = `The file is larger than this bot's ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)} MB upload limit. Try a shorter or lower-resolution source.`;
        if (progressTimer) clearTimeout(progressTimer);
        if (progressMessage) return progressMessage.edit(response).catch(() => {});
        return message.reply(response).catch(() => {});
      }
      if (progressTimer) clearTimeout(progressTimer);
      if (progressMessage) await progressMessage.delete().catch(() => {});
      progressMessage = null;
      return await sendDownloadEmbed(client, message, source, input, file);
    } catch (error) {
      const notInstalled = error.code === "ENOENT";
      console.error(`[download:${source.platform}]`, error.message, error.details || "");
      const uploadAborted = error.name === "HTTPError" && error.method === "post" && /\/channels\/\d+\/messages/.test(error.path || "");
      const response = notInstalled
        ? `The ${source.tool} downloader isn't installed on the bot host.`
        : uploadAborted
          ? "The download finished, but Discord timed out while uploading it. Please try again; smaller files upload more reliably."
        : error.killed
          ? "The download timed out. Try again with a shorter item."
          : `Couldn't download that ${source.platform} link. Check that it is public and supported.`;
      if (progressTimer) clearTimeout(progressTimer);
      if (progressMessage) return progressMessage.edit(response).catch(() => {});
      return message.reply(response).catch(() => {});
    } finally {
      if (progressTimer) clearTimeout(progressTimer);
      if (message.channel.stopTyping) message.channel.stopTyping(true);
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
};
