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
        return message.channel.send('Could not find enough videos on that channel.');
      }
      
      // Create compilation video
      const outputPath = await createVideoCompilation(videos, tempDir);
      
      // Send the video
      const attachment = new AttachmentBuilder(outputPath, { name: 'compilation.mp4' });
      await message.channel.send({ content: 'Here is your video compilation!', files: [attachment] });
      
      // Clean up
      fs.unlinkSync(outputPath);
      videos.forEach(video => {
        if (fs.existsSync(video.localPath)) {
          fs.unlinkSync(video.localPath);
        }
      });
      
      // Delete processing message
      processingMsg.delete().catch(console.error);
    } catch (error) {
      console.error('Error processing !oot command:', error);
      message.channel.send(`Error creating compilation: ${error.message}`);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);