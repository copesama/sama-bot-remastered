const axios = require('axios');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const jwt = require('jsonwebtoken');
const { Game, connectToDatabase, sanitizeGameHtml } = require('../utils/mongooseUtil');
const { getPrefix } = require('./prefixCommand');

// Path to games directory (relative to project root) - kept for backwards compatibility
const GAMES_DIR = path.join(__dirname, '..', 'games');

// Function to sanitize user data to prevent XSS attacks
function sanitizeUserData(userData) {
  if (!userData) return null;
  
  // Create a copy to avoid modifying the original
  const sanitized = { ...userData };
  
  // Sanitize username - only allow alphanumeric, spaces and some special chars
  if (sanitized.username) {
    sanitized.username = sanitized.username
      .replace(/[^\w\s\-_.@]/g, '')  // Remove potentially dangerous characters
      .substring(0, 32);             // Limit length
  }
  
  // Ensure avatar URL is from trusted sources only
  if (sanitized.avatar) {
    const trustedDomains = [
      'cdn.discordapp.com',
      'i.imgur.com', 
      'ui-avatars.com',
      'media.discordapp.net'
    ];
    
    // Check if avatar URL is from a trusted domain
    const isValidAvatar = trustedDomains.some(domain => 
      sanitized.avatar.startsWith(`https://${domain}/`)
    );
    
    if (!isValidAvatar) {
      // Fall back to a default avatar if the URL is not trusted
      sanitized.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(sanitized.username?.[0] || 'U')}&background=random&size=128`;
    }
  }
  
  return sanitized;
}

// Helper function to extract HTML from API response
function extractHtmlFromResponse(response) {
  // Try to extract HTML from code blocks if present
  const htmlMatch = response.match(/```html\n([\s\S]*?)```/) || 
                    response.match(/```\n([\s\S]*?)```/) ||
                    response.match(/<html[\s\S]*?<\/html>/i);
  
  let htmlContent;
  if (htmlMatch && htmlMatch[1]) {
    htmlContent = htmlMatch[1];
  } else {
    // If no HTML tags or code blocks found, assume the entire response is HTML content
    htmlContent = `<!DOCTYPE html>
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
  
  // Check if it has the basic structure before sanitizing
  const hasHtmlStructure = /<html.*?>[\s\S]*?<\/html>/i.test(htmlContent);
  
  // If it doesn't have proper HTML structure, wrap it
  if (!hasHtmlStructure) {
    htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Generated Game</title>
  <meta charset="UTF-8">
</head>
<body>
  ${htmlContent}
</body>
</html>`;
  }
  
  // Sanitize the HTML content before returning it
  return sanitizeGameHtml(htmlContent);
}

// Function to generate a single-player game using OpenRouter API
async function generateSinglePlayerGame(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
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
    
    // Connect to MongoDB
    await connectToDatabase();
    
    // Save the game to MongoDB
    const game = new Game({
      gameId: gameId,
      html: htmlGame,
      prompt: prompt,
      isSanitized: true // Mark as sanitized
    });
    
    await game.save();
    
    // Also save to file system for backwards compatibility
    if (!fs.existsSync(GAMES_DIR)) {
      fs.mkdirSync(GAMES_DIR, { recursive: true });
    }
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, htmlGame);
    
    return gameId;
  } catch (error) {
    throw error;
  }
}

// Function to edit an existing game
async function editGame(gameId, editPrompt, originalHtml) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
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

    const gameCode = response.data.choices[0].message.content;
    const editedHtml = extractHtmlFromResponse(gameCode);
    
    // Connect to MongoDB
    await connectToDatabase();
    
    // Update the game in MongoDB
    await Game.updateOne({ gameId: gameId }, { 
      html: editedHtml,
      updatedAt: new Date()
    });
    
    // Also update in file system for backwards compatibility
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, editedHtml);
    
    return gameId;
  } catch (error) {
    throw error;
  }
}

// Function to auto-enhance an existing game
async function enhanceGame(gameId, originalHtml) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
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

    const gameCode = response.data.choices[0].message.content;
    const enhancedHtml = extractHtmlFromResponse(gameCode);
    
    // Connect to MongoDB
    await connectToDatabase();
    
    // Update the game in MongoDB
    await Game.updateOne({ gameId: gameId }, { 
      html: enhancedHtml,
      updatedAt: new Date()
    });
    
    // Also update in file system for backwards compatibility
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, enhancedHtml);
    
    return gameId;
  } catch (error) {
    throw error;
  }
}

// Main function to handle the !singlegame command
async function handleSingleGameCommand(message) {
  // Get the custom prefix for this server
  const prefix = await getPrefix(message.guild?.id);
  
  // Extract the command content (prompt) with the dynamic prefix
  const commandName = message.content.startsWith(`${prefix}singlegame`) ? `${prefix}singlegame` : `${prefix}sgame`;
  const prompt = message.content.slice(commandName.length).trim();
  
  if (!prompt) {
    message.reply(`Please provide a prompt for the game. Example: \`${prefix}singlegame platform adventure with collectibles\``);
    return;
  }
  
  const loadingMessage = await message.reply('🎮 Generating your custom single-player game... This might take a minute!');
  
  try {
    const gameId = await generateSinglePlayerGame(prompt);
    
    const gameEmbed = new EmbedBuilder()
      .setColor('#00cc99')
      .setTitle('🎮 Your Custom Single-Player Game is Ready!')
      .setDescription(`**Game prompt:** ${prompt}`)
      .addFields(
        { name: 'Game ID', value: `\`${gameId}\`` },
        { name: 'How to Play', value: `Use \`${prefix}playgame ${gameId}\` to get a personalized link to your game or click the Play button below.` },
        { name: 'Share Your Game', value: 'Share the Game ID with friends so they can try your game!' },
        { name: 'Edit Your Game', value: `To modify this game, use command: \`${prefix}editgame ${gameId}\` or click the Edit button below.` },
        { name: 'Auto-Enhance Your Game', value: `To automatically improve and fix bugs in your game, use command: \`${prefix}enhancegame ${gameId}\` or click the Enhance button below.` },
        { name: 'Features', value: '• Custom gameplay based on your prompt\n• Personal high scores\n• Discord profile integration' }
      )
      .setFooter({ text: `Generated using AI • To play, use ${prefix}playgame command or click the buttons below` })
      .setTimestamp();
    
    // Create buttons for play, edit, and enhance actions
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`play_${gameId}`)
          .setLabel('Play Game')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎮'),
        new ButtonBuilder()
          .setCustomId(`edit_${gameId}`)
          .setLabel('Edit Game')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✏️'),
        new ButtonBuilder()
          .setCustomId(`enhance_${gameId}`)
          .setLabel('Enhance Game')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✨')
      );
    
    await loadingMessage.edit({ content: 'Game created successfully!', embeds: [gameEmbed], components: [row] });
  } catch (error) {
    await loadingMessage.edit('Sorry, there was an error generating your game. Please try again later.');
  }
}

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

// Handle game route and authentication
function setupGameRoutes(app, jwtSecret) {
  app.get('/game/:gameId', async (req, res) => {
    const gameId = req.params.gameId;
    const userToken = req.query.token;
    
    try {
      // Connect to MongoDB
      await connectToDatabase();
      
      // Retrieve game from MongoDB
      const game = await Game.findOne({ gameId: gameId });
      
      if (game) {
        // If we have a user token, verify it
        let userData = null;
        
        if (userToken) {
          try {
            // Verify and sanitize user data from token
            const rawUserData = jwt.verify(userToken, jwtSecret);
            userData = sanitizeUserData(rawUserData);
            
            // Set cookie with sanitized user data
            res.cookie('gameUserData', JSON.stringify(userData), { 
              maxAge: 3600000, // 1 hour
              httpOnly: false,
              sameSite: 'Lax', // Prevents CSRF, but allows normal navigation
              secure: process.env.NODE_ENV === 'production' // Only use secure in production
            });
          } catch (err) {
            // Generate a guest token if the provided token is invalid
            userData = generateGuestUserData();
            res.cookie('gameUserData', JSON.stringify(userData), { 
              maxAge: 3600000, 
              httpOnly: false,
              sameSite: 'Lax',
              secure: process.env.NODE_ENV === 'production'
            });
          }
        } else {
          // If no token provided, create a guest user
          userData = generateGuestUserData();
          res.cookie('gameUserData', JSON.stringify(userData), { 
            maxAge: 3600000, 
            httpOnly: false,
            sameSite: 'Lax',
            secure: process.env.NODE_ENV === 'production'
          });
        }
        
        // Inject Content-Security-Policy header to prevent XSS attacks
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com https://ui-avatars.com https://i.imgur.com https://media.discordapp.net data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-src 'none';"
        );
        
        // Check if the game needs sanitization
        let gameHtml = game.html;
        if (!game.isSanitized) {
          gameHtml = sanitizeGameHtml(game.html);
          // Update the game with sanitized HTML
          await Game.updateOne({ gameId: gameId }, { 
            html: gameHtml,
            isSanitized: true 
          });
        }
        
        // Serve the game HTML directly from the database
        res.send(gameHtml);
      } else {
        // Try to fall back to file system for backwards compatibility
        const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
        if (fs.existsSync(gamePath)) {
          // If we have a user token, verify it
          let userData = null;
          
          if (userToken) {
            try {
              // Verify and sanitize user data from token
              const rawUserData = jwt.verify(userToken, jwtSecret);
              userData = sanitizeUserData(rawUserData);
              
              res.cookie('gameUserData', JSON.stringify(userData), { 
                maxAge: 3600000, 
                httpOnly: false,
                sameSite: 'Lax',
                secure: process.env.NODE_ENV === 'production'
              });
            } catch (err) {
              userData = generateGuestUserData();
              res.cookie('gameUserData', JSON.stringify(userData), { 
                maxAge: 3600000, 
                httpOnly: false,
                sameSite: 'Lax',
                secure: process.env.NODE_ENV === 'production'
              });
            }
          } else {
            userData = generateGuestUserData();
            res.cookie('gameUserData', JSON.stringify(userData), { 
              maxAge: 3600000, 
              httpOnly: false,
              sameSite: 'Lax',
              secure: process.env.NODE_ENV === 'production'
            });
          }
          
          // Inject Content-Security-Policy header
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com https://ui-avatars.com https://i.imgur.com https://media.discordapp.net data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-src 'none';"
          );
          
          // Import game from file system to MongoDB for future use
          const gameHtml = fs.readFileSync(gamePath, 'utf8');
          const newGame = new Game({
            gameId: gameId,
            html: gameHtml,
            prompt: "Imported from file system"
          });
          
          await newGame.save();
          
          res.sendFile(gamePath);
        } else {
          res.status(404).send('Game not found');
        }
      }
    } catch (error) {
      console.error("Error retrieving game:", error);
      res.status(500).send('Error retrieving the game');
    }
  });
}

// Generate a game link with user authentication
function generateGameLink(gameId, user, baseUrl, jwtSecret) {
  // Sanitize user data before creating the token
  const sanitizedUserData = {
    id: user.id,
    username: user.username.replace(/[^\w\s\-_.@]/g, '').substring(0, 32),
    avatar: user.displayAvatarURL({ format: 'png' })
  };
  
  const userToken = jwt.sign(sanitizedUserData, jwtSecret);
  
  return `${baseUrl}/game/${gameId}?token=${userToken}`;
}

// Create game embed for responding to users
async function createGameEmbed(gameId, gamePrompt, gameUrl, guildId = null) {
  // Get the prefix for the guild if available
  const prefix = await getPrefix(guildId);
  
  const embed = new EmbedBuilder()
    .setColor('#00cc99')
    .setTitle('🎮 Here\'s Your Personal Game Link!')
    .setDescription(`**Game ID:** \`${gameId}\``)
    .addFields(
      { name: 'Play the game', value: `[Click here to play](${gameUrl})` },
      { name: 'About Your Link', value: 'This link is personalized for you and will display your Discord username and avatar in the game.' }
    )
    .setFooter({ text: `Generated using AI • Link personalized for you • Use ${prefix}playgame to play other games` })
    .setTimestamp();
  
  return embed;
}

/**
 * Handle the play game command
 * @param {Object} message - Discord message object
 * @param {string} gameId - ID of the game to play
 * @param {string} gamesDir - Directory where games are stored
 * @param {number} port - Server port
 * @param {string} jwtSecret - Secret for JWT token generation
 */
async function handlePlayGameCommand(message, gameId, gamesDir, port, jwtSecret) {
  try {
    // Connect to MongoDB
    await connectToDatabase();
    
    // Check if game exists in MongoDB
    const game = await Game.findOne({ gameId: gameId });
    
    if (!game) {
      // Try file system as fallback for backwards compatibility
      const gamePath = path.join(gamesDir, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        message.reply(`Error: Game with ID ${gameId} not found.`);
        return;
      }
      
      // Import game from file system to MongoDB for future use
      const gameHtml = fs.readFileSync(gamePath, 'utf8');
      const newGame = new Game({
        gameId: gameId,
        html: gameHtml,
        prompt: "Imported from file system"
      });
      
      await newGame.save();
    }
    
    const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;

    // Generate game link
    const gameUrl = generateGameLink(gameId, message.author, baseUrl, jwtSecret);
    
    // Create game embed with guild ID for prefix
    const gameEmbed = await createGameEmbed(gameId, game?.prompt || null, gameUrl, message.guild?.id);
    
    await message.reply({ content: `${message.author} Here's your game link:`, embeds: [gameEmbed] });
  } catch (error) {
    console.error("Error handling play game command:", error);
    message.reply("Sorry, there was an error retrieving your game. Please try again later.");
  }
}

/**
 * Handle the edit game command
 * @param {Object} message - Discord message object
 * @param {string} gameId - ID of the game to edit
 * @param {string} gamesDir - Directory where games are stored
 * @returns {Object|null} - Object with gameId and loadingMessage if successful, null otherwise
 */
async function handleEditGameCommand(message, gameId, gamesDir) {
  try {
    // Connect to MongoDB
    await connectToDatabase();
    
    // Check if game exists in MongoDB
    const game = await Game.findOne({ gameId: gameId });
    
    if (!game) {
      // Try file system as fallback for backwards compatibility
      const gamePath = path.join(gamesDir, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        message.reply(`Error: Game with ID ${gameId} not found.`);
        return null;
      }
    }
    
    const loadingMessage = await message.reply(`Game ${gameId} found. Please send your edit request in the next message.`);
    
    return { gameId, loadingMessage };
  } catch (error) {
    console.error("Error handling edit game command:", error);
    message.reply("Sorry, there was an error retrieving your game. Please try again later.");
    return null;
  }
}

/**
 * Handle the enhance game command
 * @param {Object} message - Discord message object
 * @param {string} gameId - ID of the game to enhance
 * @param {string} gamesDir - Directory where games are stored
 */
async function handleEnhanceGameCommand(message, gameId, gamesDir) {
  try {
    // Get the custom prefix for this server
    const prefix = await getPrefix(message.guild?.id);
    
    // Connect to MongoDB
    await connectToDatabase();
    
    // Check if game exists in MongoDB
    const game = await Game.findOne({ gameId: gameId });
    let originalHtml;
    
    if (game) {
      originalHtml = game.html;
    } else {
      // Try file system as fallback for backwards compatibility
      const gamePath = path.join(gamesDir, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        message.reply(`Error: Game with ID ${gameId} not found.`);
        return;
      }
      originalHtml = fs.readFileSync(gamePath, 'utf8');
    }
    
    const loadingMessage = await message.reply(`🔄 Enhancing game ${gameId}... This might take a minute or two!`);
    
    try {
      await enhanceGame(gameId, originalHtml);
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#5533ff')
        .setTitle('✨ Your Game Has Been Enhanced!')
        .setDescription('Your game has been automatically improved with bug fixes and enhanced features!')
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'Enhancements Applied', value: '• Bug fixes\n• Improved game mechanics\n• Enhanced visuals\n• Performance optimization\n• Mobile compatibility improvements' },
          { name: 'How to Play', value: `Use \`${prefix}playgame ${gameId}\` to get a personalized link to your enhanced game.` }
        )
        .setFooter({ text: `Auto-enhanced using AI • To play, use ${prefix}playgame command` })
        .setTimestamp();
      
      await loadingMessage.edit({ content: '✅ Game successfully enhanced!', embeds: [gameEmbed] });
      
    } catch (error) {
      console.error("Error enhancing game:", error);
      await loadingMessage.edit('Sorry, there was an error enhancing your game. Please try again later.');
    }
  } catch (error) {
    message.reply('Sorry, there was an error retrieving your game. Please try again later.');
  }
}

/**
 * Handles a user's edit input for a game
 * @param {string} userId - The Discord user ID
 * @param {Object} editData - Data containing gameId and loadingMessage
 * @param {string} editPrompt - The user's edit prompt
 * @param {string} gamesDir - Directory where games are stored
 */
async function handleGameEditInput(userId, editData, editPrompt, gamesDir) {
  const { gameId, loadingMessage } = editData;
  const guildId = loadingMessage.guild?.id;
  const prefix = await getPrefix(guildId);
  
  await loadingMessage.edit('🔄 Editing your game... This might take a minute!');
  
  try {
    // Connect to MongoDB
    await connectToDatabase();
    
    // Check if game exists in MongoDB
    const game = await Game.findOne({ gameId: gameId });
    let originalHtml;
    
    if (game) {
      originalHtml = game.html;
    } else {
      // Try file system as fallback for backwards compatibility
      const gamePath = path.join(gamesDir, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        await loadingMessage.edit(`Error: Game with ID ${gameId} not found.`);
        return false;
      }
      originalHtml = fs.readFileSync(gamePath, 'utf8');
    }
    
    await editGame(gameId, editPrompt, originalHtml);
    
    const gameEmbed = new EmbedBuilder()
      .setColor('#9933cc')
      .setTitle('🎮 Your Game Has Been Updated!')
      .setDescription(`**Edit request:** ${editPrompt}`)
      .addFields(
        { name: 'Game ID', value: `\`${gameId}\`` },
        { name: 'How to Play', value: `Use \`${prefix}playgame ${gameId}\` to get a personalized link to your game.` }
      )
      .setFooter({ text: `Edited using AI • To play, use ${prefix}playgame command` })
      .setTimestamp();
    
    await loadingMessage.edit({ content: 'Game updated successfully!', embeds: [gameEmbed] });
    
    return true;
  } catch (error) {
    console.error("Error handling game edit:", error);
    await loadingMessage.edit('Sorry, there was an error editing your game. Please try again later.');
    return false;
  }
}

/**
 * Handles button interactions for games
 * @param {Object} interaction - Discord interaction object
 * @param {string} gamesDir - Directory where games are stored
 * @param {number} port - Server port number
 * @param {string} jwtSecret - JWT secret for token generation
 */
async function handleGameButtonInteraction(interaction, gamesDir, port, jwtSecret) {
  try {
    await interaction.deferUpdate();
    const gameId = interaction.customId.split('_')[1];
    const actionType = interaction.customId.split('_')[0];
    
    switch(actionType) {
      case 'play':
        // Handle play game button
        const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;
        const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
        
        // Generate game link for the user
        const gameUrl = generateGameLink(gameId, interaction.user, baseUrl, jwtSecret);
        
        // Create game embed with guild ID for prefix
        const gameEmbed = await createGameEmbed(gameId, null, gameUrl, interaction.guildId);
        
        // Send the game link as a follow-up message to avoid cluttering the channel
        await interaction.followUp({ 
          content: `${interaction.user} Here's your personal game link:`, 
          embeds: [gameEmbed], 
          ephemeral: true 
        });
        break;
        
      case 'edit':
        // Handle edit game button
        await connectToDatabase();
        const game = await Game.findOne({ gameId: gameId });
        
        if (!game) {
          // Check filesystem as fallback
          const gamePath = path.join(gamesDir, `${gameId}.html`);
          if (!fs.existsSync(gamePath)) {
            await interaction.followUp({ 
              content: `Error: Game with ID ${gameId} not found.`,
              ephemeral: true 
            });
            return;
          }
        }
        
        await interaction.followUp({ 
          content: `Please reply with your edit request for game ${gameId}. Be specific about what you want to change.`,
          ephemeral: true 
        });
        break;
        
      case 'enhance':
        // Handle enhance game button
        await connectToDatabase();
        
        // Check if game exists
        const gameToEnhance = await Game.findOne({ gameId: gameId });
        let originalHtml;
        
        if (gameToEnhance) {
          originalHtml = gameToEnhance.html;
        } else {
          // Try file system as fallback
          const gamePath = path.join(gamesDir, `${gameId}.html`);
          if (!fs.existsSync(gamePath)) {
            await interaction.followUp({ 
              content: `Error: Game with ID ${gameId} not found.`,
              ephemeral: true 
            });
            return;
          }
          originalHtml = fs.readFileSync(gamePath, 'utf8');
        }
        
        const enhanceMessage = await interaction.followUp({ 
          content: `🔄 Enhancing game ${gameId}... This might take a minute or two!`,
          ephemeral: false,
          fetchReply: true
        });
        
        try {
          await enhanceGame(gameId, originalHtml);
          
          // Get custom prefix
          const prefix = await getPrefix(interaction.guildId);
          
          const enhanceEmbed = new EmbedBuilder()
            .setColor('#5533ff')
            .setTitle('✨ Your Game Has Been Enhanced!')
            .setDescription('Your game has been automatically improved with bug fixes and enhanced features!')
            .addFields(
              { name: 'Game ID', value: `\`${gameId}\`` },
              { name: 'Enhancements Applied', value: '• Bug fixes\n• Improved game mechanics\n• Enhanced visuals\n• Performance optimization\n• Mobile compatibility improvements' },
              { name: 'How to Play', value: `Use \`${prefix}playgame ${gameId}\` to get a personalized link to your enhanced game.` }
            )
            .setFooter({ text: `Auto-enhanced using AI • To play, use ${prefix}playgame command` })
            .setTimestamp();
          
          // Create a button for the enhanced game
          const enhancedRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`play_${gameId}`)
                .setLabel('Play Enhanced Game')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎮')
            );
          
          await enhanceMessage.edit({ 
            content: '✅ Game successfully enhanced!', 
            embeds: [enhanceEmbed],
            components: [enhancedRow]
          });
          
        } catch (error) {
          console.error("Error enhancing game:", error);
          await enhanceMessage.edit('Sorry, there was an error enhancing your game. Please try again later.');
        }
        break;
    }
  } catch (error) {
    console.error("Error handling game button interaction:", error);
    await interaction.followUp({ 
      content: 'An error occurred while processing your request.', 
      ephemeral: true 
    });
  }
}

module.exports = {
  handleSingleGameCommand,
  generateSinglePlayerGame,
  editGame,
  enhanceGame,
  extractHtmlFromResponse,
  generateGuestUserData,
  setupGameRoutes,
  generateGameLink,
  createGameEmbed,
  handlePlayGameCommand,
  handleEditGameCommand,
  handleEnhanceGameCommand,
  handleGameEditInput,
  handleGameButtonInteraction
};
