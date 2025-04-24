const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');

// Store active games with user IDs as keys
const activeGames = new Map();

/**
 * Generates a choices game scenario based on the provided prompt using OpenRouter API
 * @param {string} scenario The scenario topic for the game
 * @returns {Object} Object containing the branching game content
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
            content: `You are an expert branching narrative game designer. Create a choice-based game about the scenario provided by the user.

The game should follow this JSON format:
{
  "title": "Title of the scenario",
  "startingDescription": "Initial description of the scenario that sets the stage",
  "firstQuestion": {
    "id": "q1",
    "text": "First question text",
    "choices": [
      {
        "id": "q1_a",
        "text": "Choice A text",
        "nextQuestion": "q2",
        "outcome": "Description of what happens when this choice is selected"
      },
      {
        "id": "q1_b",
        "text": "Choice B text",
        "nextQuestion": "q3",
        "outcome": "Description of what happens when this choice is selected"
      },
      {
        "id": "q1_c",
        "text": "Choice C text",
        "nextQuestion": "q4", 
        "outcome": "Description of what happens when this choice is selected"
      },
      {
        "id": "q1_d",
        "text": "Choice D text",
        "nextQuestion": "q5",
        "outcome": "Description of what happens when this choice is selected"
      }
    ]
  },
  "questions": {
    "q2": {
      "text": "Question after choice A was selected",
      "choices": [
        {
          "id": "q2_a",
          "text": "Choice A text",
          "nextQuestion": "q6",
          "outcome": "Description of what happens"
        },
        {
          "id": "q2_b",
          "text": "Choice B text",
          "nextQuestion": "q7",
          "outcome": "Description of what happens"
        },
        {
          "id": "q2_c",
          "text": "Choice C text",
          "nextQuestion": "q8",
          "outcome": "Description of what happens"
        },
        {
          "id": "q2_d",
          "text": "Choice D text",
          "nextQuestion": "ending_bad",
          "outcome": "Description of what happens"
        }
      ]
    },
    "q3": {
      "text": "Question after choice B was selected",
      "choices": [...]
    },
    // and so on for other questions (q4, q5, q6, q7, q8, etc.)
    "ending_good": {
      "text": "Description of good ending",
      "isEnding": true,
      "endingType": "good"
    },
    "ending_bad": {
      "text": "Description of bad ending",
      "isEnding": true,
      "endingType": "bad"
    }
  }
}

IMPORTANT REQUIREMENTS:
1. Create a branching narrative with at least 8 questions total before any ending
2. Each question must have 4 choices (A, B, C, D)
3. There must be at least 2 distinct endings (good and bad)
4. Create a meaningful branching structure where choices lead to different paths
5. For brevity, create just enough questions to demonstrate branching (no need for hundreds)
6. Be descriptive in outcomes and endings to make choices meaningful
7. Return ONLY valid JSON with no additional text, comments or markdown
8. Create the game in the SAME LANGUAGE as the user's prompt
9. Keep outcomes between 1-3 sentences for readability
10. The scenario should build toward either success or failure (good/bad endings)

The output must be a valid JSON that can be directly parsed.`
          },
          {
            role: 'user',
            content: `Create a choices-based branching narrative game about: ${scenario}`
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
        // Third attempt: look for JSON object in the content
        const objMatch = gameContent.match(/\{\s*"[\s\S]*\}\s*\}/);
        if (objMatch) {
          gameData = JSON.parse(objMatch[0]);
        } else {
          throw new Error('Failed to parse game data from API response');
        }
      }
    }
    
    // Validate the game format
    if (!gameData.title || !gameData.startingDescription || !gameData.firstQuestion || !gameData.questions) {
      throw new Error('Invalid game format: Missing required fields');
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
 * Creates a Discord embed for a choices game question
 * @param {string} title The game title
 * @param {string} description The scenario description
 * @param {string} questionText The current question text
 * @param {string} outcome The outcome of the previous choice (if any)
 * @param {boolean} isEnding Whether this is an ending
 * @param {string} endingType The type of ending (good/bad)
 * @returns {EmbedBuilder} Discord embed for the question or ending
 */
function createGameEmbed(title, description, questionText, outcome = null, isEnding = false, endingType = null) {
  const embed = new EmbedBuilder()
    .setTitle(title);
  
  if (isEnding) {
    embed.setColor(endingType === 'good' ? '#4CAF50' : '#F44336');
    
    const endingEmoji = endingType === 'good' ? '🏆' : '💔';
    embed.setDescription(`${description}\n\n${endingEmoji} **ENDING:**\n${questionText}`);
    
    if (outcome) {
      embed.addFields({ name: 'Your Journey', value: outcome });
    }
    
    embed.setFooter({ text: `${endingType === 'good' ? 'Good' : 'Bad'} Ending • Type !choicesgame to play again with a different scenario` });
  } else {
    embed.setColor('#4285F4');
    
    let fullDescription = description;
    
    if (outcome) {
      fullDescription += `\n\n**Outcome of your choice:**\n${outcome}`;
    }
    
    fullDescription += `\n\n**${questionText}**`;
    
    embed.setDescription(fullDescription);
    embed.setFooter({ text: 'Make your choice by clicking a button below' });
  }
  
  return embed;
}

/**
 * Creates button components for choices
 * @param {Array} choices Array of choice objects
 * @returns {ActionRowBuilder} Row of button components
 */
function createChoiceButtons(choices) {
  const row = new ActionRowBuilder();
  
  // Create A, B, C, D buttons for the choices
  choices.forEach((choice, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, D
    
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(choice.id)
        .setLabel(letter)
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
  // Extract the command content
  const commandContent = message.content.replace(/^!(?:generatechoicesgame|choicesgame)\s+/, '').trim();
  
  if (!commandContent) {
    message.reply('Please provide a scenario for the choices game. Example: `!choicesgame running a tech startup`');
    return;
  }
  
  // Check if user already has an active game
  if (activeGames.has(message.author.id)) {
    message.reply('You already have an active choices game! Please finish it before starting a new one.');
    return;
  }
  
  // Send initial loading message
  const loadingMessage = await message.reply(`🎮 Generating a choices game about "${commandContent}"... This might take a minute!`);
  
  try {
    // Generate game content using the API
    const gameData = await generateChoicesGameContent(commandContent);
    
    // Create user game session
    const gameSession = {
      userId: message.author.id,
      gameData: gameData,
      currentQuestionId: 'firstQuestion',
      choiceHistory: [],
      outcomeHistory: [],
      message: null
    };
    
    // Add to active games
    activeGames.set(message.author.id, gameSession);
    
    // Update the loading message
    await loadingMessage.edit(`✅ Game created! ${message.author}, get ready to play "${gameData.title}"!`);
    
    // Start the game with the first question
    await sendGameState(message.channel, message.author.id);
    
  } catch (error) {
    console.error('Error in choices game command:', error);
    await loadingMessage.edit('Sorry, there was an error generating your choices game. Please try again later.');
  }
}

/**
 * Sends the current game state to the channel
 * @param {Object} channel Discord channel to send the game state to
 * @param {string} userId The user's ID
 */
async function sendGameState(channel, userId) {
  const gameSession = activeGames.get(userId);
  
  if (!gameSession) {
    return;
  }
  
  const gameData = gameSession.gameData;
  
  // Determine the current question
  let currentQuestion;
  let isEnding = false;
  let endingType = null;
  
  if (gameSession.currentQuestionId === 'firstQuestion') {
    currentQuestion = gameData.firstQuestion;
  } else {
    currentQuestion = gameData.questions[gameSession.currentQuestionId];
    isEnding = currentQuestion.isEnding || false;
    endingType = currentQuestion.endingType;
  }
  
  // Get the last outcome if there is one
  const lastOutcome = gameSession.outcomeHistory.length > 0 
    ? gameSession.outcomeHistory[gameSession.outcomeHistory.length - 1] 
    : null;
  
  // Create the game embed
  const embed = createGameEmbed(
    gameData.title,
    gameData.startingDescription,
    currentQuestion.text,
    lastOutcome,
    isEnding,
    endingType
  );
  
  let components = [];
  
  // If not at an ending, add choice buttons
  if (!isEnding && currentQuestion.choices) {
    components = [createChoiceButtons(currentQuestion.choices)];
  }
  
  // Send the game state
  const gameMessage = await channel.send({
    content: `<@${userId}>'s Choices Game:`,
    embeds: [embed],
    components: components
  });
  
  // Store reference to the message
  gameSession.message = gameMessage;
  
  // If this is an ending, clean up the game
  if (isEnding) {
    activeGames.delete(userId);
    return;
  }
  
  // Create a collector for button interactions
  const collector = gameMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300000, // 5 minute timeout per question
    filter: (interaction) => interaction.user.id === userId // Only the game player can make choices
  });
  
  // Handle choice selection
  collector.on('collect', async (interaction) => {
    const choiceId = interaction.customId;
    
    // Find the selected choice
    const selectedChoice = currentQuestion.choices.find(choice => choice.id === choiceId);
    
    if (!selectedChoice) {
      await interaction.reply({
        content: 'Invalid choice. Please try again.',
        ephemeral: true
      });
      return;
    }
    
    // Store the choice and outcome in history
    gameSession.choiceHistory.push(selectedChoice.text);
    gameSession.outcomeHistory.push(selectedChoice.outcome);
    
    // Move to the next question
    gameSession.currentQuestionId = selectedChoice.nextQuestion;
    
    // Update interaction
    await interaction.update({
      components: [] // Remove buttons after selection
    });
    
    // Send the next game state
    await sendGameState(channel, userId);
    
    // Stop the collector
    collector.stop();
  });
  
  // Handle collector end (timeout)
  collector.on('end', async (collected, reason) => {
    if (reason === 'time' && gameSession.message && gameSession.message.id === gameMessage.id) {
      // Timeout - user didn't make a choice in time
      await gameMessage.edit({
        components: [] // Remove buttons
      });
      
      await channel.send({
        content: `<@${userId}> Your choices game has timed out due to inactivity. Type !choicesgame to start a new game!`,
        ephemeral: true
      });
      
      // Remove from active games
      activeGames.delete(userId);
    }
  });
}

/**
 * Clears a user's active game
 * @param {string} userId The user's ID
 * @returns {boolean} Whether a game was cleared
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
