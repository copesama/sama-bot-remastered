const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');

// Store active choices games with user IDs as keys
const activeChoicesGames = new Map();

/**
 * Generates a choices-based game using OpenRouter API
 * @param {string} scenario The scenario/theme for the choices game
 * @returns {Object} Object containing game structure with branching choices
 */
async function generateChoicesGameContent(scenario) {
  try {
    console.log(`Generating choices game about: ${scenario}`);
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert interactive narrative designer. Create a branching choices game based on the scenario provided by the user.

The game should follow this JSON structure:
{
  "title": "Game title here",
  "description": "Brief game description and setting",
  "startNode": "start",
  "nodes": {
    "start": {
      "text": "Opening scenario text here...",
      "choices": [
        {"text": "Choice 1", "nextNode": "choice1_result"},
        {"text": "Choice 2", "nextNode": "choice2_result"},
        {"text": "Choice 3", "nextNode": "choice3_result"},
        {"text": "Choice 4", "nextNode": "choice4_result"}
      ]
    },
    "choice1_result": {
      "text": "Result of Choice 1...",
      "choices": [
        {"text": "Follow-up Choice 1A", "nextNode": "choice1A_result"},
        {"text": "Follow-up Choice 1B", "nextNode": "choice1B_result"},
        {"text": "Follow-up Choice 1C", "nextNode": "choice1C_result"},
        {"text": "Follow-up Choice 1D", "nextNode": "choice1D_result"}
      ]
    },
    "choice1A_result": {
      "text": "Result of follow-up Choice 1A...",
      "ending": true,
      "endingType": "success",
      "endingDescription": "Description of this successful ending"
    }
    // Additional nodes should follow the same pattern
  }
}

IMPORTANT REQUIREMENTS:
1. Every node must have exactly 4 choices UNLESS it's an ending node
2. Ending nodes must have "ending": true and an "endingType" that is one of: "success", "failure", "neutral"
3. Create at least 12 different nodes with 3-5 possible endings
4. Each path should make logical sense within the scenario context
5. Include detailed descriptions for each scenario and consequences of choices
6. The game should have interesting branching paths where prior choices affect later outcomes
7. Return ONLY valid JSON with no additional text, comments or markdown
8. Create the game in the SAME LANGUAGE as the user's prompt (e.g., Greek for Greek prompts)
9. Each ending should have an "endingDescription" that summarizes the player's journey

The output must be a valid JSON object that can be directly parsed.`
          },
          {
            role: 'user',
            content: `Create a choices-based game with the following scenario: ${scenario}`
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

    // Extract the game content from the response
    const gameContent = response.data.choices[0].message.content;
    
    // Try to extract JSON from the content
    let gameData;
    try {
      // First attempt: try to parse the entire response as JSON
      gameData = JSON.parse(gameContent);
    } catch (e) {
      // Second attempt: try to extract JSON if it's wrapped in a code block
      const jsonMatch = gameContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        gameData = JSON.parse(jsonMatch[1]);
      } else {
        // Third attempt: look for object brackets in the content
        const objectMatch = gameContent.match(/\{\s*"[\s\S]*"\s*:\s*[\s\S]*\}/);
        if (objectMatch) {
          gameData = JSON.parse(objectMatch[0]);
        } else {
          throw new Error('Failed to parse game data from API response');
        }
      }
    }
    
    // Validate the game structure
    if (!gameData.title || !gameData.description || !gameData.startNode || !gameData.nodes) {
      throw new Error('Invalid game format: Missing required fields');
    }
    
    // Validate that the start node exists
    if (!gameData.nodes[gameData.startNode]) {
      throw new Error('Invalid game format: Start node not found');
    }
    
    return gameData;
  } catch (error) {
    console.error('Error generating choices game content:', error);
    
    if (error.response) {
      console.error('API error response:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Creates a Discord embed for a game node
 * @param {Object} gameData The game data
 * @param {Object} nodeData The current node data
 * @param {string} currentNodeId The current node ID
 * @returns {EmbedBuilder} Discord embed for the node
 */
function createNodeEmbed(gameData, nodeData, currentNodeId) {
  const embed = new EmbedBuilder()
    .setColor('#4285F4')
    .setTitle(gameData.title);
  
  if (currentNodeId === gameData.startNode) {
    // Include game description only at the start
    embed.setDescription(`**${gameData.description}**\n\n${nodeData.text}`);
  } else if (nodeData.ending) {
    // This is an ending node
    let color;
    let emoji;
    
    switch (nodeData.endingType) {
      case 'success':
        color = '#4CAF50'; // Green
        emoji = '🏆';
        break;
      case 'failure':
        color = '#F44336'; // Red
        emoji = '💥';
        break;
      case 'neutral':
        color = '#FF9800'; // Orange
        emoji = '🤔';
        break;
      default:
        color = '#607D8B'; // Gray
        emoji = '📜';
    }
    
    embed.setColor(color)
      .setTitle(`${emoji} ${gameData.title} - Ending`)
      .setDescription(`${nodeData.text}\n\n**${emoji} ${nodeData.endingType.toUpperCase()} ENDING ${emoji}**\n\n${nodeData.endingDescription}`);
  } else {
    // Regular node
    embed.setDescription(nodeData.text);
  }
  
  embed.setFooter({ text: nodeData.ending ? 'Game Over • Use !choicesgame to play again' : 'Make your choice by clicking a button below' });
  
  return embed;
}

/**
 * Creates button components for the choices
 * @param {Array} choices Array of choice objects
 * @returns {ActionRowBuilder} Row of button components
 */
function createChoiceButtons(choices) {
  const row = new ActionRowBuilder();
  
  choices.forEach((choice, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`choice_${index}`)
        .setLabel(choice.text)
        .setStyle(ButtonStyle.Primary)
    );
  });
  
  return row;
}

/**
 * Main handler for the generateChoicesGame command
 * @param {Object} message Discord message object
 */
async function handleChoicesGameCommand(message) {
  // Extract the command content (scenario)
  let commandContent;
  
  if (message.content.startsWith('!generatechoicesgame')) {
    commandContent = message.content.slice('!generatechoicesgame'.length).trim();
  } else if (message.content.startsWith('!choicesgame')) {
    commandContent = message.content.slice('!choicesgame'.length).trim();
  }
  
  if (!commandContent) {
    message.reply('Please provide a scenario for the choices game. Example: `!choicesgame Business CEO` or `!generatechoicesgame Fantasy Adventure`');
    return;
  }
  
  // Check if user already has an active game
  if (activeChoicesGames.has(message.author.id)) {
    message.reply('You already have an active choices game! Please finish it before starting a new one.');
    return;
  }
  
  // Send initial loading message
  const loadingMessage = await message.reply(`🎮 Generating a choices game with the scenario: "${commandContent}"... This might take a minute!`);
  
  try {
    // Generate game content using the API
    const gameData = await generateChoicesGameContent(commandContent);
    
    // Create user game session
    const gameSession = {
      userId: message.author.id,
      scenario: commandContent,
      gameData: gameData,
      currentNode: gameData.startNode,
      history: [], // Track path taken
      message: null
    };
    
    // Add to active games
    activeChoicesGames.set(message.author.id, gameSession);
    
    // Update the loading message
    await loadingMessage.edit(`✅ Game generated! ${message.author}, get ready to play "${gameData.title}"!`);
    
    // Start the game with the first node
    await sendGameNode(message.channel, message.author.id);
    
  } catch (error) {
    console.error('Error in choices game command:', error);
    await loadingMessage.edit('Sorry, there was an error generating your choices game. Please try again later.');
  }
}

/**
 * Sends the current game node to the channel
 * @param {Object} channel Discord channel to send the node to
 * @param {string} userId The user's ID
 */
async function sendGameNode(channel, userId) {
  const gameSession = activeChoicesGames.get(userId);
  
  if (!gameSession) {
    return;
  }
  
  const gameData = gameSession.gameData;
  const currentNodeId = gameSession.currentNode;
  const nodeData = gameData.nodes[currentNodeId];
  
  if (!nodeData) {
    channel.send(`<@${userId}> Error: Could not find the next part of your story. The game has ended unexpectedly.`);
    activeChoicesGames.delete(userId);
    return;
  }
  
  // Create node embed
  const embed = createNodeEmbed(gameData, nodeData, currentNodeId);
  
  let components = [];
  
  // If this is not an ending node, add choice buttons
  if (!nodeData.ending && nodeData.choices && nodeData.choices.length > 0) {
    components = [createChoiceButtons(nodeData.choices)];
  } else {
    // This is an ending, remove from active games
    setTimeout(() => {
      activeChoicesGames.delete(userId);
    }, 1000);
  }
  
  // Send the node
  const nodeMessage = await channel.send({
    content: `<@${userId}>'s choices game:`,
    embeds: [embed],
    components: components
  });
  
  // Store reference to the message
  gameSession.message = nodeMessage;
  
  // If there are choices, create a collector for button interactions
  if (!nodeData.ending && nodeData.choices && nodeData.choices.length > 0) {
    const collector = nodeMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000, // 5 minute timeout per node
      filter: (interaction) => interaction.user.id === userId // Only the game player can interact
    });
    
    // Handle choice selection
    collector.on('collect', async (interaction) => {
      // Parse the selected choice index from the button ID
      const selectedIndex = parseInt(interaction.customId.split('_')[1]);
      const selectedChoice = nodeData.choices[selectedIndex];
      
      // Record the choice in history
      gameSession.history.push({
        node: currentNodeId,
        choice: selectedChoice.text
      });
      
      // Update the current node
      gameSession.currentNode = selectedChoice.nextNode;
      
      // Create a temporary response
      await interaction.update({
        components: [] // Remove buttons after selection
      });
      
      // Send the next node
      await sendGameNode(channel, userId);
      
      // Stop the collector
      collector.stop();
    });
    
    // Handle collector end (timeout)
    collector.on('end', async (collected, reason) => {
      if (reason === 'time' && gameSession.message && gameSession.message.id === nodeMessage.id) {
        // Timeout - user didn't make a choice in time
        const timeoutEmbed = new EmbedBuilder()
          .setColor('#607D8B')
          .setTitle(`${gameData.title} - Timed Out`)
          .setDescription("⏰ You took too long to make a choice. The game has ended.")
          .setFooter({ text: 'Game Over • Use !choicesgame to play again' });
        
        // Update message with timeout notification
        await nodeMessage.edit({
          embeds: [timeoutEmbed],
          components: []
        });
        
        // Remove from active games
        activeChoicesGames.delete(userId);
      }
    });
  }
}

/**
 * Handle a user leaving or quitting a choices game
 * @param {string} userId The user's ID
 */
function clearUserChoicesGame(userId) {
  if (activeChoicesGames.has(userId)) {
    activeChoicesGames.delete(userId);
    return true;
  }
  return false;
}

// Export the functions to be used in the main bot file
module.exports = {
  handleChoicesGameCommand,
  clearUserChoicesGame
};
