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
            9. DO NOT include any comments inside the JSON
            10. Use double quotes for all strings and property names
            11. Ensure all JSON syntax is valid and follows the exact structure provided
            
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
              ]
            }
            
            Return ONLY the JSON data with no additional text, comments, or explanations.`
          },
          {
            role: 'user',
            content: `Create a 10-question multiple-choice quiz about: ${prompt}. Follow the exact JSON format provided in the system message. Do not include any comments in the JSON.`
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
      // Log the raw content for debugging
      console.log("Raw API response content:", content.substring(0, 500) + "...");
      
      // First attempt: try to directly parse the content
      let quizData;
      try {
        quizData = JSON.parse(content);
      } catch (directParseError) {
        console.log("Direct JSON parsing failed, trying to extract JSON...");
        
        // Second attempt: Extract JSON using regex
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("No JSON object found in the response");
        }
        
        const jsonStr = jsonMatch[0];
        console.log("Extracted JSON:", jsonStr.substring(0, 500) + "...");
        
        // Clean the JSON before parsing
        // Replace any single quotes with double quotes
        const cleanedJson = jsonStr
          .replace(/'/g, '"')
          // Remove any trailing commas in arrays or objects
          .replace(/,(\s*[\]}])/g, '$1')
          // Remove any comments (both // and /* */ style)
          .replace(/\/\/.*?(\r?\n|$)/g, '$1')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        
        console.log("Cleaned JSON:", cleanedJson.substring(0, 500) + "...");
        quizData = JSON.parse(cleanedJson);
      }
      
      // Validate the quiz format
      if (!quizData.title || !Array.isArray(quizData.questions)) {
        throw new Error('Invalid quiz format: missing title or questions array');
      }
      
      // Make sure we have exactly 10 questions
      if (quizData.questions.length !== 10) {
        console.log(`Warning: Expected 10 questions but got ${quizData.questions.length}`);
        
        // If we have more than 10, trim to 10
        if (quizData.questions.length > 10) {
          quizData.questions = quizData.questions.slice(0, 10);
        }
        // If we have less than 10, generate defaults for the missing ones
        else if (quizData.questions.length < 10) {
          const missingCount = 10 - quizData.questions.length;
          for (let i = 0; i < missingCount; i++) {
            quizData.questions.push({
              question: `Bonus question ${i+1} about ${prompt}?`,
              options: {
                "A": "Option A",
                "B": "Option B",
                "C": "Option C",
                "D": "Option D"
              },
              correctAnswer: "A",
              explanation: `This is a backup question generated because the API didn't provide enough questions.`
            });
          }
        }
      }
      
      // Validate each question's format
      quizData.questions.forEach((question, index) => {
        // Ensure each question has the required properties
        if (!question.question || !question.options || !question.correctAnswer || !question.explanation) {
          console.log(`Warning: Question ${index+1} is missing required properties`);
          // Add missing properties with defaults
          question.question = question.question || `Question ${index+1} about ${prompt}?`;
          question.options = question.options || { "A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D" };
          question.correctAnswer = question.correctAnswer || "A";
          question.explanation = question.explanation || "This is the correct answer.";
        }
        
        // Ensure options has exactly A, B, C, D keys
        const optionKeys = Object.keys(question.options);
        const expectedKeys = ["A", "B", "C", "D"];
        
        if (optionKeys.length !== 4 || !expectedKeys.every(key => optionKeys.includes(key))) {
          console.log(`Warning: Question ${index+1} has incorrect option keys: ${optionKeys.join(', ')}`);
          
          // Fix options by creating a new object with the correct keys
          const fixedOptions = {};
          expectedKeys.forEach((key, i) => {
            fixedOptions[key] = optionKeys[i] ? question.options[optionKeys[i]] : `Option ${key}`;
          });
          question.options = fixedOptions;
          
          // Make sure correctAnswer is valid
          if (!expectedKeys.includes(question.correctAnswer)) {
            question.correctAnswer = "A";
          }
        }
      });
      
      return quizData;
    } catch (parseError) {
      console.error('Error parsing quiz JSON:', parseError);
      console.error('Raw content length:', content.length);
      console.error('Raw content first 1000 chars:', content.substring(0, 1000));
      
      // Create a fallback quiz as a last resort
      return generateFallbackQuiz(prompt);
    }
  } catch (error) {
    console.error('Error calling OpenRouter API:', error);
    if (error.response) {
      console.error('API error status:', error.response.status);
      console.error('API error data:', error.response.data);
    }
    
    // Create a fallback quiz if API call fails
    return generateFallbackQuiz(prompt);
  }
}

// Function to generate a fallback quiz when the API fails
function generateFallbackQuiz(topic) {
  console.log(`Generating fallback quiz for topic: ${topic}`);
  
  return {
    title: `Quiz about ${topic}`,
    questions: Array.from({ length: 10 }, (_, i) => ({
      question: `Question ${i+1} about ${topic}?`,
      options: {
        "A": `The first possible answer to question ${i+1}`,
        "B": `The second possible answer to question ${i+1}`,
        "C": `The third possible answer to question ${i+1}`,
        "D": `The fourth possible answer to question ${i+1}`
      },
      correctAnswer: ["A", "B", "C", "D"][i % 4],
      explanation: `This is a placeholder explanation for question ${i+1} because the quiz generation API encountered an error.`
    }))
  };
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
    const disabledComponents = [];
    
    try {
      const disabledButtons = new ActionRowBuilder();
      Object.keys(quiz.questions[currentQuestionIndex].options).forEach(option => {
        const style = option === answer 
          ? (option === quiz.questions[currentQuestionIndex].correctAnswer ? ButtonStyle.Success : ButtonStyle.Danger)
          : (option === quiz.questions[currentQuestionIndex].correctAnswer ? ButtonStyle.Success : ButtonStyle.Secondary);
          
        disabledButtons.addComponents(
          new ButtonBuilder()
            .setCustomId(`disabled_${option}`)
            .setLabel(option)
            .setStyle(style)
            .setDisabled(true)
        );
      });
      
      disabledComponents.push(disabledButtons);
    } catch (err) {
      console.error('Error creating disabled buttons:', err);
      // Create a simple fallback with just A, B, C, D
      try {
        const disabledButtons = new ActionRowBuilder();
        ['A', 'B', 'C', 'D'].forEach(option => {
          disabledButtons.addComponents(
            new ButtonBuilder()
              .setCustomId(`disabled_${option}`)
              .setLabel(option)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
        });
        disabledComponents.push(disabledButtons);
      } catch (innerErr) {
        console.error('Error creating fallback buttons:', innerErr);
      }
    }
    
    // Show feedback for the answer
    const isCorrect = answer === quiz.questions[currentQuestionIndex].correctAnswer;
    const feedbackEmbed = new EmbedBuilder()
      .setColor(isCorrect ? '#00cc44' : '#cc3300')
      .setTitle(isCorrect ? '✅ Correct!' : '❌ Incorrect')
      .setDescription(quiz.questions[currentQuestionIndex].explanation)
      .setFooter({ text: `Question ${currentQuestionIndex + 1} of 10` });
    
    await interaction.update({ 
      embeds: [feedbackEmbed],
      components: disabledComponents 
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
  try {
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
    const buttons = new ActionRowBuilder();
    
    // Add each option as a button
    Object.keys(questionData.options).forEach(option => {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`quiz_${index}_${option}_${sessionId}`)
          .setLabel(option)
          .setStyle(ButtonStyle.Primary)
      );
    });
    
    // Send the question
    return await message.channel.send({
      content: `${message.author} Question ${index + 1}:`,
      embeds: [questionEmbed],
      components: [buttons]
    });
  } catch (error) {
    console.error(`Error sending question ${index + 1}:`, error);
    
    // Create a simplified fallback question
    const fallbackEmbed = new EmbedBuilder()
      .setColor('#4b72c6')
      .setTitle(`Question ${index + 1} of 10`)
      .setDescription(questionData.question || `Question ${index + 1}`)
      .setFooter({ text: 'Select your answer using the buttons below' });
    
    // Create simplified buttons with just A, B, C, D
    const fallbackButtons = new ActionRowBuilder();
    ['A', 'B', 'C', 'D'].forEach(option => {
      const optionText = questionData.options?.[option] || `Option ${option}`;
      fallbackButtons.addComponents(
        new ButtonBuilder()
          .setCustomId(`quiz_${index}_${option}_${sessionId}`)
          .setLabel(option)
          .setStyle(ButtonStyle.Primary)
      );
      
      // Add the option text to the embed
      fallbackEmbed.addFields({ name: `Option ${option}`, value: optionText, inline: true });
    });
    
    return await message.channel.send({
      content: `${message.author} Question ${index + 1}:`,
      embeds: [fallbackEmbed],
      components: [fallbackButtons]
    });
  }
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
  
  try {
    // Add summary of questions and answers
    let answerSummary = '';
    userAnswers.forEach((answer, i) => {
      try {
        const questionNumber = i + 1;
        const questionText = quiz.questions[answer.questionIndex].question;
        const userAnswer = quiz.questions[answer.questionIndex].options[answer.userAnswer] || `Option ${answer.userAnswer}`;
        const correctAnswer = quiz.questions[answer.questionIndex].options[answer.correctAnswer] || `Option ${answer.correctAnswer}`;
        
        const resultSymbol = answer.isCorrect ? '✅' : '❌';
        answerSummary += `**Q${questionNumber}:** ${questionText.substring(0, 60)}${questionText.length > 60 ? '...' : ''}\n`;
        answerSummary += `${resultSymbol} Your answer: ${answer.userAnswer}) ${userAnswer}\n`;
        
        if (!answer.isCorrect) {
          answerSummary += `👉 Correct answer: ${answer.correctAnswer}) ${correctAnswer}\n`;
        }
        
        answerSummary += '\n';
      } catch (err) {
        console.error(`Error processing answer summary for question ${i+1}:`, err);
        answerSummary += `**Q${i+1}:** [Error displaying this question]\n\n`;
      }
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
  } catch (error) {
    console.error('Error showing quiz results:', error);
    
    // Send a simplified result if there's an error
    const simpleResultsEmbed = new EmbedBuilder()
      .setColor('#7289da')
      .setTitle('🏆 Quiz Results')
      .setDescription(`You completed the quiz: **${quiz.title}**`)
      .addFields(
        { name: 'Score', value: `${correctAnswers} out of ${userAnswers.length} (${Math.round(score)}%)`, inline: false },
        { name: 'Performance', value: performanceMessage, inline: false },
        { name: 'Note', value: 'There was an error displaying the detailed answer summary.' }
      )
      .setFooter({ text: 'Generated using AI • Use !generatequiz to create another quiz' })
      .setTimestamp();
    
    await message.channel.send({ 
      content: `${message.author} Here are your quiz results:`,
      embeds: [simpleResultsEmbed] 
    });
  }
}

module.exports = { handleQuizCommand };
