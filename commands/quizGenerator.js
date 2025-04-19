const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

// Main function to handle quiz generation command
async function handleQuizCommand(message, prompt) {
  // Send loading message
  const loadingMessage = await message.reply(`🧠 Generating a 10-question quiz about "${prompt}"... This might take a minute!`);
  
  try {
    // Generate the quiz using OpenRouter API
    const quiz = await generateQuiz(prompt);
    
    // Start the quiz interaction
    await startQuiz(message, loadingMessage, quiz);
  } catch (error) {
    console.error('Error generating quiz:', error);
    await loadingMessage.edit('Sorry, there was an error generating your quiz. Please try again later.');
  }
}

// Function to generate quiz questions and answers using OpenRouter API
async function generateQuiz(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert quiz creator. Create a 10-question multiple-choice quiz about the given topic.
            
            CRITICAL REQUIREMENTS:
            1. Format your response as a valid JSON object that can be parsed directly
            2. Create exactly 10 questions
            3. Each question must have exactly 4 possible answers (A, B, C, D)
            4. Only one answer should be correct
            5. Ensure factual accuracy in questions and answers
            6. Cover a variety of aspects related to the topic
            7. Vary the difficulty level from easy to moderately challenging
            8. DO NOT include any text outside the JSON object
            
            The response format MUST be EXACTLY as follows:
            {
              "title": "Quiz title related to the topic",
              "questions": [
                {
                  "question": "Question text here?",
                  "options": {
                    "A": "First option",
                    "B": "Second option",
                    "C": "Third option",
                    "D": "Fourth option"
                  },
                  "correctAnswer": "A",
                  "explanation": "Brief explanation of why this answer is correct"
                }
                // ... 9 more similar question objects
              ]
            }`
          },
          {
            role: 'user',
            content: `Create a 10-question multiple-choice quiz about: ${prompt}`
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

    // Try to parse the response as JSON
    const content = response.data.choices[0].message.content;
    
    try {
      // Find JSON in the response (in case there's text around it)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      
      const quizData = JSON.parse(jsonStr);
      
      // Validate the quiz format
      if (!quizData.title || !Array.isArray(quizData.questions) || quizData.questions.length !== 10) {
        throw new Error('Invalid quiz format received from API');
      }
      
      return quizData;
    } catch (parseError) {
      console.error('Error parsing quiz JSON:', parseError);
      console.error('Raw content:', content);
      throw new Error('Failed to parse quiz data from API response');
    }
  } catch (error) {
    console.error('Error calling OpenRouter API:', error);
    if (error.response) {
      console.error('API error status:', error.response.status);
      console.error('API error data:', error.response.data);
    }
    throw error;
  }
}

// Function to start the quiz interaction
async function startQuiz(message, loadingMessage, quiz) {
  // Create a unique session ID for this quiz
  const sessionId = Date.now().toString();
  
  // Create the initial quiz embed
  const quizEmbed = new EmbedBuilder()
    .setColor('#4b72c6')
    .setTitle(`📝 ${quiz.title}`)
    .setDescription(`This quiz contains 10 multiple-choice questions about ${quiz.title}. Click the buttons to answer each question.`)
    .addFields(
      { name: 'Instructions', value: 'Use the buttons below to select your answer for each question. After answering all questions, you will see your final score.' },
      { name: 'Questions', value: '10 questions in total' },
      { name: 'Created for', value: `<@${message.author.id}>` }
    )
    .setFooter({ text: 'Generated using AI • Quiz will start momentarily' })
    .setTimestamp();
  
  // Edit the loading message with the quiz introduction
  await loadingMessage.edit({ 
    content: `${message.author} Your quiz is ready!`, 
    embeds: [quizEmbed] 
  });
  
  // Wait a moment before starting
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Start the actual quiz
  await runQuizQuestions(message, loadingMessage, quiz, sessionId);
}

// Function to run through all quiz questions
async function runQuizQuestions(message, loadingMessage, quiz, sessionId) {
  const userAnswers = [];
  const collector = message.channel.createMessageComponentCollector({ time: 15 * 60 * 1000 }); // 15 minutes timeout
  
  let currentQuestionIndex = 0;
  
  // Send the first question
  const questionMessage = await sendQuestion(message, quiz.questions[currentQuestionIndex], currentQuestionIndex, sessionId);
  
  // Handle button interactions
  collector.on('collect', async interaction => {
    // Only allow the original quiz taker to answer
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({ 
        content: 'This quiz is not for you. Use !generatequiz to create your own quiz!', 
        ephemeral: true 
      });
      return;
    }
    
    const [action, qIndex, answer, qSessionId] = interaction.customId.split('_');
    
    // Verify this is a response to the current question and session
    if (action !== 'quiz' || parseInt(qIndex) !== currentQuestionIndex || qSessionId !== sessionId) {
      await interaction.reply({ 
        content: 'This question is no longer active or belongs to a different quiz.', 
        ephemeral: true 
      });
      return;
    }
    
    // Record the answer
    userAnswers.push({
      questionIndex: currentQuestionIndex,
      userAnswer: answer,
      correctAnswer: quiz.questions[currentQuestionIndex].correctAnswer,
      isCorrect: answer === quiz.questions[currentQuestionIndex].correctAnswer
    });
    
    // Disable all buttons
    const disabledButtons = new ActionRowBuilder()
      .addComponents(
        Object.keys(quiz.questions[currentQuestionIndex].options).map(option => {
          const button = ButtonBuilder
            .setCustomId(`disabled_${option}`)
            .setLabel(option)
            .setStyle(
              option === answer ? 
                (option === quiz.questions[currentQuestionIndex].correctAnswer ? ButtonStyle.Success : ButtonStyle.Danger) :
                (option === quiz.questions[currentQuestionIndex].correctAnswer ? ButtonStyle.Success : ButtonStyle.Secondary)
            )
            .setDisabled(true);
          return button;
        })
      );
    
    // Show feedback for the answer
    const isCorrect = answer === quiz.questions[currentQuestionIndex].correctAnswer;
    const feedbackEmbed = new EmbedBuilder()
      .setColor(isCorrect ? '#00cc44' : '#cc3300')
      .setTitle(isCorrect ? '✅ Correct!' : '❌ Incorrect')
      .setDescription(quiz.questions[currentQuestionIndex].explanation)
      .setFooter({ text: `Question ${currentQuestionIndex + 1} of 10` });
    
    await interaction.update({ 
      embeds: [feedbackEmbed],
      components: [disabledButtons] 
    });
    
    // Wait a moment before moving to the next question
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Move to the next question or show results
    currentQuestionIndex++;
    
    if (currentQuestionIndex < quiz.questions.length) {
      await sendQuestion(message, quiz.questions[currentQuestionIndex], currentQuestionIndex, sessionId);
    } else {
      // End of quiz, show results
      collector.stop('completed');
      await showQuizResults(message, userAnswers, quiz);
    }
  });
  
  collector.on('end', (collected, reason) => {
    if (reason === 'time') {
      message.channel.send(`${message.author} Your quiz has timed out. You answered ${userAnswers.length} out of 10 questions.`);
    }
  });
}

// Function to send a single question
async function sendQuestion(message, questionData, index, sessionId) {
  // Create the question embed
  const questionEmbed = new EmbedBuilder()
    .setColor('#4b72c6')
    .setTitle(`Question ${index + 1} of 10`)
    .setDescription(questionData.question)
    .addFields(
      Object.entries(questionData.options).map(([key, value]) => {
        return { name: `Option ${key}`, value: value, inline: true };
      })
    )
    .setFooter({ text: 'Select your answer using the buttons below' });
  
  // Create the answer buttons
  const buttons = new ActionRowBuilder()
    .addComponents(
      Object.keys(questionData.options).map(option => {
        return new ButtonBuilder()
          .setCustomId(`quiz_${index}_${option}_${sessionId}`)
          .setLabel(option)
          .setStyle(ButtonStyle.Primary);
      })
    );
  
  // Send the question
  return await message.channel.send({
    content: `${message.author} Question ${index + 1}:`,
    embeds: [questionEmbed],
    components: [buttons]
  });
}

// Function to show quiz results
async function showQuizResults(message, userAnswers, quiz) {
  // Calculate score
  const correctAnswers = userAnswers.filter(answer => answer.isCorrect).length;
  const score = (correctAnswers / userAnswers.length) * 100;
  
  // Determine performance message
  let performanceMessage;
  if (score >= 90) {
    performanceMessage = "Amazing! You're an expert! 🌟";
  } else if (score >= 70) {
    performanceMessage = "Great job! You know your stuff! 👍";
  } else if (score >= 50) {
    performanceMessage = "Not bad! You've got the basics down. 📚";
  } else {
    performanceMessage = "Keep learning! You'll do better next time. 📝";
  }
  
  // Create results embed
  const resultsEmbed = new EmbedBuilder()
    .setColor('#7289da')
    .setTitle('🏆 Quiz Results')
    .setDescription(`You completed the quiz: **${quiz.title}**`)
    .addFields(
      { name: 'Score', value: `${correctAnswers} out of ${userAnswers.length} (${Math.round(score)}%)`, inline: false },
      { name: 'Performance', value: performanceMessage, inline: false }
    )
    .setFooter({ text: 'Generated using AI • Use !generatequiz to create another quiz' })
    .setTimestamp();
  
  // Add summary of questions and answers
  let answerSummary = '';
  userAnswers.forEach((answer, i) => {
    const questionNumber = i + 1;
    const questionText = quiz.questions[answer.questionIndex].question;
    const userAnswer = quiz.questions[answer.questionIndex].options[answer.userAnswer];
    const correctAnswer = quiz.questions[answer.questionIndex].options[answer.correctAnswer];
    
    const resultSymbol = answer.isCorrect ? '✅' : '❌';
    answerSummary += `**Q${questionNumber}:** ${questionText.substring(0, 60)}${questionText.length > 60 ? '...' : ''}\n`;
    answerSummary += `${resultSymbol} Your answer: ${answer.userAnswer}) ${userAnswer}\n`;
    
    if (!answer.isCorrect) {
      answerSummary += `👉 Correct answer: ${answer.correctAnswer}) ${correctAnswer}\n`;
    }
    
    answerSummary += '\n';
  });
  
  // Send summary in one or more messages if needed
  if (answerSummary.length <= 1024) {
    resultsEmbed.addFields({ name: 'Answer Summary', value: answerSummary });
    await message.channel.send({ 
      content: `${message.author} Here are your quiz results:`,
      embeds: [resultsEmbed] 
    });
  } else {
    // Send results first
    await message.channel.send({ 
      content: `${message.author} Here are your quiz results:`,
      embeds: [resultsEmbed] 
    });
    
    // Then send answer summary separately
    const summaryEmbed = new EmbedBuilder()
      .setColor('#7289da')
      .setTitle('📋 Detailed Answer Summary')
      .setDescription(answerSummary.substring(0, 4000))
      .setFooter({ text: 'Use !generatequiz to try another quiz' });
    
    await message.channel.send({ embeds: [summaryEmbed] });
  }
}

module.exports = { handleQuizCommand };
