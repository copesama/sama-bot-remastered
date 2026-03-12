const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');
const { getPrefix } = require('./prefixCommand');

// Store active games with user IDs as keys
const activeGames = new Map();

/**
 * Generates a choices game based on the provided scenario using OpenRouter API
 * @param {string} scenario The scenario for the choices game
 * @returns {Object} Object containing game structure with choices and outcomes
 */
async function generateGameContent(scenario) {
  try {
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert interactive narrative designer. Create an engaging choice-based story game based on the scenario provided by the user.

The game should follow this exact JSON format:
{
  "title": "Title of the game goes here",
  "introduction": "An introduction to the scenario and setting",
  "nodes": [
    {
      "id": "start",
      "text": "The first situation description goes here",
      "choices": [
        {
          "text": "Choice 1 description",
          "nextNode": "node1"
        },
        {
          "text": "Choice 2 description",
          "nextNode": "node2"
        },
        {
          "text": "Choice 3 description",
          "nextNode": "node3"
        },
        {
          "text": "Choice 4 description",
          "nextNode": "node4"
        }
      ]
    },
    {
      "id": "node1",
      "text": "The situation that follows Choice 1",
      "choices": [
        // More choices here that lead to other nodes
      ],
      "isEnding": false
    },
    // More nodes with different situations
    {
      "id": "good_ending",
      "text": "Description of the good ending",
      "isEnding": true,
      "endingType": "good"
    },
    {
      "id": "bad_ending",
      "text": "Description of the bad ending",
      "isEnding": true,
      "endingType": "bad"
    }
  ]
}

IMPORTANT REQUIREMENTS:
1. Create a meaningful branching narrative with 8-12 total nodes
2. Each non-ending node must have 2-4 choices
3. Choices should be meaningful and lead to different paths
4. Include at least 2 distinct endings (good and bad)
5. The story should be coherent and relate to the scenario
6. Return ONLY valid JSON with no additional text, comments or markdown
7. Write in the SAME LANGUAGE as the user's prompt
8. Make the narrative engaging and tailored to the scenario
9. Keep descriptions concise but vivid

The output must be a valid JSON object that can be directly parsed.`
          },
          {
            role: 'user',
            content: `Create a choices-based game with the following scenario: ${scenario}`
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

    // Extract the game content from the response
    const gameContent = response.data.choices[0].message.content;
    
    // Try to extract JSON from the content (in case it's wrapped in markdown or other text)
    let gameStructure;
    try {
      // First attempt: try to parse the entire response as JSON
      gameStructure = JSON.parse(gameContent);
    } catch (e) {
      // Second attempt: try to extract JSON if it's wrapped in a code block
      const jsonMatch = gameContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        gameStructure = JSON.parse(jsonMatch[1]);
      } else {
        // Third attempt: look for object brackets in the content
        const objectMatch = gameContent.match(/\{\s*"[\s\S]*\}\s*\}/);
        if (objectMatch) {
          gameStructure = JSON.parse(objectMatch[0]);
        } else {
          throw new Error('Failed to parse game structure from API response');
        }
      }
    }
    
    // Validate the game structure
    if (!gameStructure.title || !gameStructure.introduction || !Array.isArray(gameStructure.nodes)) {
      throw new Error('Invalid game structure: Missing required elements');
    }
    
    // Ensure we have a starting node
    const startNode = gameStructure.nodes.find(node => node.id === 'start');
    if (!startNode) {
      throw new Error('Invalid game structure: Missing start node');
    }
    
    // Ensure we have at least one ending
    const hasEnding = gameStructure.nodes.some(node => node.isEnding === true);
    if (!hasEnding) {
      throw new Error('Invalid game structure: No ending nodes found');
    }
    
    return gameStructure;
  } catch (error) {
    throw error;
  }
}

/**
 * Creates a Discord embed for a game node
 * @param {Object} gameSession The current game session
 * @param {Object} node The current node data
 * @param {string} prefix The server's command prefix
 * @returns {EmbedBuilder} Discord embed for the node
 */
function createNodeEmbed(gameSession, node, prefix = '!') {
  let color = '#4285F4'; // Default color
  let title = gameSession.gameStructure.title;
  
  // If it's an ending, set color based on ending type
  if (node.isEnding) {
    if (node.endingType === 'good') {
      color = '#4CAF50'; // Green for good endings
      title += ' - Success!';
    } else {
      color = '#F44336'; // Red for bad endings
      title += ' - Game Over';
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title);
  
  // If it's the first node, include the introduction
  if (node.id === 'start' && !gameSession.introductionShown) {
    embed.setDescription(`${gameSession.gameStructure.introduction}\n\n${node.text}`);
    gameSession.introductionShown = true;
  } else {
    embed.setDescription(node.text);
  }
  
  // Add footer showing progress with the custom prefix
  if (!node.isEnding) {
    embed.setFooter({ text: 'Make your choice by clicking a button below' });
  } else {
    embed.setFooter({ text: `Game ended. You can play again with ${prefix}choicesgame` });
  }
  
  return embed;
}

/**
 * Creates button components for choices
 * @param {Array} choices List of choices for the current node
 * @returns {ActionRowBuilder} Row of button components
 */
function createChoiceButtons(choices) {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  
  choices.forEach((choice, index) => {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`choice_${index}`)
        .setLabel(choice.text.substring(0, 80)) // Discord has an 80 character limit for button labels
        .setStyle(ButtonStyle.Primary)
    );
    
    // Create a new row after 4 buttons (Discord's limit)
    if ((index + 1) % 4 === 0 && index < choices.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });
  
  // Add the last row if it has any buttons
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }
  
  return rows;
}

/**
 * Creates a results embed showing the game outcome
 * @param {Object} gameSession The completed game session
 * @param {Object} endingNode The ending node reached
 * @param {string} prefix The server's command prefix
 * @returns {EmbedBuilder} Discord embed with the results
 */
function createResultsEmbed(gameSession, endingNode, prefix = '!') {
  const color = endingNode.endingType === 'good' ? '#4CAF50' : '#F44336';
  const resultType = endingNode.endingType === 'good' ? 'Success!' : 'Game Over';
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${gameSession.gameStructure.title} - ${resultType}`)
    .setDescription(endingNode.text)
    .addFields(
      { name: 'Your Journey', value: `You made ${gameSession.path.length - 1} choices in this story.` },
      { 
        name: '💬 Looking for a completely anonymous chatting experience?', 
        value: 'Try [Luck Off](https://luckoff.chat/) - an end-to-end encrypted chat platform. Free with no registration or installation required!'
      }
    )
    .setTimestamp();
  
  return embed;
}

/**
 * Main handler for the generateChoicesGame command
 * @param {Object} message Discord message object
 */
async function handleChoicesGameCommand(message) {
  // Get the server's prefix
  const prefix = await getPrefix(message.guild?.id);
  
  // Extract the command content (scenario)
  let commandName = message.content.startsWith(`${prefix}generatechoicesgame`) ? `${prefix}generatechoicesgame` : `${prefix}choicesgame`;
  const scenario = message.content.slice(commandName.length).trim();
  
  if (!scenario) {
    message.reply(`Please provide a scenario for the choices game. Example: \`${prefix}generatechoicesgame business CEO\` or \`${prefix}choicesgame space explorer\``);
    return;
  }
  
  // Check if user already has an active game
  if (activeGames.has(message.author.id)) {
    message.reply('You already have an active choices game! Please finish it before starting a new one.');
    return;
  }
  
  // Send initial loading message
  const loadingMessage = await message.reply(`🎮 Generating a choices game about "${scenario}"... This might take a minute!`);
  
  try {
    // Generate game content using the API
    const gameStructure = await generateGameContent(scenario);
    
    // Create user game session
    const gameSession = {
      userId: message.author.id,
      scenario: scenario,
      gameStructure: gameStructure,
      currentNode: 'start',
      path: ['start'], // Track the path taken
      introductionShown: false,
      message: null,
      prefix: prefix // Store the prefix with the session
    };
    
    // Add to active games
    activeGames.set(message.author.id, gameSession);
    
    // Update the loading message
    await loadingMessage.edit(`✅ Game generated! ${message.author}, get ready to play "${gameStructure.title}"!`);
    
    // Start the game with the first node
    await sendGameNode(message.channel, message.author.id);
    
  } catch (error) {
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
  
  // Find the current node in the game structure
  const currentNode = gameSession.gameStructure.nodes.find(node => node.id === gameSession.currentNode);
  
  if (!currentNode) {
    // Instead of ending the game, handle missing node and let user retry
    await handleMissingNode(channel, userId, gameSession);
    return;
  }
  
  // Create node embed using the session's prefix
  const prefix = gameSession.prefix || '!';
  const embed = createNodeEmbed(gameSession, currentNode, prefix);
  
  let components = [];
  
  // If this is not an ending, create choice buttons
  if (!currentNode.isEnding && currentNode.choices && currentNode.choices.length > 0) {
    components = createChoiceButtons(currentNode.choices);
  }
  
  // Send the node
  const nodeMessage = await channel.send({
    content: `<@${userId}> Your story continues:`,
    embeds: [embed],
    components: components
  });
  
  // Store reference to the message for cleanup later
  gameSession.message = nodeMessage;
  
  // If this is an ending, finish the game
  if (currentNode.isEnding) {
    finishGame(channel, userId, currentNode);
    return;
  }
  
  // Create a collector for button interactions
  const collector = nodeMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300000, // 5 minute timeout per decision
    filter: (interaction) => interaction.user.id === userId // Only the game player can interact
  });
  
  // Handle choice selection
  collector.on('collect', async (interaction) => {
    // Parse the selected choice index from the button ID
    const choiceIndex = parseInt(interaction.customId.split('_')[1]);
    const selectedChoice = currentNode.choices[choiceIndex];
    
    if (!selectedChoice || !selectedChoice.nextNode) {
      await interaction.reply({ content: 'Invalid choice or missing next node!', ephemeral: true });
      return;
    }
    
    // Check if the next node exists before navigating to it
    const nextNode = gameSession.gameStructure.nodes.find(node => node.id === selectedChoice.nextNode);
    if (!nextNode) {
      await interaction.reply({ 
        content: 'Sorry, there was an issue with that choice. Please select another option.',
        ephemeral: true 
      });
      return;
    }
    
    // Update the game session
    gameSession.currentNode = selectedChoice.nextNode;
    gameSession.path.push(selectedChoice.nextNode);
    
    // Create a temporary response showing the choice made
    const choiceEmbed = new EmbedBuilder()
      .setColor('#607D8B')
      .setDescription(`**Your choice:** ${selectedChoice.text}`)
      .setFooter({ text: 'The story continues...' });
    
    // Disable all buttons
    const disabledComponents = components.map(row => {
      const newRow = new ActionRowBuilder();
      row.components.forEach(button => {
        newRow.addComponents(
          ButtonBuilder.from(button)
            .setDisabled(true)
            .setStyle(button.customId === interaction.customId ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
      });
      return newRow;
    });
    
    // Update the message with the chosen option
    await interaction.update({
      embeds: [embed, choiceEmbed],
      components: disabledComponents
    });
    
    // Send the next node after a short delay
    setTimeout(() => {
      sendGameNode(channel, userId);
    }, 2000);
    
    // Stop the collector
    collector.stop();
  });
  
  // Handle collector end (timeout)
  collector.on('end', async (collected, reason) => {
    if (reason === 'time' && gameSession.message && gameSession.message.id === nodeMessage.id) {
      // Timeout - user didn't make a choice in time
      const prefix = gameSession.prefix || '!';
      const timeoutEmbed = new EmbedBuilder()
        .setColor('#607D8B')
        .setTitle("⏰ Time's up!")
        .setDescription(`You took too long to make a decision. The game has ended.`)
        .setFooter({ text: `You can start a new game with ${prefix}choicesgame` });
      
      // Disable all buttons
      const disabledComponents = components.map(row => {
        const newRow = new ActionRowBuilder();
        row.components.forEach(button => {
          newRow.addComponents(
            ButtonBuilder.from(button)
              .setDisabled(true)
              .setStyle(ButtonStyle.Secondary)
          );
        });
        return newRow;
      });
      
      // Update message with timeout notification
      await nodeMessage.edit({
        embeds: [timeoutEmbed],
        components: disabledComponents
      });
      
      // Remove from active games
      activeGames.delete(userId);
    }
  });
}

/**
 * Handle node not found scenario and allow user to make another choice
 * @param {Object} channel Discord channel to send the message to
 * @param {string} userId The user's ID
 * @param {Object} gameSession The current game session
 */
async function handleMissingNode(channel, userId, gameSession) {
  // If we have a previous node in path, go back to it
  if (gameSession.path.length > 1) {
    // Remove the invalid node from the path
    gameSession.path.pop();
    
    // Get the previous node ID
    const previousNodeId = gameSession.path[gameSession.path.length - 1];
    gameSession.currentNode = previousNodeId;
    
    // Notify the user about the issue
    await channel.send({
      content: `<@${userId}> Sorry, there was an issue with that choice. Please select another option.`,
      ephemeral: true
    });
    
    // Send the previous node again for the user to make a new choice
    await sendGameNode(channel, userId);
  } else {
    // If we can't go back (we're at the start), inform the user and end the game
    channel.send(`<@${userId}> Sorry, there was an error in the game. The story node couldn't be found.`);
    activeGames.delete(userId);
  }
}

/**
 * Finish the game and show final results
 * @param {Object} channel Discord channel to send results to
 * @param {string} userId The user's ID
 * @param {Object} endingNode The ending node reached
 */
async function finishGame(channel, userId, endingNode) {
  const gameSession = activeGames.get(userId);
  
  if (!gameSession) {
    return;
  }
  
  const prefix = gameSession.prefix || '!';
  
  // Create and send results embed
  const resultsEmbed = createResultsEmbed(gameSession, endingNode, prefix);
  
  // Send a summary message
  await channel.send({
    content: `<@${userId}> Your story has come to an end:`,
    embeds: [resultsEmbed]
  });
  
  // Add a follow-up message with feedback
  let feedbackMessage = '';
  
  if (endingNode.endingType === 'good') {
    feedbackMessage = "🎉 Congratulations on your success! Your choices led to a positive outcome!";
  } else {
    feedbackMessage = "💫 Better luck next time! Every choice shapes a different story.";
  }
  
  await channel.send(`<@${userId}> ${feedbackMessage}\n\nUse \`${prefix}choicesgame [scenario]\` to create another choices game!`);
  
  // Remove from active games
  activeGames.delete(userId);
}

/**
 * Handle a user leaving or quitting a game
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
