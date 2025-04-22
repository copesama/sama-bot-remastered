const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

/**
 * Calculates the permission integer for the bot based on the required permissions
 * @returns {string} The permission integer as a string
 */
function calculatePermissions() {
  // Define the necessary permissions for the bot
  const permissions = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.ManageMessages, // For deleting prompt messages
  ];

  // Calculate the total permission value
  const permissionValue = permissions.reduce((acc, perm) => acc | perm, 0n);
  return permissionValue.toString();
}

/**
 * Handles the invite command
 * @param {Message} message - The Discord message that triggered the command
 */
async function handleInviteCommand(message) {
  try {
    const clientId = message.client.user.id;
    const permissions = calculatePermissions();
    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot`;

    const inviteEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Invite SamaAI Bot to Your Server')
      .setDescription(`Use the link below to add SamaAI Bot to your Discord server:`)
      .addFields(
        { name: 'Invite Link', value: `[Click Here](${inviteLink})` },
        { 
          name: 'Included Permissions', 
          value: 'Send Messages, View Channels, Embed Links, Attach Files, Read Message History, Connect to Voice, Speak, Use External Emojis, Manage Messages' 
        }
      )
      .setFooter({ text: 'Thank you for using SamaAI Bot!' });

    await message.reply({ embeds: [inviteEmbed] });
  } catch (error) {
    console.error('Error generating invite link:', error);
    await message.reply('Sorry, there was an error generating the invite link. Please try again later.');
  }
}

module.exports = {
  handleInviteCommand
};
