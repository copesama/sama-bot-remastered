const { EmbedBuilder } = require('discord.js');

/**
 * Handles the help command and returns information about available commands
 * @param {Object} message The Discord message object
 */
async function handleHelpCommand(message) {
  try {
    const embed = createHelpEmbed();
    await message.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error in help command:', error);
    await message.channel.send('Sorry, there was an error displaying the help information.');
  }
}

/**
 * Creates the embed with all command information
 * @returns {EmbedBuilder} Discord embed with command info
 */
function createHelpEmbed() {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('📚 Bot Commands Guide')
    .setDescription('Here are all the available commands and how to use them:')
    .addFields(
      { 
        name: '🎮 Game Commands', 
        value: 
          '`!singlegame [prompt]` - Generate a personalized HTML5 game based on your prompt (Powered by Google Gemini 2.0 Flash)\n' +
          '`!playgame [gameId]` - Play a previously generated game with your Discord info integrated\n' +
          '`!editgame [gameId]` - Edit features or mechanics of a game you created\n' +
          '`!enhance [gameId]` - Automatically improve your game with bug fixes and optimizations\n' +
          '`!multigame` - Create a multiplayer game experience'
      },
      { 
        name: '📊 Finance Commands', 
        value: 
          '`!financenews` - Get the latest financial news headlines with AI-powered market analysis and stock recommendations\n' +
          '`!financereport` - Generate a detailed financial market report for stocks mentioned in the most recent analysis\n' +
          '`!financenews subscribe` - Subscribe the current channel to daily financial updates (Admin only)\n' +
          '`!financenews unsubscribe` - Remove daily financial updates from your server (Admin only)\n' +
          '`!financenews status` - Check if your server is subscribed to daily financial updates\n\n' +
          'Subscribed channels receive:\n' +
          '   - Morning financial news and market analysis (15 minutes before market open)\n' +
          '   - Evening performance report of mentioned stocks (5 minutes after market close)'
      },
      { 
        name: '🎓 Quiz Command', 
        value: 
          '`!generatequiz [topic]` - Create a personalized quiz about any topic\n' +
          '`!generatequiz [number] [topic]` - Create a quiz with a custom number of questions (3-20)\n' +
          '   - Example: `!generatequiz Solar System` - Creates a 10-question quiz about the Solar System\n' +
          '   - Example: `!generatequiz 15 World History` - Creates a 15-question quiz about World History\n' +
          '   - Interactive multiple-choice format with immediate feedback\n' +
          '   - Detailed explanations for each answer\n' +
          '   - Complete quiz summary at the end\n' +
          '   - One active quiz per user at a time'
      },
      { 
        name: '🎵 Music Command', 
        value: 
          '`!generatemusic [lyrics]Your lyrics here[/lyrics]` - Generate and play AI-created music\n' +
          '   - Format your lyrics between [lyrics] and [/lyrics] tags\n' +
          '   - Example: `!generatemusic [lyrics]In the silence, I hear your name\nEchoes of love that still remain[/lyrics]`\n' +
          '   - You can optionally attach an audio file to use as a base for the generation\n' +
          '   - You must be in a voice channel to use this command\n' +
          '   - Processing time: 1-2 minutes for complete track generation'
      },
      { 
        name: '📝 Story Command', 
        value: 
          '`!generatestory @user1 @user2...` - Create an interactive story with mentioned users as characters\n' +
          '   - First mention users to include as characters (at least one required)\n' +
          '   - Then provide a scenario description in your next message\n' +
          '   - Bot will generate a story (1000-2000 words) with AI-created scene images\n' +
          '   - Each mentioned user\'s avatar will be incorporated into the story images\n' +
          '   - Processing time: 3-5 minutes for complete story with images'
      },
      { 
        name: '🖼️ Image Commands', 
        value: 
          '`!generateimage @user1 @user2...` - Create an AI image featuring mentioned users\' avatars\n' +
          '   - First mention users, then provide a detailed scene description\n' +
          '   - Example: `!generateimage @user1 @user2 superheroes fighting robots in a futuristic city`\n' +
          '   - Supports multiple users (up to 5 recommended)\n' +
          '   - Processing time: 2-3 minutes for high-quality results'
      },
      { 
        name: '🔗 Other Commands', 
        value: 
          '`!invite` - Get an invite link to add this bot to another server\n' +
          '`!help` - Show this help message'
      }
    )
    .addFields(
      {
        name: '🤖 AI Attribution',
        value: 
          'Game Generator: Google Gemini 2.0 Flash via OpenRouter\n' +
          'Story Generator: Sophosympatheia Rogue Rose (story) & Gemini 2.0 Flash (scene descriptions) via OpenRouter\n' +
          'Quiz Generator: Google Gemini 2.0 Flash via OpenRouter\n' +
          'Image Generator: FLUX.1 Model via Hugging Face\n' +
          'Music Generator: MiniMax-01 Model via Segmind API\n' +
          'Financial Analysis: Microsoft MAI-DS-R1 via OpenRouter\n' +
          'Market Data: Alpha Vantage API & News API'
      }
    )
    .setFooter({ text: 'Type a command to get started!' });

  return embed;
}

module.exports = { handleHelpCommand };
