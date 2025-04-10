const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { sampleYouTubeChannel } = require('./utils/youtube');
const { createVideoCompilation } = require('./utils/videoProcessor');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Garbage collection helper - Force garbage collection when possible
function forceGC() {
  if (global.gc) {
    global.gc();
    console.log('Forced garbage collection');
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
  // Clean any leftover files in temp directory
  const files = fs.readdirSync(tempDir);
  for (const file of files) {
    fs.unlinkSync(path.join(tempDir, file));
  }
}

client.once('ready', () => {
  console.log('Bot is ready!');
});

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
  
  isProcessing = false;
  forceGC(); // Try to free memory
  processQueue(); // Process next item
}

// Handler for !oot command
async function handleOotCommand(message, channelUrl) {
  let processingMsg = null;
  
  try {
    // Send initial processing message
    processingMsg = await message.channel.send('Processing your request, this might take a while...');
    
    // Get videos from the channel (reduced to 3 for memory concerns)
    const videos = await sampleYouTubeChannel(channelUrl, 3);
    
    if (videos.length < 3) {
      await processingMsg.edit('Could not find enough videos on that channel.');
      return;
    }
    
    await processingMsg.edit('Found videos, now creating compilation...');
    forceGC(); // Try to free memory
    
    // Create compilation video with reduced quality
    const outputPath = await createVideoCompilation(videos, tempDir);
    forceGC(); // Try to free memory
    
    // Check if file exists and is not empty
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      await processingMsg.edit('Failed to create video compilation.');
      return;
    }
    
    const fileSize = fs.statSync(outputPath).size;
    console.log(`Compilation created: ${fileSize} bytes`);
    
    if (fileSize < 1024) {
      await processingMsg.edit('Created compilation is too small to be valid.');
      fs.unlinkSync(outputPath);
      return;
    }
    
    if (fileSize > 7900000) { // Discord's file limit is ~8MB
      await processingMsg.edit('Compilation is too large to upload to Discord. Try a channel with shorter videos.');
      fs.unlinkSync(outputPath);
      return;
    }
    
    await processingMsg.edit('Compilation created, uploading now...');
    
    // Send the video
    const attachment = new AttachmentBuilder(outputPath, { name: 'compilation.mp4' });
    await message.channel.send({ 
      content: 'Here is your video compilation from ' + channelUrl, 
      files: [attachment] 
    });
    
    // Clean up
    fs.unlinkSync(outputPath);
    
    // Delete processing message
    await processingMsg.delete().catch(console.error);
    
  } catch (error) {
    console.error('Error processing !oot command:', error);
    
    if (processingMsg) {
      await processingMsg.edit(`Error creating compilation: ${error.message}`);
    } else {
      await message.channel.send(`Error creating compilation: ${error.message}`);
    }
  }
}

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

// Handle process events
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

client.login(process.env.DISCORD_BOT_TOKEN);