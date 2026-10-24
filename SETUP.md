# Setup

## Requirements

- **Node 16** — pinned in `mise.toml` (`mise install` will fetch it). Discord.js 12 and the native modules do not work on Node 18+.
- A Discord application + bot token: <https://discord.com/developers/applications>

## Run

Always run from the project root — the command loader reads `./commands/` relative to the working directory.

```bash
cd ~/Projects/bleed-src

npm start                 # foreground; Ctrl+C to stop
```

Background, surviving the terminal closing:

```bash
setsid nohup mise exec -- npm start > bot.log 2>&1 < /dev/null &
```

```bash
tail -f bot.log           # watch logs
pgrep -af "node bleed.js" # is it running?
pkill -f "[n]ode bleed.js"  # stop it (bracket avoids matching the pkill command itself)
```

**Node version matters.** `mise.toml` pins 16.20.2 and your `.zshrc` activates mise for interactive shells, so `npm start` is enough in a normal terminal. Non-interactive contexts (cron, `setsid`, scripts) do not load `.zshrc` and will fall back to Node 26, which breaks `better-sqlite3` with `NODE_MODULE_VERSION 147`. Use `mise exec -- npm start` there.

## Discord Developer Portal

Under **Bot**, enable these privileged intents or the bot connects but behaves oddly:

- **Server Members Intent** — required, `fetchAllMembers: true` in `bleed.js`
- **Message Content Intent** — required, all commands read `message.content`
- **Presence Intent** — optional, only for the `spotify` command

## Configuration

Secrets live in `.env` (git-ignored). Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `TOKEN` | Bot token |
| `LASTFM_API_KEY` | Last.fm API key |

Non-secret settings live in `config.json`:

| Key | Meaning |
|---|---|
| `owner` | Discord user ID allowed to run `eval`, `leave`, `portal`, `status`, `guilds`, `reload` |
| `default_prefix` | Fallback command prefix (`,,`) |
| `color` | Default embed colour |
| `JOINTOCREATECHANNEL` | Voice channel ID that spawns temporary rooms |

## VoiceMaster

Temporary voice rooms with one persistent public embed and Discord buttons. The host bot remains on discord.js v12 for compatibility with its existing commands; VoiceMaster registers slash commands and handles Discord interaction gateway packets through discord.js's raw event and the documented Discord API.

```
/voicemaster setup   # creates/reuses the category, trigger, text channel, and shared panel
/voicemaster panel   # refreshes or recreates the persistent shared panel
,,vm setup           # same setup flow through this bot's existing prefix commands
,,vm config          # show the configured category, trigger, and panel
,,vm panel           # refresh the shared panel
,,vm config trigger #voice  # select an existing trigger channel
,,vm config category #category
,,vm config panel #text-channel
,,vm clear      # disable creation; existing managed rooms still clean up
```

Setup requires Manage Server for the invoking administrator and Manage Channels plus Move Members for the bot. It creates or reuses a category, Join to Create voice channel, and a control text channel. The panel message ID, guild configuration, room ownership, and access lists are stored in `quick.db`. On startup the bot refreshes the same panel message and registers the guild slash command, so controls survive restarts. Each click resolves that clicking user's indexed room in the same guild; no shared current-room state is used.

Room commands operate on the managed room you are currently in:

```
,,vm rename <name>       ,,vm limit <0-99>
,,vm lock / unlock       ,,vm hide / reveal
,,vm permit @member      ,,vm reject @member
,,vm transfer @member    ,,vm claim
,,vm delete
```

| Button | Action |
|---|---|
| ✏️ | Rename using a modal |
| 🔒 | Lock or unlock the room |
| 👁️ | Hide or reveal the room |
| 👥 | Set user limit using a modal (0 = unlimited) |
| ➕ | Permit a member using a user-select menu |
| ➖ | Reject a member and deny future access |
| 🔇 | Disconnect a selected connected member |
| 👑 | Transfer ownership to a member in the room |
| 🌍 | Set one of Discord's supported RTC regions |
| 🔄 | Show private status for the clicking user's room |
| 🗑️ | Confirm and delete the user's temporary room |

Room owners and members with Manage Channels can use controls for the room resolved from their own ownership record or current managed voice channel. Administrators cannot be rejected. Empty managed rooms are deleted after a short grace period and during reconnect recovery. Ordinary voice channels have no managed ownership record and are never deleted by cleanup.

## Anti-nuke

Audit-log anti-nuke protection is disabled until enabled by a server manager:

```
,,antinuke status
,,antinuke enable
,,antinuke threshold 3
,,antinuke window 10
,,antinuke action strip
,,antinuke log #mod-logs
,,antinuke whitelist user add @trusted-staff
,,antinuke whitelist role add @admins
,,antinuke createguard on
,,antinuke permissions set @security-managers
```

It correlates channel/role deletion, bans, kicks, bot additions, and dangerous role permission grants with recent audit-log entries. Three actions in ten seconds trigger the configured response by default. The server owner and configured trusted users/roles are exempt. Create-flood detection is optional because normal setup workflows can create several channels or roles at once. The bot needs **View Audit Log** and **Manage Roles** for the default role-strip response; put the bot role above roles it may need to remove. Kick/ban responses require their matching permissions. Alerts appear only after an alert channel is configured.

The detection pattern follows public anti-nuke designs that attribute changes from audit logs and count actions per executor inside a configurable time window; this is a fresh integration for this bot, not copied third-party code.

`antinuke permissions` shows the bot's current permission checks. `antinuke permissions set @role` lets a server manager delegate anti-nuke settings to that role; `antinuke permissions clear` restricts changes to members with Manage Server. This delegates the bot's anti-nuke configuration only and does not change Discord permissions on the bot itself.

## Media downloads

`download` (alias `dl`) accepts public YouTube, TikTok, Pinterest, and individual Spotify track links. It attaches the downloaded file to Discord; downloads are limited to 8 MB by default and stop after two minutes. Set `DOWNLOAD_MAX_SIZE_MB` in `.env` to change the size cap, subject to the server's Discord upload limit.

Install `yt-dlp` on the bot host for YouTube, TikTok, and Pinterest, and `spotdl` for Spotify tracks. Both must be available on the process `PATH`. Spotify links use `spotdl`'s supported source resolution; they do not download audio directly from Spotify.

```
,,download <link>
```

## Known gaps

- **`joindm` is disabled.** `commands/configuration/joindm.js.disabled` and the join-DM listener in `events/guildMemberAdd.js` require `models/joindmmodel.js`, which was never committed, plus MongoDB. Re-enable only after porting it to `quick.db`.
- **Join log phones home.** `events/guildCreate.js` and `guildDelete.js` report every guild to channel `868302839947100160`. Change that ID to one of your own or remove the handlers.
- **Rotate the token.** The current one is in the public git history of `mkyxqz/bleed-src`. Regenerate it in the developer portal and put the new value in `.env`.
