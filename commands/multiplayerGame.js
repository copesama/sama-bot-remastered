const { EmbedBuilder } = require('discord.js');
const { getPrefix } = require('./prefixCommand');

/**
 * Handle the multiplayer game command
 * @param {object} message - The Discord message object
 * @returns {Promise<void>}
 */
async function handleMultiplayerGameCommand(message) {
  // Get the server's custom prefix
  const prefix = await getPrefix(message.guild?.id);
  
  const multiplayerEmbed = new EmbedBuilder()
    .setColor('#ff9900')
    .setTitle('🎮 Multiplayer Games - Coming Soon!')
    .setDescription('Multiplayer game functionality is currently under development and will be available in a future update.')
    .addFields(
      { name: 'Available Now', value: `In the meantime, try our single-player games with \`${prefix}singlegame [prompt]\`!` },
    )
    .setFooter({ text: 'Stay tuned for updates!' })
    .setTimestamp();
  
  await message.reply({ embeds: [multiplayerEmbed] });
}

module.exports = {
  handleMultiplayerGameCommand
};
