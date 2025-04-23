const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

// Map to track users waiting for responses to the human generation questions
const usersWaitingForHumanResponse = new Map();

/**
 * Generates a question about a given topic to analyze the user's writing style
 * @param {string} topic - The topic to generate a question about
 * @returns {Promise<string>} - The generated question
 */
async function generateQuestion(topic) {
  try {
    console.log(`Generating question about topic: ${topic}`);
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at generating thought-provoking questions that will elicit a detailed, opinionated response from users. Your questions should be open-ended and encourage users to express their views and writing style. Always respond in the same language as the user\'s request.'
          },
          {
            role: 'user',
            content: `Create a thought-provoking question about "${topic}" that will encourage the user to write at least a paragraph expressing their personal views, opinions, and knowledge about this topic. The question should be neutral but stimulating, allowing me to analyze their writing style and perspective. Make the question specifically about ${topic} and be concise. IMPORTANT: Respond in the same language as my request (e.g., if I asked in Greek, respond in Greek; if I asked in English, respond in English, etc.).`
          }
        ],
        temperature: 0.7
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
    console.error('Error generating question:', error);
    if (error.response) {
      console.error('API error response:', error.response.data);
    }
    throw new Error('Failed to generate a question. Please try again later.');
  }
}

/**
 * Analyzes user's response and generates academic text in their style
 * @param {string} topic - The original topic
 * @param {string} userResponse - The user's response to the question
 * @returns {Promise<string>} - The generated academic text
 */
async function generateAcademicText(topic, userResponse) {
  try {
    console.log(`Generating academic text based on user response of length: ${userResponse.length}`);
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'sophosympatheia/rogue-rose-103b-v0.2:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert at analyzing human writing styles and generating new content that perfectly mimics a person's unique writing patterns, vocabulary preferences, sentence structures, speech patterns, and ideological perspectives. 
            
            Your goal is to create text that is indistinguishable from what the human would write themselves - maintaining all their unique quirks, flaws, inconsistencies, and personal touches that make human writing distinctly non-AI.
            
            Pay special attention to:
            1. Subtle language patterns unique to the individual
            2. Any informal elements, slang, or colloquialisms they use
            3. Their specific sentence length preferences and paragraph structuring
            4. Any grammatical patterns or even "errors" that appear consistently
            5. How they transition between ideas
            6. Their emotional tone and how they express opinions
            
            Create content that maintains these human elements rather than "improving" or standardizing their writing style.`
          },
          {
            role: 'user',
            content: `Here is a sample of my writing on the topic of "${topic}":

${userResponse}

Based on my writing style, vocabulary choices, sentence structures, and ideological perspective evident in the above text, please generate a comprehensive academic text of 1500-2000 words on the topic of "${topic}". 

The generated text should:
1. Perfectly mimic my writing style, vocabulary, and sentence structures - maintain any quirks, informality, or unique patterns
2. Reflect my apparent ideological perspective and opinions on the topic
3. Be structured like an academic paper but maintain the natural, human-like flow of my writing
4. Include sophisticated arguments, evidence, and analysis consistent with my apparent knowledge level
5. Feel as though I wrote it myself, maintaining my authentic voice
6. Preserve any idiosyncrasies, casual elements, or stylistic inconsistencies present in my writing
7. NOT sound AI-generated or overly polished - maintain the natural imperfections of human writing
8. Use the SAME LANGUAGE that I used in my response (e.g., if I wrote in Greek, English, German, etc., respond in that same language)

Maintain my apparent level of expertise, whether I seem knowledgeable or not. The goal is to create text that I could have plausibly written myself in the exact language I used in my prompt.`
          }
        ],
        temperature: 0.9 // Increased temperature to encourage more human-like, varied text
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
    console.error('Error generating academic text:', error);
    if (error.response) {
      console.error('API error response:', error.response.data);
    }
    throw new Error('Failed to generate academic text. Please try again later.');
  }
}

/**
 * Handles the initial !generatehuman command
 * @param {Object} message - The Discord message object
 * @returns {Promise<Object>} - Information about the waiting state
 */
async function handleHumanGeneratorCommand(message) {
  try {
    // Extract the topic from the command (everything after !generatehuman)
    const commandPrefix = '!generatehuman';
    let topic = message.content.slice(commandPrefix.length).trim();
    
    if (!topic) {
      return message.reply('Please provide a topic. Example: `!generatehuman climate change`');
    }
    
    const loadingMessage = await message.reply(`Generating a question about "${topic}"...`);
    
    const question = await generateQuestion(topic);
    
    const questionEmbed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`Question about ${topic}`)
      .setDescription(question)
      .setFooter({ text: 'Please respond to this question in your next message' });
    
    await loadingMessage.edit({
      content: `${message.author}, please answer the following question about "${topic}" in your next message:`,
      embeds: [questionEmbed]
    });
    
    // Return information needed to set up the waiting state
    return { topic, loadingMessage };
  } catch (error) {
    console.error('Error in handleHumanGeneratorCommand:', error);
    message.reply('Sorry, there was an error generating your question. Please try again later.');
    return null;
  }
}

/**
 * Handles the user's response to the human generator question
 * @param {string} userId - The Discord user ID
 * @param {Object} humanData - Data containing topic and loadingMessage
 * @param {string} userResponse - The user's response to the question
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Whether the processing was successful
 */
async function handleHumanResponseInput(userId, humanData, userResponse, message) {
  const { topic, loadingMessage } = humanData;
  
  await loadingMessage.edit(`Analyzing your response and generating an academic text about "${topic}"... This might take several minutes.`);
  
  try {
    const academicText = await generateAcademicText(topic, userResponse);
    
    // Split the text into chunks of maximum 2000 characters to fit within Discord's message limit
    const MAX_MESSAGE_LENGTH = 2000;
    const textChunks = [];
    
    for (let i = 0; i < academicText.length; i += MAX_MESSAGE_LENGTH) {
      textChunks.push(academicText.substring(i, i + MAX_MESSAGE_LENGTH));
    }
    
    // Create an embed for the first part
    const academicEmbed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle(`Academic Text on ${topic}`)
      .setDescription(textChunks.length > 1 ? 'Here is your academic text (split into multiple messages):' : 'Here is your academic text:')
      .setFooter({ text: `Generated based on your writing style • ${textChunks.length} part${textChunks.length > 1 ? 's' : ''}` })
      .setTimestamp();
    
    await message.channel.send({
      content: `${message.author}, I've analyzed your writing style and generated an academic text on "${topic}" that matches your style and perspective:`,
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
    
    await loadingMessage.edit(`✅ Academic text on "${topic}" generated successfully based on your writing style!`);
    
    return true;
  } catch (error) {
    console.error('Error processing human response:', error);
    await loadingMessage.edit(`Sorry, there was an error generating the academic text on "${topic}". Please try again later.`);
    return false;
  }
}

module.exports = {
  handleHumanGeneratorCommand,
  handleHumanResponseInput,
  usersWaitingForHumanResponse
};
