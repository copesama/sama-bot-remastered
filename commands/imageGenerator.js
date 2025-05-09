const axios = require('axios');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const { EmbedBuilder } = require('discord.js');
const { getPrefix } = require('./prefixCommand');

// Debug logging utility function
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[DEBUG ${timestamp}] ${message}`;
  
  console.log(logMessage);
  if (data) {
    try {
      if (typeof data === 'object') {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data);
      }
    } catch (e) {
      console.log('Could not stringify debug data:', e.message);
    }
  }
}

// Function to generate image using Hugging Face API (step 1: text-to-image with white circles)
async function generateBaseImage(prompt, numAvatars, IMAGES_DIR) {
  debugLog(`Starting base image generation for prompt: "${prompt}" with ${numAvatars} avatar(s)`);
  try {
    // Calculate a reasonable percentage for the image generation prompt
    const circleSizeMinPercent = 15;
    
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
    
    debugLog(`Enhanced prompt created: ${enhancedPrompt.substring(0, 100)}...`);
    
    const payload = { inputs: enhancedPrompt };

    debugLog('Sending request to Hugging Face API');
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
    debugLog('Received response from Hugging Face API', {
      status: response.status,
      dataLength: response.data?.length || 0,
      headers: response.headers
    });

    // Generate temporary ID for the intermediate image file
    const tempImageId = `temp_${shortid.generate()}`;
    const tempImagePath = path.join(IMAGES_DIR, `${tempImageId}.png`);
    debugLog(`Temp image path: ${tempImagePath}`);

    // Check if IMAGES_DIR exists
    if (!fs.existsSync(IMAGES_DIR)) {
      debugLog(`Creating images directory: ${IMAGES_DIR}`);
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }

    // Save the temporary image file
    fs.writeFileSync(tempImagePath, Buffer.from(response.data));
    debugLog(`Base image saved to: ${tempImagePath}`);

    return { tempImageId, tempImagePath };
  } catch (error) {
    debugLog('Error in generateBaseImage:', {
      message: error.message,
      stack: error.stack
    });
    
    if (error.response) {
      try {
        const errorData = Buffer.from(error.response.data).toString('utf8');
        debugLog('API error response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: errorData
        });
      } catch (e) {
        debugLog('Could not parse error response data', e.message);
      }
    }
    throw error;
  }
}

// Function to place avatars into white circles using Jimp
async function placeAvatarsInCircles(baseImagePath, avatarUrls, IMAGES_DIR) {
  debugLog(`Starting avatar placement for ${avatarUrls.length} avatars`);
  debugLog(`Base image path: ${baseImagePath}`);
  
  try {
    debugLog('Importing Jimp library');
    const { Jimp, intToRGBA } = require('jimp');
    debugLog('Loading base image with Jimp');
    
    // Check if the base image file exists
    if (!fs.existsSync(baseImagePath)) {
      debugLog(`ERROR: Base image file does not exist: ${baseImagePath}`);
      throw new Error(`Base image file does not exist: ${baseImagePath}`);
    }
    
    const baseImage = await Jimp.read(baseImagePath);
    const baseWidth = baseImage.width;
    const baseHeight = baseImage.height;
    debugLog(`Base image dimensions: ${baseWidth}x${baseHeight}`);
    
    const findWhiteCircles = async (image) => {
      debugLog('Starting white circle detection');
      const circles = [];
      const threshold = 230;
      const circleMinRadius = Math.min(baseWidth, baseHeight) * 0.05;
      debugLog(`Circle minimum radius: ${circleMinRadius}`);
      
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
                  x = Math.min(rightEdge + radius, image.width - 1);
                }
              }
            }
          }
        }
      }
      
      debugLog(`Found ${circles.length} circles in the base image`);
      return circles;
    };
    
    let circles = await findWhiteCircles(baseImage);
    
    circles.sort((a, b) => b.radius - a.radius);
    debugLog(`After sorting by radius, largest radius: ${circles.length > 0 ? circles[0].radius : 'N/A'}`);
    
    if (circles.length < avatarUrls.length) {
      debugLog(`Not enough circles detected (${circles.length}). Creating default grid layout for ${avatarUrls.length} avatars`);
      circles = [];
      const margin = baseWidth * 0.1;
      const avatarSize = Math.min(baseWidth, baseHeight) * 0.2;
      
      const avatarsPerRow = Math.ceil(Math.sqrt(avatarUrls.length));
      const spacing = (baseWidth - 2 * margin) / avatarsPerRow;
      debugLog(`Creating grid with ${avatarsPerRow} avatars per row, spacing: ${spacing}px`);
      
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
      debugLog(`Found sufficient circles (${circles.length}). Using top ${avatarUrls.length} circles`);
      circles = circles.slice(0, avatarUrls.length);
      circles.sort((a, b) => a.centerY - b.centerY);
    }
    
    for (let i = 0; i < avatarUrls.length && i < circles.length; i++) {
      const { centerX, centerY, radius } = circles[i];
      debugLog(`Processing avatar ${i+1}/${avatarUrls.length}, circle center(${centerX}, ${centerY}), radius: ${radius}`);
      
      try {
        let avatarUrl = avatarUrls[i];
        debugLog(`Original avatar URL: ${avatarUrl}`);
        
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
          debugLog(`Modified avatar URL: ${avatarUrl}`);
        }
        
        let avatarImage;
        try {
          debugLog(`Fetching avatar from URL: ${avatarUrl}`);
          const avatarResponse = await axios.get(avatarUrl, { 
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
              'Accept': 'image/png,image/*'
            }
          });
          
          const contentType = avatarResponse.headers['content-type'];
          debugLog(`Avatar fetched, content type: ${contentType}, data size: ${avatarResponse.data.length}`);
          
          if (contentType && contentType.includes('webp')) {
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
          debugLog(`Error fetching avatar: ${avatarError.message}`, avatarError.stack);
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
            debugLog(`Error adding text to avatar image: ${textError.message}`);
          }
        }
        
        try {
          const scalingFactor = 1.6;
          const exactDiameter = Math.floor(radius * 2);
          const scaledDiameter = Math.floor(exactDiameter * scalingFactor);
          debugLog(`Processing avatar image - exact diameter: ${exactDiameter}, scaled: ${scaledDiameter}`);
          
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
          } else {
            const safeX = Math.max(0, Math.min(avatarX, baseImage.width - scaledDiameter));
            const safeY = Math.max(0, Math.min(avatarY, baseImage.height - scaledDiameter));
            
            baseImage.composite(avatarImage, safeX, safeY, {
              mode: Jimp.BLEND_SOURCE_OVER,
              opacitySource: 1,
              opacityDest: 1
            });
          }
          
          debugLog(`Avatar processed and composited at position (${avatarX}, ${avatarY})`);
        } catch (error) {
          debugLog(`Error processing avatar: ${error.message}`, error.stack);
          // Error processing avatar
        }
      } catch (outerError) {
        debugLog(`Outer error in avatar preparation: ${outerError.message}`, outerError.stack);
        // Error in avatar preparation
      }
    }
    
    const imageId = shortid.generate();
    const imagePath = path.join(IMAGES_DIR, `${imageId}.png`);
    debugLog(`Saving final image to: ${imagePath}`);
    
    await baseImage.write(imagePath);
    debugLog(`Final image saved successfully`);
    
    return { imageId, imagePath };
  } catch (error) {
    debugLog(`Critical error in placeAvatarsInCircles: ${error.message}`, {
      stack: error.stack,
      baseImagePath,
      avatarUrlsCount: avatarUrls.length
    });
    throw error;
  }
}

// Function to generate image with avatars (two-step process)
async function generateImageWithAvatars(prompt, avatarUrls, IMAGES_DIR) {
  debugLog(`generateImageWithAvatars started with prompt: "${prompt.substring(0, 50)}..." and ${avatarUrls.length} avatars`);
  try {
    debugLog(`Starting step 1: Generate base image with white circles`);
    const { tempImageId, tempImagePath } = await generateBaseImage(prompt, avatarUrls.length, IMAGES_DIR);
    debugLog(`Step 1 complete, temp image created at: ${tempImagePath}`);
    
    debugLog(`Starting step 2: Place avatars in circles`);
    const { imageId, imagePath } = await placeAvatarsInCircles(tempImagePath, avatarUrls, IMAGES_DIR);
    debugLog(`Step 2 complete, final image created at: ${imagePath}`);
    
    try {
      debugLog(`Attempting to delete temporary image: ${tempImagePath}`);
      fs.unlinkSync(tempImagePath);
      debugLog(`Temporary image deleted successfully`);
    } catch (err) {
      debugLog(`Error deleting temporary image file: ${err.message}`);
      // Error deleting temporary image file
    }
    
    return { imageId, imagePath };
  } catch (error) {
    debugLog(`Error in generateImageWithAvatars: ${error.message}`, {
      stack: error.stack,
      prompt: prompt.substring(0, 100)
    });
    throw error;
  }
}

// Function to handle the image generation command
async function handleImageCommand(message) {
  debugLog(`handleImageCommand called by user: ${message.author.username} (${message.author.id})`);
  const mentionedUsers = Array.from(message.mentions.users.values());
  debugLog(`Mentioned users: ${mentionedUsers.map(u => u.username).join(', ')}`);
  
  const prefix = await getPrefix(message.guild?.id);
  debugLog(`Server prefix: ${prefix}`);
  
  if (mentionedUsers.length === 0) {
    debugLog(`No users mentioned, sending help message`);
    return message.reply(`Please mention at least one user to include their avatar in the image. Example: \`${prefix}generateimage @username1 @username2\``);
  }
  
  debugLog(`Sending loading message`);
  const loadingMessage = await message.reply(`I found ${mentionedUsers.length} mentioned user(s). Now, please describe the scenario for the image in your next message.`);
  debugLog(`Loading message sent: ${loadingMessage.id}`);
  
  // Return information needed to set up the waiting state, including prefix
  return { mentionedUsers, loadingMessage, prefix };
}

// Function to process the image prompt
async function processImagePrompt(message, imagePrompt, mentionedUsers, loadingMessage, IMAGES_DIR) {
  debugLog(`processImagePrompt called for user: ${message.author.username} (${message.author.id})`);
  debugLog(`Image prompt: "${imagePrompt}"`);
  debugLog(`Mentioned users: ${mentionedUsers.map(u => u.username).join(', ')}`);
  
  try {
    await loadingMessage.edit('🎨 Generating your custom image in two steps...\n1️⃣ Creating base image from your prompt with placeholder circles\n2️⃣ Adding user avatars to the circles\n\nThis process might take 2-3 minutes!');
    debugLog(`Loading message updated with generation status`);
  } catch (editError) {
    debugLog(`Error updating loading message: ${editError.message}`);
  }
  
  try {
    debugLog(`Getting avatar URLs for ${mentionedUsers.length} users`);
    const avatarUrls = mentionedUsers.map(user => {
      const url = user.displayAvatarURL({ format: 'png', size: 512 });
      debugLog(`Avatar URL for ${user.username}: ${url}`);
      return url;
    });
    
    debugLog(`Checking if IMAGES_DIR exists: ${IMAGES_DIR}`);
    if (!fs.existsSync(IMAGES_DIR)) {
      debugLog(`Creating IMAGES_DIR directory`);
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    
    debugLog(`Starting image generation with ${avatarUrls.length} avatar URLs`);
    const { imageId, imagePath } = await generateImageWithAvatars(imagePrompt, avatarUrls, IMAGES_DIR);
    debugLog(`Image generation successful. ID: ${imageId}, Path: ${imagePath}`);
    
    debugLog(`Creating embed for generated image`);
    const imageEmbed = new EmbedBuilder()
      .setColor('#ff6600')
      .setTitle('🎨 Your Custom Image with Avatars is Ready!')
      .setDescription(`**Image prompt:** ${imagePrompt}\n\n**Featuring:** ${mentionedUsers.map(user => user.username).join(', ')}`)
      .setImage(`attachment://${imageId}.png`)
      .setFooter({ text: 'Generated using AI with Discord avatars' })
      .setTimestamp();
    
    debugLog(`Sending final image to channel`);
    await message.channel.send({ 
      content: `${message.author} Here's your generated image with ${mentionedUsers.length} user avatars:`,
      embeds: [imageEmbed],
      files: [{ attachment: imagePath, name: `${imageId}.png` }]
    });
    debugLog(`Final image sent to channel successfully`);
    
    try {
      await loadingMessage.edit('✅ Composite image generated successfully!');
      debugLog(`Loading message updated with success status`);
    } catch (editError) {
      debugLog(`Error updating loading message with success: ${editError.message}`);
    }
    
    try {
      await message.delete();
      debugLog(`Original command message deleted`);
    } catch (error) {
      debugLog(`Error deleting message: ${error.message}`);
    }
    
    debugLog(`Setting timer to clean up image file in 5 seconds`);
    setTimeout(() => {
      try {
        fs.unlinkSync(imagePath);
        debugLog(`Image file deleted: ${imagePath}`);
      } catch (err) {
        debugLog(`Error deleting image file: ${err.message}`);
      }
    }, 5000);
    
  } catch (error) {
    debugLog(`Critical error in processImagePrompt:`, {
      message: error.message,
      stack: error.stack,
      prompt: imagePrompt
    });
    
    let errorMessage = 'Sorry, there was an error generating your image. Please try again later.';
    
    if (error.message && error.message.includes('timeout')) {
      errorMessage = 'Sorry, image generation timed out. Please try a simpler prompt or try again later.';
    } else if (error.message) {
      // Include specific error message but keep generic message for user
      debugLog(`Specific error: ${error.message}`);
    }
    
    try {
      await loadingMessage.edit(errorMessage);
      debugLog(`Loading message updated with error status: ${errorMessage}`);
    } catch (editError) {
      debugLog(`Error updating loading message with error: ${editError.message}`);
    }
  }
}

/**
 * Handles a user's image prompt input
 * @param {string} userId - The Discord user ID
 * @param {Object} imageData - Data containing mentionedUsers, loadingMessage, and prefix
 * @param {string} imagePrompt - The user's image prompt
 * @param {Object} message - The Discord message object
 * @param {string} imagesDir - Directory to store images
 */
async function handleImagePromptInput(userId, imageData, imagePrompt, message, imagesDir) {
  debugLog(`handleImagePromptInput called for user ID: ${userId}`);
  debugLog(`Image prompt: "${imagePrompt}"`);
  debugLog(`Images directory: ${imagesDir}`);
  
  const { mentionedUsers, loadingMessage } = imageData;
  
  return await processImagePrompt(message, imagePrompt, mentionedUsers, loadingMessage, imagesDir);
}

module.exports = {
  handleImageCommand,
  processImagePrompt,
  generateImageWithAvatars,
  handleImagePromptInput
};
