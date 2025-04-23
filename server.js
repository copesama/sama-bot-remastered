require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
// Add voice-related imports
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const axios = require('axios');
const express = require('express');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');
const http = require('http');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');

// Import the finance news module - update to include the handleFinanceReportCommand function
const { handleFinanceNewsCommand, initFinanceNews, handleFinanceReportCommand } = require('./commands/financeNews');

// Import the quiz generator module
const { handleQuizCommand, clearUserQuiz } = require('./commands/quizGenerator');

// Import the music generator module
const { handleMusicCommand, cleanupVoiceConnections } = require('./commands/musicGenerator');

// Import the game generator module with extended functions
const { 
  handleSingleGameCommand, 
  editGame, 
  enhanceGame, 
  setupGameRoutes, 
  generateGameLink, 
  createGameEmbed,
  handlePlayGameCommand,
  handleEditGameCommand,
  handleEnhanceGameCommand,
  handleGameEditInput
} = require('./commands/gameGenerator');

// Import the story generator module
const { 
  handleStoryCommand, 
  generateAndSendStoryWithImages,
  handleStoryPromptInput
} = require('./commands/storyGenerator');

// Import the image generator module
const { 
  handleImageCommand, 
  processImagePrompt, 
  generateImageWithAvatars,
  handleImagePromptInput
} = require('./commands/imageGenerator');

// Import the multiplayer game module
const { handleMultiplayerGameCommand } = require('./commands/multiplayerGame');

// Import the invite command module
const { handleInviteCommand } = require('./commands/inviteCommand');

// Import the help command module
const { handleHelpCommand } = require('./commands/helpCommand');

// Import the human generator module
const { 
  handleHumanGeneratorCommand, 
  handleHumanResponseInput,
  usersWaitingForHumanResponse
} = require('./commands/humanGenerator');

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

  if (message.content.startsWith('!financenews')) {
    await handleFinanceNewsCommand(message, process.env.NEWSAPI_KEY, client);
    return;
  }

  if (message.content.startsWith('!financereport')) {
    await handleFinanceReportCommand(message, client);
    return;
  }

  if (message.content.startsWith('!generatequiz')) {
    await handleQuizCommand(message);
    return;
  }

  const playGameMatch = message.content.match(/^!playgame\s+([a-zA-Z0-9_-]+)$/);
  if (playGameMatch) {
    const gameId = playGameMatch[1];
    await handlePlayGameCommand(message, gameId, GAMES_DIR, PORT, JWT_SECRET);
    return;
  }

  if (message.content.startsWith('!generatestory')) {
    const result = await handleStoryCommand(message);
    if (result) {
      const { characterUsers, loadingMessage } = result;
      usersWaitingForStoryPrompt.set(message.author.id, { characterUsers, loadingMessage });
    }
    return;
  }

  if (message.content.startsWith('!generateimage')) {
    const result = await handleImageCommand(message);
    if (result) {
      const { mentionedUsers, loadingMessage } = result;
      usersWaitingForImagePrompt.set(message.author.id, { mentionedUsers, loadingMessage });
    }
    return;
  }

  const editGameMatch = message.content.match(/^!editgame\s+([a-zA-Z0-9_-]+)$/);
  if (editGameMatch) {
    const gameId = editGameMatch[1];
    const result = await handleEditGameCommand(message, gameId, GAMES_DIR);
    if (result) {
      usersInEditMode.set(message.author.id, result);
    }
    return;
  }

  const enhanceGameMatch = message.content.match(/^!enhance\s+([a-zA-Z0-9_-]+)$/);
  if (enhanceGameMatch) {
    const gameId = enhanceGameMatch[1];
    await handleEnhanceGameCommand(message, gameId, GAMES_DIR);
    return;
  }

  if (message.content.startsWith('!generatemusic')) {
    await handleMusicCommand(message);
    return;
  }
  
  if (message.content.startsWith('!singlegame')) {
    await handleSingleGameCommand(message);
    return;
  }

  if (message.content.startsWith('!multigame')) {
    await handleMultiplayerGameCommand(message);
    return;
  }

  if (message.content.startsWith('!generatehuman')) {
    const result = await handleHumanGeneratorCommand(message);
    if (result) {
      usersWaitingForHumanResponse.set(message.author.id, result);
    }
    return;
  }

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