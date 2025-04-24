const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');

// Store active games with user IDs as keys
const activeGames = new Map();

/**
 * Generates a choices game based on the provided scenario using OpenRouter API
 * @param {string} scenario The scenario for the choices game
 * @returns {Object} Object containing game structure, questions, and outcomes
 */
async function generateGameContent(scenario) {
  try {
    console.log(`Generating choices game about: ${scenario}`);
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert narrative and choice-based game designer. Create an engaging choice-based game about the scenario provided by the user.

The game should follow this exact JSON format:
{
  "title": "Title of the game",
  "description": "Brief description of the scenario and the player's role",
  "startNode": "start",
  "nodes": {
    "start": {
      "text": "Introduction text that sets up the scenario",
      "choices": [
        {"text": "Choice 1", "nextNode": "node1"},
        {"text": "Choice 2", "nextNode": "node2"},
        {"text": "Choice 3", "nextNode": "node3"},
        {"text": "Choice 4", "nextNode": "node4"}
      ]
    },
    "node1": {
      "text": "Outcome of Choice 1 and followup situation",
      "choices": [
        {"text": "Sub-choice 1A", "nextNode": "node1a"},
        {"text": "Sub-choice 1B", "nextNode": "node1b"},
        {"text": "Sub-choice 1C", "nextNode": "node1c"},
        {"text": "Sub-choice 1D", "nextNode": "node1d"}
      ]
    },
    "node1a": {
      "text": "Final outcome",
      "end": true,
      "outcome": "Success/Failure/Other outcome",
      "summary": "Summary of the player's journey and final situation"
    }
    // And so on for other nodes
  }
}

IMPORTANT REQUIREMENTS:
1. Create a branching narrative with at least 4 meaningful decision points
2. Each choice should lead to a distinctly different path/outcome
3. Include at least 6 possible end states (win/lose/neutral outcomes)
4. Each choice should have 2-4 options
5. The scenario should adapt based on previous choices
6. Include some end states earlier in the tree and some that require multiple choices
7. End nodes must include the "end": true property, an "outcome" and a "summary" of the player's journey
8. Create realistic consequences that follow logically from the player's choices
9. Return ONLY valid JSON with no additional text, comments or markdown
10. Create the game in the SAME LANGUAGE as the user's prompt/scenario

The output must be a valid JSON object that can be directly parsed.`
          },
          {
            role: 'user',
            content: `Create a choices-based game about this scenario: ${scenario}`
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
        const objectMatch = gameContent.match(/\{\s*"[\s\S]*\}\s*\}/);
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
    
    return gameData;
  } catch (error) {
    console.error('Error generating game content:', error);
    
    if (error.response) {
      console.error('API error response:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Creates a Discord embed for a choice node
 * @param {Object} gameData The game data
 * @param {string} nodeId The current node ID
 * @param {number} step The current step number
 * @returns {EmbedBuilder} Discord embed for the node
 */
function createNodeEmbed(gameData, nodeId, step) {
  const node = gameData.nodes[nodeId];
  
  const embed = new EmbedBuilder()
    .setColor('#6200EA')
    .setTitle(gameData.title)
    .setDescription(node.text);
  
  if (step === 1) {
    // First node, include the game description
    embed.setAuthor({ name: gameData.description });
  }
  
  if (node.end) {
    // This is an end node
    embed.addFields(
      { name: 'Outcome', value: node.outcome },
      { name: 'Summary', value: node.summary }
    );
    embed.setFooter({ text: 'Game Over • Use !choicesgame to play again' });
  } else {
    embed.setFooter({ text: `Decision ${step} • Choose your path wisely` });
  }
  
  return embed;
}

/**
 * Creates button components for the choices
 * @param {Array} choices The available choices
 * @returns {ActionRowBuilder} Row of button components
 */
function createChoiceButtons(choices) {
  const rows = [];
  const buttonsPerRow = 2;
  
  // Create buttons in multiple rows if needed
  for (let i = 0; i < choices.length; i += buttonsPerRow) {
    const row = new ActionRowBuilder();
    
    for (let j = 0; j < buttonsPerRow && i + j < choices.length; j++) {
      const choice = choices[i + j];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`choice_${choice.nextNode}`)
          .setLabel(choice.text)
          .setStyle(ButtonStyle.Primary)
      );
    }
    
    rows.push(row);
  }
  
  return rows;
}

/**
 * Main handler for the generateChoicesGame command
 * @param {Object} message Discord message object
 */
async function handleChoicesGameCommand(message) {
  // Extract the command content (scenario)
  const commandContent = message.content.replace(/^!(?:generatechoicesgame|choicesgame)\s+/, '').trim();
  
  if (!commandContent) {
    message.reply('Please provide a scenario for the choices game. Example: `!choicesgame space explorer on a mysterious planet` or `!generatechoicesgame medieval knight in a dragon\'s lair`');
    return;
  }
  
  // Check if user already has an active game
  if (activeGames.has(message.author.id)) {
    message.reply('You already have an active choices game! Please finish it before starting a new one.');
    return;
  }
  
  // Send initial loading message
  const loadingMessage = await message.reply(`🎮 Generating a choices-based game about "${commandContent}"... This might take a minute!`);
  
  try {
    // Generate game content using the API
    const gameData = await generateGameContent(commandContent);
    
    // Create user game session
    const gameSession = {
      userId: message.author.id,
      scenario: commandContent,
      gameData: gameData,
      currentNode: gameData.startNode,
      step: 1,
      history: [],
      message: null
    };
    
    // Add to active games
    activeGames.set(message.author.id, gameSession);
    
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
  const gameSession = activeGames.get(userId);
  
  if (!gameSession) {
    return;
  }
  
  const nodeId = gameSession.currentNode;
  const node = gameSession.gameData.nodes[nodeId];
  
  if (!node) {
    channel.send(`<@${userId}> Error: Invalid game node. The game has ended.`);
    activeGames.delete(userId);
    return;
  }
  
  // Create node embed
  const embed = createNodeEmbed(gameSession.gameData, nodeId, gameSession.step);
  
  // If this is an end node, no choices needed
  if (node.end) {
    const gameMessage = await channel.send({
      content: `<@${userId}> Your journey has reached its conclusion:`,
      embeds: [embed]
    });
    
    // Clean up
    activeGames.delete(userId);
    return;
  }
  
  // Create buttons for choices
  const choiceButtons = createChoiceButtons(node.choices);
  
  // Send the node
  const gameMessage = await channel.send({
    content: `<@${userId}> What will you do?`,
    embeds: [embed],
    components: choiceButtons
  });
  
  // Store reference to the message for cleanup later
  gameSession.message = gameMessage;
  
  // Create a collector for button interactions
  const collector = gameMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300000, // 5 minute timeout per decision
    filter: (interaction) => interaction.user.id === userId // Only the player can make choices
  });
  
  // Handle choice selection
  collector.on('collect', async (interaction) => {
    // Parse the selected node from the button ID
    const selectedNode = interaction.customId.split('_')[1];
    
    // Find the selected choice
    const selectedChoice = node.choices.find(c => c.nextNode === selectedNode);
    
    // Check if choice was found
    if (!selectedChoice) {
      // Error: choice not found - let user know and let them try again
      await interaction.reply({
        content: "There was an error with that choice. Please select another option.",
        ephemeral: true
      });
      
      console.error(`Error: Could not find choice with nextNode ${selectedNode} in node ${nodeId}`);
      return;
    }
    
    // Update game session
    gameSession.history.push({
      node: nodeId,
      choice: selectedChoice.text,
      step: gameSession.step
    });
    
    gameSession.currentNode = selectedNode;
    gameSession.step++;
    
    // Acknowledge the interaction
    await interaction.deferUpdate();
    
    // Disable all buttons
    const disabledButtons = [];
    for (const row of choiceButtons) {
      const disabledRow = new ActionRowBuilder();
      
      row.components.forEach(button => {
        disabledRow.addComponents(
          ButtonBuilder.from(button)
            .setDisabled(true)
            .setStyle(button.data.custom_id === interaction.customId ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
      });
      
      disabledButtons.push(disabledRow);
    }
    
    // Update the message with disabled buttons
    await gameMessage.edit({
      components: disabledButtons
    });
    
    // Send the next node after a short delay
    setTimeout(() => {
      sendGameNode(channel, userId);
    }, 1500);
    
    // Stop the collector
    collector.stop();
  });
  
  // Handle collector end (timeout)
  collector.on('end', async (collected, reason) => {
    if (reason === 'time' && gameSession.message && gameSession.message.id === gameMessage.id) {
      // Timeout - user didn't answer in time
      const timeoutEmbed = new EmbedBuilder()
        .setColor('#607D8B')
        .setTitle("⏰ Time's up!")
        .setDescription("You took too long to make a decision. The game has ended.")
        .setFooter({ text: 'Game Over • Use !choicesgame to play again' });
      
      // Disable all buttons
      const disabledButtons = [];
      for (const row of choiceButtons) {
        const disabledRow = new ActionRowBuilder();
        
        row.components.forEach(button => {
          disabledRow.addComponents(
            ButtonBuilder.from(button)
              .setDisabled(true)
              .setStyle(ButtonStyle.Secondary)
          );
        });
        
        disabledButtons.push(disabledRow);
      }
      
      // Update message with timeout notification
      await gameMessage.edit({
        embeds: [timeoutEmbed],
        components: disabledButtons
      });
      
      // Clean up
      activeGames.delete(userId);
    }
  });
}

/**
 * Clear a user's active game
 * @param {string} userId The user's ID
 */
function clearUserGame(userId) {
  if (activeGames.has(userId)) {
    activeGames.delete(userId);
    return true;
  }
  return false;
}

// Export the functions to be used in the main bot file
module.exports = {
  handleChoicesGameCommand,
  clearUserGame
};
