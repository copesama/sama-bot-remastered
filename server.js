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
const socketIO = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
// Add YouTube-related imports
const YouTube = require('youtube-sr').default;
const ytdl = require('ytdl-core');
const { createWriteStream } = require('fs');

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

// Create Socket.IO server
const io = socketIO(server);

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

// Track active game rooms and players
const gameRooms = {};

// Serve static game files
app.use('/games', express.static(GAMES_DIR));
app.use(cookieParser());

// Keep track of active voice connections and players
const voiceConnections = new Map();
const audioPlayers = new Map();

// Keep track of out-of-context sessions and timeout handlers
const outOfContextSessions = new Map();

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
    
    // Initialize game room if it doesn't exist
    if (!gameRooms[gameId]) {
      gameRooms[gameId] = {
        players: {},
        gameState: {}
      };
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

// Socket.IO connection handler
io.on('connection', (socket) => {
  let userId = null;
  let gameId = null;
  let userData = null;

  // Handle player joining a game
  socket.on('joinGame', (data) => {
    gameId = data.gameId;
    userId = data.userId;
    userData = data.userData;
    
    // If user data is missing or incomplete, create guest data
    if (!userData || !userData.username || !userData.avatar) {
      userData = generateGuestUserData();
    }
    
    // Add player to game room
    socket.join(gameId);
    
    if (!gameRooms[gameId]) {
      gameRooms[gameId] = {
        players: {},
        gameState: {}
      };
    }
    
    // Store player info
    gameRooms[gameId].players[userId] = {
      socket: socket.id,
      userData
    };
    
    // Send current game state to the joining player
    socket.emit('gameState', gameRooms[gameId].gameState);
    
    // Important fix: Send existing players list to the newly joined player
    const existingPlayers = Object.entries(gameRooms[gameId].players).map(([id, player]) => ({
      id,
      userData: player.userData
    }));
    
    // Send individual playerJoined events for each existing player to the new player
    existingPlayers.forEach(player => {
      if (player.id !== userId) { // Don't send the player their own info
        socket.emit('playerJoined', {
          userId: player.id,
          userData: player.userData,
          playerCount: Object.keys(gameRooms[gameId].players).length,
          players: existingPlayers
        });
      }
    });
    
    // Notify all players in the room about the new player
    io.to(gameId).emit('playerJoined', {
      userId,
      userData,
      playerCount: Object.keys(gameRooms[gameId].players).length,
      players: Object.entries(gameRooms[gameId].players).map(([id, player]) => ({
        id,
        userData: player.userData
      }))
    });
  });
  
  // Handle game actions
  socket.on('gameAction', (data) => {
    if (gameId) {
      // Broadcast the action to all players in the game room except sender
      socket.to(gameId).emit('gameAction', {
        action: data.action,
        userId,
        userData
      });
    }
  });
  
  // Update game state
  socket.on('updateGameState', (state) => {
    if (gameId && gameRooms[gameId]) {
      // Update stored game state
      gameRooms[gameId].gameState = state;
      
      // Broadcast to all players in the room except sender
      socket.to(gameId).emit('gameState', state);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    if (gameId && userId && gameRooms[gameId]) {
      // Remove player from game room
      delete gameRooms[gameId].players[userId];
      
      // Notify remaining players
      io.to(gameId).emit('playerLeft', {
        userId,
        playerCount: Object.keys(gameRooms[gameId].players).length,
        players: Object.entries(gameRooms[gameId].players).map(([id, player]) => ({
          id,
          userData: player.userData
        }))
      });
      
      // Clean up empty game rooms
      if (Object.keys(gameRooms[gameId].players).length === 0) {
        delete gameRooms[gameId];
      }
    }
  });
});

// Generate game using OpenRouter API
async function generateMultiplayerGame(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. Create a complete, playable HTML multiplayer game based on the user prompt. 
            The game should be entirely self-contained in a single HTML file with embedded JavaScript and CSS.
            
            CRITICAL REQUIREMENTS:
            1. The game MUST be fully functional and error-free
            2. Use simple graphics and mechanics that work reliably in browsers
            3. Test all game logic and multiplayer functionality thoroughly in your response
            4. PROPERLY IMPLEMENT all Socket.IO events for multiplayer functionality
            5. ENSURE the game correctly detects when other players join and leave
            
            SOCKET.IO IMPLEMENTATION (MUST BE IMPLEMENTED EXACTLY AS FOLLOWS):
            - Include Socket.IO properly: <script src="/socket.io/socket.io.js"></script>
            - Initialize connection: const socket = io();
            - Extract game ID from URL: const gameId = window.location.pathname.split('/').pop();
            - Extract user data from cookie:
              const userData = JSON.parse(decodeURIComponent(document.cookie.split('; ').find(row => row.startsWith('gameUserData=')).split('=')[1]));
            
            REQUIRED MULTIPLAYER EVENTS (DO NOT MODIFY THESE EXACT EVENT NAMES AND PARAMETERS):
            1. JOIN GAME (MUST BE CALLED IMMEDIATELY AFTER PAGE LOADS):
               socket.emit('joinGame', {
                 gameId: gameId,
                 userId: userData.id,
                 userData: userData
               });
               
            2. HANDLE OTHER PLAYERS (THESE EVENT HANDLERS MUST BE PROPERLY IMPLEMENTED):
               socket.on('playerJoined', function(data) {
                 // Add new player to game with their userData.username and userData.avatar
                 console.log('Player joined:', data.userData.username);
                 // data.players contains all current players
                 // YOU MUST implement visual feedback showing the new player has joined
               });
               
               socket.on('playerLeft', function(data) {
                 // Remove player from game
                 console.log('Player left:', data.userId);
                 // data.userId is the leaving player's ID
                 // YOU MUST implement code to remove the player from the game
               });
               
            3. SYNC GAME ACTIONS (MUST USE THESE EXACT EVENT NAMES):
               // Send player actions
               socket.emit('gameAction', {
                 action: 'actionName', // e.g., 'move', 'shoot', 'jump'
                 data: actionData // data specific to the action
               });
               
               // Receive others' actions
               socket.on('gameAction', function(data) {
                 console.log('Game action received:', data.action, 'from', data.userId);
                 // Apply other player's action to their character
                 // data.userId is the player who performed the action
                 // data.action is the action type
                 // data.userData contains the player's info
                 // YOU MUST implement code to apply the action to the correct player
               });
               
            4. SYNC GAME STATE (MUST BE IMPLEMENTED FOR CONSISTENCY):
               // Send game state updates periodically
               socket.emit('updateGameState', gameState);
               
               // Receive game state updates
               socket.on('gameState', function(state) {
                 console.log('Game state update received');
                 // Update local game state with server's state
                 // YOU MUST implement code to apply the state update
               });
               
            YOUR GAME MUST INCLUDE:
            1. A clear visual representation of each player with their username displayed
            2. A way to distinguish between different players (different colors, avatars, etc.)
            3. Debug output in the console for Socket.IO events
            4. Visual confirmation when players join or leave
            5. Properly synchronized game mechanics between all players
            
            Test each event thoroughly to ensure proper multiplayer functionality. 
            The final game MUST work correctly with multiple players.`
          },
          {
            role: 'user',
            content: `Create a browser game based on this prompt: ${prompt}. 
            
            TECHNICAL IMPLEMENTATION GUIDELINES:
            1. Start with a SIMPLE game concept that works well for multiplayer
            2. Create clean HTML structure with clear element IDs
            3. Use requestAnimationFrame for smooth animation
            4. Implement basic physics if needed (keep it simple)
            5. THOROUGHLY implement ALL Socket.IO events exactly as described
            6. Ensure the game initializes properly and handles player connections/disconnections
            7. Use inlined CSS and JS for a single file solution
            
            GAME FEATURES TO INCLUDE:
            1. Clear visual indication of each player (show usernames) using userData.username and userData.avatar
            2. Simple UI showing connected players and basic instructions
            3. Basic sound effects (optional)
            4. Win/lose conditions where appropriate
            
            CODE STRUCTURE:
            1. Initialize game variables and Socket.IO connection FIRST
            2. IMMEDIATELY emit the joinGame event after initialization
            3. Set up event listeners for inputs
            4. Implement game loop and rendering functions
            5. Create distinct functions for each game mechanic
            6. Socket.IO event handlers properly separated and organized
            7. Add thorough comments explaining critical sections
            8. VERIFY all multiplayer events are properly implemented
            
            IMPLEMENTATION VERIFICATION (do this before finalizing):
            1. Confirm joinGame event is emitted immediately after page load
            2. Verify playerJoined handler adds new players visually
            3. Verify playerLeft handler removes departed players
            4. Ensure game actions synchronize between players
            5. Test that game state updates apply correctly
            
            TEST THE GAME LOGIC IN YOUR MIND STEP BY STEP BEFORE GENERATING THE CODE.
            ENSURE ALL MULTIPLAYER FUNCTIONALITY WORKS AS EXPECTED.`
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
    
    // Validate the multiplayer implementation
    const validatedHtml = validateAndFixMultiplayerGame(htmlGame);
    
    // Generate unique ID for the game
    const gameId = shortid.generate();
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    
    // Save the game HTML to file
    fs.writeFileSync(gamePath, validatedHtml);
    
    return gameId;
  } catch (error) {
    console.error('Error generating game:', error);
    throw error;
  }
}

// Function to validate and fix multiplayer game implementation
function validateAndFixMultiplayerGame(html) {
  // Check if the essential Socket.IO functionality is included
  const missingFeatures = [];
  
  if (!html.includes('socket.emit(\'joinGame\'')) {
    missingFeatures.push('joinGame event emission');
  }
  
  if (!html.includes('socket.on(\'playerJoined\'')) {
    missingFeatures.push('playerJoined event handler');
  }
  
  if (!html.includes('socket.on(\'playerLeft\'')) {
    missingFeatures.push('playerLeft event handler');
  }
  
  if (!html.includes('socket.on(\'gameAction\'')) {
    missingFeatures.push('gameAction event handler');
  }
  
  // Add essential debugging to help track multiplayer issues
  let enhancedHtml = html;
  
  if (missingFeatures.length > 0) {
    console.warn('Generated game is missing essential multiplayer features:', missingFeatures.join(', '));
    
    // Inject Socket.IO initialization if it's missing
    if (!html.includes('const socket = io()')) {
      const scriptTag = '<script src="/socket.io/socket.io.js"></script>';
      enhancedHtml = enhancedHtml.replace('</head>', `${scriptTag}\n</head>`);
      
      const socketInit = `
      <script>
        // Automatically added Socket.IO initialization
        const socket = io();
        const gameId = window.location.pathname.split('/').pop();
        let userData;
        try {
          const userDataCookie = document.cookie.split('; ').find(row => row.startsWith('gameUserData='));
          userData = userDataCookie ? JSON.parse(decodeURIComponent(userDataCookie.split('=')[1])) : {id: 'guest-'+Math.random().toString(36).substring(2,9), username: 'Guest'};
        } catch (e) {
          console.error('Error parsing user data:', e);
          userData = {id: 'guest-'+Math.random().toString(36).substring(2,9), username: 'Guest'};
        }
        
        // Debug console logs for Socket.IO
        console.log('Socket.IO initialized', {gameId, userData});
        
        // Auto-join game room
        socket.emit('joinGame', {
          gameId: gameId,
          userId: userData.id,
          userData: userData
        });
        console.log('Emitted joinGame event');
        
        // Essential event handlers
        socket.on('playerJoined', function(data) {
          console.log('Player joined event:', data);
          alert('Player joined: ' + data.userData.username);
          // Implementation should be improved by the game
        });
        
        socket.on('playerLeft', function(data) {
          console.log('Player left event:', data);
          alert('Player left the game');
          // Implementation should be improved by the game
        });
        
        socket.on('gameAction', function(data) {
          console.log('Game action received:', data);
          // Implementation should be improved by the game
        });
        
        socket.on('gameState', function(state) {
          console.log('Game state update received:', state);
          // Implementation should be improved by the game
        });
      </script>
      `;
      enhancedHtml = enhancedHtml.replace('</body>', `${socketInit}\n</body>`);
    }
    
    // Add debugging div
    const debugDiv = `
    <div id="multiplayer-debug" style="position: fixed; bottom: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 5px; font-size: 12px; max-width: 300px; max-height: 200px; overflow: auto; z-index: 9999;">
      <h3>Multiplayer Debug</h3>
      <p>Your ID: <span id="debug-user-id"></span></p>
      <p>Players: <span id="debug-players">0</span></p>
      <div id="player-list"></div>
      <div id="debug-log" style="font-family: monospace; font-size: 10px;"></div>
    </div>
    <script>
      // Update debug info
      const debugLog = document.getElementById('debug-log');
      const debugUserId = document.getElementById('debug-user-id');
      const debugPlayers = document.getElementById('debug-players');
      const playerList = document.getElementById('player-list');
      
      if (userData && debugUserId) {
        debugUserId.textContent = userData.id;
      }
      
      function logDebug(message) {
        if (debugLog) {
          const entry = document.createElement('div');
          entry.textContent = new Date().toLocaleTimeString() + ': ' + message;
          debugLog.appendChild(entry);
          if (debugLog.children.length > 20) {
            debugLog.removeChild(debugLog.firstChild);
          }
        }
        console.log(message);
      }
      
      // Track connected players for debugging
      const connectedPlayers = new Map();
      
      // Hook into Socket.IO events for debugging
      const originalEmit = socket.emit;
      socket.emit = function() {
        logDebug('EMIT: ' + arguments[0]);
        return originalEmit.apply(this, arguments);
      };
      
      socket.on('playerJoined', function(data) {
        logDebug('JOIN: ' + data.userData.username + ' (ID: ' + data.userId + ')');
        if (debugPlayers) {
          debugPlayers.textContent = data.playerCount || data.players?.length || '?';
        }
        
        // Add player to tracking map
        if (data.userId !== userData.id) {
          connectedPlayers.set(data.userId, data.userData);
          
          // Update player list in debug window
          if (playerList) {
            playerList.innerHTML = '';
            connectedPlayers.forEach((playerData, pid) => {
              const playerEntry = document.createElement('div');
              playerEntry.textContent = playerData.username + ' (' + pid.substring(0, 5) + '...)';
              playerList.appendChild(playerEntry);
            });
          }
        }
      });
      
      socket.on('playerLeft', function(data) {
        logDebug('LEFT: Player ' + data.userId);
        if (debugPlayers) {
          debugPlayers.textContent = data.playerCount || data.players?.length || '?';
        }
        
        // Remove player from tracking
        connectedPlayers.delete(data.userId);
        
        // Update player list in debug window
        if (playerList) {
          playerList.innerHTML = '';
          connectedPlayers.forEach((playerData, pid) => {
            const playerEntry = document.createElement('div');
            playerEntry.textContent = playerData.username + ' (' + pid.substring(0, 5) + '...)';
            playerList.appendChild(playerEntry);
          });
        }
      });
    </script>
    `;
    enhancedHtml = enhancedHtml.replace('</body>', `${debugDiv}\n</body>`);
  }
  
  return enhancedHtml;
}

// Function to generate a single-player game using OpenRouter API
async function generateSinglePlayerGame(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. Create a complete, playable HTML game based on the user prompt. 
            The game should be entirely self-contained in a single HTML file with embedded JavaScript and CSS.
            
            CRITICAL REQUIREMENTS:
            1. The game MUST be fully functional and error-free
            2. Use simple graphics and mechanics that work reliably in browsers
            3. Test all game logic in your response
            
            USER DATA IMPLEMENTATION:
            - Extract user data from cookie:
              const userData = JSON.parse(decodeURIComponent(document.cookie.split('; ').find(row => row.startsWith('gameUserData=')).split('=')[1]));
            - Use userData.username and userData.avatar where appropriate
            
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
            3. Basic sound effects (optional)
            4. Win/lose conditions where appropriate
            
            CODE STRUCTURE:
            1. Initialize game variables first
            2. Set up event listeners for inputs
            3. Implement game loop and rendering functions
            4. Create distinct functions for each game mechanic
            5. Add thorough comments explaining critical sections
            
            TEST THE GAME LOGIC IN YOUR MIND STEP BY STEP BEFORE GENERATING THE CODE.`
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
    console.error('Error generating single player game:', error);
    throw error;
  }
}

// Function to generate music using Segmind API
async function generateMusic(prompt, duration = 30) {
  try {
    const response = await axios.post(
      'https://api.segmind.com/v1/meta-musicgen-medium',
      {
        prompt: prompt,
        duration: duration,
        seed: Math.floor(Math.random() * 1000) // Random seed for variety
      },
      {
        headers: {
          'x-api-key': process.env.SEGMIND_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer' // Important for receiving binary audio data
      }
    );

    // Generate unique ID for the music file
    const musicId = shortid.generate();
    const musicPath = path.join(MUSIC_DIR, `${musicId}.mp3`);

    // Save the music file
    fs.writeFileSync(musicPath, Buffer.from(response.data));

    return { musicId, musicPath };
  } catch (error) {
    console.error('Error generating music:', error);
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
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. A user has provided an HTML game and wants to modify it according to their edit prompt.
            
            CRITICAL REQUIREMENTS:
            1. Preserve the existing game structure and multiplayer functionality
            2. Make changes according to the edit prompt
            3. Ensure the game remains fully functional and error-free
            4. Return the complete HTML file with your modifications
            
            DO NOT remove any Socket.IO implementation or any existing multiplayer code.
            DO NOT break the game's core functionality.
            
            Make targeted modifications to fulfill the edit request while maintaining all existing functionality.`
          },
          {
            role: 'user',
            content: `Here is the current game HTML:\n\n${originalHtml}\n\nPlease modify this game according to this edit request: ${editPrompt}`
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

  // Check for !createmusic command
  if (message.content.startsWith('!createmusic')) {
    const prompt = message.content.slice('!createmusic'.length).trim();
    
    if (!prompt) {
      message.reply('Please provide a prompt for the music. Example: `!createmusic upbeat jazz with piano solo`');
      return;
    }
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      message.reply('You need to join a voice channel first!');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply('🎵 Generating your custom music track... This might take a minute!');
    
    try {
      // Generate the music
      const { musicId, musicPath } = await generateMusic(prompt);
      
      // Create an embed with the music information
      const musicEmbed = new EmbedBuilder()
        .setColor('#9966ff')
        .setTitle('🎵 Your Custom Music Track is Ready!')
        .setDescription(`**Music prompt:** ${prompt}`)
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
      await loadingMessage.edit('Sorry, there was an error generating your music. Please try again later.');
    }
  }
  
  // Check for !multigame command (renamed from !creategame)
  if (message.content.startsWith('!multigame')) {
    const prompt = message.content.slice('!multigame'.length).trim();
    
    if (!prompt) {
      message.reply('Please provide a prompt for the game. Example: `!multigame space shooter with aliens`');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply('🎮 Generating your custom multiplayer game... This might take a minute!');
    
    try {
      // Generate the game
      const gameId = await generateMultiplayerGame(prompt);
      
      // Create an embed with just the game ID, no direct links
      const gameEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎮 Your Custom Multiplayer Game is Ready!')
        .setDescription(`**Game prompt:** ${prompt}`)
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your game.' },
          { name: 'Invite Friends', value: 'Share the Game ID with friends so they can use the same command to join!' },
          { name: 'Edit Your Game', value: `To modify this game, use command: \`!editgame ${gameId}\`` },
          { name: 'Features', value: '• Real-time multiplayer\n• In-game chat\n• Discord profiles integration' }
        )
        .setFooter({ text: 'Generated using AI • To play, use !playgame command' })
        .setTimestamp();
      
      // Edit the loading message with just the game ID
      await loadingMessage.edit({ content: 'Game created successfully!', embeds: [gameEmbed] });
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error generating your game. Please try again later.');
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

  // Check for !outofcontext command
  if (message.content.startsWith('!outofcontext')) {
    const channelUrl = message.content.slice('!outofcontext'.length).trim();
    
    if (!channelUrl || !channelUrl.includes('youtube.com/')) {
      message.reply('Please provide a valid YouTube channel URL. Example: `!outofcontext https://www.youtube.com/channel/UCxxx` or `!outofcontext https://www.youtube.com/@channelname`');
      return;
    }
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      message.reply('You need to join a voice channel first!');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply('🎬 Searching for random videos from this channel... This might take a moment!');
    
    try {
      // Check if there's already an active session for this guild
      if (outOfContextSessions.has(message.guild.id)) {
        // Clear any existing timeout
        clearTimeout(outOfContextSessions.get(message.guild.id).timeout);
        // Stop any existing playback
        const connection = voiceConnections.get(message.guild.id);
        if (connection) {
          connection.destroy();
          voiceConnections.delete(message.guild.id);
        }
        outOfContextSessions.delete(message.guild.id);
      }
      
      // Fetch videos from the channel
      const videos = await getRandomVideosFromChannel(channelUrl, 5);
      
      if (!videos || videos.length === 0) {
        await loadingMessage.edit('Could not find any videos from this channel. Please check the URL and try again.');
        return;
      }
      
      // Create an embed with the info
      const outOfContextEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🎬 Out of Context YouTube Clips')
        .setDescription(`Playing 5-second clips from **${videos.length}** random videos`)
        .addFields(
          { name: 'Channel', value: channelUrl }
        )
        .setFooter({ text: 'Each clip will play for 5 seconds before moving to the next one' })
        .setTimestamp();
      
      await loadingMessage.edit({ content: 'Found videos! Starting playback...', embeds: [outOfContextEmbed] });
      
      // Play the first video and set up the queue for the rest
      await playOutOfContextVideos(message, videos, 0);
      
    } catch (error) {
      console.error('Error in out of context command:', error);
      await loadingMessage.edit('Sorry, there was an error processing your request. Please try again later.');
    }
  }
});

// Function to get random videos from a YouTube channel
async function getRandomVideosFromChannel(channelUrl, count) {
  try {
    console.log('Processing channel URL:', channelUrl);
    
    // Normalize the URL - remove trailing slashes and parameters
    channelUrl = channelUrl.trim().split('?')[0].replace(/\/$/, '');
    console.log('Normalized URL:', channelUrl);
    
    // Extract channel ID or handle from URL using various possible formats
    let channelId = '';
    let channelHandle = '';
    
    if (channelUrl.includes('/channel/')) {
      // Format: /channel/UC...
      channelId = channelUrl.split('/channel/')[1].split('/')[0];
      console.log('Extracted channel ID from URL:', channelId);
    } else if (channelUrl.includes('/c/')) {
      // Format: /c/ChannelName
      channelHandle = channelUrl.split('/c/')[1].split('/')[0];
      console.log('Extracted custom URL from /c/ format:', channelHandle);
    } else if (channelUrl.includes('/user/')) {
      // Format: /user/Username
      channelHandle = channelUrl.split('/user/')[1].split('/')[0];
      console.log('Extracted username from /user/ format:', channelHandle);
    } else if (channelUrl.includes('/@')) {
      // Format: /@channelname
      channelHandle = channelUrl.split('/@')[1].split('/')[0];
      console.log('Extracted handle from /@ format:', channelHandle);
    } else if (channelUrl.match(/youtube\.com\/\w+$/)) {
      // Format: youtube.com/ChannelName (without @ or other prefixes)
      channelHandle = channelUrl.split('youtube.com/')[1];
      console.log('Extracted handle from simple format:', channelHandle);
    } else {
      console.error('Unrecognized YouTube channel URL format:', channelUrl);
      return [];
    }
    
    // If we have a handle but no ID, search for the channel
    if (!channelId && channelHandle) {
      console.log('Searching for channel ID using handle:', channelHandle);
      
      // Try to find the channel by name/handle
      try {
        const searchResults = await YouTube.search(channelHandle, { type: 'channel', limit: 1 });
        
        if (searchResults && searchResults.length > 0) {
          channelId = searchResults[0].channelID;
          console.log('Found channel ID via search:', channelId);
        } else {
          console.error('No channels found for handle:', channelHandle);
          
          // Try an alternative approach - get videos from the handle directly
          try {
            console.log('Attempting to search for videos by channel name');
            const videoSearch = await YouTube.search(`${channelHandle} channel`, { limit: 50 });
            
            if (videoSearch && videoSearch.length > 0) {
              // Filter to get videos from what appears to be the same channel
              const commonChannelId = findMostCommonChannelId(videoSearch);
              
              if (commonChannelId) {
                channelId = commonChannelId;
                console.log('Found likely channel ID through video search:', channelId);
              } else {
                // If we can't determine a common channel, just return some videos
                console.log('Returning random videos from search results');
                const shuffled = [...videoSearch].sort(() => 0.5 - Math.random());
                return shuffled.slice(0, Math.min(count, shuffled.length));
              }
            }
          } catch (searchError) {
            console.error('Error in fallback video search:', searchError);
          }
        }
      } catch (searchError) {
        console.error('Error searching for channel:', searchError);
      }
    }
    
    if (!channelId) {
      console.error('Could not determine channel ID from:', channelUrl);
      return [];
    }
    
    // Get videos from the channel using the proper method
    console.log('Fetching videos for channel ID:', channelId);
    let channelVideos = [];
    
    try {
      // First approach: try to get videos using getChannelVideos
      if (typeof YouTube.getChannelVideos === 'function') {
        channelVideos = await YouTube.getChannelVideos(channelId, 50);
        console.log('Retrieved videos using getChannelVideos');
      } 
      // Second approach: try to get videos using the get method
      else if (typeof YouTube.get === 'function') {
        const channel = await YouTube.getChannel(channelId);
        if (channel && channel.videos) {
          channelVideos = channel.videos;
          console.log('Retrieved videos from channel object');
        }
      }
      
      // Third approach: search for videos from this channel
      if (!channelVideos || channelVideos.length === 0) {
        const searchQuery = `channel:${channelId}`;
        console.log('Searching for videos with query:', searchQuery);
        channelVideos = await YouTube.search(searchQuery, { limit: 50 });
        console.log('Retrieved videos using search');
      }
      
      // Fourth approach: more general search including channel name
      if (!channelVideos || channelVideos.length === 0) {
        // Try a more generic search
        const searchQuery = channelHandle || channelId;
        console.log('Performing generic search for videos:', searchQuery);
        channelVideos = await YouTube.search(searchQuery, { limit: 50 });
        
        // Filter to only include videos from our target channel if possible
        if (channelVideos.length > 0 && channelId) {
          channelVideos = channelVideos.filter(video => 
            video.channel && (video.channel.id === channelId || video.channelID === channelId)
          );
          console.log(`Filtered to ${channelVideos.length} videos from the target channel`);
        }
      }
    } catch (error) {
      console.error('Error fetching channel videos:', error);
      // If everything fails, make a generic search
      try {
        const searchTerm = channelHandle || channelId;
        console.log('Falling back to basic search for term:', searchTerm);
        channelVideos = await YouTube.search(searchTerm, { limit: 50 });
      } catch (searchError) {
        console.error('Error in final fallback search:', searchError);
      }
    }
    
    if (!channelVideos || channelVideos.length === 0) {
      console.error('No videos found for channel ID:', channelId);
      return [];
    }
    
    console.log(`Found ${channelVideos.length} videos from channel`);
    
    // Shuffle the videos and pick the requested number
    const shuffled = [...channelVideos].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, shuffled.length));
  } catch (error) {
    console.error('Error getting videos from channel:', error);
    return [];
  }
}

// Helper function to find the most common channel ID in a list of videos
function findMostCommonChannelId(videos) {
  if (!videos || videos.length === 0) return null;
  
  // Count occurrences of each channel ID
  const channelCounts = {};
  videos.forEach(video => {
    if (video.channelID) {
      channelCounts[video.channelID] = (channelCounts[video.channelID] || 0) + 1;
    }
  });
  
  // Find the channel ID with the most videos
  let mostCommonChannelId = null;
  let maxCount = 0;
  
  Object.entries(channelCounts).forEach(([channelId, count]) => {
    if (count > maxCount) {
      mostCommonChannelId = channelId;
      maxCount = count;
    }
  });
  
  return mostCommonChannelId;
}

// Function to play out-of-context videos
async function playOutOfContextVideos(message, videos, index) {
  // If we've played all videos or there are no videos, stop
  if (index >= videos.length || videos.length === 0) {
    message.channel.send('Finished playing all random clips!');
    
    // Clear from the sessions map
    if (outOfContextSessions.has(message.guild.id)) {
      clearTimeout(outOfContextSessions.get(message.guild.id).timeout);
      outOfContextSessions.delete(message.guild.id);
    }
    
    // If we're using a voice connection directly, destroy it
    const connection = voiceConnections.get(message.guild.id);
    if (connection) {
      connection.destroy();
      voiceConnections.delete(message.guild.id);
    }
    
    return;
  }
  
  try {
    const video = videos[index];
    
    // Join the voice channel if not already connected
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      message.channel.send('You need to be in a voice channel to continue playback!');
      return;
    }
    
    // Play the current video
    message.channel.send(`▶️ Clip ${index + 1}/${videos.length}: "${video.title}"`);
    
    // Get the direct YouTube URL for playback
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    console.log('Playing URL:', videoUrl);
    
    try {
      // Create a temporary file path for the audio
      const tempFilePath = path.join(MUSIC_DIR, `temp-${video.id}.mp3`);
      
      // Create or get voice connection
      let connection = voiceConnections.get(message.guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        voiceConnections.set(message.guild.id, connection);
      }
      
      // Create an audio player if needed
      let player = audioPlayers.get(message.guild.id);
      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause,
          },
        });
        audioPlayers.set(message.guild.id, player);
        connection.subscribe(player);
      }
      
      // Download a short part of the video as audio
      await new Promise((resolve, reject) => {
        try {
          console.log(`Downloading brief clip from ${videoUrl}`);
          const stream = ytdl(videoUrl, { 
            filter: 'audioonly',
            quality: 'lowestaudio',
            highWaterMark: 1<<25 // 32MB buffer to prevent throttling
          });
          
          const writeStream = createWriteStream(tempFilePath);
          
          let downloadProgress = 0;
          const maxFileSize = 1024 * 1024; // 1MB max for a short clip
          
          stream.on('data', (chunk) => {
            downloadProgress += chunk.length;
            if (downloadProgress > maxFileSize) {
              console.log('Downloaded enough audio for a clip');
              stream.destroy();
              writeStream.end();
            }
          });
          
          stream.on('end', () => {
            console.log('Download completed normally');
            writeStream.end();
          });
          
          stream.on('error', (err) => {
            console.error('Error in ytdl stream:', err);
            writeStream.end();
            reject(err);
          });
          
          writeStream.on('finish', () => {
            console.log('File write completed');
            resolve();
          });
          
          writeStream.on('error', (err) => {
            console.error('Error writing file:', err);
            reject(err);
          });
          
          // Add a timeout to force completion if it takes too long
          setTimeout(() => {
            stream.destroy();
            writeStream.end();
            console.log('Forced completion after timeout');
            resolve();
          }, 5000);
          
        } catch (error) {
          console.error('Error in download process:', error);
          reject(error);
        }
      });
      
      console.log(`Playing audio from ${tempFilePath}`);
      // Create an audio resource from the downloaded file
      const resource = createAudioResource(tempFilePath);
      
      // Play the audio
      player.play(resource);
      
      // Set up event listeners for the player
      const stopPlayback = () => {
        try {
          // Remove the event listeners
          player.removeAllListeners(AudioPlayerStatus.Idle);
          
          // Delete the temporary file
          setTimeout(() => {
            try {
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log(`Deleted temp file: ${tempFilePath}`);
              }
            } catch (err) {
              console.error(`Error deleting temp file: ${err}`);
            }
          }, 1000);
        } catch (cleanupError) {
          console.error('Error during cleanup:', cleanupError);
        }
      };
      
      // Set a timeout to play the next video after 5 seconds
      const timeout = setTimeout(() => {
        stopPlayback();
        
        // Small delay before playing the next video
        setTimeout(() => {
          playOutOfContextVideos(message, videos, index + 1);
        }, 500);
        
      }, 5000); // 5 seconds per clip
      
      // Handle when audio finishes playing naturally
      player.once(AudioPlayerStatus.Idle, () => {
        console.log('Player became idle naturally');
        clearTimeout(timeout); // Prevent the timeout from triggering
        stopPlayback();
        
        // Move to the next video
        setTimeout(() => {
          playOutOfContextVideos(message, videos, index + 1);
        }, 500);
      });
      
      // Store the session information
      outOfContextSessions.set(message.guild.id, {
        videos,
        currentIndex: index,
        timeout
      });
      
    } catch (playError) {
      console.error(`Error during direct playback of video ${index}:`, playError);
      message.channel.send(`Couldn't play clip ${index + 1}. Skipping to next...`);
      
      // Move to the next video
      setTimeout(() => {
        playOutOfContextVideos(message, videos, index + 1);
      }, 1000);
    }
    
  } catch (error) {
    console.error(`Error playing video at index ${index}:`, error);
    message.channel.send(`Error playing clip ${index + 1}. Skipping to next...`);
    
    // Move to the next video
    setTimeout(() => {
      playOutOfContextVideos(message, videos, index + 1);
    }, 1000);
  }
}

// DisTube event handlers
distube.on('error', (channel, error) => {
  if (channel) {
    channel.send(`An error occurred: ${error.message}`);
  }
  console.error('DisTube error:', error);
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