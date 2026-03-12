const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');
const { getPrefix } = require('./prefixCommand');

// Store active quizzes with user IDs as keys
const activeQuizzes = new Map();

/**
 * Generates a quiz based on the provided prompt using OpenRouter API
 * @param {string} prompt The topic for the quiz
 * @param {number} questionCount Number of questions to generate
 * @returns {Object} Object containing questions and answers
 */
async function generateQuizContent(prompt, questionCount = 10) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert quiz creator. Create a multiple-choice quiz with exactly ${questionCount} questions about the topic provided by the user.

Each question must follow this exact JSON format:
{
  "question": "The question text goes here?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctIndex": 0,
  "explanation": "Brief explanation of why this answer is correct"
}

IMPORTANT REQUIREMENTS:
1. Generate exactly ${questionCount} questions in a JSON array
2. Each question must have exactly 4 options
3. The correctIndex must be 0, 1, 2, or 3 (corresponding to the correct option's position)
4. The difficulty should increase gradually throughout the quiz
5. Questions should be factually accurate and well-researched
6. Ensure varied question formats (who, what, when, where, how, etc.)
7. Each question should have a brief explanation of the correct answer
8. Return ONLY valid JSON with no additional text, comments or markdown.

The output must be a valid JSON array that can be directly parsed.`
          },
          {
            role: 'user',
            content: `Create a ${questionCount}-question multiple-choice quiz about: ${prompt}`
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

    // Extract the quiz content from the response
    const quizContent = response.data.choices[0].message.content;
    
    // Try to extract JSON from the content (in case it's wrapped in markdown or other text)
    let quizQuestions;
    try {
      // First attempt: try to parse the entire response as JSON
      quizQuestions = JSON.parse(quizContent);
    } catch (e) {
      // Second attempt: try to extract JSON if it's wrapped in a code block
      const jsonMatch = quizContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        quizQuestions = JSON.parse(jsonMatch[1]);
      } else {
        // Third attempt: look for array brackets in the content
        const arrayMatch = quizContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (arrayMatch) {
          quizQuestions = JSON.parse(arrayMatch[0]);
        } else {
          throw new Error('Failed to parse quiz questions from API response');
        }
      }
    }
    
    // Validate the questions format
    if (!Array.isArray(quizQuestions) || quizQuestions.length !== questionCount) {
      throw new Error(`Invalid quiz format: Expected an array of ${questionCount} questions`);
    }
    
    // Validate each question and randomize answer positions
    quizQuestions.forEach((q, index) => {
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 || 
          q.correctIndex === undefined || !q.explanation) {
        throw new Error(`Question ${index + 1} has an invalid format`);
      }
      
      // Randomize the positions of the answers
      const correctOption = q.options[q.correctIndex];
      
      // Shuffle the options
      for (let i = q.options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
      }
      
      // Find the new index of the correct answer
      q.correctIndex = q.options.findIndex(option => option === correctOption);
    });
    
    return quizQuestions;
  } catch (error) {
    if (error.response) {
      // API error response exists but not logging it
    }
    
    throw error;
  }
}

/**
 * Creates a Discord embed for a quiz question
 * @param {Object} questionData The question data
 * @param {number} questionNumber The question number (1-10)
 * @param {number} totalQuestions Total number of questions
 * @param {string} prompt The quiz topic
 * @returns {EmbedBuilder} Discord embed for the question
 */
function createQuestionEmbed(questionData, questionNumber, totalQuestions, prompt) {
  const optionsText = questionData.options.map((option, index) => {
    return `**${String.fromCharCode(65 + index)}.** ${option}`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setColor('#4285F4')
    .setTitle(`Quiz Question ${questionNumber} of ${totalQuestions}`)
    .setDescription(`**Topic:** ${prompt}\n\n**${questionData.question}**\n\n${optionsText}`)
    .setFooter({ text: `Question ${questionNumber}/${totalQuestions} • Respond by clicking a button below` });
}

/**
 * Creates button components for quiz options
 * @returns {ActionRowBuilder} Row of button components
 */
function createOptionButtons() {
  const row = new ActionRowBuilder();
  
  // Create A, B, C, D buttons
  ['A', 'B', 'C', 'D'].forEach((option, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_option_${index}`)
        .setLabel(option)
        .setStyle(ButtonStyle.Primary)
    );
  });
  
  return row;
}

/**
 * Creates a results embed showing the quiz score and feedback
 * @param {number} score The user's score
 * @param {number} totalQuestions Total number of questions
 * @param {string} prompt The quiz topic
 * @param {Array} questionResults Results for each question
 * @returns {EmbedBuilder} Discord embed with the results
 */
function createResultsEmbed(score, totalQuestions, prompt, questionResults) {
  const percentage = Math.round((score / totalQuestions) * 100);
  let grade, color;
  
  // Determine grade and color based on percentage
  if (percentage >= 90) {
    grade = 'Excellent! 🏆';
    color = '#4CAF50'; // Green
  } else if (percentage >= 70) {
    grade = 'Good job! 👍';
    color = '#2196F3'; // Blue
  } else if (percentage >= 50) {
    grade = 'Nice try! 👌';
    color = '#FF9800'; // Orange
  } else {
    grade = 'Keep learning! 📚';
    color = '#F44336'; // Red
  }
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('📋 Quiz Results')
    .setDescription(`**Topic:** ${prompt}\n\n**Your Score: ${score}/${totalQuestions} (${percentage}%)**\n**Grade:** ${grade}`)
    .setTimestamp();
  
  // Add fields for correct and incorrect answers
  const correctAnswers = questionResults.filter(r => r.correct).length;
  const incorrectAnswers = questionResults.filter(r => !r.correct).length;
  
  embed.addFields(
    { name: '✅ Correct Answers', value: correctAnswers.toString(), inline: true },
    { name: '❌ Incorrect Answers', value: incorrectAnswers.toString(), inline: true },
    { 
      name: '💬 Looking for a completely anonymous chatting experience?', 
      value: 'Try [Luck Off](https://luckoff.chat/) - an end-to-end encrypted chat platform. Free with no registration or installation required!'
    }
  );
  
  // Add a summary of only incorrect answers (limited to first 5 for brevity)
  const incorrectResults = questionResults.filter(r => !r.correct);
  const resultsSummary = incorrectResults
    .slice(0, 5)
    .map((result, i) => {
      // Find the index of this result in the original array
      const originalIndex = questionResults.findIndex(r => r === result);
      return `**Q${originalIndex + 1}:** ❌ ${result.explanation.substring(0, 100)}${result.explanation.length > 100 ? '...' : ''}`;
    })
    .join('\n\n');
  
  if (resultsSummary && incorrectResults.length > 0) {
    embed.addFields({ name: `Incorrect Answers Summary (Up to 5)`, value: resultsSummary });
  } else if (incorrectResults.length === 0) {
    embed.addFields({ name: 'Incorrect Answers Summary', value: '🎉 You got all questions correct! Impressive!' });
  }
  
  if (incorrectResults.length > 5) {
    embed.setFooter({ text: `Showing only the first 5 incorrect answers out of ${incorrectResults.length}` });
  }
  
  return embed;
}

/**
 * Main handler for the generateQuiz command
 * @param {Object} message Discord message object
 */
async function handleQuizCommand(message) {
  // Get the custom prefix for this server
  const prefix = await getPrefix(message.guild?.id);
  
  // Determine command name from message content
  const commandName = message.content.startsWith(`${prefix}generatequiz`) ? `${prefix}generatequiz` : `${prefix}quiz`;
  
  // Extract the command content
  const commandContent = message.content.slice(commandName.length).trim();
  
  // Check for number and prompt
  let questionCount = 10; // Default to 10 questions
  let prompt;
  
  // Parse the command
  const match = commandContent.match(/^(\d+)(?:\s+(.+))?$/);
  
  if (match) {
    // User specified a number
    questionCount = parseInt(match[1]);
    prompt = match[2] ? match[2].trim() : null;
    
    // Validate question count
    if (questionCount < 3 || questionCount > 20) {
      message.reply(`Please specify a number of questions between 3 and 20. Example: \`${prefix}generatequiz 15 Solar System\``);
      return;
    }
    
    // If no prompt was provided after the number, ask for it
    if (!prompt) {
      message.reply(`Please provide a topic for your ${questionCount}-question quiz. Example: \`${prefix}generatequiz ${questionCount} Solar System\``);
      return;
    }
  } else {
    // No number specified, the entire content is the prompt
    prompt = commandContent;
    
    if (!prompt) {
      message.reply(`Please provide a topic for the quiz. Example: \`${prefix}generatequiz Solar System\` or \`${prefix}generatequiz 15 Solar System\``);
      return;
    }
  }
  
  // Check if user already has an active quiz
  if (activeQuizzes.has(message.author.id)) {
    message.reply('You already have an active quiz! Please finish it before starting a new one.');
    return;
  }
  
  // Send initial loading message
  const loadingMessage = await message.reply(`📝 Generating a ${questionCount}-question quiz about "${prompt}"... This might take a minute!`);
  
  try {
    // Generate quiz questions using the API
    const quizQuestions = await generateQuizContent(prompt, questionCount);
    
    // Create user quiz session
    const quizSession = {
      userId: message.author.id,
      prompt: prompt,
      questions: quizQuestions,
      currentQuestion: 0,
      score: 0,
      results: [],
      message: null,
      prefix: prefix // Store the prefix with the session
    };
    
    // Add to active quizzes
    activeQuizzes.set(message.author.id, quizSession);
    
    // Update the loading message
    await loadingMessage.edit(`✅ Quiz generated! ${message.author}, get ready to test your knowledge about "${prompt}" with ${questionCount} questions!`);
    
    // Start the quiz with the first question
    await sendNextQuestion(message.channel, message.author.id);
    
  } catch (error) {
    await loadingMessage.edit(`Sorry, there was an error generating your quiz. Please try again later with \`${prefix}quiz\`.`);
  }
}

/**
 * Sends the next question in the quiz
 * @param {Object} channel Discord channel to send the question to
 * @param {string} userId The user's ID
 */
async function sendNextQuestion(channel, userId) {
  const quizSession = activeQuizzes.get(userId);
  
  if (!quizSession || quizSession.currentQuestion >= quizSession.questions.length) {
    // Quiz is finished or doesn't exist
    return;
  }
  
  const currentQ = quizSession.currentQuestion;
  const questionData = quizSession.questions[currentQ];
  
  // Create question embed and buttons
  const embed = createQuestionEmbed(
    questionData, 
    currentQ + 1, 
    quizSession.questions.length,
    quizSession.prompt
  );
  
  const buttons = createOptionButtons();
  
  // Send the question
  const questionMessage = await channel.send({
    content: `<@${userId}> Question ${currentQ + 1}:`,
    embeds: [embed],
    components: [buttons]
  });
  
  // Store reference to the message for cleanup later
  quizSession.message = questionMessage;
  
  // Create a collector for button interactions
  const collector = questionMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000, // 1 minute timeout per question
    filter: (interaction) => interaction.user.id === userId // Only the quiz taker can answer
  });
  
  // Handle answer selection
  collector.on('collect', async (interaction) => {
    // Parse the selected option index from the button ID
    const selectedIndex = parseInt(interaction.customId.split('_')[2]);
    
    // Check if the answer is correct
    const isCorrect = selectedIndex === questionData.correctIndex;
    
    // Update score and results
    if (isCorrect) {
      quizSession.score++;
    }
    
    quizSession.results.push({
      correct: isCorrect,
      selectedOption: questionData.options[selectedIndex],
      correctOption: questionData.options[questionData.correctIndex],
      explanation: questionData.explanation
    });
    
    // Create a result embed for this question
    const resultEmbed = new EmbedBuilder()
      .setColor(isCorrect ? '#4CAF50' : '#F44336')
      .setTitle(isCorrect ? '✅ Correct!' : '❌ Incorrect')
      .setDescription(`**Question:** ${questionData.question}\n\n**Your answer:** ${questionData.options[selectedIndex]}\n\n**Correct answer:** ${questionData.options[questionData.correctIndex]}\n\n**Explanation:** ${questionData.explanation}`)
      .setFooter({ text: `Question ${currentQ + 1}/${quizSession.questions.length} • Your current score: ${quizSession.score}/${currentQ + 1}` });
    
    // Disable all buttons
    const disabledButtons = new ActionRowBuilder();
    buttons.components.forEach((button, index) => {
      const style = index === questionData.correctIndex ? ButtonStyle.Success : 
                    (index === selectedIndex && !isCorrect ? ButtonStyle.Danger : ButtonStyle.Secondary);
      
      disabledButtons.addComponents(
        ButtonBuilder.from(button)
          .setStyle(style)
          .setDisabled(true)
      );
    });
    
    // Update the message with the result
    await interaction.update({
      embeds: [resultEmbed],
      components: [disabledButtons]
    });
    
    // Move to the next question or finish the quiz
    quizSession.currentQuestion++;
    
    if (quizSession.currentQuestion < quizSession.questions.length) {
      // Send the next question after a short delay
      setTimeout(() => {
        sendNextQuestion(channel, userId);
      }, 3000);
    } else {
      // Quiz is complete, send final results
      setTimeout(() => {
        finishQuiz(channel, userId);
      }, 3000);
    }
    
    // Stop the collector
    collector.stop();
  });
  
  // Handle collector end (timeout or answer received)
  collector.on('end', async (collected, reason) => {
    if (reason === 'time' && quizSession.message && quizSession.message.id === questionMessage.id) {
      // Timeout - user didn't answer in time
      const timeoutEmbed = new EmbedBuilder()
        .setColor('#607D8B')
        .setTitle("⏰ Time's up!")
        .setDescription(`**Question:** ${questionData.question}\n\n**Correct answer:** ${questionData.options[questionData.correctIndex]}\n\n**Explanation:** ${questionData.explanation}`)
        .setFooter({ text: `Question ${currentQ + 1}/${quizSession.questions.length} • Moving to next question...` });
      
      // Disable all buttons
      const disabledButtons = new ActionRowBuilder();
      buttons.components.forEach((button, index) => {
        disabledButtons.addComponents(
          ButtonBuilder.from(button)
            .setStyle(index === questionData.correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(true)
        );
      });
      
      // Update message with timeout notification
      await questionMessage.edit({
        embeds: [timeoutEmbed],
        components: [disabledButtons]
      });
      
      // Record this as an incorrect answer
      quizSession.results.push({
        correct: false,
        selectedOption: "No answer (timed out)",
        correctOption: questionData.options[questionData.correctIndex],
        explanation: questionData.explanation
      });
      
      // Move to the next question or finish the quiz
      quizSession.currentQuestion++;
      
      if (quizSession.currentQuestion < quizSession.questions.length) {
        // Send the next question after a short delay
        setTimeout(() => {
          sendNextQuestion(channel, userId);
        }, 3000);
      } else {
        // Quiz is complete, send final results
        setTimeout(() => {
          finishQuiz(channel, userId);
        }, 3000);
      }
    }
  });
}

/**
 * Finish the quiz and show final results
 * @param {Object} channel Discord channel to send results to
 * @param {string} userId The user's ID
 */
async function finishQuiz(channel, userId) {
  const quizSession = activeQuizzes.get(userId);
  
  if (!quizSession) {
    return;
  }
  
  // Get the prefix from the session, or default to '!'
  const prefix = quizSession.prefix || '!';
  
  // Create and send results embed
  const resultsEmbed = createResultsEmbed(
    quizSession.score,
    quizSession.questions.length,
    quizSession.prompt,
    quizSession.results
  );
  
  await channel.send({
    content: `<@${userId}> Your quiz results:`,
    embeds: [resultsEmbed]
  });
  
  // Add a follow-up message with feedback
  let feedbackMessage = '';
  const score = quizSession.score;
  const total = quizSession.questions.length;
  const percentage = Math.round((score / total) * 100);
  
  if (percentage === 100) {
    feedbackMessage = "🎓 Perfect score! You're a true expert!";
  } else if (percentage >= 90) {
    feedbackMessage = "🏆 Outstanding! You really know your stuff!";
  } else if (percentage >= 80) {
    feedbackMessage = "👏 Great job! You have solid knowledge on this topic!";
  } else if (percentage >= 70) {
    feedbackMessage = "👍 Good work! You know quite a bit about this subject!";
  } else if (percentage >= 60) {
    feedbackMessage = "🙂 Not bad! You've got a decent grasp of the basics!";
  } else if (percentage >= 50) {
    feedbackMessage = "📚 You're on the right track! A bit more studying and you'll master this topic!";
  } else if (percentage >= 30) {
    feedbackMessage = "🤔 This topic seems challenging for you. Keep learning!";
  } else {
    feedbackMessage = "📖 Don't worry! Everyone starts somewhere. This is a great opportunity to learn more about this topic!";
  }
  
  await channel.send(`<@${userId}> ${feedbackMessage}\n\nUse \`${prefix}generatequiz [topic]\` to create another quiz!`);
  
  // Remove from active quizzes
  activeQuizzes.delete(userId);
}

/**
 * Handle a user leaving or quitting a quiz
 * @param {string} userId The user's ID
 */
function clearUserQuiz(userId) {
  if (activeQuizzes.has(userId)) {
    activeQuizzes.delete(userId);
    return true;
  }
  return false;
}

// Export the functions to be used in the main bot file
module.exports = {
  handleQuizCommand,
  clearUserQuiz
};