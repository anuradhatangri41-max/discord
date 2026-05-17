/**
 * ============================================================
 *  DISCORD BOT — ALL-IN-ONE  (v2)
 * ============================================================
 *  PREFIX : . (dot)
 *  SLASH  : /setuptixroles  /setticketpanel  /setuppayment  /setfollowers  /autopurge
 *
 *  STACK  : discord.js v14 · axios · qrcode · Node.js ESM
 *
 *  SETUP  :
 *    1. npm install discord.js axios qrcode node-fetch
 *    2. Set env var:  DISCORD_BOT_TOKEN=your_token_here
 *    3. Discord Dev Portal → Bot → Privileged Gateway Intents:
 *       enable  PRESENCE INTENT · SERVER MEMBERS INTENT · MESSAGE CONTENT INTENT
 *    4. node bot.js   ← invite link printed in console on startup
 *
 *  ⚠️  /joinvc NOTE:
 *    Controlling a user account via its token ("self-bot") is explicitly
 *    banned by Discord ToS §13 and leads to permanent account termination.
 *    That feature is intentionally not implemented here to protect your account.
 * ============================================================
 */

import {
  Client, GatewayIntentBits, Partials, Collection,
  REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ChannelType, PermissionFlagsBits, Events, ActivityType
} from 'discord.js';
import axios from 'axios';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
const PREFIX     = '.';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
// DATA STORAGE
// ============================================================
const FILES = {
  tickets:        path.join(DATA_DIR, 'tickets.json'),
  ticketPanels:   path.join(DATA_DIR, 'ticketPanels.json'),
  payments:       path.join(DATA_DIR, 'payments.json'),
  autoPurge:      path.join(DATA_DIR, 'autoPurge.json'),
  followerRoles:  path.join(DATA_DIR, 'followerRoles.json'),
  warnings:       path.join(DATA_DIR, 'warnings.json'),
  slashAutoPurge: path.join(DATA_DIR, 'slashAutoPurge.json'),
  serverInvite:   path.join(DATA_DIR, 'serverInvite.json'),
  platformEmojis: path.join(DATA_DIR, 'platformEmojis.json'),
};
const _data = {
  tickets: {}, ticketPanels: {}, payments: {}, autoPurge: {},
  followerRoles: {}, warnings: {}, slashAutoPurge: {},
  serverInvite: {}, platformEmojis: {},
};
const snipeCache = {};   // channelId → { content, author, timestamp }

function loadAll() {
  for (const [k, f] of Object.entries(FILES))
    if (fs.existsSync(f)) { try { _data[k] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} }
}
function save(key) { fs.writeFileSync(FILES[key], JSON.stringify(_data[key], null, 2)); }
function get(key)  { return _data[key]; }
loadAll();

// ============================================================
// HELPERS
// ============================================================
const errEmbed  = (d) => ({ color: 0xff4444, description: d });
const okEmbed   = (d) => ({ color: 0x00cc66, description: d });

function isAdmin(member) { return member.permissions.has(PermissionFlagsBits.Administrator); }
function adminCheck(message) {
  if (!isAdmin(message.member)) {
    message.reply({ embeds: [errEmbed('❌ This command is **admin only**.')] });
    return false;
  }
  return true;
}
async function resolveMember(message, args) {
  const id = args[0]?.replace(/[<@!>]/g, '');
  if (!id) return null;
  try { return await message.guild.members.fetch(id); } catch { return null; }
}
function parseTime(str) {
  const m = str?.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(m[1]) * map[m[2].toLowerCase()];
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms)         { return new Promise(r => setTimeout(r, ms)); }

// Social command cooldowns: key = `${userId}_${guildId}` → expiry timestamp
const socialCooldowns = new Map();
const SOCIAL_COOLDOWN_MS = 30_000; // 30 seconds

/** Get follower amount for a member based on their highest configured role, per-platform.
 *  Storage: followerRoles[guildId][roleId][platform] = amount   OR   [roleId] = number (legacy)
 */
function getFollowerAmount(member, guildId, platform) {
  const cfg = get('followerRoles')[guildId] || {};
  let best = null;
  for (const [roleId, val] of Object.entries(cfg)) {
    if (!member.roles.cache.has(roleId)) continue;
    // val can be a plain number (legacy) or an object { platform: amount }
    const amount = typeof val === 'object'
      ? (val[platform] ?? val['all'] ?? null)
      : val;
    if (amount !== null && (!best || amount > best.amount)) best = { roleId, amount };
  }
  return best ? best.amount : randInt(10, 100);
}

// ============================================================
// MODERATION
// ============================================================
async function cmdBan(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member)          return message.reply({ embeds: [errEmbed('Mention a valid member to ban.')] });
  if (!member.bannable) return message.reply({ embeds: [errEmbed("I can't ban that member.")] });
  const reason = args.slice(1).join(' ') || 'No reason provided';
  await member.ban({ reason });
  message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🔨 Member Banned')
    .addFields(
      { name: 'User',      value: member.user.tag,    inline: true },
      { name: 'Reason',    value: reason,             inline: true },
      { name: 'Banned By', value: message.author.tag, inline: true }
    ).setTimestamp()] });
}

async function cmdKick(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member)         return message.reply({ embeds: [errEmbed('Mention a valid member to kick.')] });
  if (!member.kickable)return message.reply({ embeds: [errEmbed("I can't kick that member.")] });
  const reason = args.slice(1).join(' ') || 'No reason provided';
  await member.kick(reason);
  message.reply({ embeds: [new EmbedBuilder().setColor(0xff8800).setTitle('👢 Member Kicked')
    .addFields(
      { name: 'User',     value: member.user.tag,    inline: true },
      { name: 'Reason',   value: reason,             inline: true },
      { name: 'Kicked By',value: message.author.tag, inline: true }
    ).setTimestamp()] });
}

async function cmdTimeout(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member) return message.reply({ embeds: [errEmbed('Usage: `.timeout @user <dur> [reason]`')] });
  const ms = parseTime(args[1]);
  if (!ms) return message.reply({ embeds: [errEmbed('Invalid duration. Use: 10s 5m 1h 1d')] });
  const reason = args.slice(2).join(' ') || 'No reason provided';
  await member.timeout(ms, reason);
  message.reply({ embeds: [new EmbedBuilder().setColor(0xffcc00).setTitle('⏱️ Member Timed Out')
    .addFields(
      { name: 'User', value: member.user.tag, inline: true }, { name: 'Duration', value: args[1], inline: true },
      { name: 'Reason', value: reason, inline: true }, { name: 'By', value: message.author.tag, inline: true }
    ).setTimestamp()] });
}

async function cmdMute(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member) return message.reply({ embeds: [errEmbed('Mention a valid member to mute.')] });
  let muteRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
  if (!muteRole) {
    muteRole = await message.guild.roles.create({ name: 'Muted', permissions: [], reason: 'Auto-created' });
    for (const [, ch] of message.guild.channels.cache)
      await ch.permissionOverwrites.create(muteRole, { SendMessages: false, AddReactions: false, Speak: false }).catch(() => {});
  }
  await member.roles.add(muteRole);
  message.reply({ embeds: [okEmbed(`🔇 **${member.user.tag}** has been muted.`)] });
}

async function cmdUnmute(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member) return message.reply({ embeds: [errEmbed('Mention a valid member to unmute.')] });
  const muteRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
  if (!muteRole) return message.reply({ embeds: [errEmbed('No Muted role found.')] });
  await member.roles.remove(muteRole);
  message.reply({ embeds: [okEmbed(`🔊 **${member.user.tag}** has been unmuted.`)] });
}

async function cmdPurge(message, args) {
  if (!adminCheck(message)) return;
  const n = parseInt(args[0]);
  if (!n || n < 1 || n > 100) return message.reply({ embeds: [errEmbed('Usage: `.purge <1-100>`')] });
  await message.delete().catch(() => {});
  const deleted = await message.channel.bulkDelete(n, true);
  const m = await message.channel.send({ embeds: [okEmbed(`🗑️ Deleted **${deleted.size}** messages.`)] });
  setTimeout(() => m.delete().catch(() => {}), 4000);
}

async function cmdAutoPurge(message, args) {
  if (!adminCheck(message)) return;
  const ap = get('autoPurge');
  if (args[0] === 'off') {
    delete ap[message.channel.id]; save('autoPurge');
    return message.reply({ embeds: [okEmbed('🛑 Auto-purge disabled for this channel.')] });
  }
  const ms = parseTime(args[0]);
  if (!ms) return message.reply({ embeds: [errEmbed('Usage: `.autopurge <interval>` e.g. `.autopurge 30m` or `.autopurge off`')] });
  ap[message.channel.id] = { interval: ms, guildId: message.guild.id }; save('autoPurge');
  message.reply({ embeds: [okEmbed(`✅ Auto-purge every **${args[0]}** in this channel.`)] });
  setInterval(async () => {
    const ch = message.guild.channels.cache.get(message.channel.id);
    if (!ch) return;
    const msgs = await ch.messages.fetch({ limit: 100 });
    await ch.bulkDelete(msgs.filter(m => !m.pinned), true).catch(() => {});
  }, ms);
}

async function cmdDeleteChannel(message, args) {
  if (!adminCheck(message)) return;
  const channel = message.mentions.channels.first() || message.channel;
  await message.reply({ embeds: [{ color: 0xff4444, description: `⚠️ Delete **#${channel.name}**? Type \`confirm\` within 15s.` }] });
  const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === 'confirm';
  const col = await message.channel.awaitMessages({ filter, max: 1, time: 15000 }).catch(() => null);
  if (!col?.size) return message.channel.send({ embeds: [errEmbed('❌ Cancelled.')] });
  await channel.delete('Admin deleted channel');
}

async function cmdNuke(message) {
  if (!adminCheck(message)) return;
  const ch = message.channel;
  const perms = ch.permissionOverwrites.cache.map(o => ({
    id: o.id, type: o.type, allow: o.allow.toArray(), deny: o.deny.toArray()
  }));
  await ch.delete('Nuke');
  const newCh = await message.guild.channels.create({
    name: ch.name, type: ChannelType.GuildText,
    parent: ch.parentId || undefined, position: ch.position,
    topic: ch.topic || undefined, permissionOverwrites: perms
  });
  newCh.send({ embeds: [{ color: 0xff4444, title: '💣 Channel Nuked', description: 'Channel recreated — all messages cleared.', timestamp: new Date().toISOString() }] });
}

async function cmdSlowmode(message, args) {
  if (!adminCheck(message)) return;
  const secs = parseInt(args[0]);
  if (isNaN(secs) || secs < 0 || secs > 21600)
    return message.reply({ embeds: [errEmbed('Usage: `.slowmode <0-21600 seconds>` (0 = off)')] });
  await message.channel.setRateLimitPerUser(secs);
  message.reply({ embeds: [okEmbed(secs === 0 ? '✅ Slowmode disabled.' : `✅ Slowmode set to **${secs}s**.`)] });
}

async function cmdWarn(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member) return message.reply({ embeds: [errEmbed('Usage: `.warn @user <reason>`')] });
  const reason = args.slice(1).join(' ') || 'No reason provided';
  const warns = get('warnings');
  const key = `${message.guild.id}_${member.id}`;
  if (!warns[key]) warns[key] = [];
  warns[key].push({ reason, by: message.author.tag, at: Date.now() });
  save('warnings');
  const count = warns[key].length;
  message.reply({ embeds: [new EmbedBuilder().setColor(0xffcc00).setTitle('⚠️ Warning Issued')
    .addFields(
      { name: 'User',    value: `${member}`,         inline: true },
      { name: 'Reason',  value: reason,              inline: true },
      { name: 'Total',   value: `${count} warning${count > 1 ? 's' : ''}`, inline: true },
      { name: 'By',      value: message.author.tag,  inline: true }
    ).setTimestamp()] });
  try { await member.send({ embeds: [{ color: 0xffcc00, title: `⚠️ Warning in ${message.guild.name}`, description: `You received a warning.\n**Reason:** ${reason}\n**Warnings:** ${count}` }] }); } catch {}
}

async function cmdWarnings(message, args) {
  const member = await resolveMember(message, args);
  if (!member) return message.reply({ embeds: [errEmbed('Usage: `.warnings @user`')] });
  const warns = get('warnings')[`${message.guild.id}_${member.id}`] || [];
  if (!warns.length) return message.reply({ embeds: [okEmbed(`✅ **${member.user.tag}** has no warnings.`)] });
  const list = warns.map((w, i) => `**${i + 1}.** ${w.reason} — by *${w.by}* — <t:${Math.floor(w.at / 1000)}:R>`).join('\n');
  message.reply({ embeds: [new EmbedBuilder().setColor(0xffcc00).setTitle(`⚠️ Warnings for ${member.user.tag}`)
    .setDescription(list).setFooter({ text: `Total: ${warns.length}` }).setTimestamp()] });
}

async function cmdClearWarns(message, args) {
  if (!adminCheck(message)) return;
  const member = await resolveMember(message, args);
  if (!member) return message.reply({ embeds: [errEmbed('Usage: `.clearwarns @user`')] });
  const warns = get('warnings');
  delete warns[`${message.guild.id}_${member.id}`]; save('warnings');
  message.reply({ embeds: [okEmbed(`✅ Cleared all warnings for **${member.user.tag}**.`)] });
}

// ============================================================
// INFO COMMANDS
// ============================================================
async function cmdPing(message) {
  const sent = await message.reply({ embeds: [{ color: 0x5865f2, description: '🏓 Pinging…' }] });
  const latency = sent.createdTimestamp - message.createdTimestamp;
  const ws = message.client.ws.ping;
  sent.edit({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('🏓 Pong!')
    .addFields(
      { name: '⏱️ Roundtrip', value: `${latency}ms`, inline: true },
      { name: '💓 WebSocket', value: `${ws}ms`,      inline: true }
    ).setTimestamp()] });
}

async function cmdServerInfo(message) {
  const g = message.guild;
  await g.fetch();
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 ${g.name}`)
    .setThumbnail(g.iconURL({ dynamic: true }))
    .addFields(
      { name: '👑 Owner',      value: `<@${g.ownerId}>`,                         inline: true },
      { name: '👥 Members',    value: `${g.memberCount}`,                         inline: true },
      { name: '📅 Created',    value: `<t:${Math.floor(g.createdTimestamp/1000)}:D>`, inline: true },
      { name: '💬 Channels',   value: `${g.channels.cache.size}`,                 inline: true },
      { name: '🎭 Roles',      value: `${g.roles.cache.size}`,                    inline: true },
      { name: '😀 Emojis',     value: `${g.emojis.cache.size}`,                   inline: true },
      { name: '🔒 Verification',value: g.verificationLevel.toString(),             inline: true },
      { name: '💎 Boosts',     value: `${g.premiumSubscriptionCount || 0} (Tier ${g.premiumTier})`, inline: true },
    )
    .setFooter({ text: `ID: ${g.id}` }).setTimestamp();
  if (g.bannerURL()) embed.setImage(g.bannerURL({ size: 1024 }));
  message.reply({ embeds: [embed] });
}

async function cmdUserInfo(message, args) {
  const member = (await resolveMember(message, args)) || message.member;
  const u = member.user;
  const roles = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => `${r}`).join(', ') || 'None';
  message.reply({ embeds: [new EmbedBuilder().setColor(member.displayHexColor || 0x5865f2).setTitle(`👤 ${u.tag}`)
    .setThumbnail(u.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: '🆔 ID',          value: u.id,                                              inline: true  },
      { name: '📅 Joined Discord', value: `<t:${Math.floor(u.createdTimestamp/1000)}:D>`, inline: true  },
      { name: '📅 Joined Server',  value: `<t:${Math.floor(member.joinedTimestamp/1000)}:D>`, inline: true },
      { name: '🤖 Bot',         value: u.bot ? 'Yes' : 'No',                              inline: true  },
      { name: '📛 Nickname',    value: member.nickname || 'None',                          inline: true  },
      { name: '🎭 Top Role',    value: `${member.roles.highest}`,                          inline: true  },
      { name: `🎭 Roles [${member.roles.cache.size - 1}]`, value: roles.slice(0, 1000), inline: false },
    ).setFooter({ text: `Requested by ${message.author.tag}` }).setTimestamp()] });
}

async function cmdAvatar(message, args) {
  const member = (await resolveMember(message, args)) || message.member;
  const url = member.user.displayAvatarURL({ dynamic: true, size: 1024 });
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🖼️ Avatar — ${member.user.tag}`)
    .setImage(url).setURL(url).setTimestamp()] });
}

async function cmdBotInfo(message) {
  const b = message.client;
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${b.user.id}&permissions=8&scope=bot%20applications.commands`;
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🤖 ${b.user.tag}`)
    .setThumbnail(b.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '📅 Created',  value: `<t:${Math.floor(b.user.createdTimestamp/1000)}:D>`,  inline: true },
      { name: '📡 Servers',  value: `${b.guilds.cache.size}`,                             inline: true },
      { name: '💓 Ping',     value: `${b.ws.ping}ms`,                                     inline: true },
      { name: '🔗 Invite',   value: `[Click to Invite](${inviteUrl})`,                    inline: false },
    ).setFooter({ text: 'discord.js v14 · Node.js ESM' }).setTimestamp()] });
}

async function cmdRoleInfo(message, args) {
  const roleId = args[0]?.replace(/[<@&>]/g, '');
  const role = roleId ? message.guild.roles.cache.get(roleId) : null;
  if (!role) return message.reply({ embeds: [errEmbed('Usage: `.roleinfo @role`')] });
  message.reply({ embeds: [new EmbedBuilder().setColor(role.color || 0x5865f2).setTitle(`🎭 ${role.name}`)
    .addFields(
      { name: '🆔 ID',        value: role.id,                                           inline: true },
      { name: '👥 Members',   value: `${role.members.size}`,                            inline: true },
      { name: '📅 Created',   value: `<t:${Math.floor(role.createdTimestamp/1000)}:D>`, inline: true },
      { name: '🎨 Color',     value: role.hexColor,                                     inline: true },
      { name: '📌 Position',  value: `${role.position}`,                                inline: true },
      { name: '💎 Mentionable',value: role.mentionable ? 'Yes' : 'No',                  inline: true },
      { name: '🔒 Hoisted',   value: role.hoist ? 'Yes' : 'No',                         inline: true },
    ).setTimestamp()] });
}

async function cmdSnipe(message) {
  const data = snipeCache[message.channel.id];
  if (!data) return message.reply({ embeds: [errEmbed('Nothing to snipe in this channel.')] });
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔍 Sniped Message')
    .setDescription(data.content || '*[no text content]*')
    .setFooter({ text: `Sent by ${data.author}` })
    .setTimestamp(data.timestamp)] });
}

async function cmdInvite(message) {
  const id = message.client.user.id;
  const url = `https://discord.com/oauth2/authorize?client_id=${id}&permissions=8&scope=bot%20applications.commands`;
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔗 Invite This Bot')
    .setDescription(`[**Click here to invite**](${url})\n\n\`${url}\``)
    .setThumbnail(message.client.user.displayAvatarURL()).setTimestamp()] });
}

// ============================================================
// TICKET COMMANDS
// ============================================================
async function cmdClaim(message) {
  const tickets = get('tickets');
  const tid = `${message.guild.id}_${message.channel.id}`;
  const ticket = tickets[tid];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  if (!isAdmin(message.member)) return message.reply({ embeds: [errEmbed('Only staff can claim tickets.')] });
  ticket.claimedBy = message.author.id; save('tickets');
  await message.channel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  message.reply({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('✅ Ticket Claimed')
    .setDescription(`This ticket has been claimed by ${message.author}.`).setTimestamp()] });
  try {
    const owner = await message.guild.members.fetch(ticket.userId);
    await owner.send({ embeds: [{ color: 0x00cc66, title: '✅ Ticket Claimed', description: `Your ticket in **${message.guild.name}** was claimed by **${message.author.tag}**.` }] });
  } catch {}
}

async function cmdUnclaim(message) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const tid = `${message.guild.id}_${message.channel.id}`;
  const ticket = tickets[tid];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  const prev = ticket.claimedBy; ticket.claimedBy = null; save('tickets');
  message.reply({ embeds: [okEmbed(`🔓 Ticket unclaimed${prev ? ` from <@${prev}>` : ''}.`)] });
}

async function cmdTransfer(message, args) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const tid = `${message.guild.id}_${message.channel.id}`;
  const ticket = tickets[tid];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  const id = args[0]?.replace(/[<@!>]/g, '');
  if (!id) return message.reply({ embeds: [errEmbed('Usage: `.transfer @staff`')] });
  let member; try { member = await message.guild.members.fetch(id); } catch { return message.reply({ embeds: [errEmbed('Member not found.')] }); }
  const old = ticket.claimedBy; ticket.claimedBy = member.id; save('tickets');
  await message.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔄 Ticket Transferred')
    .addFields({ name: 'From', value: old ? `<@${old}>` : 'Unclaimed', inline: true }, { name: 'To', value: `${member}`, inline: true }).setTimestamp()] });
  try { await member.send({ embeds: [{ color: 0x5865f2, title: '📨 Ticket Transferred to You', description: `Ticket transferred to you by **${message.author.tag}** in **${message.guild.name}**.\nChannel: ${message.channel}` }] }); } catch {}
}

async function cmdTimer(message, args) {
  if (!adminCheck(message)) return;
  const ms = parseTime(args[0]);
  if (!ms) return message.reply({ embeds: [errEmbed('Usage: `.timer <duration>` e.g. `.timer 10m`')] });
  const end = Math.floor((Date.now() + ms) / 1000);
  message.reply({ embeds: [new EmbedBuilder().setColor(0xffcc00).setTitle('⏱️ Timer Set')
    .setDescription(`Duration: **${args[0]}**\nExpires: <t:${end}:R>`).setTimestamp()] });
  setTimeout(() => message.channel.send({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('⏰ Timer Expired')
    .setDescription(`The **${args[0]}** timer by ${message.author} has expired!`).setTimestamp()] }), ms);
}

// ============================================================
// EXCHANGE & MIDDLEMAN
// ============================================================
const EXCH_TYPES = {
  'inr-crypto':  { label: 'INR → Crypto',  emoji: '💰' },
  'crypto-inr':  { label: 'Crypto → INR',  emoji: '🪙' },
  'paypal-inr':  { label: 'PayPal → INR',  emoji: '💳' },
  'inr-paypal':  { label: 'INR → PayPal',  emoji: '💰' },
  'pak-inr':     { label: 'PKR → INR',     emoji: '🇵🇰' },
  'inr-pak':     { label: 'INR → PKR',     emoji: '🇮🇳' },
  'pak-crypto':  { label: 'PKR → Crypto',  emoji: '🇵🇰' },
  'crypto-pak':  { label: 'Crypto → PKR',  emoji: '🪙' },
  'euro-crypto': { label: 'EUR → Crypto',  emoji: '💶' },
};
async function fetchRates() {
  try { const r = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=litecoin,bitcoin,ethereum,tron,tether&vs_currencies=inr,usd,pkr,eur', { timeout: 6000 }); return r.data; } catch { return null; }
}
async function fetchFx(from, to) {
  try { const r = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`, { timeout: 6000 }); return r.data.rates?.[to] ?? null; } catch { return null; }
}

async function cmdMM(message, args) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const ticket  = tickets[`${message.guild.id}_${message.channel.id}`];
  if (!ticket) return message.reply({ embeds: [errEmbed('Use `.mm` inside a ticket channel.')] });
  const amount = args[0]; const type = args[1]?.toUpperCase();
  if (!amount || !type) return message.reply({ embeds: [errEmbed('Usage: `.mm <amount> <currency>`')] });
  const claimedBy = ticket.claimedBy;
  const sp = claimedBy ? get('payments')[claimedBy] : null;
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🤝 Middleman Transaction')
    .setDescription('A middleman deal has been initiated.')
    .addFields(
      { name: '💵 Amount', value: `**${amount} ${type}**`, inline: true },
      { name: '👤 User',   value: `<@${ticket.userId}>`,  inline: true },
      { name: '🛡️ Staff',  value: claimedBy ? `<@${claimedBy}>` : 'Unclaimed', inline: true },
    ).setTimestamp();
  if (sp?.upi)    embed.addFields({ name: '📲 UPI',    value: sp.upi,    inline: true });
  if (sp?.crypto) embed.addFields({ name: '🪙 Crypto', value: sp.crypto, inline: true });
  message.reply({ embeds: [embed] });
  if (claimedBy) {
    try {
      const sm = await message.guild.members.fetch(claimedBy);
      await sm.send({ embeds: [{ color: 0x5865f2, title: '📢 MM Transaction', description: `MM deal **${amount} ${type}** in your claimed ticket.\nChannel: ${message.channel} — **${message.guild.name}**` }] });
    } catch {}
  }
}

async function cmdExch(message) {
  if (!adminCheck(message)) return;
  const rows = [];
  const keys = Object.keys(EXCH_TYPES);
  for (let i = 0; i < keys.length; i += 4) {
    const row = new ActionRowBuilder();
    keys.slice(i, i + 4).forEach(k =>
      row.addComponents(new ButtonBuilder().setCustomId(`exch_${k}`).setLabel(EXCH_TYPES[k].label).setStyle(ButtonStyle.Primary))
    );
    rows.push(row);
  }
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('💱 Exchange Service').setDescription('Select exchange type for live rates.').setTimestamp()], components: rows });
}

async function cmdBuySell(message, args, mode) {
  if (!adminCheck(message)) return;
  const ticket = get('tickets')[`${message.guild.id}_${message.channel.id}`];
  const item = args[0]; const amount = args[1]; const currency = args[2]?.toUpperCase() || 'INR';
  const embed = new EmbedBuilder().setColor(mode === 'buy' ? 0x00cc66 : 0xff4444).setTitle(`${mode === 'buy' ? '🛒 Buy' : '💸 Sell'} Order`).setTimestamp();
  if (item && amount) {
    embed.addFields(
      { name: 'Item',   value: item,                                            inline: true },
      { name: 'Amount', value: `${amount} ${currency}`,                         inline: true },
      { name: 'Mode',   value: mode === 'buy' ? '🛒 Buying' : '💸 Selling',    inline: true },
      { name: 'By',     value: `${message.author}`,                             inline: true }
    );
  } else embed.setDescription(`Usage: \`.${mode} <item> <amount> [currency]\``);
  const claimedBy = ticket?.claimedBy;
  if (claimedBy) {
    embed.addFields({ name: '🛡️ Staff', value: `<@${claimedBy}>`, inline: true });
    try {
      const sm = await message.guild.members.fetch(claimedBy);
      await sm.send({ embeds: [{ color: mode === 'buy' ? 0x00cc66 : 0xff4444, title: `📢 New ${mode === 'buy' ? 'Buy' : 'Sell'} Order`, description: `**${message.author.tag}** started a **${mode}** order.\n**Item:** ${item || 'N/A'} | **Amount:** ${amount || 'N/A'} ${currency}\nChannel: ${message.channel}` }] });
    } catch {}
  }
  message.reply({ embeds: [embed] });
}

// ============================================================
// QR / PAYMENT
// ============================================================
async function cmdAddPayment(message, args) {
  const type = args[0]?.toLowerCase(); const value = args.slice(1).join(' ');
  if (!type || !value || !['upi', 'crypto'].includes(type))
    return message.reply({ embeds: [errEmbed('Usage:\n`.addpayment upi <upi_id>`\n`.addpayment crypto <address>`')] });
  const payments = get('payments');
  if (!payments[message.author.id]) payments[message.author.id] = {};
  payments[message.author.id][type] = value; save('payments');
  message.reply({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('✅ Payment Method Saved')
    .addFields({ name: 'Type', value: type.toUpperCase(), inline: true }, { name: 'Value', value: `\`${value}\``, inline: true })
    .setFooter({ text: 'Use .qr <amount> to generate QR' }).setTimestamp()] });
}

async function cmdQR(message, args) {
  const amount = args[0];
  if (!amount) return message.reply({ embeds: [errEmbed('Usage: `.qr <amount>`')] });
  const sp = get('payments')[message.author.id];
  if (!sp?.upi && !sp?.crypto) return message.reply({ embeds: [errEmbed('No payment method saved. Use `.addpayment upi <id>` first.')] });
  await message.channel.sendTyping();
  const files = []; const fields = [];
  if (sp.upi) {
    try {
      const buf = await QRCode.toBuffer(`upi://pay?pa=${sp.upi}&am=${amount}&cu=INR`, { errorCorrectionLevel: 'H', width: 400 });
      const { AttachmentBuilder } = await import('discord.js');
      files.push(new AttachmentBuilder(buf, { name: 'upi_qr.png' }));
      fields.push({ name: '📲 UPI QR', value: `**UPI:** \`${sp.upi}\`\n**Amount:** ₹${amount}`, inline: false });
    } catch (e) { fields.push({ name: '📲 UPI', value: `QR failed: ${e.message}`, inline: false }); }
  }
  if (sp.crypto) {
    try {
      const buf = await QRCode.toBuffer(sp.crypto, { errorCorrectionLevel: 'H', width: 400, color: { dark: '#f97316', light: '#ffffff' } });
      const { AttachmentBuilder } = await import('discord.js');
      files.push(new AttachmentBuilder(buf, { name: 'crypto_qr.png' }));
      fields.push({ name: '🪙 Crypto QR', value: `**Address:** \`${sp.crypto}\``, inline: false });
    } catch (e) { fields.push({ name: '🪙 Crypto', value: `QR failed: ${e.message}`, inline: false }); }
  }
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`💳 Payment QR — ₹${amount}`)
    .setDescription(`Scan to pay **₹${amount}**`).addFields(fields)
    .setFooter({ text: `Requested by ${message.author.tag}` }).setTimestamp();
  if (files.length) embed.setImage('attachment://upi_qr.png');
  message.reply({ embeds: [embed], files });
}

// ============================================================
// CRYPTO WALLET LOOKUP
// ============================================================
const COINS = {
  LTC:  { name: 'Litecoin',    color: 0xa6a9aa, emoji: '🪙', div: 1e8,  explorer: a=>`https://live.blockcypher.com/ltc/address/${a}/`, api: a=>`https://api.blockcypher.com/v1/ltc/main/addrs/${a}/full?limit=5`, type:'bcy' },
  BTC:  { name: 'Bitcoin',     color: 0xf7931a, emoji: '₿',  div: 1e8,  explorer: a=>`https://live.blockcypher.com/btc/address/${a}/`, api: a=>`https://api.blockcypher.com/v1/btc/main/addrs/${a}/full?limit=5`, type:'bcy' },
  ETH:  { name: 'Ethereum',    color: 0x627eea, emoji: '⟠',  div: 1e18, explorer: a=>`https://etherscan.io/address/${a}`,             api: a=>`https://api.blockcypher.com/v1/eth/main/addrs/${a}/full?limit=5`, type:'bcy' },
  TRX:  { name: 'TRON',        color: 0xe50914, emoji: '🔴', div: 1e6,  explorer: a=>`https://tronscan.org/#/address/${a}`,          api: a=>`https://apilist.tronscanapi.com/api/account?address=${a}`,        type:'trx' },
  USDT: { name: 'USDT TRC20',  color: 0x26a17b, emoji: '💚', div: 1e6,  explorer: a=>`https://tronscan.org/#/address/${a}`,          api: a=>`https://apilist.tronscanapi.com/api/account?address=${a}`,        type:'trx' },
};

async function cmdCryptoLookup(message, args, coin) {
  const address = args[0];
  if (!address) return message.reply({ embeds: [errEmbed(`Usage: \`.${coin.toLowerCase()} <wallet_address>\``)] });
  await message.channel.sendTyping();
  const c = COINS[coin];
  try {
    const res = await axios.get(c.api(address), { timeout: 10000 });
    const d = res.data;
    const embed = new EmbedBuilder().setColor(c.color).setTitle(`${c.emoji} ${c.name} Wallet Info`).setURL(c.explorer(address)).setTimestamp();
    if (c.type === 'trx') {
      embed.addFields(
        { name: '📍 Address',      value: `\`${address}\``,         inline: false },
        { name: '💰 Balance',      value: `${((d.balance||0)/c.div).toFixed(2)} TRX`, inline: true },
        { name: '📊 Transactions', value: `${d.transactions||0}`,   inline: true },
        { name: '🔗 Explorer',     value: `[TronScan](${c.explorer(address)})`, inline: false }
      );
    } else {
      const bal  = ((d.balance        ||0)/c.div).toFixed(8);
      const recv = ((d.total_received ||0)/c.div).toFixed(8);
      const sent = ((d.total_sent     ||0)/c.div).toFixed(8);
      embed.addFields(
        { name: '📍 Address',       value: `\`${address}\``,            inline: false },
        { name: '💰 Balance',       value: `${bal} ${coin}`,            inline: true  },
        { name: '📥 Total Received',value: `${recv} ${coin}`,           inline: true  },
        { name: '📤 Total Sent',    value: `${sent} ${coin}`,           inline: true  },
        { name: '📊 Total Txns',    value: `${d.n_tx||0}`,              inline: true  },
        { name: '⏳ Unconfirmed',   value: `${d.unconfirmed_n_tx||0}`,  inline: true  },
        { name: '🔗 Explorer',      value: `[BlockCypher](${c.explorer(address)})`, inline: false }
      );
      const txs = d.txs?.slice(0, 5) || [];
      if (txs.length) {
        const list = txs.map((tx, i) => {
          const hash = tx.hash?.slice(0, 16) + '...';
          const val  = ((tx.total||0)/c.div).toFixed(6);
          const conf = tx.confirmations || 0;
          const time = tx.confirmed ? `<t:${Math.floor(new Date(tx.confirmed).getTime()/1000)}:R>` : '⏳';
          return `${i+1}. \`${hash}\` — ${val} ${coin} — ${conf} confs — ${time}`;
        }).join('\n');
        embed.addFields({ name: `📜 Last ${txs.length} Transactions`, value: list, inline: false });
      }
    }
    message.reply({ embeds: [embed] });
  } catch (err) { message.reply({ embeds: [errEmbed(`Failed to fetch wallet data: ${err.message}`)] }); }
}

// ============================================================
// SOCIAL MEDIA FOLLOWER / SPAM COMMANDS
// ============================================================
const PLATFORMS = {
  tfollow:  { name: 'Twitch',    color: 0x9146ff, icon: '🟣', action: 'Followers', label: 'Twitch Followers',   url: u=>`https://twitch.tv/${u}` },
  tspam:    { name: 'Twitch',    color: 0x9146ff, icon: '🟣', action: 'Chat Spam', label: 'Twitch Chat Spam',   url: u=>`https://twitch.tv/${u}` },
  ttfollow: { name: 'TikTok',    color: 0x010101, icon: '⚡', action: 'Followers', label: 'TikTok Followers',   url: u=>`https://tiktok.com/@${u}` },
  ifollow:  { name: 'Instagram', color: 0xe1306c, icon: '📸', action: 'Followers', label: 'Instagram Followers',url: u=>`https://instagram.com/${u}` },
  pfollow:  { name: 'Pinterest', color: 0xe60023, icon: '📌', action: 'Followers', label: 'Pinterest Followers',url: u=>`https://pinterest.com/${u}` },
  sfollow:  { name: 'Snapchat',  color: 0xfffc00, icon: '👻', action: 'Followers', label: 'Snapchat Followers', url: u=>`https://snapchat.com/add/${u}` },
  yfollow:  { name: 'YouTube',   color: 0xff0000, icon: '▶️', action: 'Subscribers',label: 'YouTube Subscribers',url: u=>`https://youtube.com/@${u}` },
  spfollow: { name: 'Spotify',   color: 0x1db954, icon: '🎵', action: 'Followers', label: 'Spotify Followers',  url: u=>`https://open.spotify.com/user/${u}` },
};

/** Returns the custom emoji for a platform in this guild, or the default icon */
function getPlatformEmoji(guildId, cmdName) {
  return get('platformEmojis')?.[guildId]?.[cmdName] || PLATFORMS[cmdName]?.icon || '';
}

/** Check if member has required server invite text in their custom status */
function hasInviteInStatus(member, requiredText) {
  if (!requiredText) return true;
  const activities = member.presence?.activities || [];
  const custom = activities.find(a => a.type === ActivityType.Custom);
  const state  = (custom?.state || '').toLowerCase();
  return state.includes(requiredText.toLowerCase());
}

async function cmdSocialAction(message, args, cmdName) {
  const platform = PLATFORMS[cmdName];
  if (!platform) return;
  const username = args[0];
  if (!username) return message.reply({ embeds: [errEmbed(`Usage: \`.${cmdName} <username>\``)] });

  // ── Server invite status gate ──────────────────────────────
  const inviteCfg = get('serverInvite')[message.guild.id];
  if (inviteCfg?.text && !isAdmin(message.member)) {
    if (!hasInviteInStatus(message.member, inviteCfg.text)) {
      return message.reply(`❌ ${message.author}, you must have \`${inviteCfg.text}\` in status.`);
    }
  }

  // ── Cooldown check ─────────────────────────────────────────
  const coolKey  = `${message.author.id}_${message.guild.id}`;
  const now      = Date.now();
  const expiry   = socialCooldowns.get(coolKey) || 0;
  if (now < expiry) {
    const secsLeft = Math.ceil((expiry - now) / 1000);
    const emoji    = getPlatformEmoji(message.guild.id, cmdName);
    return message.reply(`${emoji} ${message.author}, wait **${secsLeft}s**.`);
  }
  socialCooldowns.set(coolKey, now + SOCIAL_COOLDOWN_MS);

  const emoji    = getPlatformEmoji(message.guild.id, cmdName);
  const amount   = getFollowerAmount(message.member, message.guild.id, cmdName);
  const delaySec = randInt(3, 15);
  const delayMs  = delaySec * 1000;

  // ── Processing embed (matches screenshot style) ────────────
  const isSpam = cmdName === 'tspam';
  const processingEmbed = new EmbedBuilder()
    .setColor(platform.color)
    .setTitle(`${emoji} ${platform.label}`)
    .addFields(
      { name: isSpam ? 'Channel' : 'Username', value: username, inline: false },
      { name: isSpam ? 'Messages' : platform.action, value: `${amount.toLocaleString()}`, inline: false },
      { name: 'Status', value: isSpam ? 'Sending messages...' : 'Sending...', inline: false },
    );

  const sent = await message.reply({ embeds: [processingEmbed] });
  await sleep(delayMs);

  // ── Completed embed ────────────────────────────────────────
  const doneEmbed = new EmbedBuilder()
    .setColor(platform.color)
    .setTitle(`${emoji} ${platform.label}`)
    .addFields(
      { name: isSpam ? 'Channel' : 'Username', value: username, inline: false },
      { name: isSpam ? 'Messages' : platform.action, value: `${amount.toLocaleString()}`, inline: false },
      { name: 'Status', value: isSpam ? 'Messages sent ✅' : `${platform.action} delivered ✅`, inline: false },
    );

  await sent.edit({ embeds: [doneEmbed] });
}

// ============================================================
// ROLE SOCIAL PERKS COMMAND
// ============================================================
const PLATFORM_LABELS = {
  tfollow:'🟣 Twitch Followers', tspam:'🟣 Twitch Spam', ttfollow:'⚡ TikTok',
  ifollow:'📸 Instagram', pfollow:'📌 Pinterest', sfollow:'👻 Snapchat',
  yfollow:'▶️ YouTube', spfollow:'🎵 Spotify', all:'🌐 All (default)',
};

async function cmdRoleSocial(message) {
  if (!adminCheck(message)) return;
  const cfg = get('followerRoles')[message.guild.id] || {};
  if (!Object.keys(cfg).length)
    return message.reply({ embeds: [errEmbed('No follower amounts configured yet. Use `/setfollowers` to set them.')] });

  const embed = new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle('📊 Role Social Media Perks')
    .setDescription('All configured roles and their per-platform follower/subscriber amounts.')
    .setFooter({ text: `${message.guild.name} • Use /setfollowers to update` })
    .setTimestamp();

  for (const [roleId, val] of Object.entries(cfg)) {
    const role = message.guild.roles.cache.get(roleId);
    const roleName = role ? `@${role.name}` : `Unknown Role (${roleId})`;
    let lines = [];
    if (typeof val === 'object') {
      for (const [platform, amount] of Object.entries(val)) {
        lines.push(`${PLATFORM_LABELS[platform] || platform}: **${Number(amount).toLocaleString()}**`);
      }
    } else {
      lines.push(`🌐 All platforms: **${Number(val).toLocaleString()}**`);
    }
    embed.addFields({ name: roleName, value: lines.join('\n') || 'No amounts set', inline: false });
  }
  message.reply({ embeds: [embed] });
}

// ============================================================
// TICKET MANAGEMENT COMMANDS
// ============================================================
async function cmdTicketAdd(message, args) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const ticket  = tickets[`${message.guild.id}_${message.channel.id}`];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  const target = message.mentions.members.first();
  if (!target) return message.reply({ embeds: [errEmbed('Usage: `.add @user`')] });
  await message.channel.permissionOverwrites.edit(target, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  message.reply({ embeds: [okEmbed(`✅ Added ${target} to this ticket.`)] });
}

async function cmdTicketRemove(message, args) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const ticket  = tickets[`${message.guild.id}_${message.channel.id}`];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  const target = message.mentions.members.first();
  if (!target) return message.reply({ embeds: [errEmbed('Usage: `.remove @user`')] });
  if (target.id === ticket.userId) return message.reply({ embeds: [errEmbed('Cannot remove the ticket owner.')] });
  await message.channel.permissionOverwrites.delete(target);
  message.reply({ embeds: [okEmbed(`✅ Removed ${target} from this ticket.`)] });
}

async function cmdTicketRename(message, args) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const ticket  = tickets[`${message.guild.id}_${message.channel.id}`];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  const newName = args.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || null;
  if (!newName) return message.reply({ embeds: [errEmbed('Usage: `.rename <new-name>`')] });
  await message.channel.setName(newName);
  message.reply({ embeds: [okEmbed(`✅ Channel renamed to **${newName}**.`)] });
}

async function cmdTicketLock(message) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const ticket  = tickets[`${message.guild.id}_${message.channel.id}`];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
  message.reply({ embeds: [{ color: 0xff4444, description: '🔒 Ticket locked. Only staff can send messages.' }] });
}

async function cmdTicketUnlock(message) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const ticket  = tickets[`${message.guild.id}_${message.channel.id}`];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null });
  message.reply({ embeds: [okEmbed('🔓 Ticket unlocked. Anyone in this ticket can now send messages.')] });
}

async function cmdTicketClose(message) {
  if (!adminCheck(message)) return;
  const tickets = get('tickets');
  const key     = `${message.guild.id}_${message.channel.id}`;
  const ticket  = tickets[key];
  if (!ticket) return message.reply({ embeds: [errEmbed('This is not a ticket channel.')] });
  await message.reply({ embeds: [{ color: 0xff4444, description: '🔒 Closing ticket in 5 seconds...' }] });
  await sleep(5000);
  delete tickets[key];
  save('tickets');
  await message.channel.delete().catch(() => {});
}

// ============================================================
// UTILITY / FUN COMMANDS
// ============================================================
async function cmdSay(message, args) {
  if (!adminCheck(message)) return;
  const text = args.join(' ');
  if (!text) return message.reply({ embeds: [errEmbed('Usage: `.say <message>`')] });
  await message.delete().catch(() => {});
  message.channel.send(text);
}

async function cmdAnnounce(message, args) {
  if (!adminCheck(message)) return;
  const text = args.join(' ');
  if (!text) return message.reply({ embeds: [errEmbed('Usage: `.announce <message>`')] });
  await message.delete().catch(() => {});
  message.channel.send({
    embeds: [new EmbedBuilder().setColor(0xf97316).setTitle('📢 Announcement').setDescription(text).setFooter({ text: message.guild.name }).setTimestamp()]
  });
}

async function cmdDM(message, args) {
  if (!adminCheck(message)) return;
  const target = message.mentions.members.first();
  const text   = args.slice(1).join(' ');
  if (!target || !text) return message.reply({ embeds: [errEmbed('Usage: `.dm @user <message>`')] });
  try {
    await target.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📨 Message from ${message.guild.name}`).setDescription(text).setFooter({ text: `Sent by ${message.author.tag}` }).setTimestamp()] });
    message.reply({ embeds: [okEmbed(`✅ DM sent to ${target}.`)] });
  } catch { message.reply({ embeds: [errEmbed('❌ Could not DM that user (DMs may be closed).')] }); }
}

async function cmdEmbed(message, args) {
  if (!adminCheck(message)) return;
  const raw = args.join(' ');
  const parts = raw.split('|');
  if (parts.length < 2) return message.reply({ embeds: [errEmbed('Usage: `.embed <title> | <description>`')] });
  const title = parts[0].trim();
  const desc  = parts.slice(1).join('|').trim();
  await message.delete().catch(() => {});
  message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(desc).setFooter({ text: message.guild.name }).setTimestamp()] });
}

async function cmdPoll(message, args) {
  if (!adminCheck(message)) return;
  const question = args.join(' ');
  if (!question) return message.reply({ embeds: [errEmbed('Usage: `.poll <question>`')] });
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Poll').setDescription(`**${question}**`).setFooter({ text: `Poll by ${message.author.tag}` }).setTimestamp();
  const msg = await message.channel.send({ embeds: [embed] });
  await msg.react('👍');
  await msg.react('👎');
  await message.delete().catch(() => {});
}

async function cmdCoinflip(message) {
  const result = Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails';
  message.reply({ embeds: [new EmbedBuilder().setColor(0xf0b429).setTitle('Coin Flip').setDescription(`**${result}!**`).setTimestamp()] });
}

const EIGHTBALL = [
  'It is certain.','It is decidedly so.','Without a doubt.','Yes – definitely.',
  'You may rely on it.','As I see it, yes.','Most likely.','Outlook good.',
  'Yes.','Signs point to yes.','Reply hazy, try again.','Ask again later.',
  'Better not tell you now.','Cannot predict now.','Concentrate and ask again.',
  "Don't count on it.",'My reply is no.','My sources say no.','Outlook not so good.','Very doubtful.'
];
async function cmdEightBall(message, args) {
  const question = args.join(' ');
  if (!question) return message.reply({ embeds: [errEmbed('Usage: `.8ball <question>`')] });
  const answer = EIGHTBALL[Math.floor(Math.random() * EIGHTBALL.length)];
  message.reply({ embeds: [new EmbedBuilder().setColor(0x1a1a2e).setTitle('🎱 8-Ball').addFields({ name: '❓ Question', value: question }, { name: '🔮 Answer', value: `**${answer}**` }).setTimestamp()] });
}

// ============================================================
// HELP COMMAND
// ============================================================
async function cmdHelp(message, args) {
  const cat = args[0]?.toLowerCase();
  const cats = {
    mod: {
      title: '🛡️ Moderation (Admin Only)', color: 0xff4444,
      fields: [
        { name: '.ban @user [reason]',           value: 'Ban a member',                          inline: false },
        { name: '.kick @user [reason]',          value: 'Kick a member',                         inline: false },
        { name: '.timeout @user <dur> [reason]', value: 'Timeout  (10s 5m 1h 1d)',               inline: false },
        { name: '.mute / .unmute @user',         value: 'Add or remove Muted role',              inline: false },
        { name: '.purge <1-100>',                value: 'Bulk delete messages',                  inline: false },
        { name: '.autopurge <interval|off>',     value: 'Auto-purge channel on interval',        inline: false },
        { name: '.slowmode <0-21600>',           value: 'Set channel slowmode (0 = off)',        inline: false },
        { name: '.warn @user <reason>',          value: 'Warn a member (DMs them)',              inline: false },
        { name: '.warnings @user',              value: 'View warnings for a member',            inline: false },
        { name: '.clearwarns @user',            value: 'Clear all warnings for a member',       inline: false },
        { name: '.deletechannel [#channel]',     value: 'Delete channel with confirmation',      inline: false },
        { name: '.nuke',                         value: 'Delete & recreate channel (wipe all)',  inline: false },
      ]
    },
    ticket: {
      title: '🎫 Ticket Commands', color: 0x5865f2,
      fields: [
        { name: '.claim',             value: 'Claim ticket — DMs the owner',               inline: false },
        { name: '.unclaim',           value: 'Unclaim the ticket',                         inline: false },
        { name: '.transfer @staff',   value: 'Transfer ticket — DMs new staff',            inline: false },
        { name: '.timer <duration>',  value: 'Set countdown timer (e.g. .timer 10m)',      inline: false },
        { name: '.add @user',         value: 'Add a user to the ticket channel',           inline: false },
        { name: '.remove @user',      value: 'Remove a user from the ticket channel',      inline: false },
        { name: '.rename <name>',     value: 'Rename the ticket channel',                  inline: false },
        { name: '.lock',              value: 'Lock ticket — only staff can send',          inline: false },
        { name: '.unlock',            value: 'Unlock ticket — restore send permissions',   inline: false },
        { name: '.close',             value: 'Close & delete ticket channel (5s delay)',   inline: false },
        { name: '/setuptixroles',     value: 'Configure panel with staff/required roles',  inline: false },
        { name: '/setticketpanel',    value: 'Post interactive ticket buttons to channel', inline: false },
      ]
    },
    exchange: {
      title: '💱 Exchange / MM Commands', color: 0x00cc66,
      fields: [
        { name: '.mm <amount> <currency>', value: 'Middleman deal — notifies claimed staff', inline: false },
        { name: '.exch',                   value: 'Button panel with live exchange rates',  inline: false },
        { name: '.buy <item> <amount>',    value: 'Create buy order — notifies staff',      inline: false },
        { name: '.sell <item> <amount>',   value: 'Create sell order — notifies staff',     inline: false },
      ]
    },
    payment: {
      title: '💳 Payment / QR', color: 0xf97316,
      fields: [
        { name: '.addpayment upi <id>',    value: 'Save your UPI payment method',               inline: false },
        { name: '.addpayment crypto <addr>',value: 'Save your crypto wallet address',           inline: false },
        { name: '.qr <amount>',            value: 'Generate QR image (UPI with exact amount)',  inline: false },
        { name: '/setuppayment',           value: 'Save payment methods via slash command',     inline: false },
      ]
    },
    crypto: {
      title: '🔗 Crypto Wallet Lookup', color: 0xa6a9aa,
      fields: [
        { name: '.ltc <addr>', value: 'Litecoin wallet: balance + last 5 txns',  inline: false },
        { name: '.btc <addr>', value: 'Bitcoin wallet: balance + last 5 txns',   inline: false },
        { name: '.eth <addr>', value: 'Ethereum wallet: balance + last 5 txns',  inline: false },
        { name: '.trx <addr>', value: 'TRON wallet: balance + txn count',         inline: false },
        { name: '.usdt <addr>',value: 'USDT TRC20 wallet info',                  inline: false },
      ]
    },
    social: {
      title: '📱 Social Media Commands', color: 0x9146ff,
      fields: [
        { name: '.tfollow <user>',  value: '🟣 Send Twitch followers (role-based, random ≤15s)', inline: false },
        { name: '.tspam <user>',    value: '🟣 Send Twitch chat spam',                           inline: false },
        { name: '.ttfollow <user>', value: '⚡ Send TikTok followers',                            inline: false },
        { name: '.ifollow <user>',  value: '📸 Send Instagram followers',                        inline: false },
        { name: '.pfollow <user>',  value: '📌 Send Pinterest followers',                        inline: false },
        { name: '.sfollow <user>',  value: '👻 Send Snapchat followers',                         inline: false },
        { name: '.yfollow <user>',  value: '▶️ Send YouTube subscribers',                                inline: false },
        { name: '.spfollow <user>', value: '🎵 Send Spotify followers',                                  inline: false },
        { name: '.rolesocial',      value: '📊 Show all role perks & platform amounts',                   inline: false },
        { name: '/setfollowers',    value: 'Set per-platform amount per role (e.g. Instagram 25 for @Member)', inline: false },
        { name: '⏳ Cooldown',      value: '30 seconds between social commands per user',                 inline: false },
      ]
    },
    info: {
      title: 'ℹ️ Info Commands', color: 0x5865f2,
      fields: [
        { name: '.ping',              value: 'Bot latency & WebSocket ping',     inline: false },
        { name: '.serverinfo',        value: 'Display server information',       inline: false },
        { name: '.userinfo [@user]',  value: 'Display user information',         inline: false },
        { name: '.avatar [@user]',    value: 'Show avatar image',                inline: false },
        { name: '.roleinfo @role',    value: 'Display role information',         inline: false },
        { name: '.botinfo',           value: 'Bot info + invite link',           inline: false },
        { name: '.snipe',             value: 'Show last deleted message',        inline: false },
        { name: '.invite',            value: 'Get bot invite link',              inline: false },
      ]
    },
    fun: {
      title: '🎉 Utility / Fun Commands', color: 0xf0b429,
      fields: [
        { name: '.say <message>',           value: 'Bot sends a plain message (your msg deleted)',    inline: false },
        { name: '.announce <message>',      value: 'Bot sends a formatted announcement embed',        inline: false },
        { name: '.dm @user <message>',      value: 'DM a user with an embed from the server',        inline: false },
        { name: '.embed <title> | <desc>',  value: 'Post a custom embed (split title and desc with |)', inline: false },
        { name: '.poll <question>',         value: 'Post a 👍/👎 poll embed',                         inline: false },
        { name: '.coinflip',                value: 'Flip a coin — heads or tails',                   inline: false },
        { name: '.8ball <question>',        value: '🎱 Ask the magic 8-ball anything',               inline: false },
      ]
    },
  };
  if (cat && cats[cat]) {
    const c = cats[cat];
    return message.reply({ embeds: [new EmbedBuilder().setColor(c.color).setTitle(c.title).addFields(c.fields).setFooter({ text: '. prefix | Admin only unless noted' }).setTimestamp()] });
  }
  message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📖 Help — Command Categories')
    .setDescription('Use `.help <category>` for full list.')
    .addFields(
      { name: '🛡️ `.help mod`',      value: 'Ban kick mute warn purge nuke slowmode…',           inline: true },
      { name: '🎫 `.help ticket`',   value: 'Claim add remove lock unlock close transfer…',       inline: true },
      { name: '💱 `.help exchange`', value: 'MM rates buy sell…',                                  inline: true },
      { name: '💳 `.help payment`',  value: 'UPI & Crypto QR…',                                   inline: true },
      { name: '🔗 `.help crypto`',   value: 'LTC BTC ETH TRX USDT wallet lookup…',               inline: true },
      { name: '📱 `.help social`',   value: 'Twitch TikTok Instagram Pinterest Snap YouTube Spotify…', inline: true },
      { name: 'ℹ️ `.help info`',     value: 'Ping serverinfo userinfo avatar snipe…',             inline: true },
      { name: '🎉 `.help fun`',      value: 'Say announce poll coinflip 8ball dm embed…',         inline: true },
      { name: '⚙️ Slash Commands',   value: '/setuptixroles /setticketpanel /setuppayment /setfollowers /autopurge', inline: false },
    ).setFooter({ text: 'All prefix commands are admin-only unless noted' }).setTimestamp()] });
}

// ============================================================
// SLASH COMMANDS
// ============================================================
const slashCommands = [
  // /setuptixroles
  {
    data: new SlashCommandBuilder()
      .setName('setuptixroles').setDescription('Setup ticket panel type with roles & category')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('type').setDescription('Panel type').setRequired(true)
        .addChoices(
          { name: 'Support', value: 'support' }, { name: 'Middleman (MM)', value: 'mm' },
          { name: 'Exchange', value: 'exch' },   { name: 'Buy', value: 'buy' },
          { name: 'Sell', value: 'sell' },        { name: 'General', value: 'general' },
        ))
      .addRoleOption(o => o.setName('staff_role').setDescription('Staff role that sees these tickets').setRequired(true))
      .addRoleOption(o => o.setName('required_role').setDescription('Role required to open ticket (optional)').setRequired(false))
      .addChannelOption(o => o.setName('category').setDescription('Category for tickets (optional)').setRequired(false).addChannelTypes(ChannelType.GuildCategory)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const type = interaction.options.getString('type');
      const staffRole = interaction.options.getRole('staff_role');
      const reqRole   = interaction.options.getRole('required_role');
      const category  = interaction.options.getChannel('category');
      const panels = get('ticketPanels');
      panels[`${interaction.guild.id}_${type}`] = { type, staffRole: staffRole.id, requiredRole: reqRole?.id||null, categoryId: category?.id||null, guildId: interaction.guild.id };
      save('ticketPanels');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('✅ Ticket Role Setup')
        .addFields(
          { name: '🎫 Type',          value: type,                                     inline: true },
          { name: '🛡️ Staff Role',    value: `${staffRole}`,                           inline: true },
          { name: '🔒 Required Role', value: reqRole ? `${reqRole}` : 'None (anyone)', inline: true },
          { name: '📁 Category',      value: category ? category.name : 'None',       inline: true },
        ).setFooter({ text: 'Use /setticketpanel to post the panel' }).setTimestamp()] });
    }
  },

  // /setticketpanel
  {
    data: new SlashCommandBuilder()
      .setName('setticketpanel').setDescription('Post interactive ticket panel to a channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(false))
      .addStringOption(o => o.setName('types').setDescription('Comma-separated: support,mm,exch,buy,sell,general').setRequired(false)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const channel = interaction.options.getChannel('channel');
      const title   = interaction.options.getString('title')       || '🎫 Open a Ticket';
      const desc    = interaction.options.getString('description') || 'Click a button below to open a ticket. Staff will assist you shortly.\n\n🆘 Support · 🤝 Middleman · 💱 Exchange · 🛒 Buy · 💸 Sell · 💬 General';
      const types   = (interaction.options.getString('types') || 'support,mm,exch,buy,sell,general').split(',').map(t=>t.trim());
      const btnMeta = {
        support: { label:'🆘 Support',   style: ButtonStyle.Primary  },
        mm:      { label:'🤝 Middleman', style: ButtonStyle.Success  },
        exch:    { label:'💱 Exchange',  style: ButtonStyle.Primary  },
        buy:     { label:'🛒 Buy',       style: ButtonStyle.Success  },
        sell:    { label:'💸 Sell',      style: ButtonStyle.Danger   },
        general: { label:'💬 General',   style: ButtonStyle.Secondary },
      };
      const rows = [];
      for (let i = 0; i < types.length; i += 4) {
        const row = new ActionRowBuilder();
        types.slice(i, i+4).filter(t=>btnMeta[t]).forEach(t =>
          row.addComponents(new ButtonBuilder().setCustomId(`ticket_open_${t}`).setLabel(btnMeta[t].label).setStyle(btnMeta[t].style))
        );
        if (row.components.length) rows.push(row);
      }
      try {
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(desc).setFooter({ text: `${interaction.guild.name} • Ticket System` }).setTimestamp()], components: rows });
        await interaction.editReply({ embeds: [okEmbed(`✅ Panel posted in ${channel}`)] });
      } catch (e) { await interaction.editReply({ embeds: [errEmbed(`Failed: ${e.message}`)] }); }
    }
  },

  // /setuppayment
  {
    data: new SlashCommandBuilder()
      .setName('setuppayment').setDescription('Save your UPI/crypto payment methods')
      .addStringOption(o => o.setName('upi').setDescription('Your UPI ID e.g. name@upi').setRequired(false))
      .addStringOption(o => o.setName('crypto').setDescription('Your crypto wallet address').setRequired(false))
      .addStringOption(o => o.setName('coin').setDescription('Coin for crypto address').setRequired(false)
        .addChoices(
          { name:'Litecoin (LTC)', value:'LTC' }, { name:'Bitcoin (BTC)', value:'BTC' },
          { name:'Ethereum (ETH)', value:'ETH' }, { name:'TRON (TRX)',     value:'TRX' },
          { name:'USDT TRC20',     value:'USDT' },
        )),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const upi    = interaction.options.getString('upi');
      const crypto = interaction.options.getString('crypto');
      const coin   = interaction.options.getString('coin') || 'LTC';
      if (!upi && !crypto) return interaction.editReply({ embeds: [errEmbed('Provide at least a UPI ID or crypto address.')] });
      const payments = get('payments');
      if (!payments[interaction.user.id]) payments[interaction.user.id] = {};
      const fields = [];
      if (upi)    { payments[interaction.user.id].upi    = upi;    fields.push({ name:'📲 UPI ID',          value:`\`${upi}\``,    inline:true }); }
      if (crypto) { payments[interaction.user.id].crypto = crypto; payments[interaction.user.id].cryptoCoin = coin;
                    fields.push({ name:`🪙 ${coin} Address`, value:`\`${crypto}\``, inline:true }); }
      save('payments');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('✅ Payment Methods Saved')
        .setDescription('Use `.qr <amount>` to generate QR codes.').addFields(fields).setTimestamp()] });
    }
  },

  // /setfollowers
  {
    data: new SlashCommandBuilder()
      .setName('setfollowers').setDescription('Set per-platform follower amount for a role')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption(o => o.setName('role').setDescription('The role to configure').setRequired(true))
      .addStringOption(o => o.setName('platform').setDescription('Which platform to configure (or "all" for a default)').setRequired(true)
        .addChoices(
          { name: '🟣 Twitch Followers', value: 'tfollow'  },
          { name: '🟣 Twitch Spam',      value: 'tspam'    },
          { name: '⚡ TikTok',           value: 'ttfollow' },
          { name: '📸 Instagram',        value: 'ifollow'  },
          { name: '📌 Pinterest',        value: 'pfollow'  },
          { name: '👻 Snapchat',         value: 'sfollow'  },
          { name: '▶️ YouTube',          value: 'yfollow'  },
          { name: '🎵 Spotify',          value: 'spfollow' },
          { name: '🌐 All Platforms (default)', value: 'all' },
        ))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1).setMaxValue(1000000)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const role     = interaction.options.getRole('role');
      const platform = interaction.options.getString('platform');
      const amount   = interaction.options.getInteger('amount');
      const cfg      = get('followerRoles');
      if (!cfg[interaction.guild.id]) cfg[interaction.guild.id] = {};
      const existing = cfg[interaction.guild.id][role.id];
      // migrate legacy plain-number to object
      const obj = (existing && typeof existing === 'object') ? existing : {};
      obj[platform] = amount;
      cfg[interaction.guild.id][role.id] = obj;
      save('followerRoles');
      const PLATFORM_LABELS = {
        tfollow:'🟣 Twitch Followers', tspam:'🟣 Twitch Spam', ttfollow:'⚡ TikTok',
        ifollow:'📸 Instagram', pfollow:'📌 Pinterest', sfollow:'👻 Snapchat',
        yfollow:'▶️ YouTube', spfollow:'🎵 Spotify', all:'🌐 All (default)',
      };
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('✅ Follower Amount Set')
        .addFields(
          { name: '🎭 Role',     value: `${role}`,                        inline: true },
          { name: '📱 Platform', value: PLATFORM_LABELS[platform]||platform, inline: true },
          { name: '📊 Amount',   value: `${amount.toLocaleString()}`,      inline: true },
        )
        .setDescription(`When a user with **${role.name}** uses the configured platform command, they will send **${amount.toLocaleString()}** ${platform==='all'?'on all platforms':PLATFORM_LABELS[platform]||platform}.`)
        .setFooter({ text: 'Use /setfollowers again to set other platforms for this role' })
        .setTimestamp()] });
    }
  },

  // /autopurge
  {
    data: new SlashCommandBuilder()
      .setName('autopurge').setDescription('Auto-delete every message in a channel after 4 seconds')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o => o.setName('channel').setDescription('Channel to enable/disable auto-purge in').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addBooleanOption(o => o.setName('enable').setDescription('true = enable, false = disable').setRequired(true)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const channel = interaction.options.getChannel('channel');
      const enable  = interaction.options.getBoolean('enable');
      const cfg     = get('slashAutoPurge');
      if (enable) {
        cfg[channel.id] = { guildId: interaction.guild.id, enabledBy: interaction.user.id, enabledAt: Date.now() };
        save('slashAutoPurge');
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00cc66).setTitle('✅ Auto-Purge Enabled')
          .setDescription(`Every message in ${channel} will be **auto-deleted after 4 seconds**.`)
          .setFooter({ text: `Enabled by ${interaction.user.tag}` }).setTimestamp()] });
      } else {
        delete cfg[channel.id];
        save('slashAutoPurge');
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🗑️ Auto-Purge Disabled')
          .setDescription(`Auto-purge has been **disabled** for ${channel}.`).setTimestamp()] });
      }
    }
  },

  // /setupemoji
  {
    data: new SlashCommandBuilder()
      .setName('setupemoji').setDescription('Set a custom emoji for a social media platform command')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('platform').setDescription('Platform to set emoji for').setRequired(true)
        .addChoices(
          { name: 'Twitch Followers', value: 'tfollow'  },
          { name: 'Twitch Spam',      value: 'tspam'    },
          { name: 'TikTok',           value: 'ttfollow' },
          { name: 'Instagram',        value: 'ifollow'  },
          { name: 'Pinterest',        value: 'pfollow'  },
          { name: 'Snapchat',         value: 'sfollow'  },
          { name: 'YouTube',          value: 'yfollow'  },
          { name: 'Spotify',          value: 'spfollow' },
        ))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji to show (e.g. 📸 or a custom server emoji)').setRequired(true)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const platform = interaction.options.getString('platform');
      const emoji    = interaction.options.getString('emoji').trim();
      const cfg      = get('platformEmojis');
      if (!cfg[interaction.guild.id]) cfg[interaction.guild.id] = {};
      cfg[interaction.guild.id][platform] = emoji;
      save('platformEmojis');
      const label = PLATFORMS[platform]?.label || platform;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00cc66)
        .setTitle('✅ Platform Emoji Set')
        .setDescription(`**${label}** will now show **${emoji}** in all command output.`)
        .setTimestamp()] });
    }
  },

  // /serverinvite
  {
    data: new SlashCommandBuilder()
      .setName('serverinvite').setDescription('Require users to have your server invite text in their status to use social commands')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('text').setDescription('Text users must have in status (e.g. discord.gg/yourserver) — leave blank to disable').setRequired(false)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const text = interaction.options.getString('text')?.trim() || null;
      const cfg  = get('serverInvite');
      if (!text) {
        delete cfg[interaction.guild.id];
        save('serverInvite');
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xff4444)
          .setTitle('🔓 Status Requirement Disabled')
          .setDescription('Users no longer need any text in their status to use social commands.')
          .setTimestamp()] });
      }
      cfg[interaction.guild.id] = { text, setBy: interaction.user.id, setAt: Date.now() };
      save('serverInvite');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00cc66)
        .setTitle('🔒 Status Requirement Set')
        .setDescription(`Users must have \`${text}\` in their **Discord custom status** to use social commands.\n\nAdmins bypass this check automatically.`)
        .addFields({ name: '❌ Error shown to users without it', value: `❌ @user, you must have \`${text}\` in status.` })
        .setTimestamp()] });
    }
  },
];

// ============================================================
// TICKET BUTTON HANDLERS
// ============================================================
async function handleTicketOpen(interaction, type) {
  await interaction.deferReply({ ephemeral: true });
  const panel = get('ticketPanels')[`${interaction.guild.id}_${type}`];
  if (panel?.requiredRole && !interaction.member.roles.cache.has(panel.requiredRole) && !isAdmin(interaction.member))
    return interaction.editReply({ embeds: [errEmbed(`You need <@&${panel.requiredRole}> to open this ticket.`)] });
  const tickets = get('tickets');
  const existing = Object.values(tickets).find(t => t.userId === interaction.user.id && t.guildId === interaction.guild.id && t.type === type && t.open);
  if (existing) return interaction.editReply({ embeds: [errEmbed(`You already have an open ${type} ticket: <#${existing.channelId}>`)] });
  const count = Object.keys(tickets).length + 1;
  const perms = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (panel?.staffRole) perms.push({ id: panel.staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const channel = await interaction.guild.channels.create({
    name: `${type}-${interaction.user.username}-${count}`, type: ChannelType.GuildText,
    parent: panel?.categoryId || null, permissionOverwrites: perms
  });
  tickets[`${interaction.guild.id}_${channel.id}`] = { channelId: channel.id, userId: interaction.user.id, guildId: interaction.guild.id, type, open: true, claimedBy: null, createdAt: Date.now() };
  save('tickets');
  const labels = { mm:'Middleman', exch:'Exchange', buy:'Buy', sell:'Sell', support:'Support', general:'General' };
  await channel.send({
    content: `<@${interaction.user.id}>${panel?.staffRole ? ` | <@&${panel.staffRole}>` : ''}`,
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🎫 ${labels[type]||type} Ticket`)
      .setDescription(`Welcome <@${interaction.user.id}>! Staff will assist you shortly.\n\n**Type:** ${labels[type]||type}\n**Opened by:** ${interaction.user.tag}`).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger))]
  });
  // DM the user with their ticket details
  try {
    await interaction.user.send({ embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎫 Your ${labels[type]||type} Ticket Has Been Opened`)
      .setDescription(`Your ticket has been created in **${interaction.guild.name}**. Staff will assist you shortly.`)
      .addFields(
        { name: '📋 Ticket Type',    value: labels[type] || type,        inline: true },
        { name: '🏠 Server',         value: interaction.guild.name,       inline: true },
        { name: '📅 Opened At',      value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false },
        { name: '🔗 Ticket Channel', value: `Please return to the server and check ${channel}`, inline: false },
      )
      .setFooter({ text: 'Keep this DM for your records — do not share ticket details with others.' })
      .setTimestamp()
    ] });
  } catch { /* user has DMs closed — silently ignore */ }
  await interaction.editReply({ embeds: [okEmbed(`✅ Ticket opened: ${channel} — you've been DM'd with details.`)] });
}

async function handleTicketClose(interaction) {
  await interaction.deferReply();
  const tickets = get('tickets');
  const ticket  = tickets[`${interaction.guild.id}_${interaction.channel.id}`];
  if (!ticket) return interaction.editReply({ embeds: [errEmbed('This is not a registered ticket channel.')] });
  if (!isAdmin(interaction.member) && interaction.user.id !== ticket.userId)
    return interaction.editReply({ embeds: [errEmbed('Only the ticket owner or admins can close this.')] });
  ticket.open = false; ticket.closedAt = Date.now(); ticket.closedBy = interaction.user.id; save('tickets');
  await interaction.editReply({ embeds: [{ color: 0xff4444, description: '🔒 Ticket closing in 5 seconds…' }] });
  setTimeout(() => interaction.channel.delete('Ticket closed').catch(() => {}), 5000);
}

async function handleExchButton(interaction, type) {
  await interaction.deferReply();
  const et = EXCH_TYPES[type];
  if (!et) return interaction.editReply({ embeds: [errEmbed('Unknown exchange type.')] });
  const rates = await fetchRates();
  const coinIds = { LTC:'litecoin', BTC:'bitcoin', ETH:'ethereum', TRX:'tron', USDT:'tether' };
  const embed = new EmbedBuilder().setColor(0x00cc66).setTitle(`${et.emoji} ${et.label} — Live Rates`).setTimestamp();
  const fields = [];
  if (type==='inr-crypto') {
    for (const [s,id] of Object.entries(coinIds)) if (rates?.[id]?.inr) fields.push({ name:s, value:`₹1 = ${(1/rates[id].inr).toFixed(8)} ${s}`, inline:true });
  } else if (type==='crypto-inr') {
    for (const [s,id] of Object.entries(coinIds)) if (rates?.[id]?.inr) fields.push({ name:s, value:`1 ${s} = ₹${rates[id].inr.toLocaleString()}`, inline:true });
  } else if (type==='pak-inr') {
    const r=await fetchFx('PKR','INR'); if(r) fields.push({ name:'PKR→INR', value:`1 PKR = ₹${r.toFixed(4)}`, inline:false });
  } else if (type==='inr-pak') {
    const r=await fetchFx('INR','PKR'); if(r) fields.push({ name:'INR→PKR', value:`₹1 = ₨${r.toFixed(4)} PKR`, inline:false });
  } else if (type==='paypal-inr') {
    const r=await fetchFx('USD','INR'); if(r) fields.push({ name:'PayPal→INR', value:`$1 PayPal ≈ ₹${r.toFixed(2)}`, inline:false });
  } else if (type==='inr-paypal') {
    const r=await fetchFx('INR','USD'); if(r) fields.push({ name:'INR→PayPal', value:`₹1 ≈ $${r.toFixed(4)} PayPal`, inline:false });
  } else if (type==='pak-crypto') {
    const pkr=await fetchFx('PKR','USD');
    for (const [s,id] of Object.entries(coinIds)) if(rates?.[id]?.usd&&pkr) fields.push({ name:s, value:`1 PKR = ${(pkr/rates[id].usd).toFixed(8)} ${s}`, inline:true });
  } else if (type==='crypto-pak') {
    const pkr=await fetchFx('PKR','USD');
    for (const [s,id] of Object.entries(coinIds)) if(rates?.[id]?.usd&&pkr) fields.push({ name:s, value:`1 ${s} = ₨${(rates[id].usd/pkr).toFixed(2)} PKR`, inline:true });
  } else if (type==='euro-crypto') {
    for (const [s,id] of Object.entries(coinIds)) if(rates?.[id]?.eur) fields.push({ name:s, value:`1 ${s} = €${rates[id].eur.toLocaleString()}`, inline:true });
  }
  if (fields.length) { embed.addFields(fields); embed.setFooter({ text:'Rates: CoinGecko & ExchangeRate-API' }); }
  else embed.setDescription('Could not fetch live rates. Try again shortly.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`exch_confirm_${type}`).setLabel('✅ Proceed').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('exch_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
  );
  await interaction.editReply({ embeds:[embed], components:[row] });
}

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});
client.slashMap = new Map();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;
  console.log(`🔗 Bot Invite Link:\n   ${inviteUrl}`);
  client.user.setActivity('Use . prefix | /setup commands', { type: 3 });
  const cmds = slashCommands.map(c => { client.slashMap.set(c.data.name, c); return c.data.toJSON(); });
  const rest = new REST({ version:'10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: cmds }); console.log(`✅ ${cmds.length} slash commands registered`); }
  catch (e) { console.error('Slash register failed:', e.message); }
});

// Track deleted messages for .snipe
client.on(Events.MessageDelete, (message) => {
  if (message.author?.bot || !message.content) return;
  snipeCache[message.channel.id] = { content: message.content, author: message.author?.tag || 'Unknown', timestamp: message.createdAt };
});

// Auto-purge: delete messages after 4 seconds in configured channels
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const cfg = get('slashAutoPurge');
  if (cfg[message.channel.id]) {
    setTimeout(() => message.delete().catch(() => {}), 4000);
  }
});

// Message handler
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd  = args.shift().toLowerCase();
  try {
    switch (cmd) {
      // Moderation
      case 'ban':           return await cmdBan(message, args);
      case 'kick':          return await cmdKick(message, args);
      case 'timeout':       return await cmdTimeout(message, args);
      case 'mute':          return await cmdMute(message, args);
      case 'unmute':        return await cmdUnmute(message, args);
      case 'purge':         return await cmdPurge(message, args);
      case 'autopurge':     return await cmdAutoPurge(message, args);
      case 'slowmode':      return await cmdSlowmode(message, args);
      case 'warn':          return await cmdWarn(message, args);
      case 'warnings':      return await cmdWarnings(message, args);
      case 'clearwarns':    return await cmdClearWarns(message, args);
      case 'deletechannel': return await cmdDeleteChannel(message, args);
      case 'nuke':          return await cmdNuke(message);
      // Info
      case 'ping':          return await cmdPing(message);
      case 'serverinfo':    return await cmdServerInfo(message);
      case 'userinfo':      return await cmdUserInfo(message, args);
      case 'avatar':        return await cmdAvatar(message, args);
      case 'botinfo':       return await cmdBotInfo(message);
      case 'roleinfo':      return await cmdRoleInfo(message, args);
      case 'snipe':         return await cmdSnipe(message);
      case 'invite':        return await cmdInvite(message);
      // Ticket
      case 'claim':         return await cmdClaim(message);
      case 'unclaim':       return await cmdUnclaim(message);
      case 'transfer':      return await cmdTransfer(message, args);
      case 'timer':         return await cmdTimer(message, args);
      // Exchange / MM
      case 'mm':            return await cmdMM(message, args);
      case 'exch':          return await cmdExch(message);
      case 'buy':           return await cmdBuySell(message, args, 'buy');
      case 'sell':          return await cmdBuySell(message, args, 'sell');
      // Payment / QR
      case 'addpayment':    return await cmdAddPayment(message, args);
      case 'qr':            return await cmdQR(message, args);
      // Crypto wallet
      case 'ltc':           return await cmdCryptoLookup(message, args, 'LTC');
      case 'btc':           return await cmdCryptoLookup(message, args, 'BTC');
      case 'eth':           return await cmdCryptoLookup(message, args, 'ETH');
      case 'trx':           return await cmdCryptoLookup(message, args, 'TRX');
      case 'usdt':          return await cmdCryptoLookup(message, args, 'USDT');
      // Ticket management
      case 'add':           return await cmdTicketAdd(message, args);
      case 'remove':        return await cmdTicketRemove(message, args);
      case 'rename':        return await cmdTicketRename(message, args);
      case 'lock':          return await cmdTicketLock(message);
      case 'unlock':        return await cmdTicketUnlock(message);
      case 'close':         return await cmdTicketClose(message);
      // Social media
      case 'tfollow':       return await cmdSocialAction(message, args, 'tfollow');
      case 'tspam':         return await cmdSocialAction(message, args, 'tspam');
      case 'ttfollow':      return await cmdSocialAction(message, args, 'ttfollow');
      case 'ifollow':       return await cmdSocialAction(message, args, 'ifollow');
      case 'pfollow':       return await cmdSocialAction(message, args, 'pfollow');
      case 'sfollow':       return await cmdSocialAction(message, args, 'sfollow');
      case 'yfollow':       return await cmdSocialAction(message, args, 'yfollow');
      case 'spfollow':      return await cmdSocialAction(message, args, 'spfollow');
      case 'rolesocial':    return await cmdRoleSocial(message);
      // Utility / Fun
      case 'say':           return await cmdSay(message, args);
      case 'announce':      return await cmdAnnounce(message, args);
      case 'dm':            return await cmdDM(message, args);
      case 'embed':         return await cmdEmbed(message, args);
      case 'poll':          return await cmdPoll(message, args);
      case 'coinflip':      return await cmdCoinflip(message);
      case '8ball':         return await cmdEightBall(message, args);
      // Help
      case 'help':          return await cmdHelp(message, args);
    }
  } catch (err) {
    console.error(`[${cmd}]`, err.message);
    message.reply({ embeds: [errEmbed(`Error: ${err.message}`)] }).catch(() => {});
  }
});

// Interaction handler
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.slashMap.get(interaction.commandName);
      if (cmd) return await cmd.execute(interaction, client);
    }
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('ticket_open_'))  return await handleTicketOpen(interaction, id.replace('ticket_open_',''));
      if (id === 'ticket_close')          return await handleTicketClose(interaction);
      if (id.startsWith('exch_') && !id.startsWith('exch_confirm') && id !== 'exch_cancel')
                                          return await handleExchButton(interaction, id.replace('exch_',''));
      if (id === 'exch_cancel')           return interaction.reply({ content:'Exchange cancelled.', ephemeral:true });
      if (id.startsWith('exch_confirm_')) return interaction.reply({ content:'✅ Please send the amount and details in chat. Staff will assist you.', ephemeral:false });
    }
  } catch (err) {
    console.error('Interaction error:', err.message);
    const r = { embeds:[errEmbed(`Error: ${err.message}`)], ephemeral:true };
    if (interaction.replied || interaction.deferred) interaction.followUp(r).catch(()=>{});
    else interaction.reply(r).catch(()=>{});
  }
});

// Error handlers
client.on('error', (err) => {
  if (err.message?.includes('disallowed intents')) return printIntentsError();
  console.error('Client error:', err.message);
});
process.on('unhandledRejection', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('disallowed intents') || msg.includes('4014')) { printIntentsError(); process.exit(1); }
  console.error('Unhandled rejection:', msg);
});
function printIntentsError() {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('❌  PRIVILEGED INTENTS NOT ENABLED — Bot cannot start.');
  console.error('Fix: https://discord.com/developers/applications');
  console.error('  → Bot tab → Privileged Gateway Intents → Enable ALL THREE');
  console.error('  → PRESENCE · SERVER MEMBERS · MESSAGE CONTENT → Save');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('❌  DISCORD_BOT_TOKEN not set.');
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN);
