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

// Import the finance news module - update to include the initFinanceNews function
const { handleFinanceNewsCommand, initFinanceNews } = require('./commands/financeNews');

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
  createGameEmbed 
} = require('./commands/gameGenerator');

// Import the story generator module
const { handleStoryCommand, generateAndSendStoryWithImages } = require('./commands/storyGenerator');

// Import the image generator module
const { handleImageCommand, processImagePrompt, generateImageWithAvatars } = require('./commands/imageGenerator');

// Import the multiplayer game module
const { handleMultiplayerGameCommand } = require('./commands/multiplayerGame');

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
    const { gameId, loadingMessage } = usersInEditMode.get(message.author.id);
    const editPrompt = message.content;
    
    usersInEditMode.delete(message.author.id);
    
    await loadingMessage.edit('🔄 Editing your game... This might take a minute!');
    
    try {
      const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        await loadingMessage.edit(`Error: Game with ID ${gameId} not found.`);
        return;
      }
      
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      await editGame(gameId, editPrompt, originalHtml);
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#9933cc')
        .setTitle('🎮 Your Game Has Been Updated!')
        .setDescription(`**Edit request:** ${editPrompt}`)
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your game.' }
        )
        .setFooter({ text: 'Edited using AI • To play, use !playgame command' })
        .setTimestamp();
      
      await loadingMessage.edit({ content: 'Game updated successfully!', embeds: [gameEmbed] });
      
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting message:', error);
      }
      
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error editing your game. Please try again later.');
    }
    
    return;
  }

  if (usersWaitingForStoryPrompt.has(message.author.id)) {
    const { characterUsers, loadingMessage } = usersWaitingForStoryPrompt.get(message.author.id);
    const storyPrompt = message.content;
    
    usersWaitingForStoryPrompt.delete(message.author.id);
    
    await loadingMessage.edit('📝 Generating your custom story with images... This might take several minutes as I craft a detailed narrative with visuals!');
    
    try {
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting message:', error);
      }
      
      await generateAndSendStoryWithImages(message, storyPrompt, characterUsers, loadingMessage, 
        (prompt, avatarUrls) => generateImageWithAvatars(prompt, avatarUrls, IMAGES_DIR), IMAGES_DIR);
      
    } catch (error) {
      console.error('Error processing story with images:', error);
      
      let errorMessage = 'Sorry, there was an error generating your story with images. Please try again later.';
      
      if (error.message && error.message.includes('timeout')) {
        errorMessage = 'Sorry, story or image generation timed out. Please try a simpler prompt or try again later.';
      }
      
      await loadingMessage.edit(errorMessage);
    }
    
    return;
  }

  if (usersWaitingForImagePrompt.has(message.author.id)) {
    const { mentionedUsers, loadingMessage } = usersWaitingForImagePrompt.get(message.author.id);
    const imagePrompt = message.content;
    
    usersWaitingForImagePrompt.delete(message.author.id);
    
    await processImagePrompt(message, imagePrompt, mentionedUsers, loadingMessage, IMAGES_DIR);
    
    return;
  }

  if (message.content.startsWith('!financenews')) {
    await handleFinanceNewsCommand(message, process.env.NEWSAPI_KEY, client);
    return;
  }

  if (message.content.startsWith('!generatequiz')) {
    await handleQuizCommand(message);
    return;
  }

  const playGameMatch = message.content.match(/^!playgame\s+([a-zA-Z0-9_-]+)$/);
  if (playGameMatch) {
    const gameId = playGameMatch[1];
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;

    // Generate game link using the function from gameGenerator.js
    const gameUrl = generateGameLink(gameId, message.author, baseUrl, JWT_SECRET);
    
    // Create game embed using the function from gameGenerator.js
    const gameEmbed = createGameEmbed(gameId, null, gameUrl);
    
    await message.reply({ content: `${message.author} Here's your game link:`, embeds: [gameEmbed] });
    
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
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    const loadingMessage = await message.reply(`Game ${gameId} found. Please send your edit request in the next message.`);
    
    usersInEditMode.set(message.author.id, { gameId, loadingMessage });
    return;
  }

  const enhanceGameMatch = message.content.match(/^!enhance\s+([a-zA-Z0-9_-]+)$/);
  if (enhanceGameMatch) {
    const gameId = enhanceGameMatch[1];
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    const loadingMessage = await message.reply(`🔄 Enhancing game ${gameId}... This might take a minute or two!`);
    
    try {
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      await enhanceGame(gameId, originalHtml);
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#5533ff')
        .setTitle('✨ Your Game Has Been Enhanced!')
        .setDescription('Your game has been automatically improved with bug fixes and enhanced features!')
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'Enhancements Applied', value: '• Bug fixes\n• Improved game mechanics\n• Enhanced visuals\n• Performance optimization\n• Mobile compatibility improvements' },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your enhanced game.' }
        )
        .setFooter({ text: 'Auto-enhanced using AI • To play, use !playgame command' })
        .setTimestamp();
      
      await loadingMessage.edit({ content: '✅ Game successfully enhanced!', embeds: [gameEmbed] });
      
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error enhancing your game. Please try again later.');
    }
    
    return;
  }

  if (message.content.startsWith('!createmusic')) {
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