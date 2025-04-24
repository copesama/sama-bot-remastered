const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const axios = require('axios');

// Store active choice games with user IDs as keys
const activeChoicesGames = new Map();

/**
 * Generates a choices-based game scenario using OpenRouter API
 * @param {string} scenario The scenario for the choices game
 * @returns {Object} Object containing the game structure with branching paths
 */
async function generateChoicesGameContent(scenario) {
  try {
    console.log(`Generating choices game for scenario: ${scenario}`);
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert interactive choices game creator. Create an engaging branching narrative game based on the scenario provided by the user.

The game should follow this exact JSON format:
{
  "title": "Title of the game",
  "description": "Brief introduction to the scenario",
  "startNode": "start",
  "nodes": {
    "start": {
      "description": "Detailed situation description",
      "question": "What will you do?",
      "choices": [
        {"text": "Option A", "nextNode": "nodeA", "buttonStyle": "PRIMARY"},
        {"text": "Option B", "nextNode": "nodeB", "buttonStyle": "PRIMARY"},
        {"text": "Option C", "nextNode": "nodeC", "buttonStyle": "PRIMARY"},
        {"text": "Option D", "nextNode": "nodeD", "buttonStyle": "PRIMARY"}
      ]
    },
    "nodeA": {
      "description": "Result of choosing Option A",
      "question": "Now what will you do?",
      "choices": [
        {"text": "Option A1", "nextNode": "nodeA1", "buttonStyle": "PRIMARY"},
        {"text": "Option A2", "nextNode": "nodeA2", "buttonStyle": "PRIMARY"}
      ]
    },
    // Continue with more nodes...
    "ending1": {
      "description": "A detailed ending scenario",
      "isEnding": true,
      "endingType": "good",
      "endingTitle": "Success!"
    },
    "ending2": {
      "description": "Another ending scenario",
      "isEnding": true,
      "endingType": "bad",
      "endingTitle": "Failure!"
    }
  }
}

IMPORTANT REQUIREMENTS:
1. Create at least 8-10 different nodes with branching paths
2. Create at least 4 different possible endings (combination of good/neutral/bad outcomes)
3. Each node should have 2-4 choices (except ending nodes)
4. Button styles can be: "PRIMARY", "SECONDARY", "SUCCESS", "DANGER"
5. Make sure all nextNode references point to valid nodes
6. Ensure choices create meaningful branching narratives where previous decisions matter
7. The game should relate directly to the scenario the user provides
8. Make the narrative engaging, realistic and immersive
9. Ending nodes must have "isEnding" set to true and should include "endingType" (good/neutral/bad) and "endingTitle"
10. Return ONLY valid JSON with no additional text, comments or markdown

The output must be a valid JSON object that can be directly parsed.`
          },
          {
            role: 'user',
            content: `Create a choices-based interactive game about the following scenario: ${scenario}`
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
    
    // Try to extract JSON from the content (in case it's wrapped in markdown or other text)
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
    
    // Validate the game data format
    if (!gameData.title || !gameData.description || !gameData.startNode || !gameData.nodes) {
      throw new Error('Invalid game format: Missing required fields');
    }
    
    // Validate that the start node exists
    if (!gameData.nodes[gameData.startNode]) {
      throw new Error('Invalid game format: Start node not found');
    }
    
    // Validate each node has the required properties
    Object.keys(gameData.nodes).forEach(nodeId => {
      const node = gameData.nodes[nodeId];
      
      if (!node.description) {
        throw new Error(`Node ${nodeId} is missing a description`);
      }
      
      // If not an ending node, it needs choices
      if (!node.isEnding && (!node.choices || !Array.isArray(node.choices) || node.choices.length === 0)) {
        throw new Error(`Node ${nodeId} is not an ending but has no choices`);
      }
      
      // If it's an ending node, check for ending properties
      if (node.isEnding && (!node.endingType || !node.endingTitle)) {
        throw new Error(`Ending node ${nodeId} is missing ending properties`);
      }
      
      // Check that each choice points to a valid node
      if (node.choices) {
        node.choices.forEach((choice, index) => {
          if (!choice.text || !choice.nextNode) {
            throw new Error(`Choice ${index} in node ${nodeId} is missing required properties`);
          }
          
          if (!gameData.nodes[choice.nextNode]) {
            throw new Error(`Choice ${index} in node ${nodeId} points to non-existent node: ${choice.nextNode}`);
          }
          
          // Set default button style if not specified
          if (!choice.buttonStyle) {
            choice.buttonStyle = "PRIMARY";
          }
        });
      }
    });
    
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
 * Truncates a string to a maximum length and adds ellipsis if needed
 * @param {string} text The text to truncate
 * @param {number} maxLength Maximum length allowed
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 75) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Creates button components for choices
 * @param {Array} choices The choices for the current node
 * @param {string} nodeId The ID of the current node
 * @returns {Array} Rows of button components (max 5 buttons per row)
 */
function createChoiceButtons(choices, nodeId) {
  const rows = [];
  
  // Create a new row for every 5 buttons (Discord maximum)
  for (let i = 0; i < choices.length; i += 5) {
    const row = new ActionRowBuilder();
    
    // Add up to 5 buttons to this row
    const rowChoices = choices.slice(i, i + 5);
    rowChoices.forEach((choice, index) => {
      // Convert button style string to ButtonStyle enum
      let buttonStyle = ButtonStyle.Primary;
      switch (choice.buttonStyle.toUpperCase()) {
        case 'SECONDARY':
          buttonStyle = ButtonStyle.Secondary;
          break;
        case 'SUCCESS':
          buttonStyle = ButtonStyle.Success;
          break;
        case 'DANGER':
          buttonStyle = ButtonStyle.Danger;
          break;
      }
      
      // Truncate choice text to stay under Discord's limit (80 chars)
      const truncatedLabel = truncateText(choice.text);
      
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`choice_${nodeId}_${i + index}`)
          .setLabel(truncatedLabel)
          .setStyle(buttonStyle)
      );
    });
    
    rows.push(row);
  }
  
  return rows;
}

/**
 * Creates a Discord embed for a game node
 * @param {Object} gameData The full game data
 * @param {string} nodeId The current node ID
 * @param {Object} node The node data
 * @returns {EmbedBuilder} Discord embed for the node
 */
function createNodeEmbed(gameData, nodeId, node) {
  const embed = new EmbedBuilder()
    .setColor('#4285F4')
    .setTitle(gameData.title);
  
  if (node.isEnding) {
    // This is an ending node
    let color;
    
    switch (node.endingType.toLowerCase()) {
      case 'good':
        color = '#4CAF50'; // Green
        break;
      case 'neutral':
        color = '#FFC107'; // Amber
        break;
      case 'bad':
        color = '#F44336'; // Red
        break;
      default:
        color = '#9C27B0'; // Purple for special endings
    }
    
    embed
      .setColor(color)
      .setTitle(`${gameData.title} - ${node.endingTitle}`)
      .setDescription(node.description)
      .setFooter({ text: `Ending: ${node.endingTitle}` });
      
  } else {
    // Regular node
    embed
      .setDescription(`${node.description}\n\n**${node.question || 'What will you do?'}**`)
      .setFooter({ text: `Make your choice below` });
  }
  
  return embed;
}

/**
 * Sends the current game node to the user
 * @param {Object} channel Discord channel to send the node to
 * @param {string} userId The user's ID
 */
async function sendGameNode(channel, userId) {
  const gameSession = activeChoicesGames.get(userId);
  
  if (!gameSession) {
    return;
  }
  
  const { gameData, currentNodeId, history } = gameSession;
  const currentNode = gameData.nodes[currentNodeId];
  
  // Create node embed
  const embed = createNodeEmbed(gameData, currentNodeId, currentNode);
  
  // Create button rows if this is not an ending
  const componentRows = currentNode.isEnding ? [] : createChoiceButtons(currentNode.choices, currentNodeId);
  
  // Include a "game summary" button for ending nodes
  if (currentNode.isEnding) {
    const summaryRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`summary_${userId}`)
          .setLabel('Show Journey Summary')
          .setStyle(ButtonStyle.Primary)
      );
    
    componentRows.push(summaryRow);
  }
  
  // Send the node
  const nodeMessage = await channel.send({
    content: currentNode.isEnding ? `<@${userId}> Your journey has reached an end!` : `<@${userId}> Your journey continues...`,
    embeds: [embed],
    components: componentRows
  });
  
  // Store reference to the message
  gameSession.message = nodeMessage;
  
  // If this is not an ending, create collector for choices
  if (!currentNode.isEnding) {
    // Create a collector for button interactions
    const collector = nodeMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000, // 5 minute timeout per node
      filter: (interaction) => interaction.user.id === userId && interaction.customId.startsWith('choice_')
    });
    
    // Handle choice selection
    collector.on('collect', async (interaction) => {
      try {
        // Parse the choice index from the custom ID
        const parts = interaction.customId.split('_');
        if (parts.length < 3) {
          console.error('Invalid choice custom ID format:', interaction.customId);
          await interaction.reply({ 
            content: 'Sorry, there was an error processing your choice. Please try again.',
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        
        const choiceIndex = parseInt(parts[2]);
        
        // Validate the choice index is valid
        if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= currentNode.choices.length) {
          console.error(`Invalid choice index: ${choiceIndex}, max: ${currentNode.choices.length - 1}`);
          await interaction.reply({ 
            content: 'Sorry, there was an error processing your choice. Please try again.',
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        
        // Get the selected choice and next node
        const selectedChoice = currentNode.choices[choiceIndex];
        if (!selectedChoice || !selectedChoice.text || !selectedChoice.nextNode) {
          console.error(`Invalid choice data at index ${choiceIndex}:`, selectedChoice);
          await interaction.reply({ 
            content: 'Sorry, there was an error processing your choice. Please try again.',
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        
        // Record this choice in history
        gameSession.history.push({
          nodeId: currentNodeId,
          choice: selectedChoice.text,
          description: currentNode.description,
          question: currentNode.question || 'What will you do?'
        });
        
        // Update current node
        gameSession.currentNodeId = selectedChoice.nextNode;
        
        // Acknowledge the interaction
        await interaction.deferUpdate();
        
        // Send the next node
        sendGameNode(channel, userId);
        
        // Stop the collector
        collector.stop();
      } catch (error) {
        console.error('Error handling choice selection:', error);
        try {
          await interaction.reply({ 
            content: 'Sorry, there was an error processing your choice. Please try again.',
            flags: MessageFlags.Ephemeral 
          });
        } catch (replyError) {
          console.error('Error sending error reply:', replyError);
        }
      }
    });
    
    // Handle collector end (timeout)
    collector.on('end', async (collected, reason) => {
      if (reason === 'time' && gameSession.message && gameSession.message.id === nodeMessage.id) {
        // Game timed out - disable buttons
        const disabledRows = componentRows.map(row => {
          const newRow = new ActionRowBuilder();
          row.components.forEach(button => {
            newRow.addComponents(
              ButtonBuilder.from(button)
                .setDisabled(true)
            );
          });
          return newRow;
        });
        
        const timeoutEmbed = new EmbedBuilder()
          .setColor('#607D8B')
          .setTitle(`${gameData.title} - Timed Out`)
          .setDescription(`Your choices game has timed out due to inactivity.\n\nUse \`!generatechoicesgame [scenario]\` to start a new game!`)
          .setFooter({ text: 'Game ended due to inactivity' });
        
        await nodeMessage.edit({
          embeds: [timeoutEmbed],
          components: disabledRows
        });
        
        // Remove from active games
        activeChoicesGames.delete(userId);
      }
    });
  } else {
    // This is an ending node
    // Create collector for summary button
    const collector = nodeMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000, // 5 minute timeout
      filter: (interaction) => interaction.user.id === userId && interaction.customId === `summary_${userId}`
    });
    
    collector.on('collect', async (interaction) => {
      // Create summary embed
      const summaryEmbed = createSummaryEmbed(gameSession);
      await interaction.reply({
        embeds: [summaryEmbed],
        flags: MessageFlags.Ephemeral
      });
    });
    
    // Remove from active games after sending ending
    setTimeout(() => {
      activeChoicesGames.delete(userId);
    }, 300000); // Clean up after 5 minutes for ending nodes
  }
}

/**
 * Creates a summary embed of the user's journey
 * @param {Object} gameSession The user's game session data
 * @returns {EmbedBuilder} Discord embed with the summary
 */
function createSummaryEmbed(gameSession) {
  const { gameData, history, currentNodeId } = gameSession;
  const currentNode = gameData.nodes[currentNodeId];
  
  // Get color based on ending type
  let color = '#4285F4'; // Default blue
  if (currentNode.isEnding) {
    switch (currentNode.endingType.toLowerCase()) {
      case 'good':
        color = '#4CAF50'; // Green
        break;
      case 'neutral':
        color = '#FFC107'; // Amber
        break;
      case 'bad':
        color = '#F44336'; // Red
        break;
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Journey Summary: ${gameData.title}`)
    .setDescription(`You began: ${gameData.description}\n\nYour ending: **${currentNode.endingTitle}**`)
    .setFooter({ text: `This game had ${Object.keys(gameData.nodes).length} possible nodes and multiple endings` });
  
  // Add the journey as fields (limit to last 10 choices if very long)
  const journeyToShow = history.slice(-10);
  
  if (history.length > 10) {
    embed.addFields({ name: 'Journey Overview', value: `Your journey had ${history.length} decisions. Here are your last 10 choices:` });
  } else {
    embed.addFields({ name: 'Your Complete Journey', value: 'Here are all the choices you made:' });
  }
  
  journeyToShow.forEach((step, index) => {
    // Remove special characters that might break the formatting
    const cleanDescription = step.description.substring(0, 100)
      .replace(/[*_~]/g, '');
    
    embed.addFields({
      name: `${index + 1}. ${step.question}`,
      value: `You chose: **${step.choice}**\n${cleanDescription}${step.description.length > 100 ? '...' : ''}`,
    });
  });
  
  return embed;
}

/**
 * Main handler for the generateChoicesGame command
 * @param {Object} message Discord message object
 */
async function handleChoicesGameCommand(message) {
  // Extract the command content
  const fullCommand = message.content.toLowerCase();
  let scenario;
  
  if (fullCommand.startsWith('!generatechoicesgame')) {
    scenario = message.content.slice('!generatechoicesgame'.length).trim();
  } else if (fullCommand.startsWith('!choicesgame')) {
    scenario = message.content.slice('!choicesgame'.length).trim();
  }
  
  if (!scenario) {
    message.reply('Please provide a scenario for the choices game. Example: `!generatechoicesgame running a tech startup` or `!choicesgame medieval knight adventure`');
    return;
  }
  
  // Check if user already has an active choices game and clear it
  if (activeChoicesGames.has(message.author.id)) {
    // Clear the existing game without any warning
    clearUserChoicesGame(message.author.id);
  }
  
  // Send initial loading message
  const loadingMessage = await message.reply(`🎮 Generating your choices game about "${scenario}"... This might take a minute!`);
  
  try {
    // Generate choices game using the API
    const gameData = await generateChoicesGameContent(scenario);
    
    // Create user game session
    const gameSession = {
      userId: message.author.id,
      gameData: gameData,
      currentNodeId: gameData.startNode,
      history: [],
      message: null
    };
    
    // Add to active choices games
    activeChoicesGames.set(message.author.id, gameSession);
    
    // Update the loading message
    await loadingMessage.edit(`✅ Choices game generated! ${message.author}, get ready to begin your adventure in "${gameData.title}"!`);
    
    // Start the game with the first node
    await sendGameNode(message.channel, message.author.id);
    
  } catch (error) {
    console.error('Error in choices game command:', error);
    await loadingMessage.edit('Sorry, there was an error generating your choices game. Please try again later.');
  }
}

/**
 * Clears a user's active choices game
 * @param {string} userId The user's ID
 * @returns {boolean} Whether a game was cleared
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