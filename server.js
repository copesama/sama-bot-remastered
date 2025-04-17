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
const YouTube = require('youtube-sr').default;
const ytdl = require('ytdl-core');

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

// Serve static game files
app.use('/games', express.static(GAMES_DIR));
app.use(cookieParser());

// Keep track of active voice connections and players
const voiceConnections = new Map();
const audioPlayers = new Map();

// Game access with user authentication
app.get('/game/:gameId', (req, res) => {
  const gameId = req.params.gameId;
  const userToken = req.query.token;
  const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
  
  if (fs.existsSync(gamePath)) {
    // If we have a user token, verify it
    let userData = null;
    
    if (userToken) {
      try {
        userData = jwt.verify(userToken, JWT_SECRET);
        // Set cookie with user data for the game
        res.cookie('gameUserData', JSON.stringify(userData), { 
          maxAge: 3600000, // 1 hour
          httpOnly: false
        });
      } catch (err) {
        console.error('Invalid token:', err);
        // Generate a guest token if the provided token is invalid
        userData = generateGuestUserData();
        res.cookie('gameUserData', JSON.stringify(userData), { 
          maxAge: 3600000, 
          httpOnly: false 
        });
      }
    } else {
      // If no token provided, create a guest user
      userData = generateGuestUserData();
      res.cookie('gameUserData', JSON.stringify(userData), { 
        maxAge: 3600000, 
        httpOnly: false 
      });
    }
    
    res.sendFile(gamePath);
  } else {
    res.status(404).send('Game not found');
  }
});

// Helper function to generate random guest user data
function generateGuestUserData() {
  const guestId = `guest-${shortid.generate()}`;
  return {
    id: guestId,
    username: `Guest-${guestId.substring(6, 10)}`,
    avatar: `https://ui-avatars.com/api/?name=G&background=random&size=128`,
    isGuest: true
  };
}

// Function to generate a single-player game using OpenRouter API
async function generateSinglePlayerGame(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. Create a complete, playable HTML game based on the user prompt. 
            The game should be entirely self-contained in a single HTML file with embedded JavaScript and CSS.
            
            CRITICAL REQUIREMENTS:
            1. The game MUST be fully functional and error-free
            2. Use simple graphics and mechanics that work reliably in browsers
            3. Test all game logic in your response
            4. INCLUDE a clickable "Powered by Luck Off" link that opens https://luckoff.chat/ in a new tab
            5. The "Powered by Luck Off" link must be visible and properly styled in the game interface
            
            USER DATA IMPLEMENTATION:
            - Extract user data from cookie:
              const userData = JSON.parse(decodeURIComponent(document.cookie.split('; ').find(row => row.startsWith('gameUserData=')).split('=')[1]));
            - Use userData.username and userData.avatar where appropriate
            - MUST always DISPLAY the user's username and avatar (from gameUserData cookie) somewhere visible in the game interface
            
            Include comprehensive error handling and clear user feedback.
            The final game MUST be completely playable as a single-player experience.`
          },
          {
            role: 'user',
            content: `Create a browser game based on this prompt: ${prompt}. 
            
            TECHNICAL IMPLEMENTATION GUIDELINES:
            1. Focus on a SIMPLE game concept optimized for single-player
            2. Create clean HTML structure with clear element IDs
            3. Use requestAnimationFrame for smooth animation
            4. Implement basic physics if needed (keep it simple)
            5. Ensure the game initializes properly
            6. Use inlined CSS and JS for a single file solution
            
            GAME FEATURES TO INCLUDE:
            1. Clear visual representation of the player
            2. Simple UI showing score/progress and basic instructions
            3. Win/lose conditions where appropriate
            4. A footer or header with a styled "Powered by Luck Off" link to https://luckoff.chat/
            5. Always display the user's username and avatar (from gameUserData cookie) in the game interface
            
            CODE STRUCTURE:
            1. Initialize game variables first
            2. Set up event listeners for inputs
            3. Implement game loop and rendering functions
            4. Create distinct functions for each game mechanic
            5. Add thorough comments explaining critical sections
            
            ATTRIBUTION REQUIREMENT:
            - Include a nicely styled "Powered by Luck Off" link that opens https://luckoff.chat/ in a new tab
            - This attribution should be visible but not intrusive to gameplay
            
            TEST THE GAME LOGIC IN YOUR MIND STEP BY STEP BEFORE GENERATING THE CODE.`
          }
        ],
        temperature: 0.6
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
    console.error('Error generating single player game:', error);
    throw error;
  }
}

// Function to generate music using Segmind API
async function generateMusic(prompt, lyrics = null, songFileUrl = null) {
  try {
    const formData = new FormData();
    
    // Check if the prompt contains lyrics or if separate lyrics were provided
    const extractedLyrics = lyrics || prompt.includes('[verse]') ? prompt : null;
    const musicPrompt = extractedLyrics ? "Generate music for these lyrics" : prompt;
    
    // For logging purposes - store what we're sending to the API
    const requestParams = {};
    
    // Set up form data for the request - properly handle null values
    if (extractedLyrics) {
      formData.append('lyrics', extractedLyrics);
      requestParams.lyrics = extractedLyrics;
    } else {
      // Use a template for lyrics based on the prompt
      const defaultLyrics = `[verse]\n${prompt}\n[chorus]\nInspired by your imagination\nCreated just for you`;
      formData.append('lyrics', defaultLyrics);
      requestParams.lyrics = defaultLyrics;
    }
    
    // Add required parameters with proper values
    formData.append('bitrate', '256000');
    requestParams.bitrate = '256000';
    
    formData.append('sample_rate', '44100');
    requestParams.sample_rate = '44100';
    
    // Use the provided song file URL or default
    const songFile = songFileUrl || 'https://replicate.delivery/pbxt/M9zum1Y6qujy02jeigHTJzn0lBTQOemB7OkH5XmmPSC5OUoO/MiniMax-Electronic.wav';
    formData.append('song_file', songFile);
    requestParams.song_file = songFile;
    
    // Log parameters
    console.log('Sending music generation request with parameters:', requestParams);

    const response = await axios.post(
      'https://api.segmind.com/v1/minimax-music-01',
      formData,
      {
        headers: {
          'x-api-key': process.env.SEGMIND_API_KEY,
          ...formData.getHeaders()
        },
        responseType: 'arraybuffer', // Important for receiving binary audio data
        validateStatus: false, // Allow non-2xx responses for better error handling
        timeout: 120000 // 2 minute timeout for long music generation
      }
    );

    // Check if response contains an error
    if (response.status !== 200) {
      let errorMessage;
      try {
        errorMessage = Buffer.from(response.data).toString('utf8');
        console.error('Music API error response:', errorMessage);
        
        // Try to parse as JSON for better error messaging
        try {
          const jsonError = JSON.parse(errorMessage);
          if (jsonError.error) {
            errorMessage = jsonError.error;
          }
        } catch (e) {
          // If it's not valid JSON, keep the original error message
        }
        
      } catch (e) {
        errorMessage = `HTTP status ${response.status}`;
      }
      throw new Error(`Music generation failed: ${errorMessage}`);
    }

    // Generate unique ID for the music file
    const musicId = shortid.generate();
    const musicPath = path.join(MUSIC_DIR, `${musicId}.mp3`);

    // Save the music file
    fs.writeFileSync(musicPath, Buffer.from(response.data));
    console.log(`Music file saved to ${musicPath}`);

    return { musicId, musicPath };
  } catch (error) {
    console.error('Error generating music:', error);
    
    if (error.response) {
      console.error('Error status:', error.response.status);
      try {
        const errorData = Buffer.from(error.response.data).toString('utf8');
        console.error('API error response:', errorData);
      } catch (e) {
        console.error('Could not parse error response data');
      }
    }
    
    // Add more detailed error for timeouts
    if (error.code === 'ECONNABORTED') {
      throw new Error('Music generation timed out. The server took too long to respond.');
    }
    
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

// Track users who are in "edit mode"
const usersInEditMode = new Map();

// Function to edit an existing game
async function editGame(gameId, editPrompt, originalHtml) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. A user has provided an HTML game and wants to modify it according to their edit prompt.
            
            CRITICAL REQUIREMENTS:
            1. Preserve the existing game structure
            2. Make changes according to the edit prompt
            3. Ensure the game remains fully functional and error-free
            4. Return the complete HTML file with your modifications
            5. PRESERVE any existing "Powered by Luck Off" link to https://luckoff.chat/
            6. If there is no "Powered by Luck Off" link, ADD a clickable link that opens https://luckoff.chat/ in a new tab
            
            Make targeted modifications to fulfill the edit request while maintaining all existing functionality.`
          },
          {
            role: 'user',
            content: `Here is the current game HTML:\n\n${originalHtml}\n\nPlease modify this game according to this edit request: ${editPrompt}\n\nIMPORTANT: Ensure the game includes a visible "Powered by Luck Off" link to https://luckoff.chat/ that opens in a new tab.`
          }
        ],
        temperature: 0.6
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
    const editedHtml = extractHtmlFromResponse(gameCode);
    
    // Save the edited game HTML to file
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, editedHtml);
    
    return gameId;
  } catch (error) {
    console.error('Error editing game:', error);
    throw error;
  }
}

// Function to auto-enhance an existing game
async function enhanceGame(gameId, originalHtml) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer tasked with enhancing and improving an existing HTML game. 
            
            CRITICAL ENHANCEMENT REQUIREMENTS:
            1. Fix any bugs or errors in the game code
            2. Improve game mechanics and features where possible
            3. Enhance visuals and user interface
            4. Add appropriate sound effects where missing
            5. Optimize performance and responsiveness
            6. Ensure mobile compatibility if not already present
            7. Add helpful game instructions if they're missing or unclear
            8. PRESERVE any existing "Powered by Luck Off" link to https://luckoff.chat/
            9. If there is no "Powered by Luck Off" link, ADD a clickable link that opens https://luckoff.chat/ in a new tab
            
            Analyze the game thoroughly and implement enhancements that improve the player experience while maintaining the core gameplay concept.
            Return the complete enhanced HTML file.`
          },
          {
            role: 'user',
            content: `Here is an HTML game that needs enhancement:\n\n${originalHtml}\n\nPlease analyze this game, fix any bugs, and enhance its features. Keep the core game concept intact while improving the user experience, visuals, and performance. Make sure any existing "Powered by Luck Off" link is preserved or add one if it's missing.`
          }
        ],
        temperature: 0.8
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
    const enhancedHtml = extractHtmlFromResponse(gameCode);
    
    // Save the enhanced game HTML to file
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, enhancedHtml);
    
    return gameId;
  } catch (error) {
    console.error('Error enhancing game:', error);
    throw error;
  }
}

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if the user is in edit mode and waiting for an edit prompt
  if (usersInEditMode.has(message.author.id)) {
    const { gameId, loadingMessage } = usersInEditMode.get(message.author.id);
    const editPrompt = message.content;
    
    // Clear edit mode for this user
    usersInEditMode.delete(message.author.id);
    
    // Update the loading message to indicate editing has started
    await loadingMessage.edit('🔄 Editing your game... This might take a minute!');
    
    try {
      // Read the original game file
      const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        await loadingMessage.edit(`Error: Game with ID ${gameId} not found.`);
        return;
      }
      
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      // Edit the game
      await editGame(gameId, editPrompt, originalHtml);
      
      // Create an embed with the game information
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
      
      // Edit the loading message with the game ID
      await loadingMessage.edit({ content: 'Game updated successfully!', embeds: [gameEmbed] });
      
      // Delete the user's edit prompt message to keep the channel clean
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

  // Check for !playgame command
  const playGameMatch = message.content.match(/^!playgame\s+([a-zA-Z0-9_-]+)$/);
  if (playGameMatch) {
    const gameId = playGameMatch[1];
    
    // Check if the game exists
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    // Get the server URL from environment variables or default to localhost during development
    const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;

    // Create user token with Discord info for authentication
    const userToken = jwt.sign({
      id: message.author.id,
      username: message.author.username,
      avatar: message.author.displayAvatarURL({ format: 'png' })
    }, JWT_SECRET);
    
    const gameUrl = `${baseUrl}/game/${gameId}?token=${userToken}`;
    
    // Create an embed with the personalized game link
    const gameEmbed = new EmbedBuilder()
      .setColor('#00cc99')
      .setTitle('🎮 Here\'s Your Personal Game Link!')
      .setDescription(`**Game ID:** \`${gameId}\``)
      .addFields(
        { name: 'Play the game', value: `[Click here to play](${gameUrl})` },
        { name: 'About Your Link', value: 'This link is personalized for you and will display your Discord username and avatar in the game.' }
      )
      .setFooter({ text: 'Generated using AI • Link personalized for you' })
      .setTimestamp();
    
    // Send directly in the channel
    await message.reply({ content: `${message.author} Here's your game link:`, embeds: [gameEmbed] });
    
    return;
  }

  // Check for !editgame command
  const editGameMatch = message.content.match(/^!editgame\s+([a-zA-Z0-9_-]+)$/);
  if (editGameMatch) {
    const gameId = editGameMatch[1];
    
    // Check if the game exists
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply(`Game ${gameId} found. Please send your edit request in the next message.`);
    
    // Put the user in edit mode
    usersInEditMode.set(message.author.id, { gameId, loadingMessage });
    return;
  }

  // Check for !enhance command
  const enhanceGameMatch = message.content.match(/^!enhance\s+([a-zA-Z0-9_-]+)$/);
  if (enhanceGameMatch) {
    const gameId = enhanceGameMatch[1];
    
    // Check if the game exists
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply(`🔄 Enhancing game ${gameId}... This might take a minute or two!`);
    
    try {
      // Read the original game file
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      // Enhance the game
      await enhanceGame(gameId, originalHtml);
      
      // Create an embed with the game information
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
      
      // Edit the loading message with the game ID
      await loadingMessage.edit({ content: '✅ Game successfully enhanced!', embeds: [gameEmbed] });
      
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error enhancing your game. Please try again later.');
    }
    
    return;
  }

  // Check for !createmusic command
  if (message.content.startsWith('!createmusic')) {
    const fullContent = message.content.slice('!createmusic'.length).trim();
    
    // Check if there are lyrics in the format "[lyrics] ... [/lyrics]"
    let prompt, lyrics;
    const lyricsMatch = fullContent.match(/\[lyrics\]([\s\S]*?)\[\/lyrics\]/);
    
    if (lyricsMatch) {
      // Extract lyrics from the special format
      lyrics = lyricsMatch[1].trim();
      // Get the remaining text as the prompt
      prompt = fullContent.replace(/\[lyrics\][\s\S]*?\[\/lyrics\]/, '').trim();
      if (!prompt) prompt = "Generate music for these lyrics";
    } else {
      prompt = fullContent;
      lyrics = null;
    }
    
    if (!prompt) {
      message.reply('Please provide a prompt for the music. Examples:\n- `!createmusic upbeat jazz with piano solo`\n- `!createmusic [lyrics]In the silence, I hear your name\nEchoes of love that still remain[/lyrics] soft piano ballad`\n- Attach an audio file with your command to use it as a base for music generation');
      return;
    }
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      message.reply('You need to join a voice channel first!');
      return;
    }
    
    // Check if a file is attached to the message
    let songFileUrl = 'https://replicate.delivery/pbxt/M9zum1Y6qujy02jeigHTJzn0lBTQOemB7OkH5XmmPSC5OUoO/MiniMax-Electronic.wav';
    const hasAttachment = message.attachments.size > 0;
    
    if (hasAttachment) {
      const attachment = message.attachments.first();
      // Check if the attachment is an audio file
      const isAudio = attachment.contentType && attachment.contentType.startsWith('audio/');
      
      if (isAudio) {
        songFileUrl = attachment.url;
        console.log(`Using user-provided song file: ${songFileUrl}`);
      } else {
        await message.reply('The attached file is not recognized as an audio file. Using the default sample instead.');
      }
    }
    
    // Send initial response with better messaging about timing
    const loadingMessage = await message.reply(`🎵 Generating your custom music track${hasAttachment ? ' using your audio file' : ''}... This might take 1-2 minutes. Please be patient!`);
    
    try {
      // Generate the music with the song file URL (default or from attachment)
      const { musicId, musicPath } = await generateMusic(prompt, lyrics, songFileUrl);
      
      // Create an embed with the music information
      const musicEmbed = new EmbedBuilder()
        .setColor('#9966ff')
        .setTitle('🎵 Your Custom Music Track is Ready!')
        .setDescription(`**Music prompt:** ${prompt}${lyrics ? '\n\n**With custom lyrics**' : ''}${hasAttachment ? '\n\n**Using your provided audio file**' : ''}`)
        .setFooter({ text: 'Generated using AI • Now playing in your voice channel' })
        .setTimestamp();
      
      // Edit the loading message and attach the music file
      await loadingMessage.edit({ content: 'Music created successfully!', embeds: [musicEmbed], files: [musicPath] });
      
      // Join the voice channel and play the music
      try {
        // Create a voice connection
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        
        // Create an audio player
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause,
          },
        });
        
        // Create an audio resource from the generated file
        const resource = createAudioResource(musicPath);
        
        // Play the audio
        player.play(resource);
        connection.subscribe(player);
        
        // Store the connection and player for cleanup later
        voiceConnections.set(voiceChannel.guild.id, connection);
        audioPlayers.set(voiceChannel.guild.id, player);
        
        // Handle when audio finishes playing
        player.on(AudioPlayerStatus.Idle, () => {
          // Disconnect after playing
          connection.destroy();
          voiceConnections.delete(voiceChannel.guild.id);
          audioPlayers.delete(voiceChannel.guild.id);
          
          // Clean up the file
          try {
            fs.unlinkSync(musicPath);
            console.log(`Deleted music file: ${musicPath}`);
          } catch (err) {
            console.error(`Error deleting music file: ${err}`);
          }
        });
        
        // Add error handling for player errors
        player.on('error', error => {
          console.error(`Error playing audio: ${error.message}`);
          connection.destroy();
          voiceConnections.delete(voiceChannel.guild.id);
          audioPlayers.delete(voiceChannel.guild.id);
          message.channel.send('Error playing the generated music in the voice channel.');
          
          // Clean up the file
          try {
            fs.unlinkSync(musicPath);
            console.log(`Deleted music file (after error): ${musicPath}`);
          } catch (err) {
            console.error(`Error deleting music file: ${err}`);
          }
        });
        
      } catch (voiceError) {
        console.error('Error connecting to voice channel:', voiceError);
        message.channel.send('Failed to join your voice channel. Please check permissions or try again later.');
        
        // Clean up the file if voice connection fails
        setTimeout(() => {
          try {
            fs.unlinkSync(musicPath);
            console.log(`Deleted music file (voice error): ${musicPath}`);
          } catch (err) {
            console.error(`Error deleting music file: ${err}`);
          }
        }, 10000); // 10 seconds delay
      }
      
    } catch (error) {
      console.error('Error generating music:', error);
      
      // Provide more helpful error message to the user
      let errorMessage = 'Sorry, there was an error generating your music. Please try again later.';
      
      if (error.message.includes('timed out')) {
        errorMessage = 'Sorry, music generation timed out. Please try a simpler prompt or try again later.';
      } else if (error.message.includes('vocal_id null not found')) {
        errorMessage = 'Sorry, there was an issue with the music generation service. Please try a different prompt.';
      }
      
      await loadingMessage.edit(errorMessage);
    }
  }
  
  // Check for !singlegame command
  if (message.content.startsWith('!singlegame')) {
    const prompt = message.content.slice('!singlegame'.length).trim();
    
    if (!prompt) {
      message.reply('Please provide a prompt for the game. Example: `!singlegame platform adventure with collectibles`');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply('🎮 Generating your custom single-player game... This might take a minute!');
    
    try {
      // Generate the single-player game
      const gameId = await generateSinglePlayerGame(prompt);
      
      // Create an embed with just the game ID, no direct links
      const gameEmbed = new EmbedBuilder()
        .setColor('#00cc99')
        .setTitle('🎮 Your Custom Single-Player Game is Ready!')
        .setDescription(`**Game prompt:** ${prompt}`)
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your game.' },
          { name: 'Share Your Game', value: 'Share the Game ID with friends so they can try your game!' },
          { name: 'Edit Your Game', value: `To modify this game, use command: \`!editgame ${gameId}\`` },
          { name: 'Auto-Enhance Your Game', value: `To automatically improve and fix bugs in your game, use command: \`!enhance ${gameId}\`` },
          { name: 'Features', value: '• Custom gameplay based on your prompt\n• Personal high scores\n• Discord profile integration' }
        )
        .setFooter({ text: 'Generated using AI • To play, use !playgame command' })
        .setTimestamp();
      
      // Edit the loading message with the game ID
      await loadingMessage.edit({ content: 'Game created successfully!', embeds: [gameEmbed] });
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error generating your game. Please try again later.');
    }
  }

  // Check for !multigame command
  if (message.content.startsWith('!multigame')) {
    // Create an embed with information about the upcoming multiplayer feature
    const multiplayerEmbed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🎮 Multiplayer Games - Coming Soon!')
      .setDescription('Multiplayer game functionality is currently under development and will be available in a future update.')
      .addFields(
        { name: 'Available Now', value: 'In the meantime, try our single-player games with `!singlegame [prompt]`!' },
      )
      .setFooter({ text: 'Stay tuned for updates!' })
      .setTimestamp();
    
    // Send the embed
    await message.reply({ embeds: [multiplayerEmbed] });
    return;
  }

  // !outofcontext command: stream 5 random vids (5s each) from a channel URL
  if (message.content.startsWith('!outofcontext ')) {
    const url = message.content.split(' ')[1];
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('You need to join a voice channel first!');
    }
    let channelId;
    try {
      const parsed = new URL(url);
      channelId = parsed.pathname.split('/').pop();
    } catch {
      return message.reply('Invalid YouTube channel URL.');
    }
    // fetch videos
    let vids;
    try {
      vids = await YouTube.search({ channelId, type: 'video', limit: 50 });
      if (!vids.length) throw 0;
    } catch {
      return message.reply('Could not fetch videos from that channel.');
    }
    // choose 5 random
    const pick = [];
    while (pick.length < 5 && vids.length) {
      const i = Math.floor(Math.random() * vids.length);
      pick.push(vids.splice(i,1)[0]);
    }
    // connect
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);
    // sequentially play 5s clips
    for (const vid of pick) {
      const stream = ytdl(vid.url, { filter: 'audioonly' });
      const resource = createAudioResource(stream);
      player.play(resource);
      await new Promise(res => {
        const timeout = setTimeout(() => res(), 5000);
        player.once(AudioPlayerStatus.Idle, () => {
          clearTimeout(timeout);
          res();
        });
      });
    }
    // cleanup
    player.stop();
    connection.destroy();
    return message.reply('✅ Played 5 out‑of‑context clips!');
  }
});

// Add a function to handle cleaning up voice connections when the bot is stopped
process.on('SIGINT', () => {
  voiceConnections.forEach(connection => {
    connection.destroy();
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  voiceConnections.forEach(connection => {
    connection.destroy();
  });
  process.exit(0);
});

// Start the Express server and Discord bot
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Login to Discord with your app's token
client.login(process.env.DISCORD_BOT_TOKEN);