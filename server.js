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

// Implement a queue system to avoid processing multiple requests at once
const queue = [];
let isProcessing = false;

// Process the next item in the queue
async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  
  isProcessing = true;
  const task = queue.shift();
  
  try {
    await task();
  } catch (error) {
    console.error('Error processing queue task:', error);
  }
  
  // Clean up and reset
  clearDirectory(tempDir);
  isProcessing = false;
  forceGC();
  
  // Delay the next task to let memory settle
  setTimeout(processQueue, 2000);
}

// Handler for !oot command
async function handleOotCommand(message, channelUrl) {
  let processingMsg = null;
  
  try {
    // Send initial processing message
    processingMsg = await message.channel.send('Processing your request, this might take a while...');
    
    // Reduce to only 2 videos to save memory
    const videos = await sampleYouTubeChannel(channelUrl, 2);
    
    if (videos.length < 2) {
      await processingMsg.edit('Could not find enough videos on that channel.');
      return;
    }
    
    await processingMsg.edit('Found videos, now creating compilation...');
    forceGC();
    
    // Create compilation video
    const outputPath = await createVideoCompilation(videos, tempDir);
    forceGC();
    
    // Check if file exists and is not empty
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
      await processingMsg.edit('Failed to create video compilation. The server might be under high load.');
      return;
    }
    
    await processingMsg.edit('Compilation created, uploading now...');
    
    try {
      // Send the video
      const attachment = new AttachmentBuilder(outputPath, { name: 'compilation.mp4' });
      await message.channel.send({ 
        content: `Here's a video compilation representing ${channelUrl}`, 
        files: [attachment] 
      });
      
      // Delete processing message only after successful upload
      await processingMsg.delete().catch(console.error);
    } catch (uploadError) {
      console.error('Upload error:', uploadError);
      await processingMsg.edit(`Error uploading video: ${uploadError.message}`);
    } finally {
      // Always clean up the file
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }
  } catch (error) {
    console.error('Error processing !oot command:', error);
    
    if (processingMsg) {
      await processingMsg.edit(`Error creating compilation: ${error.message}`);
    } else {
      await message.channel.send(`Error creating compilation: ${error.message}`);
    }
    
    // Clean up temporary directory on error
    clearDirectory(tempDir);
  }
}

client.once('ready', () => {
  console.log('Bot is ready!');
  
  // Every hour, force garbage collection and clear temp directory
  setInterval(() => {
    console.log('Performing scheduled cleanup...');
    clearDirectory(tempDir);
    forceGC();
  }, 60 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  if (message.content === '!hello') {
    message.channel.send('Hello!');
  }
  
  if (message.content.startsWith('!oot ')) {
    const channelUrl = message.content.substring(5).trim();
    
    // Add to processing queue
    queue.push(() => handleOotCommand(message, channelUrl));
    
    // Start processing if not already
    if (!isProcessing) {
      processQueue();
    } else {
      message.channel.send('Your request has been queued. Currently processing another request...');
    }
  }
});

// Error handling for the process
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
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