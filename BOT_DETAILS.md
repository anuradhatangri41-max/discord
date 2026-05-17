# Discord Bot — Full Setup & Details

## Bot Info

| Field | Value |
|---|---|
| **Bot Name** | kicks#1528 |
| **Client ID** | 1505265128705097809 |
| **Prefix** | `.` (dot) |
| **Invite Link** | https://discord.com/oauth2/authorize?client_id=1505265128705097809&permissions=8&scope=bot%20applications.commands |

---

## Quick Start

### Step 1 — Set your bot token

Create a file called `.env` in the same folder as `bot.js` and paste your token:

```
DISCORD_BOT_TOKEN=your_token_here
```

Your token is found at: **https://discord.com/developers/applications → Your App → Bot → Reset Token**

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Enable Privileged Intents

Go to **https://discord.com/developers/applications → Your App → Bot → Privileged Gateway Intents**  
Enable all three:
- ✅ PRESENCE INTENT
- ✅ SERVER MEMBERS INTENT
- ✅ MESSAGE CONTENT INTENT

Then click **Save Changes**.

### Step 4 — Run the bot

```bash
node bot.js
```

The invite link will be printed in the console on startup.

---

## Stack & Libraries

| Library | Version | Purpose |
|---|---|---|
| discord.js | ^14.16.3 | Discord API framework |
| axios | ^1.7.9 | HTTP requests (exchange rates, crypto APIs) |
| qrcode | ^1.5.4 | Generate UPI & crypto QR images |
| node-fetch | ^3.3.2 | Additional HTTP support |

**Runtime:** Node.js 18+ (ES Modules)

---

## All Commands

### 🛡️ Moderation (Admin Only)

| Command | Usage | Description |
|---|---|---|
| .ban | `.ban @user [reason]` | Ban a member |
| .kick | `.kick @user [reason]` | Kick a member |
| .timeout | `.timeout @user 10m [reason]` | Timeout (10s / 5m / 1h / 1d) |
| .mute | `.mute @user` | Add Muted role (creates it if needed) |
| .unmute | `.unmute @user` | Remove Muted role |
| .purge | `.purge 50` | Delete 1–100 messages |
| .slowmode | `.slowmode 10` | Set channel slowmode in seconds (0 = off) |
| .warn | `.warn @user <reason>` | Warn a member (DMs them) |
| .warnings | `.warnings @user` | View all warnings for a member |
| .clearwarns | `.clearwarns @user` | Clear all warnings for a member |
| .deletechannel | `.deletechannel [#channel]` | Delete channel with confirm prompt |
| .nuke | `.nuke` | Delete + recreate channel (clears all messages) |

### 🎫 Ticket System

| Command | Usage | Description |
|---|---|---|
| .claim | `.claim` | Claim ticket, DMs the ticket owner |
| .unclaim | `.unclaim` | Unclaim the ticket |
| .transfer | `.transfer @staff` | Transfer ticket, DMs new staff |
| .timer | `.timer 10m` | Set countdown timer, pings when done |
| .add | `.add @user` | Add a user to the ticket channel |
| .remove | `.remove @user` | Remove a user from the ticket channel |
| .rename | `.rename new-name` | Rename the ticket channel |
| .lock | `.lock` | Lock ticket — only staff can send |
| .unlock | `.unlock` | Restore send permissions |
| .close | `.close` | Close & delete ticket (5s warning) |

> When a ticket is opened, the bot automatically DMs the user with their ticket details.

### 💱 Exchange / Middleman

| Command | Usage | Description |
|---|---|---|
| .mm | `.mm 500 INR` | Middleman deal — notifies claimed staff |
| .exch | `.exch` | Live exchange rates with interactive buttons |
| .buy | `.buy Robux 500 INR` | Create buy order — notifies staff |
| .sell | `.sell BTC 0.01 BTC` | Create sell order — notifies staff |

### 💳 Payment / QR

| Command | Usage | Description |
|---|---|---|
| .addpayment | `.addpayment upi name@upi` | Save UPI payment method |
| .addpayment | `.addpayment crypto ADDRESS` | Save crypto wallet address |
| .qr | `.qr 500` | Generate QR for ₹500 UPI + crypto address |

### 🔗 Crypto Wallet Lookup

| Command | Usage | Description |
|---|---|---|
| .ltc | `.ltc LgXt...` | Litecoin wallet: balance + last 5 txns |
| .btc | `.btc 1BvBM...` | Bitcoin wallet info |
| .eth | `.eth 0x742d...` | Ethereum wallet info |
| .trx | `.trx TLyq...` | TRON wallet info |
| .usdt | `.usdt TLyq...` | USDT TRC20 wallet info |

### 📱 Social Media (30s cooldown per user)

| Command | Usage | Description |
|---|---|---|
| .tfollow | `.tfollow username` | 🟣 Send Twitch followers |
| .tspam | `.tspam username` | 🟣 Send Twitch chat spam |
| .ttfollow | `.ttfollow username` | ⚡ Send TikTok followers |
| .ifollow | `.ifollow username` | 📸 Send Instagram followers |
| .pfollow | `.pfollow username` | 📌 Send Pinterest followers |
| .sfollow | `.sfollow username` | 👻 Send Snapchat followers |
| .yfollow | `.yfollow username` | ▶️ Send YouTube subscribers |
| .spfollow | `.spfollow username` | 🎵 Send Spotify followers |
| .rolesocial | `.rolesocial` | Show all role perks & platform amounts |

> Amounts are role-based and per-platform. Configure with `/setfollowers`.

### ℹ️ Info

| Command | Usage | Description |
|---|---|---|
| .ping | `.ping` | Bot latency & WebSocket ping |
| .serverinfo | `.serverinfo` | Server stats |
| .userinfo | `.userinfo [@user]` | User info |
| .avatar | `.avatar [@user]` | Show avatar |
| .roleinfo | `.roleinfo @role` | Role info |
| .botinfo | `.botinfo` | Bot info + invite link |
| .snipe | `.snipe` | Show last deleted message |
| .invite | `.invite` | Get bot invite link |

### 🎉 Utility / Fun

| Command | Usage | Description |
|---|---|---|
| .say | `.say Hello!` | Bot sends your message (yours is deleted) |
| .announce | `.announce text` | Bot sends a formatted announcement embed |
| .dm | `.dm @user message` | DM a user via bot |
| .embed | `.embed Title \| Description` | Post a custom embed |
| .poll | `.poll question?` | 👍/👎 poll |
| .coinflip | `.coinflip` | Flip a coin |
| .8ball | `.8ball question?` | 🎱 Magic 8-ball |

### ⚙️ Slash Commands (Admin Only)

| Command | Description |
|---|---|
| /setuptixroles | Configure ticket panel with staff role, required role, category |
| /setticketpanel | Post interactive ticket buttons to a channel |
| /setuppayment | Save your UPI/crypto payment methods |
| /setfollowers | Set per-platform follower amount per role |
| /autopurge | Auto-delete all messages in a channel after 4 seconds |

---

## Exchange Rates Supported

- INR ↔ Crypto (LTC, BTC, ETH, TRX, USDT)
- PayPal ↔ INR
- PKR ↔ INR
- PKR ↔ Crypto
- EUR → Crypto

Sources: **CoinGecko** + **ExchangeRate-API**

---

## Ticket System Flow

1. `/setuptixroles` — configure each panel type (staff role, required role, category)
2. `/setticketpanel #channel` — post the ticket panel with buttons
3. User clicks a button → private ticket channel is created, bot DMs user with ticket info
4. Staff uses `.claim` → ticket owner gets a DM notification
5. Staff uses `.mm` / `.buy` / `.sell` for transactions
6. `.transfer @staff` hands off with DM notification
7. `.close` or the Close button deletes the channel

---

## Social Follower System

- Use `/setfollowers @role platform amount` to configure per-platform amounts per role
- Example: `/setfollowers @Member platform:Instagram amount:25`
- Example: `/setfollowers @VIP platform:All Platforms amount:1000`
- Use `.rolesocial` to view all configured amounts at a glance
- 30-second cooldown between social commands per user

---

## Data Storage

All data is saved in a `data/` folder (auto-created):

| File | Contents |
|---|---|
| tickets.json | Open/closed ticket records |
| ticketPanels.json | Panel configs (roles, categories) |
| payments.json | Staff payment methods |
| autoPurge.json | Auto-purge interval configs |
| followerRoles.json | Per-role per-platform follower amounts |
| warnings.json | Member warning records |
| slashAutoPurge.json | Slash-configured auto-purge channels |

---

## File Structure

```
discord-bot/
├── bot.js          ← Everything is here (single file)
├── package.json    ← Dependencies
├── .env            ← Your token goes here (create this yourself)
├── BOT_DETAILS.md  ← This file
└── data/           ← Auto-created, stores all JSON state
```
