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
          '`!singlegame [prompt]` (`!sgame`) - Generate a personalized HTML5 game based on your prompt\n' +
          '`!playgame [gameId]` (`!play`) - Play a previously generated game with your Discord info integrated\n' +
          '`!editgame [gameId]` (`!edit`) - Edit features or mechanics of a game you created\n' +
          '`!enhancegame [gameId]` (`!enhance`) - Automatically improve your game with bug fixes and optimizations\n' +
          '`!multigame` (`!mgame`) - Create a multiplayer game experience (Coming soon!)'
      },
      { 
        name: '📊 Finance Commands', 
        value: 
          '`!financenews` (`!fnews`) - Get the latest financial news headlines with AI-powered market analysis and stock recommendations\n' +
          '`!financereport` (`!freport`) - Generate a detailed financial market report for stocks mentioned in the most recent analysis\n' +
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
          '`!generatequiz [topic]` (`!quiz`) - Create a personalized quiz about any topic\n' +
          '`!generatequiz [number] [topic]` (`!quiz [number] [topic]`) - Create a quiz with a custom number of questions (3-20)\n' +
          '   - Example: `!generatequiz Solar System` - Creates a 10-question quiz about the Solar System\n' +
          '   - Example: `!quiz 15 World History` - Creates a 15-question quiz about World History\n' +
          '   - Interactive multiple-choice format with immediate feedback\n' +
          '   - Detailed explanations for each answer\n' +
          '   - Complete quiz summary at the end\n' +
          '   - One active quiz per user at a time'
      },
      { 
        name: '🎲 Choices Game Command', 
        value: 
          '`!generatechoicesgame [scenario]` (`!choicesgame`) - Create an interactive choice-based story game\n' +
          '   - Example: `!choicesgame space explorer` or `!generatechoicesgame medieval knight`\n' +
          '   - Make decisions by clicking interactive buttons\n' +
          '   - Each choice leads to different paths and outcomes\n' +
          '   - Multiple possible endings (good and bad)\n' +
          '   - Only one active choices game per user at a time\n' +
          '   - Designed for solo play with 5-minute decision time limit per choice'
      },
      { 
        name: '🎵 Music Command', 
        value: 
          '`!generatemusic [lyrics]Your lyrics here[/lyrics]` (`!music`) - Generate and play AI-created music\n' +
          '   - Format your lyrics between [lyrics] and [/lyrics] tags\n' +
          '   - Example: `!music [lyrics]In the silence, I hear your name\nEchoes of love that still remain[/lyrics]`\n' +
          '   - You can optionally attach an audio file to use as a base for the generation\n' +
          '   - You must be in a voice channel to use this command\n'

      },
      { 
        name: '📝 Story Command', 
        value: 
          '`!generatestory @user1 @user2...` (`!story`) - Create an interactive story with mentioned users as characters\n' +
          '   - First mention users to include as characters (at least one required)\n' +
          '   - Then provide a scenario description in your next message\n' +
          '   - Bot will generate a story (1000-2000 words) with AI-created scene images\n' +
          '   - Each mentioned user\'s avatar will be incorporated into the story images\n'
      },
      { 
        name: '🖼️ Image Commands', 
        value: 
          '`!generateimage @user1 @user2...` (`!image`) - Create an AI image featuring mentioned users\' avatars\n' +
          '   - First mention users, then provide a detailed scene description\n' +
          '   - Example: `!image @user1 @user2 superheroes fighting robots in a futuristic city`\n' +
          '   - Supports multiple users (up to 5 recommended)\n' 
      },
      { 
        name: '📝 Academic Writing Helper', 
        value: 
          '`!generatehuman [topic]` (`!human`) - Create academic text that mimics your writing style\n' +
          '   - Example: `!human climate change`\n' +
          '   - Bot will ask you a question about the topic\n' +
          '   - Your response should be at least 50 words for best results\n' +
          '   - You\'ll then choose how many words to generate (100-3000)\n' +
          '   - Bot analyzes your writing style, vocabulary, grammar patterns, and perspective\n' +
          '   - Generate academic text that matches your personal style and level\n' 
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
          'Game Generator: Microsoft MAI-DS-R1 via OpenRouter\n' +
          'Story Generator: Microsoft MAI-DS-R1 (story) & Microsoft MAI-DS-R1 (scene descriptions) via OpenRouter\n' +
          'Quiz Generator: Microsoft MAI-DS-R1 via OpenRouter\n' +
          'Image Generator: FLUX.1 Model via Hugging Face\n' +
          'Music Generator: MiniMax-01 Model via Segmind API\n' +
          'Financial Analysis: Microsoft MAI-DS-R1 via OpenRouter\n' +
          'Human Text Generator: Microsoft MAI-DS-R1 via OpenRouter\n' +
          'Market Data: Alpha Vantage API & News API'
      }
    )
    .setFooter({ text: 'Type a command to get started!' });

  return embed;
}

module.exports = { handleHelpCommand };
