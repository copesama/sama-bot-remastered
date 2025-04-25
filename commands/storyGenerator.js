const axios = require('axios');
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');

// Function to generate a story using OpenRouter API
async function generateStory(prompt, characterNames) {
  try {
    const enhancedPrompt = `Write a creative and engaging story based on the following scenario: ${prompt}

CHARACTERS TO INCLUDE:
${characterNames.map((name, index) => `- ${name}`).join('\n')}

REQUIREMENTS:
- Feature all the listed characters prominently in the story
- Give each character meaningful dialogue and actions
- Create an interesting plot with a beginning, middle, and satisfying conclusion
- Write in an engaging narrative style with descriptive language
- The story should be well-structured and 1000-2000 words in length
- Divide the story into clear paragraphs with natural breaks
- Write in the SAME LANGUAGE as the user's prompt. If the prompt is in Greek, write the story in Greek. If in English, write it in English, etc.`;

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'sophosympatheia/rogue-rose-103b-v0.2:free',
        messages: [
          {
            role: 'system',
            content: 'You are an expert creative writer skilled in crafting engaging stories featuring specific characters. Create an immersive narrative that includes all provided character names and follows the scenario described by the user. Your writing should be vivid, with natural dialogue, good pacing, and a satisfying conclusion.  Write in the SAME LANGUAGE as the user\'s prompt. If the prompt is in Greek, write the story in Greek. If in English, write it in English, etc.'
          },
          {
            role: 'user',
            content: enhancedPrompt
          }
        ],
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const story = response.data.choices[0].message.content;
    
    return story;
  } catch (error) {
    if (error.response) {
      // Do nothing, removed console logging
    }
    
    throw error;
  }
}

// Function to extract a description from a story chunk for image generation
async function extractDescriptionFromStoryChunk(chunk, characterNames) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert at extracting vivid scene descriptions from text. Given a chunk of a story, 
            create a concise, detailed visual description that captures the most significant scene or moment from the text. 
            This description will be used to generate an accompanying image with character faces replaced by profile pictures.

            REQUIREMENTS:
            - Focus on describing ONE clear, vivid scene from the text
            - Frame the scene like a portrait where characters' faces are clearly visible
            - Position characters' heads/faces prominently in the scene, ideally facing forward
            - Specify that characters should have clearly visible faces/heads (these will be replaced with avatars)
            - Include details about character positioning and their relative placement to each other
            - Capture the setting, atmosphere, and mood
            - Be specific about visual elements (colors, lighting, positioning)
            - Keep the description between 10-20 words
            - Do NOT include character names directly - describe them visually instead
            - Write the description in English regardless of the story's language
            - Respond ONLY with the description - no explanations or other text`
          },
          {
            role: 'user',
            content: `Here's a chunk of a story featuring characters: ${characterNames.join(', ')}

${chunk}

Extract a vivid scene description for an image generator. Focus on the most visually interesting moment where the characters' faces are clearly visible, as if posing for a portrait. Ensure the description will work well for an image where profile pictures will be placed on the characters' heads. Write the description in English regardless of the story's language.`
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

    const description = response.data.choices[0].message.content.trim();
    
    return description;
  } catch (error) {
    return `A portrait-style scene featuring ${characterNames.length} people with their faces clearly visible, positioned at eye level with the viewer, adventurous style`;
  }
}

// Function to generate and send story with images
async function generateAndSendStoryWithImages(message, storyPrompt, characterUsers, loadingMessage, generateImageWithAvatars, IMAGES_DIR) {
  try {
    const characterNames = characterUsers.map(user => user.username);
    
    const story = await generateStory(storyPrompt, characterNames);
    
    await loadingMessage.edit('📝 Story generated! Now creating images for each part of the story... This will take a few more minutes.');
    
    const MAX_MESSAGE_LENGTH = 1800;
    let storyChunks = [];
    
    if (story.length <= MAX_MESSAGE_LENGTH) {
      storyChunks = [story];
    } else {
      const paragraphs = story.split(/\n\n+/);
      let currentChunk = '';
      
      for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length + 2 > MAX_MESSAGE_LENGTH && currentChunk.length > 0) {
          storyChunks.push(currentChunk);
          currentChunk = paragraph;
        } else {
          if (currentChunk.length > 0) {
            currentChunk += '\n\n' + paragraph;
          } else {
            currentChunk = paragraph;
          }
        }
      }
      
      if (currentChunk.length > 0) {
        storyChunks.push(currentChunk);
      }
    }
    
    const failedChunks = [];
    
    for (let i = 0; i < storyChunks.length; i++) {
      const chunk = storyChunks[i];
      const chunkNumber = i + 1;
      
      await loadingMessage.edit(`📝 Creating image ${chunkNumber}/${storyChunks.length} for your story...`);
      
      try {
        const imageDescription = await extractDescriptionFromStoryChunk(chunk, characterNames);
        
        const avatarUrls = characterUsers.map(user => 
          user.displayAvatarURL({ format: 'png', size: 512 })
        );
        
        const { imageId, imagePath } = await generateImageWithAvatars(imageDescription, avatarUrls);
        
        const imageEmbed = new EmbedBuilder()
          .setColor('#ff6600')
          .setTitle(`📖 Part ${chunkNumber} of ${storyChunks.length}`)
          .setImage(`attachment://${imageId}.png`)
          .setFooter({ text: `Story image ${chunkNumber}/${storyChunks.length} • Generated with AI` });
        
        await message.channel.send({
          content: chunk,
          embeds: [imageEmbed],
          files: [{ attachment: imagePath, name: `${imageId}.png` }]
        });
        
        setTimeout(() => {
          try {
            fs.unlinkSync(imagePath);
          } catch (err) {
            // Do nothing, removed console logging
          }
        }, 5000);
        
      } catch (error) {
        failedChunks.push({ index: i, chunkNumber, chunk });
        
        await message.channel.send({
          content: `**Part ${chunkNumber} of ${storyChunks.length}:**\n\n${chunk}\n\n*(Image generation failed for this part)*`
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const summaryEmbed = new EmbedBuilder()
      .setColor('#9966cc')
      .setTitle('📚 Story Complete!')
      .setDescription(`Your story "${storyPrompt}" featuring ${characterUsers.map(user => user.username).join(', ')} is now complete.`)
      .addFields(
        { name: 'Story Stats', value: `${storyChunks.length} parts\n${story.length} characters`, inline: true },
        { name: 'Image Generation', value: `${storyChunks.length - failedChunks.length}/${storyChunks.length} successful`, inline: true },
        { 
          name: '🔒 Looking for a completely anonymous chatting experience?', 
          value: 'Try [Luck Off](https://luckoff.chat/) - an end-to-end encrypted chat platform. Free with no registration or installation required!'
        }
      )
      .setFooter({ text: 'Generated using AI • Story with images created just for you' })
      .setTimestamp();
    
    await message.channel.send({ 
      content: `${message.author} Story generation complete!`,
      embeds: [summaryEmbed] });
    
    await loadingMessage.edit('✅ Story with images generated successfully!');
    
  } catch (error) {
    try {
      const characterNames = characterUsers.map(user => user.username);
      const story = await generateStory(storyPrompt, characterNames);
      
      const MAX_MESSAGE_LENGTH = 1900;
      for (let i = 0; i < story.length; i += MAX_MESSAGE_LENGTH) {
        const chunk = story.substring(i, i + MAX_MESSAGE_LENGTH);
        await message.channel.send(chunk);
      }
      
      await message.channel.send(`${message.author} I was unable to generate images for your story, but I've sent the complete text version. Enjoy!`);
      await loadingMessage.edit('⚠️ Story generated with text only (image generation failed).');
      
    } catch (fallbackError) {
      await loadingMessage.edit('Sorry, there was an error generating your story with images. Please try again later.');
    }
  }
}

// Function to handle the story command
async function handleStoryCommand(message, generateImageWithAvatars, IMAGES_DIR) {
  const characterUsers = Array.from(message.mentions.users.values());
  
  if (characterUsers.length === 0) {
    return message.reply('Please mention at least one user to include as a character in the story. Example: `!generatestory @username1 @username2`');
  }
  
  const loadingMessage = await message.reply(`I found ${characterUsers.length} character(s): ${characterUsers.map(user => user.username).join(', ')}. Now, please describe the scenario for the story in your next message.`);
  
  // Return information needed to set up the waiting state
  return { characterUsers, loadingMessage };
}

/**
 * Handles a user's story prompt input
 * @param {string} userId - The Discord user ID
 * @param {Object} storyData - Data containing characterUsers and loadingMessage
 * @param {string} storyPrompt - The user's story prompt
 * @param {Function} imageGenerator - Function to generate images
 * @param {string} imagesDir - Directory to store images
 */
async function handleStoryPromptInput(userId, storyData, storyPrompt, message, imageGenerator, imagesDir) {
  const { characterUsers, loadingMessage } = storyData;
  
  await loadingMessage.edit('📝 Generating your custom story with images... This might take several minutes as I craft a detailed narrative with visuals!');
  
  try {
    await generateAndSendStoryWithImages(
      message, 
      storyPrompt, 
      characterUsers, 
      loadingMessage, 
      imageGenerator, 
      imagesDir
    );
    
    return true;
  } catch (error) {
    let errorMessage = 'Sorry, there was an error generating your story with images. Please try again later.';
    
    if (error.message && error.message.includes('timeout')) {
      errorMessage = 'Sorry, story or image generation timed out. Please try a simpler prompt or try again later.';
    }
    
    await loadingMessage.edit(errorMessage);
    return false;
  }
}

module.exports = {
  handleStoryCommand,
  generateAndSendStoryWithImages,
  handleStoryPromptInput
};
