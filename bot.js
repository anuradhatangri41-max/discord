/**
 * Discord Bot — Node.js / discord.js v14
 * ========================================
 * Prefix : .  (or set env BOT_PREFIX)
 * Token  : set env DISCORD_TOKEN
 *
 * Admin commands : .ban .unban .kick .timeout .untimeout .role .takerole
 *                  .warn .clearwarns .purge .userpurge .slowmode .lock .unlock
 *                  .nuke .announce .dm .say .create .delete .setnick
 *                  .addemoji .steal .setprefix .vcmute .vcunmute .vckick
 *                  .tempban .note .clearnotes .giveaway .lockdown .unlockdown
 * Info commands  : .userinfo .whois .serverinfo .roleinfo .avatar .warnings
 *                  .notes .ping .inviteinfo .botinfo .membercount .uptime .snipe
 * Utility        : .embed .poll .setup .help
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  Colors,
} = require("discord.js");

const fs   = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config & persistence
// ---------------------------------------------------------------------------

const PREFIX      = process.env.BOT_PREFIX || ".";
const CONFIG_FILE = path.join(__dirname, "config.json");
const WARNS_FILE  = path.join(__dirname, "warnings.json");
const NOTES_FILE  = path.join(__dirname, "notes.json");

// In-memory snipe store: channelId -> { content, author, timestamp }
const snipeCache = new Map();

const DEFAULT_CONFIG = {
  prefix: PREFIX,
  vouch_channel_id: null,
  ticket_category_id: null,
  ticket_roles: [],
  admin_roles: [],
  embed_title: "Welcome to Our Server",
  embed_description: "Use the buttons below to interact with our community.",
  embed_color: 0x5865f2,
  embed_footer: "Powered by our bot",
  perks_description: "No perks configured yet. Ask an admin to set them up.",
  vouch_count: 0,
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadWarns() {
  if (!fs.existsSync(WARNS_FILE)) return {};
  return JSON.parse(fs.readFileSync(WARNS_FILE, "utf8"));
}

function saveWarns(data) {
  fs.writeFileSync(WARNS_FILE, JSON.stringify(data, null, 2));
}

function loadNotes() {
  if (!fs.existsSync(NOTES_FILE)) return {};
  return JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
}

function saveNotes(data) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2));
}

function parseDuration(n, unit) {
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  if (!mult[unit]) return null;
  const ms = parseInt(n) * mult[unit];
  return isNaN(ms) || ms <= 0 ? null : ms;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAdmin(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = loadConfig();
  const ids = (cfg.admin_roles || []).map(String);
  return member.roles.cache.some((r) => ids.includes(String(r.id)));
}

const errEmbed = (msg) =>
  new EmbedBuilder().setDescription(`❌  ${msg}`).setColor(Colors.Red);

const okEmbed = (msg) =>
  new EmbedBuilder().setDescription(`✅  ${msg}`).setColor(Colors.Green);

function modEmbed(title, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

const startTime = Date.now();

client.once("ready", () => {
  console.log(`✅  Logged in as ${client.user.tag}  |  Prefix: ${PREFIX}`);
  client.user.setActivity(`${PREFIX}help`, { type: 3 }); // Watching
});

// Snipe: cache last deleted message per channel
client.on("messageDelete", (message) => {
  if (message.author?.bot) return;
  if (!message.content && !message.attachments.size) return;
  snipeCache.set(message.channelId, {
    content:     message.content || "*[attachment/embed only]*",
    author:      message.author?.tag || "Unknown",
    authorIcon:  message.author?.displayAvatarURL() || null,
    timestamp:   new Date(),
  });
});

// ---------------------------------------------------------------------------
// Button & Modal interaction handler
// ---------------------------------------------------------------------------

client.on("interactionCreate", async (interaction) => {
  // ---- Buttons ----
  if (interaction.isButton()) {
    // Main embed buttons
    if (interaction.customId === "main_vouch") {
      const modal = new ModalBuilder()
        .setCustomId("modal_vouch")
        .setTitle("Submit a Vouch");
      const input = new TextInputBuilder()
        .setCustomId("vouch_text")
        .setLabel("Your Vouch")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Write your vouch here...")
        .setRequired(true)
        .setMaxLength(500);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "main_ticket") {
      const modal = new ModalBuilder()
        .setCustomId("modal_ticket_Ticket")
        .setTitle("Open a Ticket");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("subject")
            .setLabel("Subject")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Brief subject of your request...")
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Describe your issue in detail...")
            .setRequired(true)
            .setMaxLength(1000)
        )
      );
      return interaction.showModal(modal);
    }

    if (interaction.customId === "main_help") {
      const modal = new ModalBuilder()
        .setCustomId("modal_ticket_Help")
        .setTitle("Open a Help Ticket");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("subject")
            .setLabel("Subject")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("What do you need help with?")
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Describe your issue in detail...")
            .setRequired(true)
            .setMaxLength(1000)
        )
      );
      return interaction.showModal(modal);
    }

    if (interaction.customId === "main_perks") {
      const cfg = loadConfig();
      const embed = new EmbedBuilder()
        .setTitle("🎁  Server Perks")
        .setDescription(cfg.perks_description || "No perks configured yet.")
        .setColor(Colors.Gold);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Close ticket button
    if (interaction.customId === "close_ticket") {
      const cfg = loadConfig();
      const tIds = (cfg.ticket_roles || []).map(String);
      const memberRoles = interaction.member.roles.cache.map((r) => String(r.id));
      const isStaff =
        interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        tIds.some((id) => memberRoles.includes(id));
      const topic = interaction.channel.topic || "";
      const isOwner = topic.includes(String(interaction.user.id));

      if (!isStaff && !isOwner) {
        return interaction.reply({
          content: "Only staff or the ticket opener can close this.",
          ephemeral: true,
        });
      }

      await interaction.reply("🔒  Closing ticket in **5 seconds**…");
      setTimeout(() => {
        interaction.channel
          .delete(`Ticket closed by ${interaction.user.tag}`)
          .catch(() => {});
      }, 5000);
      return;
    }
  }

  // ---- Modals ----
  if (interaction.isModalSubmit()) {
    // Vouch modal
    if (interaction.customId === "modal_vouch") {
      const cfg = loadConfig();
      const chId = cfg.vouch_channel_id;
      if (!chId) {
        return interaction.reply({
          content: `Vouch channel not configured. Ask an admin to run \`${PREFIX}setup vouch_channel #channel\`.`,
          ephemeral: true,
        });
      }
      const channel = interaction.guild.channels.cache.get(String(chId));
      if (!channel) {
        return interaction.reply({ content: "Vouch channel not found.", ephemeral: true });
      }

      cfg.vouch_count = (cfg.vouch_count || 0) + 1;
      saveConfig(cfg);

      const embed = new EmbedBuilder()
        .setTitle(`⭐  Vouch #${cfg.vouch_count}`)
        .setDescription(interaction.fields.getTextInputValue("vouch_text"))
        .setColor(Colors.Green)
        .setAuthor({
          name: interaction.user.displayName || interaction.user.username,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setFooter({ text: `User ID: ${interaction.user.id}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      return interaction.reply({
        content: `Your vouch (#${cfg.vouch_count}) has been submitted. Thank you!`,
        ephemeral: true,
      });
    }

    // Ticket / Help modals
    if (interaction.customId.startsWith("modal_ticket_")) {
      const ticketType = interaction.customId.replace("modal_ticket_", "");
      const cfg = loadConfig();
      const catId = cfg.ticket_category_id;
      const tRoleIds = (cfg.ticket_roles || []).map(String);
      const guild = interaction.guild;
      const subject = interaction.fields.getTextInputValue("subject");
      const description = interaction.fields.getTextInputValue("description");

      const permOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        ...tRoleIds.map((id) => ({
          id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageMessages,
          ],
        })),
      ];

      const slug = interaction.user.username.toLowerCase().replace(/\s+/g, "-");
      const chName = `${ticketType.toLowerCase()}-${slug}`;
      const parent = catId ? guild.channels.cache.get(String(catId)) : null;

      let ticketChannel;
      try {
        ticketChannel = await guild.channels.create({
          name: chName,
          type: ChannelType.GuildText,
          parent: parent || undefined,
          permissionOverwrites: permOverwrites,
          topic: `${ticketType} | ${interaction.user.tag} | ${interaction.user.id} | ${subject}`,
        });
      } catch {
        return interaction.reply({
          content: "I don't have permission to create channels.",
          ephemeral: true,
        });
      }

      const color = ticketType === "Ticket" ? Colors.Blue : Colors.Orange;
      const embed = new EmbedBuilder()
        .setTitle(`${ticketType}: ${subject}`)
        .setDescription(description)
        .setColor(color)
        .setAuthor({
          name: interaction.user.displayName || interaction.user.username,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .addFields({ name: "Opened by", value: `<@${interaction.user.id}>`, inline: true })
        .setFooter({ text: "Staff will assist you shortly." })
        .setTimestamp();

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Close Ticket")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🔒")
      );

      const pings = [
        `<@${interaction.user.id}>`,
        ...tRoleIds.map((id) => `<@&${id}>`),
      ].join(" ");

      await ticketChannel.send({ content: pings, embeds: [embed], components: [closeRow] });
      return interaction.reply({
        content: `Your ${ticketType.toLowerCase()} has been created: ${ticketChannel}`,
        ephemeral: true,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Message command handler
// ---------------------------------------------------------------------------

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const member  = message.member;

  // Admin guard helper
  function requireAdmin() {
    if (!isAdmin(member)) {
      message.reply({ embeds: [errEmbed("You do not have permission to use this command.")] });
      return false;
    }
    return true;
  }

  // ==========================================================================
  // MODERATION COMMANDS
  // ==========================================================================

  // .ban @user [reason]
  if (command === "ban") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member to ban.")] });
    if (target.roles.highest.position >= member.roles.highest.position && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ embeds: [errEmbed("You cannot ban someone with an equal or higher role.")] });
    }
    const reason = args.slice(1).join(" ") || "No reason provided";
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle(`You were banned from ${message.guild.name}`).setDescription(`**Reason:** ${reason}`).setColor(Colors.Red)] }).catch(() => {});
      await target.ban({ reason, deleteMessageSeconds: 0 });
      const embed = modEmbed("🔨  Member Banned", Colors.Red)
        .addFields(
          { name: "User", value: `${target.user.tag} (\`${target.id}\`)`, inline: false },
          { name: "Reason", value: reason, inline: false },
          { name: "Moderator", value: `<@${member.id}>`, inline: false }
        );
      message.reply({ embeds: [embed] });
    } catch { message.reply({ embeds: [errEmbed("Could not ban that member.")] }); }
    return;
  }

  // .unban <user_id> [reason]
  if (command === "unban") {
    if (!requireAdmin()) return;
    const userId = args[0];
    const reason = args.slice(1).join(" ") || "No reason provided";
    if (!userId) return message.reply({ embeds: [errEmbed("Provide a user ID to unban.")] });
    try {
      await message.guild.members.unban(userId, reason);
      message.reply({ embeds: [okEmbed(`User \`${userId}\` has been unbanned.`)] });
    } catch { message.reply({ embeds: [errEmbed("That user is not banned or doesn't exist.")] }); }
    return;
  }

  // .kick @user [reason]
  if (command === "kick") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member to kick.")] });
    if (target.roles.highest.position >= member.roles.highest.position && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ embeds: [errEmbed("You cannot kick someone with an equal or higher role.")] });
    }
    const reason = args.slice(1).join(" ") || "No reason provided";
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle(`You were kicked from ${message.guild.name}`).setDescription(`**Reason:** ${reason}`).setColor(Colors.Orange)] }).catch(() => {});
      await target.kick(reason);
      const embed = modEmbed("👢  Member Kicked", Colors.Orange)
        .addFields(
          { name: "User", value: `${target.user.tag} (\`${target.id}\`)`, inline: false },
          { name: "Reason", value: reason, inline: false },
          { name: "Moderator", value: `<@${member.id}>`, inline: false }
        );
      message.reply({ embeds: [embed] });
    } catch { message.reply({ embeds: [errEmbed("Could not kick that member.")] }); }
    return;
  }

  // .timeout @user <duration> <s|m|h|d> [reason]
  if (command === "timeout") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    const duration = parseInt(args[1]);
    const unit = (args[2] || "m").toLowerCase();
    const reason = args.slice(3).join(" ") || "No reason provided";
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    if (!mult[unit]) return message.reply({ embeds: [errEmbed("Unit must be `s`, `m`, `h`, or `d`.")] });
    if (isNaN(duration) || duration <= 0) return message.reply({ embeds: [errEmbed("Provide a valid duration number.")] });
    const ms = duration * mult[unit];
    if (ms > 86400000 * 28) return message.reply({ embeds: [errEmbed("Timeout cannot exceed 28 days.")] });
    try {
      await target.timeout(ms, reason);
      const until = Math.floor((Date.now() + ms) / 1000);
      const embed = modEmbed("🔇  Member Timed Out", Colors.Yellow)
        .addFields(
          { name: "User", value: `${target.user.tag} (\`${target.id}\`)`, inline: false },
          { name: "Duration", value: `${duration}${unit}`, inline: true },
          { name: "Expires", value: `<t:${until}:R>`, inline: true },
          { name: "Reason", value: reason, inline: false },
          { name: "Moderator", value: `<@${member.id}>`, inline: false }
        );
      message.reply({ embeds: [embed] });
    } catch { message.reply({ embeds: [errEmbed("Could not timeout that member.")] }); }
    return;
  }

  // .untimeout @user
  if (command === "untimeout") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    await target.timeout(null).catch(() => {});
    message.reply({ embeds: [okEmbed(`Timeout removed from <@${target.id}>.`)] });
    return;
  }

  // .role @user @role
  if (command === "role" || command === "addrole") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    const role   = message.mentions.roles.first();
    if (!target || !role) return message.reply({ embeds: [errEmbed("Usage: `.addrole @user @role`")] });
    if (role.position >= member.roles.highest.position && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ embeds: [errEmbed("You cannot assign a role equal to or higher than your own.")] });
    }
    await target.roles.add(role, `Role given by ${member.user.tag}`);
    message.reply({ embeds: [new EmbedBuilder().setTitle("✅  Role Added").setDescription(`Gave <@&${role.id}> to <@${target.id}>`).setColor(Colors.Green).setFooter({ text: `By ${member.user.tag}` })] });
    return;
  }

  // .takerole @user @role
  if (command === "takerole") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    const role   = message.mentions.roles.first();
    if (!target || !role) return message.reply({ embeds: [errEmbed("Usage: `.takerole @user @role`")] });
    if (role.position >= member.roles.highest.position && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ embeds: [errEmbed("You cannot remove a role equal to or higher than your own.")] });
    }
    await target.roles.remove(role, `Role removed by ${member.user.tag}`);
    message.reply({ embeds: [new EmbedBuilder().setTitle("❌  Role Removed").setDescription(`Removed <@&${role.id}> from <@${target.id}>`).setColor(Colors.Red).setFooter({ text: `By ${member.user.tag}` })] });
    return;
  }

  // .warn @user [reason]
  if (command === "warn") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member to warn.")] });
    const reason = args.slice(1).join(" ") || "No reason provided";
    const data = loadWarns();
    const gId = message.guild.id;
    const uId = target.id;
    if (!data[gId]) data[gId] = {};
    if (!data[gId][uId]) data[gId][uId] = [];
    data[gId][uId].push({ reason, moderator: member.id, timestamp: new Date().toISOString() });
    saveWarns(data);
    const count = data[gId][uId].length;
    const embed = modEmbed("⚠️  Member Warned", Colors.Yellow)
      .addFields(
        { name: "User", value: `${target.user.tag} (\`${target.id}\`)`, inline: false },
        { name: "Reason", value: reason, inline: false },
        { name: "Total Warnings", value: String(count), inline: true },
        { name: "Moderator", value: `<@${member.id}>`, inline: true }
      );
    message.reply({ embeds: [embed] });
    target.send({ embeds: [new EmbedBuilder().setTitle(`⚠️  You received a warning in ${message.guild.name}`).setDescription(`**Reason:** ${reason}\n**Total warnings:** ${count}`).setColor(Colors.Yellow)] }).catch(() => {});
    return;
  }

  // .clearwarns @user
  if (command === "clearwarns") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    const data = loadWarns();
    const count = ((data[message.guild.id] || {})[target.id] || []).length;
    if (!data[message.guild.id]) data[message.guild.id] = {};
    data[message.guild.id][target.id] = [];
    saveWarns(data);
    message.reply({ embeds: [okEmbed(`Cleared **${count}** warning(s) for <@${target.id}>.`)] });
    return;
  }

  // .purge <amount>
  if (command === "purge") {
    if (!requireAdmin()) return;
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1 || amount > 100) {
      return message.reply({ embeds: [errEmbed("Amount must be between 1 and 100.")] });
    }
    await message.delete().catch(() => {});
    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted ? deleted.size : 0;
    const msg = await message.channel.send({ embeds: [okEmbed(`Deleted **${count}** message(s).`)] });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
    return;
  }

  // .slowmode <seconds> [#channel]
  if (command === "slowmode") {
    if (!requireAdmin()) return;
    const secs = parseInt(args[0]);
    if (isNaN(secs) || secs < 0 || secs > 21600) {
      return message.reply({ embeds: [errEmbed("Seconds must be between 0 and 21600.")] });
    }
    const target = message.mentions.channels.first() || message.channel;
    await target.setRateLimitPerUser(secs);
    const text = secs === 0 ? `Slowmode disabled in <#${target.id}>.` : `Slowmode set to **${secs}s** in <#${target.id}>.`;
    message.reply({ embeds: [okEmbed(text)] });
    return;
  }

  // .lock [#channel]
  if (command === "lock") {
    if (!requireAdmin()) return;
    const target = message.mentions.channels.first() || message.channel;
    await target.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    target.send({ embeds: [new EmbedBuilder().setDescription("🔒  This channel has been **locked**.").setColor(Colors.Red)] });
    if (target !== message.channel) message.reply({ embeds: [okEmbed(`Locked <#${target.id}>.`)] });
    return;
  }

  // .unlock [#channel]
  if (command === "unlock") {
    if (!requireAdmin()) return;
    const target = message.mentions.channels.first() || message.channel;
    await target.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    target.send({ embeds: [new EmbedBuilder().setDescription("🔓  This channel has been **unlocked**.").setColor(Colors.Green)] });
    if (target !== message.channel) message.reply({ embeds: [okEmbed(`Unlocked <#${target.id}>.`)] });
    return;
  }

  // .nuke
  if (command === "nuke") {
    if (!requireAdmin()) return;
    const ch = message.channel;
    const newCh = await ch.clone({ reason: `Nuked by ${member.user.tag}` });
    await newCh.setPosition(ch.position);
    await ch.delete(`Nuked by ${member.user.tag}`);
    newCh.send({ embeds: [new EmbedBuilder().setTitle("💣  Channel Nuked").setDescription("This channel was nuked. All previous messages have been deleted.").setColor(Colors.DarkRed).setTimestamp()] });
    return;
  }

  // .announce #channel <message>
  if (command === "announce") {
    if (!requireAdmin()) return;
    const target = message.mentions.channels.first();
    if (!target) return message.reply({ embeds: [errEmbed("Usage: `.announce #channel Your message here`")] });
    const text = args.slice(1).join(" ");
    if (!text) return message.reply({ embeds: [errEmbed("Provide a message to announce.")] });
    const embed = new EmbedBuilder()
      .setTitle("📢  Announcement")
      .setDescription(text)
      .setColor(Colors.Blurple)
      .setFooter({ text: `From ${member.displayName}`, iconURL: member.displayAvatarURL() })
      .setTimestamp();
    await target.send({ embeds: [embed] });
    await message.delete().catch(() => {});
    const ack = await message.channel.send({ embeds: [okEmbed(`Announcement sent to <#${target.id}>.`)] });
    setTimeout(() => ack.delete().catch(() => {}), 5000);
    return;
  }

  // .dm @user <message>
  if (command === "dm") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    const text = args.slice(1).join(" ");
    if (!text) return message.reply({ embeds: [errEmbed("Provide a message to send.")] });
    const embed = new EmbedBuilder()
      .setTitle(`📩  Message from ${message.guild.name}`)
      .setDescription(text)
      .setColor(Colors.Blurple)
      .setFooter({ text: `Sent by ${member.displayName}` })
      .setTimestamp();
    try {
      await target.send({ embeds: [embed] });
      message.reply({ embeds: [okEmbed(`DM sent to <@${target.id}>.`)] });
    } catch {
      message.reply({ embeds: [errEmbed(`Could not DM <@${target.id}>. They may have DMs disabled.`)] });
    }
    return;
  }

  // .say [#channel] <message>
  if (command === "say") {
    if (!requireAdmin()) return;
    const target = message.mentions.channels.first() || message.channel;
    const text = args.filter((a) => !a.startsWith("<#")).join(" ");
    if (!text) return message.reply({ embeds: [errEmbed("Provide a message to say.")] });
    await message.delete().catch(() => {});
    target.send(text);
    return;
  }

  // .create <text|voice> [category] <name>
  if (command === "create") {
    if (!requireAdmin()) return;
    const type = (args[0] || "").toLowerCase();
    if (!["text", "voice"].includes(type)) {
      return message.reply({ embeds: [errEmbed("Usage: `.create <text|voice> <channel name>`")] });
    }
    const name = args.slice(1).join(" ").trim();
    if (!name) return message.reply({ embeds: [errEmbed("Provide a channel name.")] });
    const cleanName = type === "text" ? name.toLowerCase().replace(/\s+/g, "-") : name;
    try {
      const newCh = await message.guild.channels.create({
        name: cleanName,
        type: type === "text" ? ChannelType.GuildText : ChannelType.GuildVoice,
        reason: `Created by ${member.user.tag}`,
      });
      const emoji = type === "text" ? "💬" : "🔊";
      const embed = new EmbedBuilder()
        .setTitle(`${emoji}  Channel Created`)
        .setColor(Colors.Green)
        .setTimestamp()
        .addFields(
          { name: "Name",       value: type === "text" ? `<#${newCh.id}>` : `**${newCh.name}**`, inline: true },
          { name: "Type",       value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
          { name: "Created by", value: `<@${member.id}>`, inline: true }
        );
      message.reply({ embeds: [embed] });
    } catch {
      message.reply({ embeds: [errEmbed("I don't have permission to create channels.")] });
    }
    return;
  }

  // .delete [#channel] [reason]
  if (command === "delete") {
    if (!requireAdmin()) return;
    const target = message.mentions.channels.first() || message.channel;
    const reason = args.filter((a) => !a.startsWith("<#")).join(" ") || "No reason provided";
    const isCurrent = target.id === message.channel.id;
    if (isCurrent) {
      await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`🗑️  Deleting this channel in **5 seconds**…\nReason: ${reason}`).setColor(Colors.Red)] });
      setTimeout(() => target.delete(`${reason} | By ${member.user.tag}`).catch(() => {}), 5000);
    } else {
      try {
        await target.delete(`${reason} | By ${member.user.tag}`);
        const embed = new EmbedBuilder()
          .setTitle("🗑️  Channel Deleted")
          .setColor(Colors.Red)
          .setTimestamp()
          .addFields(
            { name: "Channel",    value: `**#${target.name}**`, inline: true },
            { name: "Reason",     value: reason,                inline: true },
            { name: "Deleted by", value: `<@${member.id}>`,    inline: true }
          );
        message.reply({ embeds: [embed] });
      } catch {
        message.reply({ embeds: [errEmbed("I don't have permission to delete that channel.")] });
      }
    }
    return;
  }

  // ==========================================================================
  // INFO COMMANDS
  // ==========================================================================

  // .ping
  if (command === "ping") {
    const latency = Math.round(client.ws.ping);
    const color = latency < 100 ? Colors.Green : latency < 200 ? Colors.Yellow : Colors.Red;
    message.reply({ embeds: [new EmbedBuilder().setTitle("🏓  Pong!").setDescription(`Latency: **${latency}ms**`).setColor(color)] });
    return;
  }

  // .userinfo [@user]
  if (command === "userinfo") {
    const target = message.mentions.members.first() || member;
    const roles = target.roles.cache.filter((r) => r.id !== message.guild.id).sort((a, b) => b.position - a.position);
    const warns = ((loadWarns()[message.guild.id] || {})[target.id] || []).length;
    const created = Math.floor(target.user.createdTimestamp / 1000);
    const joined  = target.joinedTimestamp ? Math.floor(target.joinedTimestamp / 1000) : null;
    const embed = new EmbedBuilder()
      .setTitle(`👤  ${target.displayName}`)
      .setThumbnail(target.displayAvatarURL())
      .setColor(target.displayHexColor || Colors.Blurple)
      .setTimestamp()
      .addFields(
        { name: "Username",       value: target.user.tag,                                         inline: true },
        { name: "ID",             value: target.id,                                               inline: true },
        { name: "Bot",            value: target.user.bot ? "Yes" : "No",                          inline: true },
        { name: "Account Created",value: `<t:${created}:D>`,                                     inline: true },
        { name: "Joined Server",  value: joined ? `<t:${joined}:D>` : "Unknown",                 inline: true },
        { name: "Top Role",       value: `<@&${target.roles.highest.id}>`,                       inline: true },
        { name: "Warnings",       value: String(warns),                                           inline: true },
        { name: `Roles (${roles.size})`, value: roles.size ? roles.map((r) => `<@&${r.id}>`).slice(0, 15).join(" ") : "None", inline: false }
      )
      .setFooter({ text: `Requested by ${member.user.tag}` });
    message.reply({ embeds: [embed] });
    return;
  }

  // .serverinfo
  if (command === "serverinfo") {
    const g = message.guild;
    await g.fetch();
    const embed = new EmbedBuilder()
      .setTitle(`🏠  ${g.name}`)
      .setThumbnail(g.iconURL())
      .setColor(Colors.Blurple)
      .setTimestamp()
      .addFields(
        { name: "Owner",        value: `<@${g.ownerId}>`,                                inline: true },
        { name: "ID",           value: g.id,                                             inline: true },
        { name: "Created",      value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        { name: "Members",      value: g.memberCount.toLocaleString(),                  inline: true },
        { name: "Channels",     value: String(g.channels.cache.size),                   inline: true },
        { name: "Roles",        value: String(g.roles.cache.size),                      inline: true },
        { name: "Boost Level",  value: String(g.premiumTier),                           inline: true },
        { name: "Boosts",       value: String(g.premiumSubscriptionCount),              inline: true },
        { name: "Verification", value: g.verificationLevel,                             inline: true }
      )
      .setFooter({ text: `Requested by ${member.user.tag}` });
    message.reply({ embeds: [embed] });
    return;
  }

  // .roleinfo @role
  if (command === "roleinfo") {
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [errEmbed("Please mention a role.")] });
    const perms = role.permissions.toArray().map((p) => p.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
    const embed = new EmbedBuilder()
      .setTitle(`🎭  Role: ${role.name}`)
      .setColor(role.color || Colors.Blurple)
      .setTimestamp()
      .addFields(
        { name: "ID",           value: role.id,                                             inline: true },
        { name: "Color",        value: role.hexColor,                                       inline: true },
        { name: "Members",      value: String(role.members.size),                           inline: true },
        { name: "Mentionable",  value: role.mentionable ? "Yes" : "No",                    inline: true },
        { name: "Hoisted",      value: role.hoist ? "Yes" : "No",                          inline: true },
        { name: "Position",     value: String(role.position),                               inline: true },
        { name: "Created",      value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true },
        { name: "Key Permissions", value: perms.slice(0, 10).join(", ") || "None",         inline: false }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  // .avatar [@user]
  if (command === "avatar") {
    const target = message.mentions.members.first() || member;
    const url = target.displayAvatarURL({ size: 512 });
    const embed = new EmbedBuilder()
      .setTitle(`🖼  ${target.displayName}'s Avatar`)
      .setImage(url)
      .setColor(Colors.Blurple)
      .addFields(
        { name: "PNG", value: `[Link](${target.displayAvatarURL({ extension: "png", size: 512 })})`, inline: true },
        { name: "JPG", value: `[Link](${target.displayAvatarURL({ extension: "jpg", size: 512 })})`, inline: true }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  // .warnings [@user]
  if (command === "warnings") {
    const target = message.mentions.members.first() || member;
    const warns = ((loadWarns()[message.guild.id] || {})[target.id] || []);
    if (!warns.length) {
      return message.reply({ embeds: [new EmbedBuilder().setTitle(`Warnings for ${target.displayName}`).setDescription("No warnings on record.").setColor(Colors.Blurple)] });
    }
    const embed = new EmbedBuilder()
      .setTitle(`⚠️  Warnings for ${target.displayName}`)
      .setColor(Colors.Yellow)
      .setTimestamp()
      .setFooter({ text: `Total: ${warns.length} warning(s)` });
    warns.slice(0, 10).forEach((w, i) => {
      const mod = message.guild.members.cache.get(w.moderator);
      embed.addFields({
        name: `Warning #${i + 1}  —  ${w.timestamp.slice(0, 10)}`,
        value: `**Reason:** ${w.reason}\n**By:** ${mod ? mod.displayName : `ID ${w.moderator}`}`,
        inline: false,
      });
    });
    message.reply({ embeds: [embed] });
    return;
  }

  // .inviteinfo <code>
  if (command === "inviteinfo") {
    const code = args[0];
    if (!code) return message.reply({ embeds: [errEmbed("Provide an invite code.")] });
    try {
      const invite = await client.fetchInvite(code);
      const embed = new EmbedBuilder()
        .setTitle("🔗  Invite Info")
        .setColor(Colors.Blurple)
        .addFields(
          { name: "Server",  value: invite.guild?.name || "Unknown", inline: true },
          { name: "Channel", value: invite.channel ? `#${invite.channel.name}` : "Unknown", inline: true },
          { name: "Inviter", value: invite.inviter?.tag || "Unknown", inline: true },
          { name: "Members", value: invite.memberCount?.toLocaleString() ?? "?", inline: true }
        );
      message.reply({ embeds: [embed] });
    } catch {
      message.reply({ embeds: [errEmbed("Invalid or expired invite code.")] });
    }
    return;
  }

  // ==========================================================================
  // UTILITY COMMANDS
  // ==========================================================================

  // .embed  — post the main button embed
  if (command === "embed") {
    if (!requireAdmin()) return;
    const cfg = loadConfig();
    const embed = new EmbedBuilder()
      .setTitle(cfg.embed_title || "Welcome")
      .setDescription(cfg.embed_description || "Use the buttons below.")
      .setColor(cfg.embed_color || 0x5865f2)
      .setTimestamp();
    if (cfg.embed_footer) embed.setFooter({ text: cfg.embed_footer });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("main_vouch").setLabel("Vouch").setStyle(ButtonStyle.Success).setEmoji("✅"),
      new ButtonBuilder().setCustomId("main_ticket").setLabel("Ticket").setStyle(ButtonStyle.Primary).setEmoji("🎫"),
      new ButtonBuilder().setCustomId("main_help").setLabel("Help").setStyle(ButtonStyle.Secondary).setEmoji("❓"),
      new ButtonBuilder().setCustomId("main_perks").setLabel("Perks").setStyle(ButtonStyle.Secondary).setEmoji("🎁")
    );

    await message.delete().catch(() => {});
    message.channel.send({ embeds: [embed], components: [row] });
    return;
  }

  // .poll <question> | <opt1> | <opt2> ...
  if (command === "poll") {
    const raw    = args.join(" ");
    const parts  = raw.split("|").map((p) => p.trim()).filter(Boolean);
    const question = parts[0];
    const options  = parts.slice(1);
    const numEmoji = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];

    const embed = new EmbedBuilder()
      .setTitle(`📊  ${question}`)
      .setColor(Colors.Blurple)
      .setTimestamp()
      .setFooter({ text: `Poll by ${member.displayName}` });

    await message.delete().catch(() => {});

    if (!options.length) {
      embed.setDescription("React with 👍 for Yes or 👎 for No.");
      const msg = await message.channel.send({ embeds: [embed] });
      await msg.react("👍");
      await msg.react("👎");
    } else {
      if (options.length > 9) return message.channel.send({ embeds: [errEmbed("Max 9 poll options.")] });
      embed.setDescription(options.map((o, i) => `${numEmoji[i]}  ${o}`).join("\n"));
      const msg = await message.channel.send({ embeds: [embed] });
      for (let i = 0; i < options.length; i++) await msg.react(numEmoji[i]);
    }
    return;
  }

  // .setup [subcommand] [value]
  if (command === "setup") {
    if (!requireAdmin()) return;
    const sub = args[0]?.toLowerCase();
    const p = PREFIX;

    if (!sub) {
      const embed = new EmbedBuilder()
        .setTitle("⚙️  Setup Commands")
        .setColor(Colors.Blurple)
        .addFields(
          { name: `\`${p}setup vouch_channel #ch\``,    value: "Set vouch log channel",              inline: false },
          { name: `\`${p}setup ticket_category #cat\``, value: "Set ticket category",                inline: false },
          { name: `\`${p}setup ticket_role @role\``,    value: "Add a ticket staff role",             inline: false },
          { name: `\`${p}setup rm_ticket_role @role\``, value: "Remove a ticket staff role",          inline: false },
          { name: `\`${p}setup admin_role @role\``,     value: "Add a bot-admin role",               inline: false },
          { name: `\`${p}setup embed_title <text>\``,   value: "Set main embed title",               inline: false },
          { name: `\`${p}setup embed_desc <text>\``,    value: "Set main embed description",         inline: false },
          { name: `\`${p}setup embed_footer <text>\``,  value: "Set main embed footer",              inline: false },
          { name: `\`${p}setup embed_color <hex>\``,    value: "Set main embed color (e.g. FF0000)", inline: false },
          { name: `\`${p}setup perks <text>\``,         value: "Set perks description",              inline: false }
        );
      return message.reply({ embeds: [embed] });
    }

    const cfg = loadConfig();

    if (sub === "vouch_channel") {
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply({ embeds: [errEmbed("Mention a channel.")] });
      cfg.vouch_channel_id = ch.id; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`Vouch channel → <#${ch.id}>`)] });
    }

    if (sub === "ticket_category") {
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply({ embeds: [errEmbed("Mention a category channel.")] });
      cfg.ticket_category_id = ch.id; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`Ticket category → **${ch.name}**`)] });
    }

    if (sub === "ticket_role") {
      const role = message.mentions.roles.first();
      if (!role) return message.reply({ embeds: [errEmbed("Mention a role.")] });
      if (!cfg.ticket_roles.includes(role.id)) cfg.ticket_roles.push(role.id);
      saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`<@&${role.id}> added to ticket roles.`)] });
    }

    if (sub === "rm_ticket_role") {
      const role = message.mentions.roles.first();
      if (!role) return message.reply({ embeds: [errEmbed("Mention a role.")] });
      cfg.ticket_roles = cfg.ticket_roles.filter((id) => id !== role.id);
      saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`<@&${role.id}> removed from ticket roles.`)] });
    }

    if (sub === "admin_role") {
      const role = message.mentions.roles.first();
      if (!role) return message.reply({ embeds: [errEmbed("Mention a role.")] });
      if (!cfg.admin_roles.includes(role.id)) cfg.admin_roles.push(role.id);
      saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`<@&${role.id}> added as admin role.`)] });
    }

    if (sub === "embed_title") {
      const text = args.slice(1).join(" ");
      if (!text) return message.reply({ embeds: [errEmbed("Provide a title.")] });
      cfg.embed_title = text; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`Embed title → **${text}**`)] });
    }

    if (sub === "embed_desc") {
      const text = args.slice(1).join(" ");
      if (!text) return message.reply({ embeds: [errEmbed("Provide a description.")] });
      cfg.embed_description = text; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed("Embed description updated.")] });
    }

    if (sub === "embed_footer") {
      const text = args.slice(1).join(" ");
      if (!text) return message.reply({ embeds: [errEmbed("Provide a footer.")] });
      cfg.embed_footer = text; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`Embed footer → **${text}**`)] });
    }

    if (sub === "embed_color") {
      const hex = args[1]?.replace("#", "");
      const num = parseInt(hex, 16);
      if (!hex || isNaN(num)) return message.reply({ embeds: [errEmbed("Provide a valid hex color, e.g. `FF5733`.")] });
      cfg.embed_color = num; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed(`Embed color → \`#${hex.toUpperCase()}\``)] });
    }

    if (sub === "perks") {
      const text = args.slice(1).join(" ");
      if (!text) return message.reply({ embeds: [errEmbed("Provide a perks description.")] });
      cfg.perks_description = text; saveConfig(cfg);
      return message.reply({ embeds: [okEmbed("Perks description updated.")] });
    }

    message.reply({ embeds: [errEmbed(`Unknown subcommand. Run \`${p}setup\` for a list.`)] });
    return;
  }

  // ==========================================================================
  // NEW ADMIN COMMANDS
  // ==========================================================================

  // .setnick @user [nickname]  — omit nickname to reset
  if (command === "setnick") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Usage: `.setnick @user [new nickname]`")] });
    const nick = args.slice(1).join(" ").trim() || null;
    try {
      await target.setNickname(nick, `Set by ${member.user.tag}`);
      message.reply({ embeds: [okEmbed(nick ? `Nickname set to **${nick}** for <@${target.id}>.` : `Nickname reset for <@${target.id}>.`)] });
    } catch {
      message.reply({ embeds: [errEmbed("I don't have permission to change that member's nickname.")] });
    }
    return;
  }

  // .addemoji <name> <image_url>
  if (command === "addemoji") {
    if (!requireAdmin()) return;
    const name = args[0];
    const url  = args[1];
    if (!name || !url) return message.reply({ embeds: [errEmbed("Usage: `.addemoji <name> <image_url>`")] });
    try {
      const emoji = await message.guild.emojis.create({ attachment: url, name });
      message.reply({ embeds: [okEmbed(`Emoji ${emoji} \`:${emoji.name}:\` added!`)] });
    } catch (e) {
      message.reply({ embeds: [errEmbed(`Could not add emoji: ${e.message}`)] });
    }
    return;
  }

  // .steal <emoji>  — steal an emoji from a message and add to this server
  if (command === "steal") {
    if (!requireAdmin()) return;
    const raw = args[0];
    if (!raw) return message.reply({ embeds: [errEmbed("Usage: `.steal <emoji>`")] });
    const match = raw.match(/<a?:(\w+):(\d+)>/);
    if (!match) return message.reply({ embeds: [errEmbed("Please provide a custom emoji (not a standard Unicode emoji).")] });
    const [, name, id] = match;
    const animated = raw.startsWith("<a:");
    const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
    try {
      const emoji = await message.guild.emojis.create({ attachment: url, name });
      message.reply({ embeds: [okEmbed(`Stolen emoji ${emoji} \`:${emoji.name}:\` added!`)] });
    } catch (e) {
      message.reply({ embeds: [errEmbed(`Could not steal emoji: ${e.message}`)] });
    }
    return;
  }

  // .setprefix <new_prefix>
  if (command === "setprefix") {
    if (!requireAdmin()) return;
    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length > 3) return message.reply({ embeds: [errEmbed("Provide a prefix (max 3 chars).")] });
    const cfg = loadConfig();
    cfg.prefix = newPrefix;
    saveConfig(cfg);
    message.reply({ embeds: [okEmbed(`Prefix changed to \`${newPrefix}\`. Restart the bot for it to fully apply.`)] });
    return;
  }

  // .userpurge @user <amount>  — delete messages from a specific user
  if (command === "userpurge") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    const amount = parseInt(args[1]) || parseInt(args[0]);
    if (!target) return message.reply({ embeds: [errEmbed("Usage: `.userpurge @user <amount>`")] });
    if (isNaN(amount) || amount < 1 || amount > 100) return message.reply({ embeds: [errEmbed("Amount must be 1–100.")] });
    const msgs = await message.channel.messages.fetch({ limit: 100 });
    const toDelete = msgs.filter((m) => m.author.id === target.id).first(amount);
    await message.channel.bulkDelete(toDelete, true).catch(() => {});
    await message.delete().catch(() => {});
    const ack = await message.channel.send({ embeds: [okEmbed(`Deleted up to **${toDelete.length}** messages from <@${target.id}>.`)] });
    setTimeout(() => ack.delete().catch(() => {}), 5000);
    return;
  }

  // .vcmute @user
  if (command === "vcmute") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    if (!target.voice.channel) return message.reply({ embeds: [errEmbed("That member is not in a voice channel.")] });
    await target.voice.setMute(true, `Muted by ${member.user.tag}`);
    message.reply({ embeds: [okEmbed(`<@${target.id}> has been voice-muted.`)] });
    return;
  }

  // .vcunmute @user
  if (command === "vcunmute") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    if (!target.voice.channel) return message.reply({ embeds: [errEmbed("That member is not in a voice channel.")] });
    await target.voice.setMute(false, `Unmuted by ${member.user.tag}`);
    message.reply({ embeds: [okEmbed(`<@${target.id}> has been voice-unmuted.`)] });
    return;
  }

  // .vckick @user  — disconnect from voice
  if (command === "vckick") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    if (!target.voice.channel) return message.reply({ embeds: [errEmbed("That member is not in a voice channel.")] });
    await target.voice.disconnect(`Disconnected by ${member.user.tag}`);
    message.reply({ embeds: [okEmbed(`<@${target.id}> has been disconnected from voice.`)] });
    return;
  }

  // .tempban @user <n> <s|m|h|d> [reason]
  if (command === "tempban") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Usage: `.tempban @user <n> <s|m|h|d> [reason]`")] });
    const dur  = args[1];
    const unit = (args[2] || "m").toLowerCase();
    const reason = args.slice(3).join(" ") || "No reason provided";
    const ms = parseDuration(dur, unit);
    if (!ms) return message.reply({ embeds: [errEmbed("Invalid duration. Example: `.tempban @user 10 m Spamming`")] });
    if (ms > 86400000 * 28) return message.reply({ embeds: [errEmbed("Max temp-ban duration is 28 days.")] });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle(`You were temporarily banned from ${message.guild.name}`).setDescription(`**Reason:** ${reason}\n**Duration:** ${formatDuration(ms)}`).setColor(Colors.Red)] }).catch(() => {});
      await target.ban({ reason: `[TEMPBAN ${formatDuration(ms)}] ${reason}`, deleteMessageSeconds: 0 });
      const embed = modEmbed("⏳  Member Temp-Banned", Colors.Red)
        .addFields(
          { name: "User",      value: `${target.user.tag} (\`${target.id}\`)`, inline: false },
          { name: "Duration",  value: formatDuration(ms),                       inline: true  },
          { name: "Expires",   value: `<t:${Math.floor((Date.now() + ms) / 1000)}:R>`, inline: true },
          { name: "Reason",    value: reason,                                   inline: false },
          { name: "Moderator", value: `<@${member.id}>`,                        inline: false }
        );
      message.reply({ embeds: [embed] });
      setTimeout(async () => {
        try {
          await message.guild.members.unban(target.id, "Temp-ban expired");
        } catch { /* already left or already unbanned */ }
      }, ms);
    } catch {
      message.reply({ embeds: [errEmbed("Could not temp-ban that member.")] });
    }
    return;
  }

  // .note @user <text>
  if (command === "note") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Usage: `.note @user <note text>`")] });
    const text = args.slice(1).join(" ");
    if (!text) return message.reply({ embeds: [errEmbed("Provide note text.")] });
    const data = loadNotes();
    const gId = message.guild.id;
    const uId = target.id;
    if (!data[gId]) data[gId] = {};
    if (!data[gId][uId]) data[gId][uId] = [];
    data[gId][uId].push({ text, moderator: member.id, timestamp: new Date().toISOString() });
    saveNotes(data);
    message.reply({ embeds: [okEmbed(`Note added for <@${target.id}> (total: ${data[gId][uId].length}).`)] });
    return;
  }

  // .notes @user
  if (command === "notes") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    const notes = ((loadNotes()[message.guild.id] || {})[target.id] || []);
    if (!notes.length) return message.reply({ embeds: [new EmbedBuilder().setTitle(`Notes for ${target.displayName}`).setDescription("No notes on record.").setColor(Colors.Blurple)] });
    const embed = new EmbedBuilder().setTitle(`📝  Notes for ${target.displayName}`).setColor(Colors.Blurple).setTimestamp().setFooter({ text: `Total: ${notes.length}` });
    notes.slice(0, 10).forEach((n, i) => {
      const mod = message.guild.members.cache.get(n.moderator);
      embed.addFields({ name: `Note #${i + 1}  —  ${n.timestamp.slice(0, 10)}`, value: `${n.text}\n*By: ${mod ? mod.displayName : `ID ${n.moderator}`}*`, inline: false });
    });
    message.reply({ embeds: [embed] });
    return;
  }

  // .clearnotes @user
  if (command === "clearnotes") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Please mention a member.")] });
    const data = loadNotes();
    const count = ((data[message.guild.id] || {})[target.id] || []).length;
    if (!data[message.guild.id]) data[message.guild.id] = {};
    data[message.guild.id][target.id] = [];
    saveNotes(data);
    message.reply({ embeds: [okEmbed(`Cleared **${count}** note(s) for <@${target.id}>.`)] });
    return;
  }

  // .giveaway <n> <s|m|h|d> <winners> <prize>
  if (command === "giveaway") {
    if (!requireAdmin()) return;
    const n       = args[0];
    const unit    = (args[1] || "m").toLowerCase();
    const winners = parseInt(args[2]);
    const prize   = args.slice(3).join(" ");
    const ms = parseDuration(n, unit);
    if (!ms || isNaN(winners) || winners < 1 || !prize) {
      return message.reply({ embeds: [errEmbed("Usage: `.giveaway <n> <s|m|h|d> <winners> <prize>`\nExample: `.giveaway 1 h 2 Nitro`")] });
    }
    await message.delete().catch(() => {});
    const endTime = Math.floor((Date.now() + ms) / 1000);
    const embed = new EmbedBuilder()
      .setTitle("🎉  GIVEAWAY  🎉")
      .setDescription(`**Prize:** ${prize}\n\nReact with 🎉 to enter!\n\n**Ends:** <t:${endTime}:R>\n**Winners:** ${winners}`)
      .setColor(Colors.Gold)
      .setFooter({ text: `Hosted by ${member.displayName}` })
      .setTimestamp(new Date(Date.now() + ms));
    const gMsg = await message.channel.send({ embeds: [embed] });
    await gMsg.react("🎉");

    setTimeout(async () => {
      const fetched = await gMsg.fetch().catch(() => null);
      if (!fetched) return;
      const reaction = fetched.reactions.cache.get("🎉");
      const users = await reaction?.users.fetch();
      const valid = users?.filter((u) => !u.bot);
      if (!valid || valid.size === 0) {
        return gMsg.reply({ embeds: [new EmbedBuilder().setDescription("🎉  Giveaway ended — no valid entries!").setColor(Colors.Red)] });
      }
      const arr = [...valid.values()];
      const chosen = [];
      for (let i = 0; i < Math.min(winners, arr.length); i++) {
        let pick;
        do { pick = arr[Math.floor(Math.random() * arr.length)]; } while (chosen.includes(pick));
        chosen.push(pick);
      }
      const winText = chosen.map((u) => `<@${u.id}>`).join(", ");
      const winEmbed = new EmbedBuilder()
        .setTitle("🎉  Giveaway Ended!")
        .setDescription(`**Prize:** ${prize}\n**Winner(s):** ${winText}`)
        .setColor(Colors.Gold)
        .setTimestamp();
      gMsg.edit({ embeds: [winEmbed] });
      gMsg.reply({ content: `🎉  Congratulations ${winText}! You won **${prize}**!` });
    }, ms);
    return;
  }

  // .lockdown  — lock every text channel in the server
  if (command === "lockdown") {
    if (!requireAdmin()) return;
    const reason = args.join(" ") || "Server lockdown";
    const channels = message.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
    let count = 0;
    for (const [, ch] of channels) {
      try {
        await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        count++;
      } catch { /* skip channels we can't edit */ }
    }
    message.reply({ embeds: [new EmbedBuilder().setTitle("🔒  Server Lockdown").setDescription(`Locked **${count}** channel(s).\n**Reason:** ${reason}`).setColor(Colors.Red).setTimestamp()] });
    return;
  }

  // .unlockdown  — unlock every text channel
  if (command === "unlockdown") {
    if (!requireAdmin()) return;
    const channels = message.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
    let count = 0;
    for (const [, ch] of channels) {
      try {
        await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
        count++;
      } catch { /* skip */ }
    }
    message.reply({ embeds: [new EmbedBuilder().setTitle("🔓  Lockdown Lifted").setDescription(`Unlocked **${count}** channel(s).`).setColor(Colors.Green).setTimestamp()] });
    return;
  }

  // ==========================================================================
  // NEW INFO COMMANDS
  // ==========================================================================

  // .snipe  — show last deleted message in this channel
  if (command === "snipe") {
    const snipe = snipeCache.get(message.channelId);
    if (!snipe) return message.reply({ embeds: [new EmbedBuilder().setDescription("Nothing to snipe in this channel.").setColor(Colors.Blurple)] });
    const embed = new EmbedBuilder()
      .setTitle("🔍  Last Deleted Message")
      .setDescription(snipe.content)
      .setColor(Colors.Yellow)
      .setAuthor({ name: snipe.author, iconURL: snipe.authorIcon || undefined })
      .setFooter({ text: `Deleted at` })
      .setTimestamp(snipe.timestamp);
    message.reply({ embeds: [embed] });
    return;
  }

  // .botinfo
  if (command === "botinfo") {
    const upMs   = Date.now() - startTime;
    const uptime = formatDuration(upMs);
    const guilds = client.guilds.cache.size;
    const users  = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    const embed = new EmbedBuilder()
      .setTitle(`🤖  ${client.user.username}`)
      .setThumbnail(client.user.displayAvatarURL())
      .setColor(Colors.Blurple)
      .setTimestamp()
      .addFields(
        { name: "Tag",      value: client.user.tag,           inline: true },
        { name: "ID",       value: client.user.id,            inline: true },
        { name: "Prefix",   value: `\`${PREFIX}\``,           inline: true },
        { name: "Uptime",   value: uptime,                    inline: true },
        { name: "Servers",  value: String(guilds),            inline: true },
        { name: "Users",    value: users.toLocaleString(),    inline: true },
        { name: "Library",  value: "discord.js v14",          inline: true },
        { name: "Node.js",  value: process.version,           inline: true }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  // .membercount
  if (command === "membercount") {
    await message.guild.members.fetch();
    const all    = message.guild.memberCount;
    const bots   = message.guild.members.cache.filter((m) => m.user.bot).size;
    const humans = all - bots;
    const online = message.guild.members.cache.filter((m) => m.presence?.status === "online").size;
    const embed = new EmbedBuilder()
      .setTitle(`👥  Member Count — ${message.guild.name}`)
      .setColor(Colors.Blurple)
      .setTimestamp()
      .addFields(
        { name: "Total",   value: all.toLocaleString(),    inline: true },
        { name: "Humans",  value: humans.toLocaleString(), inline: true },
        { name: "Bots",    value: bots.toLocaleString(),   inline: true },
        { name: "Online",  value: online.toLocaleString() + " (approx)", inline: true }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  // .uptime
  if (command === "uptime") {
    const ms  = Date.now() - startTime;
    const d   = Math.floor(ms / 86400000);
    const h   = Math.floor((ms % 86400000) / 3600000);
    const m   = Math.floor((ms % 3600000) / 60000);
    const s   = Math.floor((ms % 60000) / 1000);
    message.reply({ embeds: [new EmbedBuilder().setTitle("⏱️  Bot Uptime").setDescription(`**${d}d ${h}h ${m}m ${s}s**`).setColor(Colors.Green)] });
    return;
  }

  // .whois @user  — alias for userinfo
  if (command === "whois") {
    const target = message.mentions.members.first() || member;
    const roles = target.roles.cache.filter((r) => r.id !== message.guild.id).sort((a, b) => b.position - a.position);
    const warns = ((loadWarns()[message.guild.id] || {})[target.id] || []).length;
    const created = Math.floor(target.user.createdTimestamp / 1000);
    const joined  = target.joinedTimestamp ? Math.floor(target.joinedTimestamp / 1000) : null;
    const embed = new EmbedBuilder()
      .setTitle(`🔎  ${target.displayName}`)
      .setThumbnail(target.displayAvatarURL())
      .setColor(target.displayHexColor || Colors.Blurple)
      .setTimestamp()
      .addFields(
        { name: "Username",       value: target.user.tag,                                                          inline: true },
        { name: "ID",             value: target.id,                                                                inline: true },
        { name: "Bot",            value: target.user.bot ? "Yes" : "No",                                           inline: true },
        { name: "Account Created",value: `<t:${created}:D>`,                                                      inline: true },
        { name: "Joined Server",  value: joined ? `<t:${joined}:D>` : "Unknown",                                  inline: true },
        { name: "Top Role",       value: `<@&${target.roles.highest.id}>`,                                        inline: true },
        { name: "Warnings",       value: String(warns),                                                            inline: true },
        { name: `Roles (${roles.size})`, value: roles.size ? roles.map((r) => `<@&${r.id}>`).slice(0, 15).join(" ") : "None", inline: false }
      )
      .setFooter({ text: `Requested by ${member.user.tag}` });
    message.reply({ embeds: [embed] });
    return;
  }

  // ==========================================================================
  // FUN COMMANDS (Everyone)
  // ==========================================================================

  // .8ball <question>
  if (command === "8ball") {
    const responses = [
      "Yes, definitely.", "It is certain.", "Without a doubt.", "You may rely on it.",
      "Most likely.", "Outlook good.", "Signs point to yes.", "As I see it, yes.",
      "Reply hazy, try again.", "Ask again later.", "Better not tell you now.",
      "Cannot predict now.", "Concentrate and ask again.",
      "Don't count on it.", "My reply is no.", "My sources say no.",
      "Outlook not so good.", "Very doubtful.", "Absolutely not.", "Nope."
    ];
    const q = args.join(" ");
    if (!q) return message.reply({ embeds: [errEmbed("Ask a question! Usage: `.8ball <question>`")] });
    const answer = responses[Math.floor(Math.random() * responses.length)];
    const embed = new EmbedBuilder()
      .setTitle("🎱  Magic 8-Ball")
      .addFields(
        { name: "Question", value: q, inline: false },
        { name: "Answer",   value: answer, inline: false }
      )
      .setColor(Colors.DarkPurple);
    message.reply({ embeds: [embed] });
    return;
  }

  // .coinflip
  if (command === "coinflip") {
    const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
    message.reply({ embeds: [new EmbedBuilder().setTitle("🪙  Coin Flip").setDescription(`**${result}**`).setColor(Colors.Gold)] });
    return;
  }

  // .dice [sides]
  if (command === "dice") {
    const sides = parseInt(args[0]) || 6;
    if (sides < 2 || sides > 1000) return message.reply({ embeds: [errEmbed("Sides must be between 2 and 1000.")] });
    const roll = Math.floor(Math.random() * sides) + 1;
    message.reply({ embeds: [new EmbedBuilder().setTitle("🎲  Dice Roll").setDescription(`Rolled a **d${sides}** → **${roll}**`).setColor(Colors.Orange)] });
    return;
  }

  // .choose <opt1> | <opt2> | ...
  if (command === "choose") {
    const opts = args.join(" ").split("|").map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return message.reply({ embeds: [errEmbed("Provide at least 2 options separated by `|`.\nExample: `.choose Pizza | Burger | Tacos`")] });
    const pick = opts[Math.floor(Math.random() * opts.length)];
    message.reply({ embeds: [new EmbedBuilder().setTitle("🤔  Random Choice").setDescription(`I choose: **${pick}**`).setFooter({ text: `Options: ${opts.join(" | ")}` }).setColor(Colors.Blurple)] });
    return;
  }

  // .color <hex>
  if (command === "color") {
    const hex = (args[0] || "").replace("#", "");
    const num = parseInt(hex, 16);
    if (!hex || isNaN(num) || hex.length !== 6) return message.reply({ embeds: [errEmbed("Provide a valid 6-digit hex color.\nExample: `.color FF5733`")] });
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const embed = new EmbedBuilder()
      .setTitle(`🎨  Color #${hex.toUpperCase()}`)
      .setColor(num)
      .setThumbnail(`https://singlecolorimage.com/get/${hex}/100x100`)
      .addFields(
        { name: "HEX", value: `#${hex.toUpperCase()}`, inline: true },
        { name: "RGB", value: `rgb(${r}, ${g}, ${b})`,  inline: true }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  // .timestamp <YYYY-MM-DD> [HH:MM]
  if (command === "timestamp") {
    const input = args.join(" ");
    if (!input) return message.reply({ embeds: [errEmbed("Usage: `.timestamp 2025-12-31` or `.timestamp 2025-12-31 23:59`")] });
    const date = new Date(input);
    if (isNaN(date.getTime())) return message.reply({ embeds: [errEmbed("Invalid date. Use format: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`")] });
    const unix = Math.floor(date.getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle("🕐  Discord Timestamp")
      .setColor(Colors.Blurple)
      .addFields(
        { name: "Short Date",       value: `\`<t:${unix}:d>\` → <t:${unix}:d>`,   inline: false },
        { name: "Long Date",        value: `\`<t:${unix}:D>\` → <t:${unix}:D>`,   inline: false },
        { name: "Short Time",       value: `\`<t:${unix}:t>\` → <t:${unix}:t>`,   inline: false },
        { name: "Date + Time",      value: `\`<t:${unix}:f>\` → <t:${unix}:f>`,   inline: false },
        { name: "Relative",         value: `\`<t:${unix}:R>\` → <t:${unix}:R>`,   inline: false },
        { name: "Unix Timestamp",   value: `\`${unix}\``,                           inline: false }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  // .id [@user / @role / #channel]  — show IDs of mentioned items
  if (command === "id") {
    const lines = [];
    message.mentions.members.forEach((m) => lines.push(`👤  **${m.user.tag}** → \`${m.id}\``));
    message.mentions.roles.forEach((r)   => lines.push(`🎭  **${r.name}** → \`${r.id}\``));
    message.mentions.channels.forEach((c)=> lines.push(`#  **${c.name}** → \`${c.id}\``));
    if (!lines.length) lines.push(`🖥️  **Server** → \`${message.guild.id}\``);
    message.reply({ embeds: [new EmbedBuilder().setTitle("🪪  IDs").setDescription(lines.join("\n")).setColor(Colors.Blurple)] });
    return;
  }

  // .remind <n> <s|m|h|d> <message>
  if (command === "remind") {
    const n    = args[0];
    const unit = (args[1] || "m").toLowerCase();
    const text = args.slice(2).join(" ");
    const ms   = parseDuration(n, unit);
    if (!ms || !text) return message.reply({ embeds: [errEmbed("Usage: `.remind <n> <s|m|h|d> <message>`\nExample: `.remind 30 m Check the oven`")] });
    if (ms > 86400000 * 7) return message.reply({ embeds: [errEmbed("Max reminder duration is 7 days.")] });
    const until = Math.floor((Date.now() + ms) / 1000);
    await message.reply({ embeds: [okEmbed(`Reminder set! I'll ping you <t:${until}:R>.`)] });
    setTimeout(async () => {
      try {
        await message.channel.send({
          content: `<@${member.id}>`,
          embeds: [new EmbedBuilder()
            .setTitle("⏰  Reminder")
            .setDescription(text)
            .setColor(Colors.Yellow)
            .setTimestamp()
            .setFooter({ text: "You asked me to remind you" })],
        });
      } catch { /* channel might be gone */ }
    }, ms);
    return;
  }

  // .afk [reason]
  if (command === "afk") {
    const reason = args.join(" ") || "AFK";
    if (!client._afkMap) client._afkMap = new Map();
    client._afkMap.set(member.id, { reason, since: Date.now() });
    await member.setNickname(`[AFK] ${member.displayName}`.slice(0, 32)).catch(() => {});
    message.reply({ embeds: [new EmbedBuilder().setDescription(`💤  You are now AFK: **${reason}**`).setColor(Colors.Grey)] });
    return;
  }

  // ==========================================================================
  // MORE ADMIN COMMANDS
  // ==========================================================================

  // .softban @user [reason]  — ban + immediate unban to clear recent messages
  if (command === "softban") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errEmbed("Usage: `.softban @user [reason]`")] });
    const reason = args.slice(1).join(" ") || "No reason provided";
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle(`You were soft-banned from ${message.guild.name}`).setDescription(`**Reason:** ${reason}\nYou may rejoin with a new invite.`).setColor(Colors.Orange)] }).catch(() => {});
      await target.ban({ reason: `[SOFTBAN] ${reason}`, deleteMessageSeconds: 604800 });
      await message.guild.members.unban(target.id, "Softban — auto unban");
      const embed = modEmbed("🧹  Member Soft-Banned", Colors.Orange)
        .addFields(
          { name: "User",      value: `${target.user.tag} (\`${target.id}\`)`, inline: false },
          { name: "Reason",    value: reason,                                   inline: false },
          { name: "Moderator", value: `<@${member.id}>`,                        inline: false },
          { name: "Note",      value: "Messages deleted. User may rejoin.",      inline: false }
        );
      message.reply({ embeds: [embed] });
    } catch {
      message.reply({ embeds: [errEmbed("Could not softban that member.")] });
    }
    return;
  }

  // .inrole @role  — list members with a role
  if (command === "inrole") {
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [errEmbed("Please mention a role.")] });
    await message.guild.members.fetch();
    const members = role.members.map((m) => m.displayName);
    if (!members.length) return message.reply({ embeds: [new EmbedBuilder().setTitle(`Members with ${role.name}`).setDescription("No members have this role.").setColor(role.color)] });
    const chunks = [];
    for (let i = 0; i < members.length; i += 30) chunks.push(members.slice(i, i + 30).join(", "));
    const embed = new EmbedBuilder()
      .setTitle(`🎭  Members with @${role.name}  (${members.length})`)
      .setDescription(chunks[0] + (chunks.length > 1 ? `\n*…and ${members.length - 30} more*` : ""))
      .setColor(role.color || Colors.Blurple);
    message.reply({ embeds: [embed] });
    return;
  }

  // .topic [#channel] <text>  — set channel topic
  if (command === "topic") {
    if (!requireAdmin()) return;
    const ch   = message.mentions.channels.first() || message.channel;
    const text = args.filter((a) => !a.startsWith("<#")).join(" ");
    if (!text) return message.reply({ embeds: [errEmbed("Usage: `.topic [#channel] <new topic>`")] });
    await ch.setTopic(text, `Set by ${member.user.tag}`);
    message.reply({ embeds: [okEmbed(`Topic for <#${ch.id}> set to: **${text}**`)] });
    return;
  }

  // .rename [#channel] <new name>
  if (command === "rename") {
    if (!requireAdmin()) return;
    const ch   = message.mentions.channels.first() || message.channel;
    const name = args.filter((a) => !a.startsWith("<#")).join(" ").toLowerCase().replace(/\s+/g, "-");
    if (!name) return message.reply({ embeds: [errEmbed("Usage: `.rename [#channel] <new name>`")] });
    try {
      await ch.setName(name, `Renamed by ${member.user.tag}`);
      message.reply({ embeds: [okEmbed(`Channel renamed to **${name}**.`)] });
    } catch {
      message.reply({ embeds: [errEmbed("I don't have permission to rename that channel.")] });
    }
    return;
  }

  // .move @user #voicechannel
  if (command === "move") {
    if (!requireAdmin()) return;
    const target = message.mentions.members.first();
    const vc     = message.mentions.channels.first();
    if (!target || !vc) return message.reply({ embeds: [errEmbed("Usage: `.move @user #voicechannel`")] });
    if (!target.voice.channel) return message.reply({ embeds: [errEmbed("That member is not in a voice channel.")] });
    if (vc.type !== ChannelType.GuildVoice) return message.reply({ embeds: [errEmbed("Target must be a voice channel.")] });
    try {
      await target.voice.setChannel(vc, `Moved by ${member.user.tag}`);
      message.reply({ embeds: [okEmbed(`<@${target.id}> moved to **${vc.name}**.`)] });
    } catch {
      message.reply({ embeds: [errEmbed("Could not move that member.")] });
    }
    return;
  }

  // .hide [#channel]  — hide channel from @everyone
  if (command === "hide") {
    if (!requireAdmin()) return;
    const ch = message.mentions.channels.first() || message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: false });
    message.reply({ embeds: [okEmbed(`<#${ch.id}> is now hidden from everyone.`)] });
    return;
  }

  // .show [#channel]  — make channel visible to @everyone
  if (command === "show") {
    if (!requireAdmin()) return;
    const ch = message.mentions.channels.first() || message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: null });
    message.reply({ embeds: [okEmbed(`<#${ch.id}> is now visible to everyone.`)] });
    return;
  }

  // .emojis  — list all custom emojis in the server
  if (command === "emojis") {
    await message.guild.emojis.fetch();
    const emojis = message.guild.emojis.cache;
    if (!emojis.size) return message.reply({ embeds: [new EmbedBuilder().setDescription("This server has no custom emojis.").setColor(Colors.Blurple)] });
    const staticE   = emojis.filter((e) => !e.animated).map((e) => `${e}`).join(" ");
    const animatedE = emojis.filter((e) => e.animated).map((e) => `${e}`).join(" ");
    const embed = new EmbedBuilder()
      .setTitle(`😀  Server Emojis  (${emojis.size})`)
      .setColor(Colors.Blurple);
    if (staticE)   embed.addFields({ name: `Static (${emojis.filter((e) => !e.animated).size})`,   value: staticE.slice(0, 1024),   inline: false });
    if (animatedE) embed.addFields({ name: `Animated (${emojis.filter((e) => e.animated).size})`, value: animatedE.slice(0, 1024), inline: false });
    message.reply({ embeds: [embed] });
    return;
  }

  // .help [mod|info|util]
  if (command === "help") {
    const p   = PREFIX;
    const sec = args[0]?.toLowerCase();

    const sections = {
      mod: {
        title: "🔨  Moderation Commands (Admin Only)",
        fields: [
          [`\`${p}ban @user [reason]\``,                    "Ban a member"],
          [`\`${p}unban <id> [reason]\``,                   "Unban by user ID"],
          [`\`${p}kick @user [reason]\``,                   "Kick a member"],
          [`\`${p}timeout @user <n> <s|m|h|d> [reason]\``, "Timeout a member"],
          [`\`${p}untimeout @user\``,                       "Remove a timeout"],
          [`\`${p}tempban @user <n> <s|m|h|d> [reason]\``, "Temp-ban (auto-unbans)"],
          [`\`${p}role @user @role\``,                      "Give a role"],
          [`\`${p}takerole @user @role\``,                  "Remove a role"],
          [`\`${p}setnick @user [nick]\``,                  "Set/reset a nickname"],
          [`\`${p}warn @user [reason]\``,                   "Warn a member"],
          [`\`${p}clearwarns @user\``,                      "Clear all warnings"],
          [`\`${p}note @user <text>\``,                     "Add a private note on a member"],
          [`\`${p}clearnotes @user\``,                      "Clear all notes for a member"],
          [`\`${p}purge <1-100>\``,                         "Bulk delete messages"],
          [`\`${p}userpurge @user <1-100>\``,               "Delete messages from a specific user"],
          [`\`${p}slowmode <s> [#ch]\``,                    "Set slowmode (0 = off)"],
          [`\`${p}lock [#ch]\``,                            "Lock a channel"],
          [`\`${p}unlock [#ch]\``,                          "Unlock a channel"],
          [`\`${p}lockdown [reason]\``,                     "Lock every text channel"],
          [`\`${p}unlockdown\``,                            "Unlock every text channel"],
          [`\`${p}nuke\``,                                  "Clone + wipe current channel"],
          [`\`${p}announce #ch <msg>\``,                    "Post an announcement embed"],
          [`\`${p}dm @user <msg>\``,                        "DM a member as the bot"],
          [`\`${p}say [#ch] <msg>\``,                       "Make the bot say something"],
          [`\`${p}create <text|voice> <name>\``,            "Create a text or voice channel"],
          [`\`${p}delete [#ch] [reason]\``,                 "Delete a channel"],
          [`\`${p}addemoji <name> <url>\``,                 "Add an emoji from a URL"],
          [`\`${p}steal <emoji>\``,                         "Steal a custom emoji into this server"],
          [`\`${p}vcmute @user\``,                          "Voice-mute a member"],
          [`\`${p}vcunmute @user\``,                        "Remove voice-mute"],
          [`\`${p}vckick @user\``,                          "Disconnect a member from voice"],
          [`\`${p}giveaway <n> <unit> <winners> <prize>\``, "Start a giveaway"],
          [`\`${p}setprefix <prefix>\``,                    "Change the bot prefix"],
        ],
      },
      info: {
        title: "ℹ️  Info Commands",
        fields: [
          [`\`${p}userinfo [@user]\``,   "Full user profile"],
          [`\`${p}whois [@user]\``,      "Alias for userinfo"],
          [`\`${p}serverinfo\``,         "Server stats"],
          [`\`${p}roleinfo @role\``,     "Role details"],
          [`\`${p}avatar [@user]\``,     "User avatar links"],
          [`\`${p}warnings [@user]\``,   "View warnings for a user"],
          [`\`${p}notes @user\``,        "View admin notes for a user"],
          [`\`${p}ping\``,               "Bot latency"],
          [`\`${p}botinfo\``,            "Bot stats (uptime, servers, users)"],
          [`\`${p}membercount\``,        "Member breakdown (humans, bots, online)"],
          [`\`${p}uptime\``,             "How long the bot has been running"],
          [`\`${p}snipe\``,              "Show the last deleted message in this channel"],
          [`\`${p}inviteinfo <code>\``,  "Invite link details"],
          [`\`${p}inrole @role\``,       "List all members with a role"],
          [`\`${p}emojis\``,             "List all custom emojis in the server"],
          [`\`${p}id [@user/@role/#ch]\``, "Show the ID of any mentioned item"],
        ],
      },
      util: {
        title: "🛠️  Utility Commands",
        fields: [
          [`\`${p}embed\``,                            "Post the main 4-button embed (admin)"],
          [`\`${p}poll <q> [| opt1 | opt2 …]\``,      "Create a reaction poll (up to 9 options)"],
          [`\`${p}8ball <question>\``,                 "Ask the magic 8-ball"],
          [`\`${p}coinflip\``,                         "Flip a coin"],
          [`\`${p}dice [sides]\``,                     "Roll a dice (default d6)"],
          [`\`${p}choose opt1 | opt2 | …\``,           "Pick a random option"],
          [`\`${p}color <hex>\``,                      "Preview a hex color"],
          [`\`${p}timestamp <YYYY-MM-DD> [HH:MM]\``,  "Generate Discord timestamps"],
          [`\`${p}remind <n> <s|m|h|d> <msg>\``,      "Set a personal reminder"],
          [`\`${p}afk [reason]\``,                     "Set yourself as AFK"],
          [`\`${p}softban @user [reason]\``,           "Ban + unban to wipe messages (admin)"],
          [`\`${p}topic [#ch] <text>\``,               "Set a channel topic (admin)"],
          [`\`${p}rename [#ch] <name>\``,              "Rename a channel (admin)"],
          [`\`${p}move @user #vc\``,                   "Move member to a voice channel (admin)"],
          [`\`${p}hide [#ch]\``,                       "Hide a channel from everyone (admin)"],
          [`\`${p}show [#ch]\``,                       "Un-hide a channel (admin)"],
          [`\`${p}setup\``,                            "Configure the bot (admin)"],
          [`\`${p}help [mod|info|util]\``,             "Show this help menu"],
        ],
      },
    };

    if (sec && sections[sec]) {
      const s = sections[sec];
      const embed = new EmbedBuilder().setTitle(s.title).setColor(Colors.Blurple);
      s.fields.forEach(([name, value]) => embed.addFields({ name, value, inline: false }));
      return message.reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setTitle("📖  Bot Help")
      .setDescription(
        `\`${p}help mod\`  — Moderation commands\n` +
        `\`${p}help info\` — Info & lookup commands\n` +
        `\`${p}help util\` — Utility commands\n\n` +
        "All admin commands require the Administrator permission or a configured admin role."
      )
      .setColor(Colors.Blurple)
      .setFooter({ text: `Prefix: ${p}` });
    message.reply({ embeds: [embed] });
    return;
  }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌  DISCORD_TOKEN environment variable is not set.");
  console.error("    Set it with:  export DISCORD_TOKEN=your_bot_token_here");
  process.exit(1);
}

client.login(token);
