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

// Keep track of active voice connections and players
const voiceConnections = new Map();
const audioPlayers = new Map();

// Keep track of users waiting to provide image prompts
const usersWaitingForImagePrompt = new Map();

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

// Function to generate a single-player game using OpenRouter API
async function generateSinglePlayerGame(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. Create a complete, playable HTML game based on the user prompt. 
            The game should be entirely self-contained in a single HTML file with embedded JavaScript and CSS.
            
            CRITICAL REQUIREMENTS:
            1. The game MUST be fully functional and error-free
            2. Use simple graphics and mechanics that work reliably in browsers
            3. Test all game logic in your response
            4. INCLUDE a clickable "Powered by Luck Off" link that opens https://luckoff.chat/ in a new tab
            5. The "Powered by Luck Off" link must be visible and properly styled in the game interface
            
            USER DATA IMPLEMENTATION:
            - Extract user data from cookie:
              const userData = JSON.parse(decodeURIComponent(document.cookie.split('; ').find(row => row.startsWith('gameUserData=')).split('=')[1]));
            - Use userData.username and userData.avatar where appropriate
            - MUST always DISPLAY the user's username and avatar (from gameUserData cookie) somewhere visible in the game interface
            
            Include comprehensive error handling and clear user feedback.
            The final game MUST be completely playable as a single-player experience.`
          },
          {
            role: 'user',
            content: `Create a browser game based on this prompt: ${prompt}. 
            
            TECHNICAL IMPLEMENTATION GUIDELINES:
            1. Focus on a SIMPLE game concept optimized for single-player
            2. Create clean HTML structure with clear element IDs
            3. Use requestAnimationFrame for smooth animation
            4. Implement basic physics if needed (keep it simple)
            5. Ensure the game initializes properly
            6. Use inlined CSS and JS for a single file solution
            
            GAME FEATURES TO INCLUDE:
            1. Clear visual representation of the player
            2. Simple UI showing score/progress and basic instructions
            3. Win/lose conditions where appropriate
            4. A footer or header with a styled "Powered by Luck Off" link to https://luckoff.chat/
            5. Always display the user's username and avatar (from gameUserData cookie) in the game interface
            
            CODE STRUCTURE:
            1. Initialize game variables first
            2. Set up event listeners for inputs
            3. Implement game loop and rendering functions
            4. Create distinct functions for each game mechanic
            5. Add thorough comments explaining critical sections
            
            ATTRIBUTION REQUIREMENT:
            - Include a nicely styled "Powered by Luck Off" link that opens https://luckoff.chat/ in a new tab
            - This attribution should be visible but not intrusive to gameplay
            
            TEST THE GAME LOGIC IN YOUR MIND STEP BY STEP BEFORE GENERATING THE CODE.`
          }
        ],
        temperature: 0.6
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract HTML game code from response
    const gameCode = response.data.choices[0].message.content;
    const htmlGame = extractHtmlFromResponse(gameCode);
    
    // Generate unique ID for the game
    const gameId = shortid.generate();
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    
    // Save the game HTML to file
    fs.writeFileSync(gamePath, htmlGame);
    
    return gameId;
  } catch (error) {
    console.error('Error generating single player game:', error);
    throw error;
  }
}

// Function to generate music using Segmind API
async function generateMusic(prompt, lyrics = null, songFileUrl = null) {
  try {
    const formData = new FormData();
    
    // Check if the prompt contains lyrics or if separate lyrics were provided
    const extractedLyrics = lyrics || prompt.includes('[verse]') ? prompt : null;
    const musicPrompt = extractedLyrics ? "Generate music for these lyrics" : prompt;
    
    // For logging purposes - store what we're sending to the API
    const requestParams = {};
    
    // Set up form data for the request - properly handle null values
    if (extractedLyrics) {
      formData.append('lyrics', extractedLyrics);
      requestParams.lyrics = extractedLyrics;
    } else {
      // Use a template for lyrics based on the prompt
      const defaultLyrics = `[verse]\n${prompt}\n[chorus]\nInspired by your imagination\nCreated just for you`;
      formData.append('lyrics', defaultLyrics);
      requestParams.lyrics = defaultLyrics;
    }
    
    // Add required parameters with proper values
    formData.append('bitrate', '256000');
    requestParams.bitrate = '256000';
    
    formData.append('sample_rate', '44100');
    requestParams.sample_rate = '44100';
    
    // Use the provided song file URL or default
    const songFile = songFileUrl || 'https://replicate.delivery/pbxt/M9zum1Y6qujy02jeigHTJzn0lBTQOemB7OkH5XmmPSC5OUoO/MiniMax-Electronic.wav';
    formData.append('song_file', songFile);
    requestParams.song_file = songFile;
    
    // Log parameters
    console.log('Sending music generation request with parameters:', requestParams);

    const response = await axios.post(
      'https://api.segmind.com/v1/minimax-music-01',
      formData,
      {
        headers: {
          'x-api-key': process.env.SEGMIND_API_KEY,
          ...formData.getHeaders()
        },
        responseType: 'arraybuffer', // Important for receiving binary audio data
        validateStatus: false, // Allow non-2xx responses for better error handling
        timeout: 120000 // 2 minute timeout for long music generation
      }
    );

    // Check if response contains an error
    if (response.status !== 200) {
      let errorMessage;
      try {
        errorMessage = Buffer.from(response.data).toString('utf8');
        console.error('Music API error response:', errorMessage);
        
        // Try to parse as JSON for better error messaging
        try {
          const jsonError = JSON.parse(errorMessage);
          if (jsonError.error) {
            errorMessage = jsonError.error;
          }
        } catch (e) {
          // If it's not valid JSON, keep the original error message
        }
        
      } catch (e) {
        errorMessage = `HTTP status ${response.status}`;
      }
      throw new Error(`Music generation failed: ${errorMessage}`);
    }

    // Generate unique ID for the music file
    const musicId = shortid.generate();
    const musicPath = path.join(MUSIC_DIR, `${musicId}.mp3`);

    // Save the music file
    fs.writeFileSync(musicPath, Buffer.from(response.data));
    console.log(`Music file saved to ${musicPath}`);

    return { musicId, musicPath };
  } catch (error) {
    console.error('Error generating music:', error);
    
    if (error.response) {
      console.error('Error status:', error.response.status);
      try {
        const errorData = Buffer.from(error.response.data).toString('utf8');
        console.error('API error response:', errorData);
      } catch (e) {
        console.error('Could not parse error response data');
      }
    }
    
    // Add more detailed error for timeouts
    if (error.code === 'ECONNABORTED') {
      throw new Error('Music generation timed out. The server took too long to respond.');
    }
    
    throw error;
  }
}

// Helper function to extract HTML from API response
function extractHtmlFromResponse(response) {
  // Try to extract HTML from code blocks if present
  const htmlMatch = response.match(/```html\n([\s\S]*?)```/) || 
                    response.match(/```\n([\s\S]*?)```/) ||
                    response.match(/<html[\s\S]*?<\/html>/i);
  
  if (htmlMatch && htmlMatch[1]) {
    return htmlMatch[1];
  }
  
  // If no HTML tags or code blocks found, assume the entire response is HTML
  return `<!DOCTYPE html>
<html>
<head>
  <title>Generated Game</title>
  <meta charset="UTF-8">
</head>
<body>
  ${response}
</body>
</html>`;
}

// Function to generate image using Hugging Face API (step 1: text-to-image with white circles)
async function generateBaseImage(prompt, numAvatars) {
  try {
    // Calculate a reasonable percentage for the image generation prompt
    const circleSizePercent = 15; // We use 10% as minimum detection threshold, so request 20% for safety
    
    // Create a more specific prompt that requests white circles for avatar placement with specific size requirements
    const enhancedPrompt = `${prompt}. Include exactly ${numAvatars} empty white circles where profile pictures should be placed. 
    IMPORTANT REQUIREMENTS FOR THE CIRCLES:
    - Each white circle must be at least ${circleSizePercent}% of the image size
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
    
    // Load the base image - Updated Jimp import and read method
    const { Jimp, intToRGBA } = require('jimp');
    const baseImage = await Jimp.read(baseImagePath);
    const baseWidth = baseImage.width;
    const baseHeight = baseImage.height;
    
    // Function to detect white circles in the image
    const findWhiteCircles = async (image) => {
      const circles = [];
      const threshold = 230; // RGB threshold for "white" pixels
      
      // Increase the minimum circle size from 5% to 10% of image dimension for stricter filtering
      const circleMinRadius = Math.min(baseWidth, baseHeight) * 0.1; // Minimum circle size (10% of image dimension)
      
      console.log(`Using minimum circle radius threshold: ${circleMinRadius} pixels`);
      
      // Scan the image to find white areas that might be circles
      for (let y = 0; y < image.height; y += 10) { // Sample every 10 pixels for performance
        for (let x = 0; x < image.width; x += 10) {
          const { r, g, b } = intToRGBA(image.getPixelColor(x, y));
          
          // If we find a white pixel
          if (r > threshold && g > threshold && b > threshold) {
            // Expand from this point to find the approximate circle
            let leftEdge = x, rightEdge = x, topEdge = y, bottomEdge = y;
            
            // Find horizontal edges (approximate)
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
            
            // Find vertical edges (approximate)
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
            
            // Calculate approximate circle dimensions
            const centerX = (leftEdge + rightEdge) / 2;
            const centerY = (topEdge + bottomEdge) / 2;
            const radiusX = (rightEdge - leftEdge) / 2;
            const radiusY = (bottomEdge - topEdge) / 2;
            
            // Average the radii for a more accurate circle
            const radius = (radiusX + radiusY) / 2;
            
            // Check if it's big enough to be a circle we want
            if (radius > circleMinRadius) {
              // Add additional check for roundness - ensure radiusX and radiusY are similar
              // If the ratio is too far from 1.0, it's not a good circle
              const roundnessRatio = Math.min(radiusX, radiusY) / Math.max(radiusX, radiusY);
              
              if (roundnessRatio > 0.7) { // Allow slight elliptical shapes but not too stretched
                // Check if we already found a circle too close to this one
                const isNewCircle = !circles.some(circle => {
                  const distance = Math.sqrt(
                    Math.pow(circle.centerX - centerX, 2) + 
                    Math.pow(circle.centerY - centerY, 2)
                  );
                  return distance < (radius * 1.5); // Increased distance threshold to better avoid duplicates
                });
                
                if (isNewCircle) {
                  circles.push({ centerX, centerY, radius });
                  console.log(`Found potential circle at (${Math.round(centerX)},${Math.round(centerY)}) with radius ${Math.round(radius)} and roundness ${roundnessRatio.toFixed(2)}`);
                  // Skip ahead to avoid finding the same circle again
                  x = Math.min(rightEdge + radius, image.width - 1);
                }
              }
            }
          }
        }
      }
      
      return circles;
    };
    
    // Find white circles in the base image
    let circles = await findWhiteCircles(baseImage);
    console.log(`Found ${circles.length} potential white circles in the image that meet the size requirements`);
    
    // Sort circles by size (largest first) before limiting to number of avatars
    circles.sort((a, b) => b.radius - a.radius);
    
    // If we found fewer circles than avatars, fall back to automatic placement
    if (circles.length < avatarUrls.length) {
      console.log(`Not enough circles found (${circles.length}), using automatic placement for ${avatarUrls.length} avatars`);
      
      // Create circles automatically
      circles = [];
      const margin = baseWidth * 0.1;
      const avatarSize = Math.min(baseWidth, baseHeight) * 0.2; // 20% of the image dimension
      
      // Calculate how many avatars per row based on image width
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
      // If we have more circles than avatars, keep only the largest ones up to the number of avatars
      circles = circles.slice(0, avatarUrls.length);
      
      // Then resort by Y position for more natural avatar placement
      circles.sort((a, b) => a.centerY - b.centerY);
    }
    
    // Download and place each avatar
    for (let i = 0; i < avatarUrls.length && i < circles.length; i++) {
      const { centerX, centerY, radius } = circles[i];
      
      try {
        // Ensure we're requesting a PNG format from Discord instead of WebP
        // Replace .webp with .png in the URL or add format=png parameter
        let avatarUrl = avatarUrls[i];
        
        // Make sure we're requesting PNG format
        if (avatarUrl.includes('discord.com') || avatarUrl.includes('discordapp.com')) {
          // If the URL already specifies size, just replace or add format
          if (avatarUrl.includes('?')) {
            if (avatarUrl.includes('format=')) {
              avatarUrl = avatarUrl.replace(/format=\w+/, 'format=png');
            } else {
              avatarUrl += '&format=png';
            }
          } else {
            avatarUrl += '?format=png';
          }
          
          // Replace .webp extension if present
          avatarUrl = avatarUrl.replace('.webp', '.png');
        }
        
        console.log(`Processing avatar ${i+1} with URL: ${avatarUrl}`);
        
        // Download the avatar with proper error handling
        let avatarImage;
        try {
          const avatarResponse = await axios.get(avatarUrl, { 
            responseType: 'arraybuffer',
            // Add timeout and retry logic
            timeout: 10000,
            headers: {
              'Accept': 'image/png,image/*'
            }
          });
          
          // Check the content type
          const contentType = avatarResponse.headers['content-type'];
          console.log(`Avatar ${i+1} content type: ${contentType}`);
          
          // If we still get webp despite requesting png, we need to convert it
          if (contentType && contentType.includes('webp')) {
            console.log(`Avatar ${i+1} is in WebP format, using fallback circle`);
            // Create a colored circle instead as a fallback - Updated constructor
            avatarImage = new Jimp({ 
              width: radius * 2, 
              height: radius * 2, 
              color: `hsl(${i * 30 % 360}, 70%, 60%)` 
            });
            // Add a simple text label in the center of the circle (first letter of the URL)
            const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
            // Use some identifier from the URL or a simple number
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
            // Process normal PNG avatar
            avatarImage = await Jimp.read(Buffer.from(avatarResponse.data));
          }
        } catch (avatarError) {
          console.error(`Error downloading/processing avatar ${i+1}:`, avatarError);
          // Create a fallback colored circle with a number - Updated constructor
          console.log(`Using fallback circle for avatar ${i+1}`);
          avatarImage = new Jimp({ 
            width: radius * 2, 
            height: radius * 2, 
            color: `hsl(${i * 30 % 360}, 70%, 60%)` 
          });
          
          // Add a number in the center of the circle
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
        
        // Improved approach for fitting avatars to white circles
        try {
          // Apply a slight scaling factor to ensure avatar completely covers the white circle
          // This helps avoid any gaps between the avatar and the original white circle
          const scalingFactor = 1.1; // 5% larger than the detected circle
          const exactDiameter = Math.floor(radius * 2);
          const scaledDiameter = Math.floor(exactDiameter * scalingFactor);
          
          // Resize the avatar with the scaled size to ensure full coverage
          avatarImage.resize({ w: scaledDiameter, h: scaledDiameter });
          
          // Create a circular mask matching the exact circle size
          const mask = new Jimp({ width: scaledDiameter, height: scaledDiameter, color: 0x00000000 });
          
          // Create a circular mask with precise edges
          const maskCenter = scaledDiameter / 2;
          const maskRadius = maskCenter;
          
          for (let y = 0; y < scaledDiameter; y++) {
            for (let x = 0; x < scaledDiameter; x++) {
              const distanceFromCenter = Math.sqrt(Math.pow(x - maskCenter, 2) + Math.pow(y - maskCenter, 2));
              if (distanceFromCenter <= maskRadius) {
                // Set pixel to solid white if inside the circle
                mask.setPixelColor(0xFFFFFFFF, x, y);
              }
            }
          }
          
          // Apply the circular mask to the avatar
          avatarImage.mask(mask, 0, 0);
          
          // Calculate the position so the masked avatar perfectly covers the white circle
          // We need to account for the scaling factor when positioning
          const offsetAdjustment = (scaledDiameter - exactDiameter) / 2;
          const avatarX = Math.round(centerX - (scaledDiameter / 2));
          const avatarY = Math.round(centerY - (scaledDiameter / 2));
          
          // Add boundary checks before compositing
          if (avatarX >= -offsetAdjustment && avatarY >= -offsetAdjustment && 
              avatarX + scaledDiameter <= baseImage.width + offsetAdjustment && 
              avatarY + scaledDiameter <= baseImage.height + offsetAdjustment) {
            
            // Composite the avatar onto the base image
            baseImage.composite(avatarImage, avatarX, avatarY, {
              mode: Jimp.BLEND_SOURCE_OVER,
              opacitySource: 1,
              opacityDest: 1
            });
            
            console.log(`Placed avatar ${i+1} at (${avatarX},${avatarY}) with adjusted diameter ${scaledDiameter}`);
          } else {
            console.warn(`Avatar ${i+1} placement partially out of bounds. Using fallback positioning.`);
            
            // Fallback: place avatar at a valid position near the center of the image
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
    
    // Generate unique ID for the final image file
    const imageId = shortid.generate();
    const imagePath = path.join(IMAGES_DIR, `${imageId}.png`);
    
    // Save the final composite image - Updated write method
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
    
    // Step 1: Generate base image from text prompt with white circles for avatar placement
    const { tempImageId, tempImagePath } = await generateBaseImage(prompt, avatarUrls.length);
    
    // Step 2: Place avatars into the white circles
    const { imageId, imagePath } = await placeAvatarsInCircles(tempImagePath, avatarUrls);
    
    // Clean up the temporary base image
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

// Track users who are in "edit mode"
const usersInEditMode = new Map();

// Function to edit an existing game
async function editGame(gameId, editPrompt, originalHtml) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer. A user has provided an HTML game and wants to modify it according to their edit prompt.
            
            CRITICAL REQUIREMENTS:
            1. Preserve the existing game structure
            2. Make changes according to the edit prompt
            3. Ensure the game remains fully functional and error-free
            4. Return the complete HTML file with your modifications
            5. PRESERVE any existing "Powered by Luck Off" link to https://luckoff.chat/
            6. If there is no "Powered by Luck Off" link, ADD a clickable link that opens https://luckoff.chat/ in a new tab
            
            Make targeted modifications to fulfill the edit request while maintaining all existing functionality.`
          },
          {
            role: 'user',
            content: `Here is the current game HTML:\n\n${originalHtml}\n\nPlease modify this game according to this edit request: ${editPrompt}\n\nIMPORTANT: Ensure the game includes a visible "Powered by Luck Off" link to https://luckoff.chat/ that opens in a new tab.`
          }
        ],
        temperature: 0.6
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract HTML game code from response
    const gameCode = response.data.choices[0].message.content;
    const editedHtml = extractHtmlFromResponse(gameCode);
    
    // Save the edited game HTML to file
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, editedHtml);
    
    return gameId;
  } catch (error) {
    console.error('Error editing game:', error);
    throw error;
  }
}

// Function to auto-enhance an existing game
async function enhanceGame(gameId, originalHtml) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: `You are an expert game developer tasked with enhancing and improving an existing HTML game. 
            
            CRITICAL ENHANCEMENT REQUIREMENTS:
            1. Fix any bugs or errors in the game code
            2. Improve game mechanics and features where possible
            3. Enhance visuals and user interface
            4. Add appropriate sound effects where missing
            5. Optimize performance and responsiveness
            6. Ensure mobile compatibility if not already present
            7. Add helpful game instructions if they're missing or unclear
            8. PRESERVE any existing "Powered by Luck Off" link to https://luckoff.chat/
            9. If there is no "Powered by Luck Off" link, ADD a clickable link that opens https://luckoff.chat/ in a new tab
            
            Analyze the game thoroughly and implement enhancements that improve the player experience while maintaining the core gameplay concept.
            Return the complete enhanced HTML file.`
          },
          {
            role: 'user',
            content: `Here is an HTML game that needs enhancement:\n\n${originalHtml}\n\nPlease analyze this game, fix any bugs, and enhance its features. Keep the core game concept intact while improving the user experience, visuals, and performance. Make sure any existing "Powered by Luck Off" link is preserved or add one if it's missing.`
          }
        ],
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract HTML game code from response
    const gameCode = response.data.choices[0].message.content;
    const enhancedHtml = extractHtmlFromResponse(gameCode);
    
    // Save the enhanced game HTML to file
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    fs.writeFileSync(gamePath, enhancedHtml);
    
    return gameId;
  } catch (error) {
    console.error('Error enhancing game:', error);
    throw error;
  }
}

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if the user is in edit mode and waiting for an edit prompt
  if (usersInEditMode.has(message.author.id)) {
    const { gameId, loadingMessage } = usersInEditMode.get(message.author.id);
    const editPrompt = message.content;
    
    // Clear edit mode for this user
    usersInEditMode.delete(message.author.id);
    
    // Update the loading message to indicate editing has started
    await loadingMessage.edit('🔄 Editing your game... This might take a minute!');
    
    try {
      // Read the original game file
      const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
      if (!fs.existsSync(gamePath)) {
        await loadingMessage.edit(`Error: Game with ID ${gameId} not found.`);
        return;
      }
      
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      // Edit the game
      await editGame(gameId, editPrompt, originalHtml);
      
      // Create an embed with the game information
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
      
      // Edit the loading message with the game ID
      await loadingMessage.edit({ content: 'Game updated successfully!', embeds: [gameEmbed] });
      
      // Delete the user's edit prompt message to keep the channel clean
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

  // Check for !playgame command
  const playGameMatch = message.content.match(/^!playgame\s+([a-zA-Z0-9_-]+)$/);
  if (playGameMatch) {
    const gameId = playGameMatch[1];
    
    // Check if the game exists
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    // Get the server URL from environment variables or default to localhost during development
    const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;

    // Create user token with Discord info for authentication
    const userToken = jwt.sign({
      id: message.author.id,
      username: message.author.username,
      avatar: message.author.displayAvatarURL({ format: 'png' })
    }, JWT_SECRET);
    
    const gameUrl = `${baseUrl}/game/${gameId}?token=${userToken}`;
    
    // Create an embed with the personalized game link
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
    
    // Send directly in the channel
    await message.reply({ content: `${message.author} Here's your game link:`, embeds: [gameEmbed] });
    
    return;
  }

  // Check for !editgame command
  const editGameMatch = message.content.match(/^!editgame\s+([a-zA-Z0-9_-]+)$/);
  if (editGameMatch) {
    const gameId = editGameMatch[1];
    
    // Check if the game exists
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply(`Game ${gameId} found. Please send your edit request in the next message.`);
    
    // Put the user in edit mode
    usersInEditMode.set(message.author.id, { gameId, loadingMessage });
    return;
  }

  // Check for !enhance command
  const enhanceGameMatch = message.content.match(/^!enhance\s+([a-zA-Z0-9_-]+)$/);
  if (enhanceGameMatch) {
    const gameId = enhanceGameMatch[1];
    
    // Check if the game exists
    const gamePath = path.join(GAMES_DIR, `${gameId}.html`);
    if (!fs.existsSync(gamePath)) {
      message.reply(`Error: Game with ID ${gameId} not found.`);
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply(`🔄 Enhancing game ${gameId}... This might take a minute or two!`);
    
    try {
      // Read the original game file
      const originalHtml = fs.readFileSync(gamePath, 'utf8');
      
      // Enhance the game
      await enhanceGame(gameId, originalHtml);
      
      // Create an embed with the game information
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
      
      // Edit the loading message with the game ID
      await loadingMessage.edit({ content: '✅ Game successfully enhanced!', embeds: [gameEmbed] });
      
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error enhancing your game. Please try again later.');
    }
    
    return;
  }

  // Check for !createmusic command
  if (message.content.startsWith('!createmusic')) {
    const fullContent = message.content.slice('!createmusic'.length).trim();
    
    // Check if there are lyrics in the format "[lyrics] ... [/lyrics]"
    let prompt, lyrics;
    const lyricsMatch = fullContent.match(/\[lyrics\]([\s\S]*?)\[\/lyrics\]/);
    
    if (lyricsMatch) {
      // Extract lyrics from the special format
      lyrics = lyricsMatch[1].trim();
      // Get the remaining text as the prompt
      prompt = fullContent.replace(/\[lyrics\][\s\S]*?\[\/lyrics\]/, '').trim();
      if (!prompt) prompt = "Generate music for these lyrics";
    } else {
      prompt = fullContent;
      lyrics = null;
    }
    
    if (!prompt) {
      message.reply('Please provide a prompt for the music. Examples:\n- `!createmusic upbeat jazz with piano solo`\n- `!createmusic [lyrics]In the silence, I hear your name\nEchoes of love that still remain[/lyrics] soft piano ballad`\n- Attach an audio file with your command to use it as a base for music generation');
      return;
    }
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      message.reply('You need to join a voice channel first!');
      return;
    }
    
    // Check if a file is attached to the message
    let songFileUrl = 'https://replicate.delivery/pbxt/M9zum1Y6qujy02jeigHTJzn0lBTQOemB7OkH5XmmPSC5OUoO/MiniMax-Electronic.wav';
    const hasAttachment = message.attachments.size > 0;
    
    if (hasAttachment) {
      const attachment = message.attachments.first();
      // Check if the attachment is an audio file
      const isAudio = attachment.contentType && attachment.contentType.startsWith('audio/');
      
      if (isAudio) {
        songFileUrl = attachment.url;
        console.log(`Using user-provided song file: ${songFileUrl}`);
      } else {
        await message.reply('The attached file is not recognized as an audio file. Using the default sample instead.');
      }
    }
    
    // Send initial response with better messaging about timing
    const loadingMessage = await message.reply(`🎵 Generating your custom music track${hasAttachment ? ' using your audio file' : ''}... This might take 1-2 minutes. Please be patient!`);
    
    try {
      // Generate the music with the song file URL (default or from attachment)
      const { musicId, musicPath } = await generateMusic(prompt, lyrics, songFileUrl);
      
      // Create an embed with the music information
      const musicEmbed = new EmbedBuilder()
        .setColor('#9966ff')
        .setTitle('🎵 Your Custom Music Track is Ready!')
        .setDescription(`**Music prompt:** ${prompt}${lyrics ? '\n\n**With custom lyrics**' : ''}${hasAttachment ? '\n\n**Using your provided audio file**' : ''}`)
        .setFooter({ text: 'Generated using AI • Now playing in your voice channel' })
        .setTimestamp();
      
      // Edit the loading message and attach the music file
      await loadingMessage.edit({ content: 'Music created successfully!', embeds: [musicEmbed], files: [musicPath] });
      
      // Join the voice channel and play the music
      try {
        // Create a voice connection
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        
        // Create an audio player
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause,
          },
        });
        
        // Create an audio resource from the generated file
        const resource = createAudioResource(musicPath);
        
        // Play the audio
        player.play(resource);
        connection.subscribe(player);
        
        // Store the connection and player for cleanup later
        voiceConnections.set(voiceChannel.guild.id, connection);
        audioPlayers.set(voiceChannel.guild.id, player);
        
        // Handle when audio finishes playing
        player.on(AudioPlayerStatus.Idle, () => {
          // Disconnect after playing
          connection.destroy();
          voiceConnections.delete(voiceChannel.guild.id);
          audioPlayers.delete(voiceChannel.guild.id);
          
          // Clean up the file
          try {
            fs.unlinkSync(musicPath);
            console.log(`Deleted music file: ${musicPath}`);
          } catch (err) {
            console.error(`Error deleting music file: ${err}`);
          }
        });
        
        // Add error handling for player errors
        player.on('error', error => {
          console.error(`Error playing audio: ${error.message}`);
          connection.destroy();
          voiceConnections.delete(voiceChannel.guild.id);
          audioPlayers.delete(voiceChannel.guild.id);
          message.channel.send('Error playing the generated music in the voice channel.');
          
          // Clean up the file
          try {
            fs.unlinkSync(musicPath);
            console.log(`Deleted music file (after error): ${musicPath}`);
          } catch (err) {
            console.error(`Error deleting music file: ${err}`);
          }
        });
        
      } catch (voiceError) {
        console.error('Error connecting to voice channel:', voiceError);
        message.channel.send('Failed to join your voice channel. Please check permissions or try again later.');
        
        // Clean up the file if voice connection fails
        setTimeout(() => {
          try {
            fs.unlinkSync(musicPath);
            console.log(`Deleted music file (voice error): ${musicPath}`);
          } catch (err) {
            console.error(`Error deleting music file: ${err}`);
          }
        }, 10000); // 10 seconds delay
      }
      
    } catch (error) {
      console.error('Error generating music:', error);
      
      // Provide more helpful error message to the user
      let errorMessage = 'Sorry, there was an error generating your music. Please try again later.';
      
      if (error.message.includes('timed out')) {
        errorMessage = 'Sorry, music generation timed out. Please try a simpler prompt or try again later.';
      } else if (error.message.includes('vocal_id null not found')) {
        errorMessage = 'Sorry, there was an issue with the music generation service. Please try a different prompt.';
      }
      
      await loadingMessage.edit(errorMessage);
    }
  }
  
  // Check for !singlegame command
  if (message.content.startsWith('!singlegame')) {
    const prompt = message.content.slice('!singlegame'.length).trim();
    
    if (!prompt) {
      message.reply('Please provide a prompt for the game. Example: `!singlegame platform adventure with collectibles`');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply('🎮 Generating your custom single-player game... This might take a minute!');
    
    try {
      // Generate the single-player game
      const gameId = await generateSinglePlayerGame(prompt);
      
      // Create an embed with just the game ID, no direct links
      const gameEmbed = new EmbedBuilder()
        .setColor('#00cc99')
        .setTitle('🎮 Your Custom Single-Player Game is Ready!')
        .setDescription(`**Game prompt:** ${prompt}`)
        .addFields(
          { name: 'Game ID', value: `\`${gameId}\`` },
          { name: 'How to Play', value: 'Use `!playgame ' + gameId + '` to get a personalized link to your game.' },
          { name: 'Share Your Game', value: 'Share the Game ID with friends so they can try your game!' },
          { name: 'Edit Your Game', value: `To modify this game, use command: \`!editgame ${gameId}\`` },
          { name: 'Auto-Enhance Your Game', value: `To automatically improve and fix bugs in your game, use command: \`!enhance ${gameId}\`` },
          { name: 'Features', value: '• Custom gameplay based on your prompt\n• Personal high scores\n• Discord profile integration' }
        )
        .setFooter({ text: 'Generated using AI • To play, use !playgame command' })
        .setTimestamp();
      
      // Edit the loading message with the game ID
      await loadingMessage.edit({ content: 'Game created successfully!', embeds: [gameEmbed] });
    } catch (error) {
      console.error('Error:', error);
      await loadingMessage.edit('Sorry, there was an error generating your game. Please try again later.');
    }
  }

  // Check for !multigame command
  if (message.content.startsWith('!multigame')) {
    // Create an embed with information about the upcoming multiplayer feature
    const multiplayerEmbed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🎮 Multiplayer Games - Coming Soon!')
      .setDescription('Multiplayer game functionality is currently under development and will be available in a future update.')
      .addFields(
        { name: 'Available Now', value: 'In the meantime, try our single-player games with `!singlegame [prompt]`!' },
      )
      .setFooter({ text: 'Stay tuned for updates!' })
      .setTimestamp();
    
    // Send the embed
    await message.reply({ embeds: [multiplayerEmbed] });
    return;
  }

  // Check for !generateimage command with mentions
  if (message.content.startsWith('!generateimage')) {
    // Extract mentioned users from the message
    const mentionedUsers = Array.from(message.mentions.users.values());
    
    if (mentionedUsers.length === 0) {
      message.reply('Please mention at least one user to include their avatar in the image. Example: `!generateimage @username1 @username2`');
      return;
    }
    
    // Send initial response
    const loadingMessage = await message.reply(`I found ${mentionedUsers.length} mentioned user(s). Now, please describe the scenario for the image in your next message.`);
    
    // Put the user in wait-for-prompt mode
    usersWaitingForImagePrompt.set(message.author.id, { mentionedUsers, loadingMessage });
    return;
  }

  // Check if the user is waiting to provide an image prompt
  if (usersWaitingForImagePrompt.has(message.author.id)) {
    const { mentionedUsers, loadingMessage } = usersWaitingForImagePrompt.get(message.author.id);
    const imagePrompt = message.content;
    
    // Clear prompt wait for this user
    usersWaitingForImagePrompt.delete(message.author.id);
    
    // Update the loading message to indicate image generation has started
    await loadingMessage.edit('🎨 Generating your custom image in two steps...\n1️⃣ Creating base image from your prompt with placeholder circles\n2️⃣ Adding user avatars to the circles\n\nThis process might take 2-3 minutes!');
    
    try {
      // Collect avatar URLs from mentioned users - EXPLICITLY REQUEST PNG FORMAT
      const avatarUrls = mentionedUsers.map(user => 
        user.displayAvatarURL({ format: 'png', size: 512 })
      );
      
      console.log('Avatar URLs:', avatarUrls);
      
      // Generate the image using the two-step process
      const { imageId, imagePath } = await generateImageWithAvatars(imagePrompt, avatarUrls);
      
      // Create an embed with the image information
      const imageEmbed = new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle('🎨 Your Custom Image with Avatars is Ready!')
        .setDescription(`**Image prompt:** ${imagePrompt}\n\n**Featuring:** ${mentionedUsers.map(user => user.username).join(', ')}`)
        .setImage(`attachment://${imageId}.png`)
        .setFooter({ text: 'Generated using AI with Discord avatars' })
        .setTimestamp();
      
      // Send the image in the channel
      await message.channel.send({ 
        content: `${message.author} Here's your generated image with ${mentionedUsers.length} user avatars:`,
        embeds: [imageEmbed],
        files: [{ attachment: imagePath, name: `${imageId}.png` }]
      });
      
      // Edit the loading message
      await loadingMessage.edit('✅ Composite image generated successfully!');
      
      // Delete the prompt message to keep the channel clean
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting message:', error);
      }
      
      // Delete the temporary image file after sending
      setTimeout(() => {
        try {
          fs.unlinkSync(imagePath);
          console.log(`Deleted image file: ${imagePath}`);
        } catch (err) {
          console.error(`Error deleting image file: ${err}`);
        }
      }, 5000); // 5 seconds delay
      
    } catch (error) {
      console.error('Error:', error);
      
      // Provide more helpful error message
      let errorMessage = 'Sorry, there was an error generating your image. Please try again later.';
      
      if (error.message.includes('timeout')) {
        errorMessage = 'Sorry, image generation timed out. Please try a simpler prompt or try again later.';
      }
      
      await loadingMessage.edit(errorMessage);
    }
    
    return;
  }
});

// Add a function to handle cleaning up voice connections when the bot is stopped
process.on('SIGINT', () => {
  voiceConnections.forEach(connection => {
    connection.destroy();
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  voiceConnections.forEach(connection => {
    connection.destroy();
  });
  process.exit(0);
});

// Start the Express server and Discord bot
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Login to Discord with your app's token
client.login(process.env.DISCORD_BOT_TOKEN);