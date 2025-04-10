require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Initialize Express app for serving games
const app = express();
const PORT = process.env.PORT || 3000;

// Create games directory if it doesn't exist
const GAMES_DIR = path.join(__dirname, 'games');
if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR);
}

// Serve static game files
app.use('/games', express.static(GAMES_DIR));

// Game generation endpoint
app.get('/game/:gameId', (req, res) => {
  const gameId = req.params.gameId;
  const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
  
  if (fs.existsSync(gamePath)) {
    res.sendFile(gamePath);
  } else {
    res.status(404).send('Game not found');
  }
});

// Generate game using OpenRouter API
async function generateGame(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-4-maverick:free',
        messages: [
          {
            role: 'system',
            content: 'You are an expert game developer. Create a complete, playable HTML game based on the user prompt. The game should be entirely self-contained in a single HTML file with embedded JavaScript and CSS. Make sure the game is fun, interactive, and follows best practices.'
          },
          {
            role: 'user',
            content: `Create a browser game based on this prompt: ${prompt}. The game should be fully playable and complete, contained in a single HTML file.`
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract HTML game code from response
    const gameCode = response.data.choices[0].message.content;
    const htmlGame = extractHtmlFromResponse(gameCode);
    
    // Generate unique ID for the game
    const gameId = shortid.generate();
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    
    // Save the game HTML to file
    fs.writeFileSync(gamePath, htmlGame);
    
    return gameId;
  } catch (error) {
    console.error('Error generating game:', error);
    throw error;
  }
}

// Helper function to extract HTML from API response
function extractHtmlFromResponse(response) {
  // Try to extract HTML from code blocks if present
  const htmlMatch = response.match(/```html\n([\s\S]*?)```/) || 
                    response.match(/```\n([\s\S]*?)```/) ||
                    response.match(/<html[\s\S]*?<\/html>/i);
  
  if (htmlMatch && htmlMatch[1]) {
    return htmlMatch[1];
  }
  
  // If no HTML tags or code blocks found, assume the entire response is HTML
  return `<!DOCTYPE html>
<html>
<head>
  <title>Generated Game</title>
  <meta charset="UTF-8">
</head>
<body>
  ${response}
</body>
</html>`;
}

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check for !creategame command
  if (message.content.startsWith('!creategame')) {
    const prompt = message.content.slice('!creategame'.length).trim();
    
    if (!prompt) {
      message.reply('Please provide a prompt for the game. Example: `!creategame space shooter with aliens`');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply('🎮 Generating your custom game... This might take a minute!');
    
    try {
      // Generate the game
      const gameId = await generateGame(prompt);
      
      // Get the server URL from environment variables or default to localhost during development
      const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
  
      // Ensure there are no double slashes in the URL
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      const gameUrl = `${baseUrl}/game/${gameId}`;
      // Create an embed with the game information
      const gameEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎮 Your Custom Game is Ready!')
        .setDescription(`**Game prompt:** ${prompt}`)
        .addFields(
          { name: 'Play your game', value: `[Click here to play](${gameUrl})` }
        )
        .setFooter({ text: 'Generated using AI' })
        .setTimestamp();
      
      // Edit the loading message with the game link
      await loadingMessage.edit({ content: 'Game created successfully!', embeds: [gameEmbed] });
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error generating your game. Please try again later.');
    }
  }
});

// Start the Express server and Discord bot
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Login to Discord with your app's token
client.login(process.env.DISCORD_BOT_TOKEN);
