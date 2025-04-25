const axios = require('axios');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const { EmbedBuilder } = require('discord.js');

// Function to generate image using Hugging Face API (step 1: text-to-image with white circles)
async function generateBaseImage(prompt, numAvatars, IMAGES_DIR) {
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

    return { tempImageId, tempImagePath };
  } catch (error) {
    if (error.response) {
      try {
        const errorData = Buffer.from(error.response.data).toString('utf8');
      } catch (e) {
        // Could not parse error response data
      }
    }
    throw error;
  }
}

// Function to place avatars into white circles using Jimp
async function placeAvatarsInCircles(baseImagePath, avatarUrls, IMAGES_DIR) {
  try {
    const { Jimp, intToRGBA } = require('jimp');
    const baseImage = await Jimp.read(baseImagePath);
    const baseWidth = baseImage.width;
    const baseHeight = baseImage.height;
    
    const findWhiteCircles = async (image) => {
      const circles = [];
      const threshold = 230;
      const circleMinRadius = Math.min(baseWidth, baseHeight) * 0.05;
      
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
      
      return circles;
    };
    
    let circles = await findWhiteCircles(baseImage);
    
    circles.sort((a, b) => b.radius - a.radius);
    
    if (circles.length < avatarUrls.length) {
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
            // Error adding text to fallback circle
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
          } else {
            const safeX = Math.max(0, Math.min(avatarX, baseImage.width - scaledDiameter));
            const safeY = Math.max(0, Math.min(avatarY, baseImage.height - scaledDiameter));
            
            baseImage.composite(avatarImage, safeX, safeY, {
              mode: Jimp.BLEND_SOURCE_OVER,
              opacitySource: 1,
              opacityDest: 1
            });
          }
        } catch (error) {
          // Error processing avatar
        }
      } catch (outerError) {
        // Error in avatar preparation
      }
    }
    
    const imageId = shortid.generate();
    const imagePath = path.join(IMAGES_DIR, `${imageId}.png`);
    
    await baseImage.write(imagePath);
    
    return { imageId, imagePath };
  } catch (error) {
    throw error;
  }
}

// Function to generate image with avatars (two-step process)
async function generateImageWithAvatars(prompt, avatarUrls, IMAGES_DIR) {
  try {
    const { tempImageId, tempImagePath } = await generateBaseImage(prompt, avatarUrls.length, IMAGES_DIR);
    
    const { imageId, imagePath } = await placeAvatarsInCircles(tempImagePath, avatarUrls, IMAGES_DIR);
    
    try {
      fs.unlinkSync(tempImagePath);
    } catch (err) {
      // Error deleting temporary image file
    }
    
    return { imageId, imagePath };
  } catch (error) {
    throw error;
  }
}

// Function to handle the image generation command
async function handleImageCommand(message) {
  const mentionedUsers = Array.from(message.mentions.users.values());
  
  if (mentionedUsers.length === 0) {
    return message.reply('Please mention at least one user to include their avatar in the image. Example: `!generateimage @username1 @username2`');
  }
  
  const loadingMessage = await message.reply(`I found ${mentionedUsers.length} mentioned user(s). Now, please describe the scenario for the image in your next message.`);
  
  // Return information needed to set up the waiting state
  return { mentionedUsers, loadingMessage };
}

// Function to process the image prompt
async function processImagePrompt(message, imagePrompt, mentionedUsers, loadingMessage, IMAGES_DIR) {
  await loadingMessage.edit('🎨 Generating your custom image in two steps...\n1️⃣ Creating base image from your prompt with placeholder circles\n2️⃣ Adding user avatars to the circles\n\nThis process might take 2-3 minutes!');
  
  try {
    const avatarUrls = mentionedUsers.map(user => 
      user.displayAvatarURL({ format: 'png', size: 512 })
    );
    
    const { imageId, imagePath } = await generateImageWithAvatars(imagePrompt, avatarUrls, IMAGES_DIR);
    
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
      // Error deleting message
    }
    
    setTimeout(() => {
      try {
        fs.unlinkSync(imagePath);
      } catch (err) {
        // Error deleting image file
      }
    }, 5000);
    
  } catch (error) {
    let errorMessage = 'Sorry, there was an error generating your image. Please try again later.';
    
    if (error.message && error.message.includes('timeout')) {
      errorMessage = 'Sorry, image generation timed out. Please try a simpler prompt or try again later.';
    }
    
    await loadingMessage.edit(errorMessage);
  }
}

/**
 * Handles a user's image prompt input
 * @param {string} userId - The Discord user ID
 * @param {Object} imageData - Data containing mentionedUsers and loadingMessage
 * @param {string} imagePrompt - The user's image prompt
 * @param {string} imagesDir - Directory to store images
 */
async function handleImagePromptInput(userId, imageData, imagePrompt, message, imagesDir) {
  const { mentionedUsers, loadingMessage } = imageData;
  
  return await processImagePrompt(message, imagePrompt, mentionedUsers, loadingMessage, imagesDir);
}

module.exports = {
  handleImageCommand,
  processImagePrompt,
  generateImageWithAvatars,
  handleImagePromptInput
};
