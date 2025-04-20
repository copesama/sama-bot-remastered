require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
// Add voice-related imports
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const axios = require('axios');
const express = require('express');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');
const http = require('http');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');

// Import the finance news module - update to include the initFinanceNews function
const { handleFinanceNewsCommand, initFinanceNews } = require('./commands/financeNews');

// Import the quiz generator module
const { handleQuizCommand, clearUserQuiz } = require('./commands/quizGenerator');

// Import the music generator module
const { handleMusicCommand, cleanupVoiceConnections } = require('./commands/musicGenerator');

// Import the game generator module
const { handleSingleGameCommand, editGame, enhanceGame } = require('./commands/gameGenerator');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // Add voice state intent to track voice channels
  ]
});

// Initialize Express app for serving games
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// Create HTTP server using Express app
const server = http.createServer(app);

// Create games directory if it doesn't exist
const GAMES_DIR = path.join(__dirname, 'games');
if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR);
}

// Create music directory if it doesn't exist
const MUSIC_DIR = path.join(__dirname, 'music');
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR);
}

// Create images directory if it doesn't exist
const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR);
}

// Serve static game files
app.use('/games', express.static(GAMES_DIR));
app.use(cookieParser());

// Keep track of users waiting to provide image prompts
const usersWaitingForImagePrompt = new Map();

// Keep track of users waiting to provide story prompts
const usersWaitingForStoryPrompt = new Map();

// Track users who are in "edit mode"
const usersInEditMode = new Map();

// Game access with user authentication
app.get('/game/:gameId', (req, res) => {
  const gameId = req.params.gameId;
  const userToken = req.query.token;
  const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
  
  if (fs.existsSync(gamePath)) {
    // If we have a user token, verify it
    let userData = null;
    
    if (userToken) {
      try {
        userData = jwt.verify(userToken, JWT_SECRET);
        // Set cookie with user data for the game
        res.cookie('gameUserData', JSON.stringify(userData), { 
          maxAge: 3600000, // 1 hour
          httpOnly: false
        });
      } catch (err) {
        console.error('Invalid token:', err);
        // Generate a guest token if the provided token is invalid
        userData = generateGuestUserData();
        res.cookie('gameUserData', JSON.stringify(userData), { 
          maxAge: 3600000, 
          httpOnly: false 
        });
      }
    } else {
      // If no token provided, create a guest user
      userData = generateGuestUserData();
      res.cookie('gameUserData', JSON.stringify(userData), { 
        maxAge: 3600000, 
        httpOnly: false 
      });
    }
    
    res.sendFile(gamePath);
  } else {
    res.status(404).send('Game not found');
  }
});

// Helper function to generate random guest user data
function generateGuestUserData() {
  const guestId = `guest-${shortid.generate()}`;
  return {
    id: guestId,
    username: `Guest-${guestId.substring(6, 10)}`,
    avatar: `https://ui-avatars.com/api/?name=G&background=random&size=128`,
    isGuest: true
  };
}

// Function to generate image using Hugging Face API (step 1: text-to-image with white circles)
async function generateBaseImage(prompt, numAvatars) {
  try {
    // Calculate a reasonable percentage for the image generation prompt
    const circleSizeMinPercent = 15;
    const circleSizeMaxPercent = 20;
    
    // Create a more specific prompt that requests white circles for avatar placement with specific size requirements
    const enhancedPrompt = `${prompt}. Include exactly ${numAvatars} empty white circles where profile pictures should be placed. 
    IMPORTANT REQUIREMENTS FOR THE CIRCLES:
    - Each white circle must be at least ${circleSizeMinPercent}% of the image size
    - Circles must be very clearly visible with clean, defined edges
    - Position circles where heads would normally be in the scene
    - Make sure circles are perfectly round, not oval or irregular
    - The circles should be prominent and easily detectable
    - Ensure each circle has a solid white fill with no patterns
    - Completely hide/replace heads with these white circles`;
    
    console.log(`Step 1: Generating base image with enhanced prompt: ${enhancedPrompt}`);
    
    const payload = { inputs: enhancedPrompt };

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',
      }
    );

    // Generate temporary ID for the intermediate image file
    const tempImageId = `temp_${shortid.generate()}`;
    const tempImagePath = path.join(IMAGES_DIR, `${tempImageId}.png`);

    // Save the temporary image file
    fs.writeFileSync(tempImagePath, Buffer.from(response.data));
    console.log(`Base image with white circles saved to ${tempImagePath}`);

    return { tempImageId, tempImagePath };
  } catch (error) {
    console.error('Error generating base image with white circles:', error);
    if (error.response) {
      console.error('Error status:', error.response.status);
      try {
        const errorData = Buffer.from(error.response.data).toString('utf8');
        console.error('API error response:', errorData);
      } catch (e) {
        console.error('Could not parse error response data');
      }
    }
    throw error;
  }
}

// Updated function to place avatars into white circles using Jimp
async function placeAvatarsInCircles(baseImagePath, avatarUrls) {
  try {
    console.log(`Step 2: Placing ${avatarUrls.length} avatars into white circles`);
    
    const { Jimp, intToRGBA } = require('jimp');
    const baseImage = await Jimp.read(baseImagePath);
    const baseWidth = baseImage.width;
    const baseHeight = baseImage.height;
    
    const findWhiteCircles = async (image) => {
      const circles = [];
      const threshold = 230;
      const circleMinRadius = Math.min(baseWidth, baseHeight) * 0.05;
      
      console.log(`Using minimum circle radius threshold: ${circleMinRadius} pixels`);
      
      for (let y = 0; y < image.height; y += 10) {
        for (let x = 0; x < image.width; x += 10) {
          const { r, g, b } = intToRGBA(image.getPixelColor(x, y));
          
          if (r > threshold && g > threshold && b > threshold) {
            let leftEdge = x, rightEdge = x, topEdge = y, bottomEdge = y;
            
            for (let testX = x; testX >= 0; testX -= 5) {
              const { r, g, b } = intToRGBA(image.getPixelColor(testX, y));
              if (r < threshold || g < threshold || b < threshold) {
                leftEdge = testX + 5;
                break;
              }
            }
            
            for (let testX = x; testX < image.width; testX += 5) {
              const { r, g, b } = intToRGBA(image.getPixelColor(testX, y));
              if (r < threshold || g < threshold || b < threshold) {
                rightEdge = testX - 5;
                break;
              }
            }
            
            for (let testY = y; testY >= 0; testY -= 5) {
              const { r, g, b } = intToRGBA(image.getPixelColor(x, testY));
              if (r < threshold || g < threshold || b < threshold) {
                topEdge = testY + 5;
                break;
              }
            }
            
            for (let testY = y; testY < image.height; testY += 5) {
              const { r, g, b } = intToRGBA(image.getPixelColor(x, testY));
              if (r < threshold || g < threshold || b < threshold) {
                bottomEdge = testY - 5;
                break;
              }
            }
            
            const centerX = (leftEdge + rightEdge) / 2;
            const centerY = (topEdge + bottomEdge) / 2;
            const radiusX = (rightEdge - leftEdge) / 2;
            const radiusY = (bottomEdge - topEdge) / 2;
            
            const radius = (radiusX + radiusY) / 2;
            
            if (radius > circleMinRadius) {
              const roundnessRatio = Math.min(radiusX, radiusY) / Math.max(radiusX, radiusY);
              
              if (roundnessRatio > 0.7) {
                const isNewCircle = !circles.some(circle => {
                  const distance = Math.sqrt(
                    Math.pow(circle.centerX - centerX, 2) + 
                    Math.pow(circle.centerY - centerY, 2)
                  );
                  return distance < (radius * 1.5);
                });
                
                if (isNewCircle) {
                  circles.push({ centerX, centerY, radius });
                  console.log(`Found potential circle at (${Math.round(centerX)},${Math.round(centerY)}) with radius ${Math.round(radius)} and roundness ${roundnessRatio.toFixed(2)}`);
                  x = Math.min(rightEdge + radius, image.width - 1);
                }
              }
            }
          }
        }
      }
      
      return circles;
    };
    
    let circles = await findWhiteCircles(baseImage);
    console.log(`Found ${circles.length} potential white circles in the image that meet the size requirements`);
    
    circles.sort((a, b) => b.radius - a.radius);
    
    if (circles.length < avatarUrls.length) {
      console.log(`Not enough circles found (${circles.length}), using automatic placement for ${avatarUrls.length} avatars`);
      
      circles = [];
      const margin = baseWidth * 0.1;
      const avatarSize = Math.min(baseWidth, baseHeight) * 0.2;
      
      const avatarsPerRow = Math.ceil(Math.sqrt(avatarUrls.length));
      const spacing = (baseWidth - 2 * margin) / avatarsPerRow;
      
      for (let i = 0; i < avatarUrls.length; i++) {
        const row = Math.floor(i / avatarsPerRow);
        const col = i % avatarsPerRow;
        
        const centerX = margin + col * spacing + spacing / 2;
        const centerY = margin + row * spacing + spacing / 2;
        
        circles.push({
          centerX,
          centerY,
          radius: avatarSize / 2
        });
      }
    } else {
      circles = circles.slice(0, avatarUrls.length);
      circles.sort((a, b) => a.centerY - b.centerY);
    }
    
    for (let i = 0; i < avatarUrls.length && i < circles.length; i++) {
      const { centerX, centerY, radius } = circles[i];
      
      try {
        let avatarUrl = avatarUrls[i];
        
        if (avatarUrl.includes('discord.com') || avatarUrl.includes('discordapp.com')) {
          if (avatarUrl.includes('?')) {
            if (avatarUrl.includes('format=')) {
              avatarUrl = avatarUrl.replace(/format=\w+/, 'format=png');
            } else {
              avatarUrl += '&format=png';
            }
          } else {
            avatarUrl += '?format=png';
          }
          
          avatarUrl = avatarUrl.replace('.webp', '.png');
        }
        
        console.log(`Processing avatar ${i+1} with URL: ${avatarUrl}`);
        
        let avatarImage;
        try {
          const avatarResponse = await axios.get(avatarUrl, { 
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
              'Accept': 'image/png,image/*'
            }
          });
          
          const contentType = avatarResponse.headers['content-type'];
          console.log(`Avatar ${i+1} content type: ${contentType}`);
          
          if (contentType && contentType.includes('webp')) {
            console.log(`Avatar ${i+1} is in WebP format, using fallback circle`);
            avatarImage = new Jimp({ 
              width: radius * 2, 
              height: radius * 2, 
              color: `hsl(${i * 30 % 360}, 70%, 60%)` 
            });
            const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
            const label = `${i+1}`;
            const textWidth = Jimp.measureText(font, label);
            const textHeight = Jimp.measureTextHeight(font, label, textWidth);
            avatarImage.print(
              font,
              Math.floor(radius - textWidth / 2),
              Math.floor(radius - textHeight / 2),
              {
                text: label,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
              },
              textWidth * 2,
              textHeight * 2
            );
          } else {
            avatarImage = await Jimp.read(Buffer.from(avatarResponse.data));
          }
        } catch (avatarError) {
          console.error(`Error downloading/processing avatar ${i+1}:`, avatarError);
          console.log(`Using fallback circle for avatar ${i+1}`);
          avatarImage = new Jimp({ 
            width: radius * 2, 
            height: radius * 2, 
            color: `hsl(${i * 30 % 360}, 70%, 60%)` 
          });
          
          try {
            const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
            const label = `${i+1}`;
            const textWidth = Jimp.measureText(font, label);
            const textHeight = Jimp.measureTextHeight(font, label, textWidth);
            avatarImage.print(
              font,
              Math.floor(radius - textWidth / 2),
              Math.floor(radius - textHeight / 2),
              {
                text: label,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
              },
              textWidth * 2,
              textHeight * 2
            );
          } catch (textError) {
            console.error(`Error adding text to fallback circle:`, textError);
          }
        }
        
        try {
          const scalingFactor = 1.6;
          const exactDiameter = Math.floor(radius * 2);
          const scaledDiameter = Math.floor(exactDiameter * scalingFactor);
          
          avatarImage.resize({ w: scaledDiameter, h: scaledDiameter });
          
          const mask = new Jimp({ width: scaledDiameter, height: scaledDiameter, color: 0x00000000 });
          
          const maskCenter = scaledDiameter / 2;
          const maskRadius = maskCenter;
          
          for (let y = 0; y < scaledDiameter; y++) {
            for (let x = 0; x < scaledDiameter; x++) {
              const distanceFromCenter = Math.sqrt(Math.pow(x - maskCenter, 2) + Math.pow(y - maskCenter, 2));
              if (distanceFromCenter <= maskRadius) {
                mask.setPixelColor(0xFFFFFFFF, x, y);
              }
            }
          }
          
          avatarImage.mask(mask, 0, 0);
          
          const offsetAdjustment = (scaledDiameter - exactDiameter) / 2;
          const avatarX = Math.round(centerX - (scaledDiameter / 2));
          const avatarY = Math.round(centerY - (scaledDiameter / 2));
          
          if (avatarX >= -offsetAdjustment && avatarY >= -offsetAdjustment && 
              avatarX + scaledDiameter <= baseImage.width + offsetAdjustment && 
              avatarY + scaledDiameter <= baseImage.height + offsetAdjustment) {
            
            baseImage.composite(avatarImage, avatarX, avatarY, {
              mode: Jimp.BLEND_SOURCE_OVER,
              opacitySource: 1,
              opacityDest: 1
            });
            
            console.log(`Placed avatar ${i+1} at (${avatarX},${avatarY}) with adjusted diameter ${scaledDiameter}`);
          } else {
            console.warn(`Avatar ${i+1} placement partially out of bounds. Using fallback positioning.`);
            
            const safeX = Math.max(0, Math.min(avatarX, baseImage.width - scaledDiameter));
            const safeY = Math.max(0, Math.min(avatarY, baseImage.height - scaledDiameter));
            
            baseImage.composite(avatarImage, safeX, safeY, {
              mode: Jimp.BLEND_SOURCE_OVER,
              opacitySource: 1,
              opacityDest: 1
            });
            
            console.log(`Placed avatar ${i+1} at safe position (${safeX},${safeY})`);
          }
        } catch (error) {
          console.error(`Error processing avatar ${i+1}:`, error);
        }
      } catch (outerError) {
        console.error(`Error in avatar preparation for avatar ${i+1}:`, outerError);
      }
    }
    
    const imageId = shortid.generate();
    const imagePath = path.join(IMAGES_DIR, `${imageId}.png`);
    
    await baseImage.write(imagePath);
    console.log(`Final composite image saved to ${imagePath}`);
    
    return { imageId, imagePath };
  } catch (error) {
    console.error('Error placing avatars in circles:', error);
    throw error;
  }
}

// Updated function to generate image with avatars (two-step process)
async function generateImageWithAvatars(prompt, avatarUrls) {
  try {
    console.log(`Starting two-step image generation process for prompt: ${prompt}`);
    
    const { tempImageId, tempImagePath } = await generateBaseImage(prompt, avatarUrls.length);
    
    const { imageId, imagePath } = await placeAvatarsInCircles(tempImagePath, avatarUrls);
    
    try {
      fs.unlinkSync(tempImagePath);
      console.log(`Deleted temporary base image: ${tempImagePath}`);
    } catch (err) {
      console.error(`Error deleting temporary image file: ${err}`);
    }
    
    return { imageId, imagePath };
  } catch (error) {
    console.error('Error in two-step image generation process:', error);
    throw error;
  }
}

// Function to generate a story using OpenRouter API
async function generateStory(prompt, characterNames) {
  try {
    console.log(`Generating story with prompt: ${prompt}`);
    console.log(`Characters: ${characterNames.join(', ')}`);
    
    const enhancedPrompt = `Write a creative and engaging story based on the following scenario: ${prompt}

CHARACTERS TO INCLUDE:
${characterNames.map((name, index) => `- ${name}`).join('\n')}

REQUIREMENTS:
- Feature all the listed characters prominently in the story
- Give each character meaningful dialogue and actions
- Create an interesting plot with a beginning, middle, and satisfying conclusion
- Write in an engaging narrative style with descriptive language
- The story should be well-structured and 1000-2000 words in length
- Divide the story into clear paragraphs with natural breaks`;

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'sophosympatheia/rogue-rose-103b-v0.2:free',
        messages: [
          {
            role: 'system',
            content: 'You are an expert creative writer skilled in crafting engaging stories featuring specific characters. Create an immersive narrative that includes all provided character names and follows the scenario described by the user. Your writing should be vivid, with natural dialogue, good pacing, and a satisfying conclusion.'
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
    console.error('Error generating story:', error);
    
    if (error.response) {
      console.error('Error status:', error.response.status);
      try {
        console.error('API error response:', error.response.data);
      } catch (e) {
        console.error('Could not parse error response data');
      }
    }
    
    throw error;
  }
}

// New function to extract a description from a story chunk for image generation
async function extractDescriptionFromStoryChunk(chunk, characterNames) {
  try {
    console.log(`Extracting image description from chunk of length: ${chunk.length}`);
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
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
            - Respond ONLY with the description - no explanations or other text`
          },
          {
            role: 'user',
            content: `Here's a chunk of a story featuring characters: ${characterNames.join(', ')}

${chunk}

Extract a vivid scene description for an image generator. Focus on the most visually interesting moment where the characters' faces are clearly visible, as if posing for a portrait. Ensure the description will work well for an image where profile pictures will be placed on the characters' heads.`
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
    console.log(`Generated image description: ${description}`);
    
    return description;
  } catch (error) {
    console.error('Error extracting description from story chunk:', error);
    return `A portrait-style scene featuring ${characterNames.join(' and ')} with their faces clearly visible, positioned at eye level with the viewer`;
  }
}

// New function to generate and send story with images
async function generateAndSendStoryWithImages(message, storyPrompt, characterUsers, loadingMessage) {
  try {
    const characterNames = characterUsers.map(user => user.username);
    
    const story = await generateStory(storyPrompt, characterNames);
    
    const storyEmbed = new EmbedBuilder()
      .setColor('#9966cc')
      .setTitle('📚 Your Custom Story is Ready!')
      .setDescription(`**Scenario:** ${storyPrompt}\n\n**Featuring:** ${characterUsers.map(user => user.username).join(', ')}`)
      .addFields(
        { name: 'Story Length', value: `${story.length} characters`, inline: true },
        { name: 'Characters', value: `${characterUsers.length} characters`, inline: true },
        { name: 'With Images', value: 'Each part of the story includes a custom generated image', inline: true }
      )
      .setFooter({ text: 'Generated using AI • Story with images created just for you' })
      .setTimestamp();
    
    const introMessage = await message.channel.send({ 
      content: `${message.author} Here's your generated story with images:`,
      embeds: [storyEmbed]
    });

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
    
    console.log(`Split story into ${storyChunks.length} chunks for processing`);
    
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
          .setDescription(imageDescription)
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
            console.log(`Deleted image file: ${imagePath}`);
          } catch (err) {
            console.error(`Error deleting image file: ${err}`);
          }
        }, 5000);
        
      } catch (error) {
        console.error(`Error processing chunk ${chunkNumber}:`, error);
        
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
        { name: 'Image Generation', value: `${storyChunks.length - failedChunks.length}/${storyChunks.length} successful`, inline: true }
      )
      .setFooter({ text: 'Generated using AI • Story with images created just for you' })
      .setTimestamp();
    
    await message.channel.send({ 
      content: `${message.author} Story generation complete!`,
      embeds: [summaryEmbed] });
    
    await loadingMessage.edit('✅ Story with images generated successfully!');
    
  } catch (error) {
    console.error('Error in generateAndSendStoryWithImages:', error);
    
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
      console.error('Error in fallback story delivery:', fallbackError);
      await loadingMessage.edit('Sorry, there was an error generating your story with images. Please try again later.');
    }
  }
}

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  initFinanceNews(client, process.env.NEWSAPI_KEY);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (usersInEditMode.has(message.author.id)) {
    const { gameId, loadingMessage } = usersInEditMode.get(message.author.id);
    const editPrompt = message.content;
    
    usersInEditMode.delete(message.author.id);
    
    await loadingMessage.edit('🔄 Editing your game... This might take a minute!');
    
    try {
      const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        await loadingMessage.edit(`Error: Game with ID ${gameId} not found.`);
        return;
      }
      
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      await editGame(gameId, editPrompt, originalHtml);
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#9933cc')
        .setTitle('🎮 Your Game Has Been Updated!')
        .setDescription(`**Edit request:** ${editPrompt}`)
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your game.' }
        )
        .setFooter({ text: 'Edited using AI • To play, use !playgame command' })
        .setTimestamp();
      
      await loadingMessage.edit({ content: 'Game updated successfully!', embeds: [gameEmbed] });
      
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting message:', error);
      }
      
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error editing your game. Please try again later.');
    }
    
    return;
  }

  if (usersWaitingForStoryPrompt.has(message.author.id)) {
    const { characterUsers, loadingMessage } = usersWaitingForStoryPrompt.get(message.author.id);
    const storyPrompt = message.content;
    
    usersWaitingForStoryPrompt.delete(message.author.id);
    
    await loadingMessage.edit('📝 Generating your custom story with images... This might take several minutes as I craft a detailed narrative with visuals!');
    
    try {
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting message:', error);
      }
      
      await generateAndSendStoryWithImages(message, storyPrompt, characterUsers, loadingMessage);
      
    } catch (error) {
      console.error('Error processing story with images:', error);
      
      let errorMessage = 'Sorry, there was an error generating your story with images. Please try again later.';
      
      if (error.message && error.message.includes('timeout')) {
        errorMessage = 'Sorry, story or image generation timed out. Please try a simpler prompt or try again later.';
      }
      
      await loadingMessage.edit(errorMessage);
    }
    
    return;
  }

  if (message.content.startsWith('!financenews')) {
    await handleFinanceNewsCommand(message, process.env.NEWSAPI_KEY, client);
    return;
  }

  if (message.content.startsWith('!generatequiz')) {
    await handleQuizCommand(message);
    return;
  }

  const playGameMatch = message.content.match(/^!playgame\s+([a-zA-Z0-9_-]+)$/);
  if (playGameMatch) {
    const gameId = playGameMatch[1];
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;

    const userToken = jwt.sign({
      id: message.author.id,
      username: message.author.username,
      avatar: message.author.displayAvatarURL({ format: 'png' })
    }, JWT_SECRET);
    
    const gameUrl = `${baseUrl}/game/${gameId}?token=${userToken}`;
    
    const gameEmbed = new EmbedBuilder()
      .setColor('#00cc99')
      .setTitle('🎮 Here\'s Your Personal Game Link!')
      .setDescription(`**Game ID:** \`${gameId}\``)
      .addFields(
        { name: 'Play the game', value: `[Click here to play](${gameUrl})` },
        { name: 'About Your Link', value: 'This link is personalized for you and will display your Discord username and avatar in the game.' }
      )
      .setFooter({ text: 'Generated using AI • Link personalized for you' })
      .setTimestamp();
    
    await message.reply({ content: `${message.author} Here's your game link:`, embeds: [gameEmbed] });
    
    return;
  }

  if (message.content.startsWith('!generatestory')) {
    const characterUsers = Array.from(message.mentions.users.values());
    
    if (characterUsers.length === 0) {
      message.reply('Please mention at least one user to include as a character in the story. Example: `!generatestory @username1 @username2`');
      return;
    }
    
    const loadingMessage = await message.reply(`I found ${characterUsers.length} character(s): ${characterUsers.map(user => user.username).join(', ')}. Now, please describe the scenario for the story in your next message.`);
    
    usersWaitingForStoryPrompt.set(message.author.id, { characterUsers, loadingMessage });
    return;
  }

  const editGameMatch = message.content.match(/^!editgame\s+([a-zA-Z0-9_-]+)$/);
  if (editGameMatch) {
    const gameId = editGameMatch[1];
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    const loadingMessage = await message.reply(`Game ${gameId} found. Please send your edit request in the next message.`);
    
    usersInEditMode.set(message.author.id, { gameId, loadingMessage });
    return;
  }

  const enhanceGameMatch = message.content.match(/^!enhance\s+([a-zA-Z0-9_-]+)$/);
  if (enhanceGameMatch) {
    const gameId = enhanceGameMatch[1];
    
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    const loadingMessage = await message.reply(`🔄 Enhancing game ${gameId}... This might take a minute or two!`);
    
    try {
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      await enhanceGame(gameId, originalHtml);
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#5533ff')
        .setTitle('✨ Your Game Has Been Enhanced!')
        .setDescription('Your game has been automatically improved with bug fixes and enhanced features!')
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'Enhancements Applied', value: '• Bug fixes\n• Improved game mechanics\n• Enhanced visuals\n• Performance optimization\n• Mobile compatibility improvements' },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your enhanced game.' }
        )
        .setFooter({ text: 'Auto-enhanced using AI • To play, use !playgame command' })
        .setTimestamp();
      
      await loadingMessage.edit({ content: '✅ Game successfully enhanced!', embeds: [gameEmbed] });
      
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error enhancing your game. Please try again later.');
    }
    
    return;
  }

  if (message.content.startsWith('!createmusic')) {
    await handleMusicCommand(message);
    return;
  }
  
  if (message.content.startsWith('!singlegame')) {
    await handleSingleGameCommand(message);
    return;
  }

  if (message.content.startsWith('!multigame')) {
    const multiplayerEmbed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🎮 Multiplayer Games - Coming Soon!')
      .setDescription('Multiplayer game functionality is currently under development and will be available in a future update.')
      .addFields(
        { name: 'Available Now', value: 'In the meantime, try our single-player games with `!singlegame [prompt]`!' },
      )
      .setFooter({ text: 'Stay tuned for updates!' })
      .setTimestamp();
    
    await message.reply({ embeds: [multiplayerEmbed] });
    return;
  }

  if (message.content.startsWith('!generateimage')) {
    const mentionedUsers = Array.from(message.mentions.users.values());
    
    if (mentionedUsers.length === 0) {
      message.reply('Please mention at least one user to include their avatar in the image. Example: `!generateimage @username1 @username2`');
      return;
    }
    
    const loadingMessage = await message.reply(`I found ${mentionedUsers.length} mentioned user(s). Now, please describe the scenario for the image in your next message.`);
    
    usersWaitingForImagePrompt.set(message.author.id, { mentionedUsers, loadingMessage });
    return;
  }

  if (usersWaitingForImagePrompt.has(message.author.id)) {
    const { mentionedUsers, loadingMessage } = usersWaitingForImagePrompt.get(message.author.id);
    const imagePrompt = message.content;
    
    usersWaitingForImagePrompt.delete(message.author.id);
    
    await loadingMessage.edit('🎨 Generating your custom image in two steps...\n1️⃣ Creating base image from your prompt with placeholder circles\n2️⃣ Adding user avatars to the circles\n\nThis process might take 2-3 minutes!');
    
    try {
      const avatarUrls = mentionedUsers.map(user => 
        user.displayAvatarURL({ format: 'png', size: 512 })
      );
      
      console.log('Avatar URLs:', avatarUrls);
      
      const { imageId, imagePath } = await generateImageWithAvatars(imagePrompt, avatarUrls);
      
      const imageEmbed = new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle('🎨 Your Custom Image with Avatars is Ready!')
        .setDescription(`**Image prompt:** ${imagePrompt}\n\n**Featuring:** ${mentionedUsers.map(user => user.username).join(', ')}`)
        .setImage(`attachment://${imageId}.png`)
        .setFooter({ text: 'Generated using AI with Discord avatars' })
        .setTimestamp();
      
      await message.channel.send({ 
        content: `${message.author} Here's your generated image with ${mentionedUsers.length} user avatars:`,
        embeds: [imageEmbed],
        files: [{ attachment: imagePath, name: `${imageId}.png` }]
      });
      
      await loadingMessage.edit('✅ Composite image generated successfully!');
      
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting message:', error);
      }
      
      setTimeout(() => {
        try {
          fs.unlinkSync(imagePath);
          console.log(`Deleted image file: ${imagePath}`);
        } catch (err) {
          console.error(`Error deleting image file: ${err}`);
        }
      }, 5000);
      
    } catch (error) {
      console.error('Error:', error);
      
      let errorMessage = 'Sorry, there was an error generating your image. Please try again later.';
      
      if (error.message.includes('timeout')) {
        errorMessage = 'Sorry, image generation timed out. Please try a simpler prompt or try again later.';
      }
      
      await loadingMessage.edit(errorMessage);
    }
    
    return;
  }
});

client.on('guildMemberRemove', (member) => {
  clearUserQuiz(member.id);
});

process.on('SIGINT', () => {
  cleanupVoiceConnections();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupVoiceConnections();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);