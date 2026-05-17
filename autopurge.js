const fs = require('fs');

const AUTO_PURGE_FILE = './autopurge_channels.json';

function loadChannels() {
    if (!fs.existsSync(AUTO_PURGE_FILE)) return [];
    return JSON.parse(fs.readFileSync(AUTO_PURGE_FILE));
}

function saveChannels(channels) {
    fs.writeFileSync(AUTO_PURGE_FILE, JSON.stringify(channels, null, 2));
}

module.exports = (client) => {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'autopurge') {
            if (!interaction.member.permissions.has('ManageChannels')) {
                return interaction.reply({
                    content: 'You need Manage Channels permission.',
                    ephemeral: true
                });
            }

            let channels = loadChannels();

            if (channels.includes(interaction.channel.id)) {
                channels = channels.filter(id => id !== interaction.channel.id);
                saveChannels(channels);

                return interaction.reply({
                    content: 'Auto purge disabled in this channel.',
                    ephemeral: true
                });
            }

            channels.push(interaction.channel.id);
            saveChannels(channels);

            interaction.reply({
                content: 'Auto purge enabled. Messages delete after 4 seconds.',
                ephemeral: true
            });
        }
    });

    client.on('messageCreate', async message => {
        const channels = loadChannels();

        if (!channels.includes(message.channel.id)) return;

        setTimeout(async () => {
            try {
                await message.delete();
            } catch (err) {}
        }, 4000);
    });
};
