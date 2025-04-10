const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { sampleYouTubeChannel } = require('./utils/youtube');
const { createVideoCompilation } = require('./utils/videoProcessor');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Garbage collection helper
function forceGC() {
  if (global.gc) {
    global.gc();
    console.log('Forced garbage collection');
  }
}

// Clear files in a directory
function clearDirectory(directory) {
  if (fs.existsSync(directory)) {
    const files = fs.readdirSync(directory);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(directory, file));
      } catch (err) {
        console.error(`Failed to delete ${file}: ${err.message}`);
      }
    }
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages]
});

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
} else {
  clearDirectory(tempDir);
}

// Handler for !oot command - direct implementation without queue
async function handleOotCommand(message, channelUrl) {
  let processingMsg = null;
  
  try {
    // Send initial processing message
    processingMsg = await message.channel.send('Processing your request...');
    
    // Get a single random video from the channel
    const videos = await sampleYouTubeChannel(channelUrl);
    
    if (!videos || videos.length === 0) {
      await processingMsg.edit('Could not find any videos on that channel.');
      return;
    }
    
    await processingMsg.edit('Found video, creating clip...');
    forceGC();
    
    // Create a simple video representation
    const outputPath = await createVideoCompilation(videos, tempDir);
    
    // Check if file exists
    if (!fs.existsSync(outputPath)) {
      await processingMsg.edit('Failed to create video. Please try again later.');
      return;
    }
    
    try {
      // Send the video
      const attachment = new AttachmentBuilder(outputPath, { name: 'channel_preview.mp4' });
      await message.channel.send({ 
        content: `Here's a preview for ${channelUrl} featuring "${videos[0].title}"`, 
        files: [attachment] 
      });
      
      // Delete processing message
      await processingMsg.delete().catch(console.error);
    } catch (uploadError) {
      console.error('Upload error:', uploadError);
      await processingMsg.edit(`Error uploading video: File may be too large or invalid`);
    } finally {
      // Always clean up
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }
  } catch (error) {
    console.error('Error processing !oot command:', error);
    
    if (processingMsg) {
      await processingMsg.edit(`Error: ${error.message}`);
    } else {
      await message.channel.send(`Error: ${error.message}`);
    }
    
    // Clean up temporary directory on error
    clearDirectory(tempDir);
  }
  
  forceGC();
}

client.once('ready', () => {
  console.log('Bot is ready!');
  
  // Every 15 minutes, force cleanup to prevent memory leaks
  setInterval(() => {
    console.log('Performing scheduled cleanup...');
    clearDirectory(tempDir);
    forceGC();
  }, 15 * 60 * 1000); // 15 minutes
});

client.on('messageCreate', async (message) => {
  if (message.content === '!hello') {
    message.channel.send('Hello!');
    return;
  }
  
  if (message.content.startsWith('!oot ')) {
    const channelUrl = message.content.substring(5).trim();
    
    // Process directly instead of using a queue
    try {
      await handleOotCommand(message, channelUrl);
    } catch (error) {
      console.error('Unhandled error in command:', error);
      message.channel.send('An unexpected error occurred. Please try again later.');
    }
    
    // Force cleanup after processing
    clearDirectory(tempDir);
    forceGC();
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
});

// Handle termination signals
process.on('SIGTERM', () => {
  console.log('SIGTERM received, cleaning up...');
  clearDirectory(tempDir);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, cleaning up...');
  clearDirectory(tempDir);
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);