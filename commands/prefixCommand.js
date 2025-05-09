const { EmbedBuilder } = require('discord.js');
const { sanitizeHtmlForTemplate } = require('../utils/mongooseUtil');
const mongoose = require('mongoose');

// Define schema for storing custom prefixes
const prefixSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  prefix: {
    type: String,
    required: true,
    default: '!',
    maxlength: 5 // Reasonable limit for prefix length
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp when document is modified
prefixSchema.pre('updateOne', function() {
  this.set({ updatedAt: new Date() });
});

// Create or get model
const PrefixModel = mongoose.models.Prefix || mongoose.model('Prefix', prefixSchema);

// Cache prefixes in memory for faster lookup
const prefixCache = new Map();

/**
 * Get the custom prefix for a guild, with fallback to default
 * @param {string} guildId - The Discord server ID
 * @returns {Promise<string>} - The custom prefix or default '!'
 */
async function getPrefix(guildId) {
  // Return default prefix for DMs
  if (!guildId) return '!';
  
  // Check cache first
  if (prefixCache.has(guildId)) {
    return prefixCache.get(guildId);
  }
  
  try {
    // Try to get from database
    const prefixDoc = await PrefixModel.findOne({ guildId });
    
    if (prefixDoc) {
      // Store in cache and return
      prefixCache.set(guildId, prefixDoc.prefix);
      return prefixDoc.prefix;
    } else {
      // Default prefix if not found
      prefixCache.set(guildId, '!');
      return '!';
    }
  } catch (error) {
    console.error('Error fetching prefix:', error);
    return '!'; // Fallback to default
  }
}

/**
 * Set a new custom prefix for a guild
 * @param {string} guildId - The Discord server ID
 * @param {string} newPrefix - The new prefix to set
 * @returns {Promise<boolean>} - Success status
 */
async function setPrefix(guildId, newPrefix) {
  try {
    // Validate the prefix
    if (!newPrefix || newPrefix.length > 5) {
      return false;
    }
    
    // Sanitize input
    const sanitizedPrefix = sanitizeHtmlForTemplate(newPrefix);
    
    // Update or create prefix in database
    await PrefixModel.findOneAndUpdate(
      { guildId },
      { prefix: sanitizedPrefix, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    
    // Update cache
    prefixCache.set(guildId, sanitizedPrefix);
    return true;
  } catch (error) {
    console.error('Error setting prefix:', error);
    return false;
  }
}

/**
 * Clear cache entry when server is removed
 * @param {string} guildId - The Discord server ID
 */
function clearPrefixCache(guildId) {
  if (prefixCache.has(guildId)) {
    prefixCache.delete(guildId);
  }
}

/**
 * Handle the prefix command
 * @param {Object} message - The Discord message object
 * @returns {Promise<void>}
 */
async function handlePrefixCommand(message) {
  // Check if user has admin permissions
  if (!message.guild) {
    await message.reply("This command can only be used in servers.");
    return;
  }
  
  const hasPermission = message.member.permissions.has('Administrator');
  if (!hasPermission) {
    await message.reply("You need Administrator permission to change the prefix.");
    return;
  }
  
  const args = message.content.split(/\s+/);
  
  // Display current prefix if no arguments
  if (args.length === 1) {
    const currentPrefix = await getPrefix(message.guild.id);
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Server Prefix')
      .setDescription(`The current prefix for this server is: \`${currentPrefix}\``)
      .addFields(
        { name: 'How to change', value: `Use \`${currentPrefix}prefix <new-prefix>\` to change it` },
        { name: 'Example', value: `\`${currentPrefix}prefix ?\` will change the prefix to \`?\`` }
      )
      .setFooter({ text: 'Only administrators can change the prefix' });
    
    await message.channel.send({ embeds: [embed] });
    return;
  }
  
  // Attempt to change prefix
  const newPrefix = args[1];
  
  if (newPrefix.length > 5) {
    await message.reply("Prefix must be 5 characters or less.");
    return;
  }
  
  const success = await setPrefix(message.guild.id, newPrefix);
  
  if (success) {
    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Prefix Changed')
      .setDescription(`Server prefix has been updated to: \`${newPrefix}\``)
      .addFields(
        { name: 'New Usage', value: `Commands now start with \`${newPrefix}\` instead of \`!\`` },
        { name: 'Example', value: `Use \`${newPrefix}help\` to see all commands` }
      );
    
    await message.channel.send({ embeds: [embed] });
  } else {
    await message.reply("Failed to update prefix. Make sure it's 5 characters or less.");
  }
}

module.exports = {
  handlePrefixCommand,
  getPrefix,
  setPrefix,
  clearPrefixCache
};
