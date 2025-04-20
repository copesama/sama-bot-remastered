const axios = require('axios');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const { EmbedBuilder } = require('discord.js');

// Path to games directory (relative to project root)
const GAMES_DIR = path.join(__dirname, '..', 'games');

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

    const gameCode = response.data.choices[0].message.content;
    const editedHtml = extractHtmlFromResponse(gameCode);
    
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

    const gameCode = response.data.choices[0].message.content;
    const enhancedHtml = extractHtmlFromResponse(gameCode);
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, enhancedHtml);
    
    return gameId;
  } catch (error) {
    console.error('Error enhancing game:', error);
    throw error;
  }
}

// Main function to handle the !singlegame command
async function handleSingleGameCommand(message) {
  const prompt = message.content.slice('!singlegame'.length).trim();
  
  if (!prompt) {
    message.reply('Please provide a prompt for the game. Example: `!singlegame platform adventure with collectibles`');
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
        { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your game.' },
        { name: 'Share Your Game', value: 'Share the Game ID with friends so they can try your game!' },
        { name: 'Edit Your Game', value: `To modify this game, use command: \`!editgame ${gameId}\`` },
        { name: 'Auto-Enhance Your Game', value: `To automatically improve and fix bugs in your game, use command: \`!enhance ${gameId}\`` },
        { name: 'Features', value: '• Custom gameplay based on your prompt\n• Personal high scores\n• Discord profile integration' }
      )
      .setFooter({ text: 'Generated using AI • To play, use !playgame command' })
      .setTimestamp();
    
    await loadingMessage.edit({ content: 'Game created successfully!', embeds: [gameEmbed] });
  } catch (error) {
    console.error('Error:', error);
    await loadingMessage.edit('Sorry, there was an error generating your game. Please try again later.');
  }
}

module.exports = {
  handleSingleGameCommand,
  generateSinglePlayerGame,
  editGame,
  enhanceGame,
  extractHtmlFromResponse
};
