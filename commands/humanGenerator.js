const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getPrefix } = require('./prefixCommand');

// Map to track users waiting for responses to the human generation questions
const usersWaitingForHumanResponse = new Map();
// Map to track users waiting for word count input
const usersWaitingForWordCount = new Map();

/**
 * Generates a question about a given topic to analyze the user's writing style
 * @param {string} topic - The topic to generate a question about
 * @returns {Promise<string>} - The generated question
 */
async function generateQuestion(topic) {
  try {
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'amazon/nova-2-lite-v1:free',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at generating clear, simple questions that anyone can understand. Your questions should be straightforward, use everyday language, and avoid complex terminology. They should still encourage users to express their views and writing style, but in a way that is accessible to people of all education levels and backgrounds. Always respond in the same language as the user\'s request.'
          },
          {
            role: 'user',
            content: `Create a simple, clear question about "${topic}" that anyone can understand.

The question should:
- Use everyday language and simple vocabulary
- Avoid jargon, technical terms, and complex phrasing
- Be concise (ideally under 20 words)
- Still encourage the user to share their personal views and opinions
- Be neutral but engaging
- Be specifically about ${topic}
- Write in the SAME LANGUAGE as the user's prompt.`
          }
        ],
        temperature: 0.5
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const question = response.data.choices[0].message.content.trim();
    return question;
  } catch (error) {
    throw new Error('Failed to generate a question. Please try again later.');
  }
}

/**
 * Analyzes user's response and generates academic text in their style
 * @param {string} topic - The original topic
 * @param {string} userResponse - The user's response to the question
 * @param {string} question - The question that was asked to the user
 * @param {number} wordCount - The desired word count for the academic text
 * @returns {Promise<string>} - The generated academic text
 */
async function generateAcademicText(topic, userResponse, question, wordCount = 1500) {
  try {
    
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'amazon/nova-2-lite-v1:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert at analyzing human writing styles and generating new content that perfectly mimics a person's unique writing patterns, vocabulary preferences, sentence structures, speech patterns, and ideological perspectives. 
            
            Your goal is to create text that is indistinguishable from what the human would write themselves - maintaining all their unique quirks, flaws, inconsistencies, and personal touches that make human writing distinctly non-AI.
            
            Pay special attention to:
            1. Subtle language patterns unique to the individual
            2. Any informal elements, slang, or colloquialisms they use
            3. Their specific sentence length preferences and paragraph structuring
            4. Any grammatical patterns or even "errors" that appear consistently - do NOT correct these errors
            5. How they transition between ideas
            6. Their emotional tone and how they express opinions
            7. Their exact vocabulary level - never use words that seem more advanced than what they've shown
            8. The precise frequency of grammar mistakes - if they make mistakes, you should make SIMILAR mistakes at a similar rate
            
            Create content that deliberately maintains these human elements. Do NOT improve or standardize their writing style in any way. If they have a limited vocabulary, use the same limited vocabulary. If they make grammar mistakes, make similar grammar mistakes.`
          },
          {
            role: 'user',
            content: `Here is a sample of my writing on the topic of "${topic}" in response to the question: "${question}"

${userResponse}

Based on my writing style, vocabulary choices, sentence structures, and ideological perspective evident in the above text, please generate a comprehensive academic text of ${wordCount} words on the topic of "${topic}". 

The generated text should:
1. Perfectly mimic my writing style, vocabulary, and sentence structures - maintain any quirks, informality, or unique patterns
2. Reflect my apparent ideological perspective and opinions on the topic
3. Be structured like an academic paper but maintain the natural, human-like flow of my writing
4. Include sophisticated arguments, evidence, and analysis consistent with my apparent knowledge level
5. Feel as though I wrote it myself, maintaining my authentic voice
6. Preserve any idiosyncrasies, casual elements, or stylistic inconsistencies present in my writing
7. NOT sound AI-generated or overly polished - maintain the natural imperfections of human writing
8. Write in the SAME LANGUAGE as the user's prompt.
9. Maintain EXACTLY the same grammar level as my sample - if I make grammar mistakes, make similar types of mistakes with the same frequency
10. Use ONLY vocabulary at the same level of complexity as my sample - don't use words I wouldn't use
11. If I use slang, repetitive phrases, or have other speech patterns, incorporate these at the same frequency

The most important aspect is to exactly match my vocabulary and grammar level. Do NOT improve my writing or make it more eloquent or correct than my sample. If my sample contains grammar errors or limited vocabulary, your generated text should contain similar patterns. The goal is to create text that I could have plausibly written myself in the exact language, style and grammar level I used in my sample.`
          }
        ],
        temperature: 0.8 // Increased temperature to encourage more human-like, varied text
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const academicText = response.data.choices[0].message.content;
    return academicText;
  } catch (error) {
    throw new Error('Failed to generate academic text. Please try again later.');
  }
}

/**
 * Handles the initial !generatehuman command
 * @param {Object} message - The Discord message object
 * @returns {Promise<Object>} - Information about the waiting state, including the question
 */
async function handleHumanGeneratorCommand(message) {
  try {
    // Get the server's prefix
    const prefix = await getPrefix(message.guild?.id);
    
    // Extract the topic from the command (everything after prefix+generatehuman)
    const commandPrefix = message.content.startsWith(`${prefix}generatehuman`) 
      ? `${prefix}generatehuman` 
      : `${prefix}human`;
      
    let topic = message.content.slice(commandPrefix.length).trim();
    
    if (!topic) {
      await message.reply(`Please provide a topic. Example: \`${prefix}generatehuman climate change\``);
      return null;
    }
    
    const loadingMessage = await message.reply(`Generating a question about "${topic}"...`);
    
    const question = await generateQuestion(topic);
    
    const questionEmbed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`Question about ${topic}`)
      .setDescription(question)
      .setFooter({ text: 'Please respond with at least 50 words in your next message' });
    
    await loadingMessage.edit({
      content: `${message.author}, please answer the following question about "${topic}" in your next message. For best results, please write at least 50 words in your response. After your response, you'll be able to choose how many words of academic text to generate:`,
      embeds: [questionEmbed]
    });
    
    // Return information needed to set up the waiting state, including the question and prefix
    return { topic, loadingMessage, question, prefix };
  } catch (error) {
    message.reply('Sorry, there was an error generating your question. Please try again later.');
    return null;
  }
}

/**
 * Handles the user's response to the human generator question
 * @param {string} userId - The Discord user ID
 * @param {Object} humanData - Data containing topic, loadingMessage, question, and prefix
 * @param {string} userResponse - The user's response to the question
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Whether the processing was successful
 */
async function handleHumanResponseInput(userId, humanData, userResponse, message) {
  const { topic, loadingMessage, question, prefix = '!' } = humanData;
  
  // Check if the response is too short
  const wordCount = userResponse.split(/\s+/).length;
  if (wordCount < 50) {
    await loadingMessage.edit(`Your response was only ${wordCount} words. For better results, please use the \`${prefix}generatehuman\` command again and provide at least 50 words in your answer.`);
    return false;
  }
  
  // Store the user's response for later use when generating the academic text
  const responseData = { topic, loadingMessage, question, userResponse, prefix };
  usersWaitingForWordCount.set(userId, responseData);
  
  // Create an embed to ask for the desired word count
  const wordCountEmbed = new EmbedBuilder()
    .setColor('#f39c12')
    .setTitle('Choose Word Count')
    .setDescription('How many words would you like in your academic text? Please respond with a number between 100 and 3000.')
    .setFooter({ text: 'Type a number (e.g., 1500) in your next message' });
  
  await loadingMessage.edit({
    content: `${message.author}, I've received your ${wordCount}-word response. Now, please specify how many words of academic text you'd like me to generate:`,
    embeds: [wordCountEmbed]
  });
  
  // Remove the user from waiting for human response
  usersWaitingForHumanResponse.delete(userId);
  
  return true;
}

/**
 * Handles the user's word count input
 * @param {string} userId - The Discord user ID
 * @param {string} wordCountInput - The user's input for word count
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Whether the processing was successful
 */
async function handleWordCountInput(userId, wordCountInput, message) {
  // Get the stored response data
  const responseData = usersWaitingForWordCount.get(userId);
  if (!responseData) {
    const prefix = await getPrefix(message.guild?.id);
    message.reply(`I couldn't find your previous response. Please start again with the ${prefix}generatehuman command.`);
    return false;
  }
  
  const { topic, loadingMessage, question, userResponse, prefix = '!' } = responseData;
  
  // Parse the word count input
  let desiredWordCount = parseInt(wordCountInput.trim(), 10);
  
  // Validate the word count
  if (isNaN(desiredWordCount) || desiredWordCount < 100 || desiredWordCount > 3000) {
    await loadingMessage.edit(`Invalid word count. Please provide a number between 100 and 3000. You entered: "${wordCountInput}"`);
    return false;
  }
  
  await loadingMessage.edit(`Analyzing your response and generating a ${desiredWordCount}-word academic text about "${topic}"... This might take several minutes.`);
  
  try {
    const academicText = await generateAcademicText(topic, userResponse, question, desiredWordCount);
    
    // Split the text into chunks of maximum 1900 characters to fit within Discord's message limit
    const MAX_MESSAGE_LENGTH = 1900;
    const textChunks = [];
    
    for (let i = 0; i < academicText.length; i += MAX_MESSAGE_LENGTH) {
      textChunks.push(academicText.substring(i, i + MAX_MESSAGE_LENGTH));
    }
    
    // Create an embed for the first part
    const academicEmbed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle(`Academic Text on ${topic}`)
      .setDescription(textChunks.length > 1 ? 'Here is your academic text (split into multiple messages):' : 'Here is your academic text:')
      .addFields(
        { 
          name: '💬 Looking for a completely anonymous chatting experience?', 
          value: 'Try [Luck Off](https://luckoff.chat/) - an end-to-end encrypted chat platform. Free with no registration or installation required!'
        }
      )
      .setFooter({ text: `Generated based on your writing style • ${textChunks.length} part${textChunks.length > 1 ? 's' : ''} • Target: ${desiredWordCount} words` })
      .setTimestamp();
    
    await message.channel.send({
      content: `${message.author}, I've analyzed your writing style and generated a ${desiredWordCount}-word academic text on "${topic}" that matches your style and perspective:`,
      embeds: [academicEmbed]
    });
    
    // Send each chunk as a separate message
    for (let i = 0; i < textChunks.length; i++) {
      await message.channel.send(`**Part ${i + 1}/${textChunks.length}**:\n\n${textChunks[i]}`);
      
      // Add a small delay between messages to avoid rate limiting
      if (i < textChunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    await loadingMessage.edit(`✅ ${desiredWordCount}-word academic text on "${topic}" generated successfully based on your writing style! You can use \`${prefix}human\` again to generate more content.`);
    
    // Remove the user from waiting for word count
    usersWaitingForWordCount.delete(userId);
    
    return true;
  } catch (error) {
    await loadingMessage.edit(`Sorry, there was an error generating the academic text on "${topic}". Please try again later with \`${prefix}human\`.`);
    // Remove the user from waiting for word count
    usersWaitingForWordCount.delete(userId);
    return false;
  }
}

module.exports = {
  handleHumanGeneratorCommand,
  handleHumanResponseInput,
  handleWordCountInput,
  usersWaitingForHumanResponse,
  usersWaitingForWordCount
};
