require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Events } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const cookieParser = require('cookie-parser');
const { connectToDatabase } = require('./utils/mongooseUtil');
// Import security middleware
const { securityHeaders, sanitizeCookies } = require('./utils/securityMiddleware');

// Import the finance news module - update to include the handleFinanceReportCommand function
const { handleFinanceNewsCommand, initFinanceNews, handleFinanceReportCommand } = require('./commands/financeNews');

// Import the quiz generator module
const { handleQuizCommand, clearUserQuiz } = require('./commands/quizGenerator');

// Import the choices game generator module
const { handleChoicesGameCommand, clearUserGame } = require('./commands/choicesGameGenerator');

// Import the music generator module
const { handleMusicCommand, cleanupVoiceConnections } = require('./commands/musicGenerator');

// Import the game generator module with extended functions
const { 
  handleSingleGameCommand, 
  setupGameRoutes, 
  handlePlayGameCommand,
  handleEditGameCommand,
  handleEnhanceGameCommand,
  handleGameEditInput,
  handleGameButtonInteraction
} = require('./commands/gameGenerator');

// Import the story generator module
const { 
  handleStoryCommand, 
  handleStoryPromptInput
} = require('./commands/storyGenerator');

// Import the image generator module
const { 
  handleImageCommand, 
  generateImageWithAvatars,
  handleImagePromptInput
} = require('./commands/imageGenerator');

// Import the multiplayer game module
const { handleMultiplayerGameCommand } = require('./commands/multiplayerGame');

// Import the invite command module
const { handleInviteCommand } = require('./commands/inviteCommand');

// Import the help command module
const { handleHelpCommand } = require('./commands/helpCommand');

// Import the prefix command module
const { handlePrefixCommand, getPrefix, clearPrefixCache } = require('./commands/prefixCommand');

// Import the human generator module with new word count functionality
const { 
  handleHumanGeneratorCommand, 
  handleHumanResponseInput,
  handleWordCountInput,
  usersWaitingForHumanResponse,
  usersWaitingForWordCount
} = require('./commands/humanGenerator');

// Import the rate limiter utility with new user-based functions
const { 
  checkRateLimit, 
  incrementUsage, 
  formatResetTime,
  checkUserRateLimit,
  incrementUserUsage
} = require('./utils/rateLimiter');

// Import the aitrain module
const { 
  handleAitrainCommand, 
  handleAitrainInput,
  handleAitrainRemoveCommand,
  handleAitrainRemoveInput
} = require('./commands/aiTrain');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // Add voice state intent to track voice channels
  ]
});

// Initialize Express app for serving games
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// Create HTTP server using Express app
const server = http.createServer(app);

// Use a stronger JWT_SECRET in production
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-key') {
  console.warn('WARNING: Using default JWT secret in production environment. Set JWT_SECRET environment variable.');
}

// Create games directory if it doesn't exist
const GAMES_DIR = path.join(__dirname, 'games');
if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR);
}

// Create music directory if it doesn't exist
const MUSIC_DIR = path.join(__dirname, 'music');
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR);
}

// Create images directory if it doesn't exist
const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR);
}

// Add security middleware
app.use(securityHeaders);
app.use(cookieParser());
app.use(sanitizeCookies);

// Serve static game files with added security
app.use('/games', (req, res, next) => {
  // Only allow access to .html files from games directory
  if (!req.path.endsWith('.html')) {
    return res.status(404).send('Not Found');
  }
  next();
}, express.static(GAMES_DIR));

// Set up game routes with authentication
setupGameRoutes(app, JWT_SECRET);

// Keep track of users waiting to provide image prompts
const usersWaitingForImagePrompt = new Map();

// Keep track of users waiting to provide story prompts
const usersWaitingForStoryPrompt = new Map();

// Track users who are in "edit mode"
const usersInEditMode = new Map();

// Keep track of users waiting for aitrain info and remove choice
const usersWaitingForAitrainInfo = new Map();
const usersWaitingForAitrainRemove = new Map();

// Discord bot event handlers
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Set bot status correctly
  client.user.setActivity('Generate anything. Type !help', { type: ActivityType.Playing });
  
  // Connect to MongoDB before initializing features that depend on it
  try {
    await connectToDatabase();
    console.log('MongoDB connected successfully');
    
    // Initialize modules that need database access
    initFinanceNews(client, process.env.NEWSAPI_KEY);
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Get the custom prefix for this server (default to '!' for DMs)
  const prefix = await getPrefix(message.guild?.id);

  if (usersInEditMode.has(message.author.id)) {
    const editData = usersInEditMode.get(message.author.id);
    const editPrompt = message.content;
    
    usersInEditMode.delete(message.author.id);
    
    try {
      await handleGameEditInput(message.author.id, editData, editPrompt, GAMES_DIR);
      await message.delete().catch(err => console.error('Error deleting message:', err));
    } catch (error) {
      console.error('Error in edit mode:', error);
    }
    
    return;
  }

  if (usersWaitingForStoryPrompt.has(message.author.id)) {
    const storyData = usersWaitingForStoryPrompt.get(message.author.id);
    const storyPrompt = message.content;
    
    usersWaitingForStoryPrompt.delete(message.author.id);
    
    try {
      await message.delete().catch(err => console.error('Error deleting message:', err));
      await handleStoryPromptInput(
        message.author.id, 
        storyData, 
        storyPrompt, 
        message,
        (prompt, avatarUrls) => generateImageWithAvatars(prompt, avatarUrls, IMAGES_DIR), 
        IMAGES_DIR
      );
    } catch (error) {
      console.error('Error in story prompt handling:', error);
    }
    
    return;
  }

  if (usersWaitingForImagePrompt.has(message.author.id)) {
    const imageData = usersWaitingForImagePrompt.get(message.author.id);
    const imagePrompt = message.content;
    
    usersWaitingForImagePrompt.delete(message.author.id);
    
    try {
      await handleImagePromptInput(message.author.id, imageData, imagePrompt, message, IMAGES_DIR);
    } catch (error) {
      console.error('Error in image prompt handling:', error);
    }
    
    return;
  }

  // Handle word count input for the human generator command
  if (usersWaitingForWordCount.has(message.author.id)) {
    const wordCountInput = message.content;
    
    try {
      await handleWordCountInput(message.author.id, wordCountInput, message);
    } catch (error) {
      console.error('Error in word count handling:', error);
    }
    
    return;
  }

  // Handle responses for the human generator command
  if (usersWaitingForHumanResponse.has(message.author.id)) {
    const humanData = usersWaitingForHumanResponse.get(message.author.id);
    const userResponse = message.content;
    
    usersWaitingForHumanResponse.delete(message.author.id);
    
    try {
      await handleHumanResponseInput(message.author.id, humanData, userResponse, message);
    } catch (error) {
      console.error('Error in human response handling:', error);
    }
    
    return;
  }

  // Handle aitrain waiting states
  if (usersWaitingForAitrainInfo.has(message.author.id)) {
    await handleAitrainInput(message, usersWaitingForAitrainInfo);
    return;
  }

  if (usersWaitingForAitrainRemove.has(message.author.id)) {
    await handleAitrainRemoveInput(message, usersWaitingForAitrainRemove);
    return;
  }
  
  // Check if message starts with the custom prefix for all commands
  if (!message.content.startsWith(prefix)) return;

  // Get the command and arguments
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // Handle prefix command with the custom prefix (removed special case for !prefix)
  if (command === 'prefix') {
    await handlePrefixCommand(message);
    return;
  }

  // Replace startsWith checks with command matching
  if (command === 'financenews' || command === 'fnews') {
    // Apply server rate limit
    const serverId = message.guild?.id;
    const userId = message.author.id;
    
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'financenews');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !financenews command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
    }
    
    // Apply user rate limit
    const userRateLimitResult = checkUserRateLimit(userId, 'financenews');
    if (userRateLimitResult.isLimited) {
      const embed = new EmbedBuilder()
        .setTitle('Personal Rate Limit')
        .setDescription(`You have reached your daily limit for the !financenews command.`)
        .addFields(
          { name: 'Your Daily Limit', value: `${userRateLimitResult.limit} uses per ${userRateLimitResult.resetTimeHours} hours` },
          { name: 'Next Reset', value: formatResetTime(userRateLimitResult.resetTimeMs) }
        )
        .setColor('#FF0000');
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    // Increment both server and user usage
    if (serverId) incrementUsage(serverId, 'financenews');
    incrementUserUsage(userId, 'financenews');
    
    await handleFinanceNewsCommand(message, process.env.NEWSAPI_KEY, client);
    return;
  }

  if (command === 'financereport' || command === 'freport') {
    // Apply server rate limit
    const serverId = message.guild?.id;
    const userId = message.author.id;
    
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'financereport');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !financereport command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
    }
    
    // Apply user rate limit
    const userRateLimitResult = checkUserRateLimit(userId, 'financereport');
    if (userRateLimitResult.isLimited) {
      const embed = new EmbedBuilder()
        .setTitle('Personal Rate Limit')
        .setDescription(`You have reached your daily limit for the !financereport command.`)
        .addFields(
          { name: 'Your Daily Limit', value: `${userRateLimitResult.limit} uses per ${userRateLimitResult.resetTimeHours} hours` },
          { name: 'Next Reset', value: formatResetTime(userRateLimitResult.resetTimeMs) }
        )
        .setColor('#FF0000');
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    // Increment both server and user usage
    if (serverId) incrementUsage(serverId, 'financereport');
    incrementUserUsage(userId, 'financereport');
    
    await handleFinanceReportCommand(message, client);
    return;
  }

  if (command === 'generatequiz' || command === 'quiz') {
    // Apply server rate limit
    const serverId = message.guild?.id;
    const userId = message.author.id;
    
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'quiz');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !quiz command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
    }
    
    // Apply user rate limit
    const userRateLimitResult = checkUserRateLimit(userId, 'quiz');
    if (userRateLimitResult.isLimited) {
      const embed = new EmbedBuilder()
        .setTitle('Personal Rate Limit')
        .setDescription(`You have reached your daily limit for the !quiz command.`)
        .addFields(
          { name: 'Your Daily Limit', value: `${userRateLimitResult.limit} uses per ${userRateLimitResult.resetTimeHours} hours` },
          { name: 'Next Reset', value: formatResetTime(userRateLimitResult.resetTimeMs) }
        )
        .setColor('#FF0000');
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    // Increment both server and user usage
    if (serverId) incrementUsage(serverId, 'quiz');
    incrementUserUsage(userId, 'quiz');
    
    await handleQuizCommand(message);
    return;
  }
  
  if (command === 'generatechoicesgame' || command === 'choicesgame') {
    // Apply server rate limit
    const serverId = message.guild?.id;
    const userId = message.author.id;
    
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'choicesgame');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !choicesgame command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
    }
    
    // Apply user rate limit
    const userRateLimitResult = checkUserRateLimit(userId, 'choicesgame');
    if (userRateLimitResult.isLimited) {
      const embed = new EmbedBuilder()
        .setTitle('Personal Rate Limit')
        .setDescription(`You have reached your daily limit for the !choicesgame command.`)
        .addFields(
          { name: 'Your Daily Limit', value: `${userRateLimitResult.limit} uses per ${userRateLimitResult.resetTimeHours} hours` },
          { name: 'Next Reset', value: formatResetTime(userRateLimitResult.resetTimeMs) }
        )
        .setColor('#FF0000');
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    // Increment both server and user usage
    if (serverId) incrementUsage(serverId, 'choicesgame');
    incrementUserUsage(userId, 'choicesgame');
    
    await handleChoicesGameCommand(message);
    return;
  }

  // Handle play game command with rate limit
  if (command === 'playgame' || command === 'play') {
    const gameId = args[1];
    if (!gameId) {
      await message.reply(`Please specify a game ID. Usage: ${prefix}play [gameId]`);
      return;
    }
    
    const serverId = message.guild?.id;
    const userId = message.author.id;
    
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'play');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !play command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
    }
    
    // Apply user rate limit
    const userRateLimitResult = checkUserRateLimit(userId, 'play');
    if (userRateLimitResult.isLimited) {
      const embed = new EmbedBuilder()
        .setTitle('Personal Rate Limit')
        .setDescription(`You have reached your daily limit for the !play command.`)
        .addFields(
          { name: 'Your Daily Limit', value: `${userRateLimitResult.limit} uses per ${userRateLimitResult.resetTimeHours} hours` },
          { name: 'Next Reset', value: formatResetTime(userRateLimitResult.resetTimeMs) }
        )
        .setColor('#FF0000');
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    // Increment both server and user usage
    if (serverId) incrementUsage(serverId, 'play');
    incrementUserUsage(userId, 'play');
    
    await handlePlayGameCommand(message, gameId, GAMES_DIR, PORT, JWT_SECRET);
    return;
  }

  if (command === 'generatestory' || command === 'story') {
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'story');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !story command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'story');
    }
    
    const result = await handleStoryCommand(message);
    if (result) {
      const { characterUsers, loadingMessage } = result;
      usersWaitingForStoryPrompt.set(message.author.id, { characterUsers, loadingMessage });
    }
    return;
  }

  if (command === 'generateimage' || command === 'image') {
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'image');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !image command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'image');
    }
    
    const result = await handleImageCommand(message);
    if (result) {
      const { mentionedUsers, loadingMessage } = result;
      usersWaitingForImagePrompt.set(message.author.id, { mentionedUsers, loadingMessage });
    }
    return;
  }

  // Handle edit game command with rate limit
  if (command === 'editgame' || command === 'edit') {
    const gameId = args[1];
    if (!gameId) {
      await message.reply(`Please specify a game ID. Usage: ${prefix}edit [gameId]`);
      return;
    }
    
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'edit');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !edit command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'edit');
    }
    
    const result = await handleEditGameCommand(message, gameId, GAMES_DIR);
    if (result) {
      usersInEditMode.set(message.author.id, result);
    }
    return;
  }

  // Handle enhance game command with rate limit
  if (command === 'enhancegame' || command === 'enhance') {
    const gameId = args[1];
    if (!gameId) {
      await message.reply(`Please specify a game ID. Usage: ${prefix}enhance [gameId]`);
      return;
    }
    
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'enhance');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !enhancegame command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'enhance');
    }
    
    await handleEnhanceGameCommand(message, gameId, GAMES_DIR);
    return;
  }

  if (command === 'generatemusic' || command === 'music') {
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'music');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !music command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'music');
    }
    
    await handleMusicCommand(message);
    return;
  }
  
  if (command === 'singlegame' || command === 'sgame') {
    // Check rate limit for the server
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'singlegame');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !singlegame command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      // If not limited, increment the usage and proceed
      incrementUsage(serverId, 'singlegame');
    }
    
    await handleSingleGameCommand(message);
    return;
  }

  if (command === 'multigame' || command === 'mgame') {
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'multigame');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !multigame command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'multigame');
    }
    
    await handleMultiplayerGameCommand(message);
    return;
  }

  if (command === 'generatehuman' || command === 'human') {
    // Apply rate limit
    const serverId = message.guild?.id;
    if (serverId) {
      const rateLimitResult = checkRateLimit(serverId, 'human');
      
      if (rateLimitResult.isLimited) {
        const embed = new EmbedBuilder()
          .setTitle('Command Rate Limited')
          .setDescription(`This server has reached the daily limit for the !human command.`)
          .addFields(
            { name: 'Daily Limit', value: `${rateLimitResult.limit} uses per ${rateLimitResult.resetTimeHours} hours` },
            { name: 'Next Reset', value: formatResetTime(rateLimitResult.resetTimeMs) }
          )
          .setColor('#FF0000');
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      incrementUsage(serverId, 'human');
    }
    
    const result = await handleHumanGeneratorCommand(message);
    if (result) {
      usersWaitingForHumanResponse.set(message.author.id, result);
    }
    return;
  }

  // Keep invite and help commands unrestricted with custom prefix
  if (command === 'invite') {
    await handleInviteCommand(message);
    return;
  }
  
  if (command === 'help') {
    await handleHelpCommand(message);
    return;
  }
});

// Handle button interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  
  // Check if this is a game-related button
  if (interaction.customId.startsWith('play_') || 
      interaction.customId.startsWith('edit_') || 
      interaction.customId.startsWith('enhance_')) {
    
    await handleGameButtonInteraction(interaction, GAMES_DIR, PORT, JWT_SECRET);
  }
});

// Update guildDelete event to clean up prefix cache
client.on('guildDelete', (guild) => {
  // Clear the prefix cache when the bot is removed from a server
  clearPrefixCache(guild.id);
});

// Update guildMemberRemove to handle existing functionality
client.on('guildMemberRemove', (member) => {
  clearUserQuiz(member.id);
  clearUserGame(member.id);
  usersWaitingForAitrainInfo.delete(member.id);
  usersWaitingForAitrainRemove.delete(member.id);
});

// Update guildCreate to include prefix information in welcome message
client.on('guildCreate', async (guild) => {
  try {
    // Find the first text channel we can send messages to
    const channel = guild.channels.cache.find(
      channel => channel.type === 0 && // 0 is text channel
        channel.permissionsFor(guild.members.me).has('SendMessages')
    );
    
    if (channel) {
      const welcomeEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('👋 Thanks for adding me to your server!')
        .setDescription('**IMPORTANT NOTICE:**\n\nThis bot uses AI services provided by third-party companies. For more information type !help')
        .addFields(
          { 
            name: '📝 Data Usage Disclaimer', 
            value: 'By using this bot, you acknowledge that:\n• Your prompts and data may be transmitted to these third-party services\n• The bot owner has no control over how these services process or store your data\n• The bot owner is not responsible for the content generated by these AI models'
          },
          {
            name: '🔍 Available Commands', 
            value: 'Type `!help` to see all available commands and features!'
          },
          {
            name: '⚙️ Customize Bot Prefix', 
            value: 'You can change the command prefix using `!prefix <new-prefix>` (Admin only)'
          },
          {
            name: '🔒 Looking for an end-to-end encrypted chat?', 
            value: 'Do you want to chat completely anonymously? Come to [Luck Off](https://luckoff.chat/). It\'s free and no registration/installation needed.'
          }
        )
        .setFooter({ text: 'Use responsibly and enjoy!' });
      
      await channel.send({ embeds: [welcomeEmbed] });
    }
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
});

process.on('SIGINT', () => {
  cleanupVoiceConnections();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupVoiceConnections();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);