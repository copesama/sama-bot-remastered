const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { sampleYouTubeChannel } = require('./utils/youtube');
const { createVideoCompilation } = require('./utils/videoProcessor');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages]
});

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

client.once('ready', () => {
  console.log('Bot is ready!');
});

client.on('messageCreate', async (message) => {
  if (message.content === '!hello') {
    message.channel.send('Hello!');
  }
  
  if (message.content.startsWith('!oot ')) {
    const channelUrl = message.content.substring(5).trim();
    try {
      // Send initial processing message
      const processingMsg = await message.channel.send('Processing your request, this might take a while...');
      
      // Get 5 random videos from the channel
      const videos = await sampleYouTubeChannel(channelUrl, 5);
      
      if (videos.length < 5) {
        processingMsg.delete().catch(console.error);
        return message.channel.send('Could not find enough videos on that channel.');
      }
      
      // Update progress message
      await processingMsg.edit('Found videos, now creating compilation...');
      
      // Create compilation video
      const outputPath = await createVideoCompilation(videos, tempDir);
      
      // Check if file exists and is not empty
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        processingMsg.delete().catch(console.error);
        throw new Error('Failed to create video compilation.');
      }
      
      // Check if file size is reasonable
      const fileSize = fs.statSync(outputPath).size;
      if (fileSize < 1024) { // Less than 1KB is probably an invalid file
        processingMsg.delete().catch(console.error);
        throw new Error('Created compilation is too small to be valid.');
      }
      
      await processingMsg.edit('Compilation created, uploading now...');
      
      try {
        // Send the video
        const attachment = new AttachmentBuilder(outputPath, { name: 'compilation.mp4' });
        await message.channel.send({ 
          content: 'Here is your video compilation from ' + channelUrl, 
          files: [attachment] 
        });
        
        // Clean up
        fs.unlinkSync(outputPath);
        
        // Delete processing message only after successful upload
        processingMsg.delete().catch(console.error);
      } catch (uploadError) {
        processingMsg.edit(`Error uploading video: ${uploadError.message}`);
        console.error('Upload error:', uploadError);
      }
    } catch (error) {
      console.error('Error processing !oot command:', error);
      message.channel.send(`Error creating compilation: ${error.message}`);
      
      // Attempt to delete the processing message if it exists
      if (processingMsg && processingMsg.deletable) {
        processingMsg.delete().catch(console.error);
      }
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);