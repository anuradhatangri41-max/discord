const autoPurgeBotChannels = new Set();

module.exports = (client) => {

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'autopurgebot') {

        if (autoPurgeBotChannels.has(interaction.channel.id)) {
            autoPurgeBotChannels.delete(interaction.channel.id);

            return interaction.reply({
                content: 'Bot auto purge disabled.',
                ephemeral: true
            });
        }

        autoPurgeBotChannels.add(interaction.channel.id);

        interaction.reply({
            content: 'Bot messages will auto delete after 4 seconds.',
            ephemeral: true
        });
    }
});

client.on('messageCreate', async message => {

    if (!message.author.bot) return;

    if (!autoPurgeBotChannels.has(message.channel.id)) return;

    setTimeout(async () => {
        try {
            await message.delete();
        } catch {}
    }, 4000);

});

};
