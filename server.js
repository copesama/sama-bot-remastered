require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const cookieParser = require('cookie-parser');

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
  handleGameEditInput
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

// Import the human generator module with new word count functionality
const { 
  handleHumanGeneratorCommand, 
  handleHumanResponseInput,
  handleWordCountInput,
  usersWaitingForHumanResponse,
  usersWaitingForWordCount
} = require('./commands/humanGenerator');

// Import the rate limiter utility
const { checkRateLimit, incrementUsage, formatResetTime } = require('./utils/rateLimiter');

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

// Serve static game files
app.use('/games', express.static(GAMES_DIR));
app.use(cookieParser());

// Set up game routes with authentication
setupGameRoutes(app, JWT_SECRET);

// Keep track of users waiting to provide image prompts
const usersWaitingForImagePrompt = new Map();

// Keep track of users waiting to provide story prompts
const usersWaitingForStoryPrompt = new Map();

// Track users who are in "edit mode"
const usersInEditMode = new Map();

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Set bot status correctly
  client.user.setActivity('Generate anything. Type !help', { type: ActivityType.Playing });
  
  initFinanceNews(client, process.env.NEWSAPI_KEY);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

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

  if (message.content.startsWith('!financenews') || message.content.startsWith('!fnews')) {
    // Apply rate limit
    const serverId = message.guild?.id;
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
      
      incrementUsage(serverId, 'financenews');
    }
    
    await handleFinanceNewsCommand(message, process.env.NEWSAPI_KEY, client);
    return;
  }

  if (message.content.startsWith('!financereport') || message.content.startsWith('!freport')) {
    // Apply rate limit
    const serverId = message.guild?.id;
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
      
      incrementUsage(serverId, 'financereport');
    }
    
    await handleFinanceReportCommand(message, client);
    return;
  }

  if (message.content.startsWith('!generatequiz') || message.content.startsWith('!quiz')) {
    // Apply rate limit
    const serverId = message.guild?.id;
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
      
      incrementUsage(serverId, 'quiz');
    }
    
    await handleQuizCommand(message);
    return;
  }
  
  if (message.content.startsWith('!generatechoicesgame') || message.content.startsWith('!choicesgame')) {
    // Apply rate limit
    const serverId = message.guild?.id;
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
      
      incrementUsage(serverId, 'choicesgame');
    }
    
    await handleChoicesGameCommand(message);
    return;
  }

  // Handle play game command with rate limit
  const playGameMatch = message.content.match(/^!playgame\s+([a-zA-Z0-9_-]+)$/) || message.content.match(/^!play\s+([a-zA-Z0-9_-]+)$/);
  if (playGameMatch) {
    const gameId = playGameMatch[1];
    
    // Apply rate limit
    const serverId = message.guild?.id;
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
      
      incrementUsage(serverId, 'play');
    }
    
    await handlePlayGameCommand(message, gameId, GAMES_DIR, PORT, JWT_SECRET);
    return;
  }

  if (message.content.startsWith('!generatestory') || message.content.startsWith('!story')) {
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

  if (message.content.startsWith('!generateimage') || message.content.startsWith('!image')) {
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
  const editGameMatch = message.content.match(/^!editgame\s+([a-zA-Z0-9_-]+)$/) || message.content.match(/^!edit\s+([a-zA-Z0-9_-]+)$/);
  if (editGameMatch) {
    const gameId = editGameMatch[1];
    
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
  const enhanceGameMatch = message.content.match(/^!enhancegame\s+([a-zA-Z0-9_-]+)$/) || message.content.match(/^!enhance\s+([a-zA-Z0-9_-]+)$/);
  if (enhanceGameMatch) {
    const gameId = enhanceGameMatch[1];
    
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

  if (message.content.startsWith('!generatemusic') || message.content.startsWith('!music')) {
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
  
  if (message.content.startsWith('!singlegame') || message.content.startsWith('!sgame')) {
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

  if (message.content.startsWith('!multigame') || message.content.startsWith('!mgame')) {
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

  if (message.content.startsWith('!generatehuman') || message.content.startsWith('!human')) {
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

  // Keep invite and help commands unrestricted
  if (message.content.startsWith('!invite')) {
    await handleInviteCommand(message);
    return;
  }
  
  if (message.content.startsWith('!help')) {
    await handleHelpCommand(message);
    return;
  }
});

client.on('guildMemberRemove', (member) => {
  clearUserQuiz(member.id);
  clearUserGame(member.id);
});

// Add guildCreate event handler for welcome message
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