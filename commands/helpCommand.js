const { EmbedBuilder } = require('discord.js');
const { getPrefix } = require('./prefixCommand');

/**
 * Handles the help command and returns information about available commands
 * @param {Object} message The Discord message object
 */
async function handleHelpCommand(message) {
  try {
    // Get the custom prefix for this server
    const prefix = await getPrefix(message.guild?.id);
    
    const embed = createHelpEmbed(prefix);
    await message.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error in help command:', error);
    await message.channel.send('Sorry, there was an error displaying the help information.');
  }
}

/**
 * Creates the embed with all command information
 * @param {string} prefix - The server's prefix
 * @returns {EmbedBuilder} Discord embed with command info
 */
function createHelpEmbed(prefix = '!') {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('📚 Bot Commands Guide')
    .setDescription(`Here are all the available commands and how to use them: (current prefix: ${prefix})`)
    .addFields(
      { 
        name: '🎮 Game Commands', 
        value: 
          `\`${prefix}singlegame [prompt]\` (\`${prefix}sgame\`) - Generate a personalized HTML5 game based on your prompt\n` +
          `\`${prefix}playgame [gameId]\` (\`${prefix}play\`) - Play a previously generated game with your Discord info integrated\n` +
          `\`${prefix}editgame [gameId]\` (\`${prefix}edit\`) - Edit features or mechanics of a game you created\n` +
          `\`${prefix}enhancegame [gameId]\` (\`${prefix}enhance\`) - Automatically improve your game with bug fixes and optimizations\n` +
          `\`${prefix}multigame\` (\`${prefix}mgame\`) - Create a multiplayer game experience (Coming soon!)`
      },
      { 
        name: '📊 Finance Commands', 
        value: 
          `\`${prefix}financenews\` (\`${prefix}fnews\`) - Get the latest financial news headlines with AI-powered market analysis and stock recommendations\n` +
          `\`${prefix}financereport\` (\`${prefix}freport\`) - Generate a detailed financial market report for stocks mentioned in the most recent analysis\n` +
          `\`${prefix}financenews subscribe\` - Subscribe the current channel to daily financial updates (Admin only)\n` +
          `\`${prefix}financenews unsubscribe\` - Remove daily financial updates from your server (Admin only)\n` +
          `\`${prefix}financenews status\` - Check if your server is subscribed to daily financial updates\n\n` +
          'Subscribed channels receive:\n' +
          '   - Morning financial news and market analysis (5 minutes before market open)\n' +
          '   - Evening performance report of mentioned stocks (1 hour after market close)'
      },
      { 
        name: '🎓 Quiz Command', 
        value: 
          `\`${prefix}generatequiz [topic]\` (\`${prefix}quiz\`) - Create a personalized quiz about any topic\n` +
          `\`${prefix}generatequiz [number] [topic]\` (\`${prefix}quiz [number] [topic]\`) - Create a quiz with a custom number of questions (3-20)\n` +
          `   - Example: \`${prefix}generatequiz Solar System\` - Creates a 10-question quiz about the Solar System\n` +
          `   - Example: \`${prefix}quiz 15 World History\` - Creates a 15-question quiz about World History\n` +
          '   - Interactive multiple-choice format with immediate feedback\n' +
          '   - Detailed explanations for each answer\n' +
          '   - Complete quiz summary at the end\n' +
          '   - One active quiz per user at a time'
      },
      { 
        name: '🎲 Choices Game Command', 
        value: 
          `\`${prefix}generatechoicesgame [scenario]\` (\`${prefix}choicesgame\`) - Create an interactive choice-based story game\n` +
          `   - Example: \`${prefix}choicesgame space explorer\` or \`${prefix}generatechoicesgame medieval knight\`\n` +
          '   - Make decisions by clicking interactive buttons\n' +
          '   - Each choice leads to different paths and outcomes\n' +
          '   - Multiple possible endings (good and bad)\n' +
          '   - Only one active choices game per user at a time\n' +
          '   - Designed for solo play with 5-minute decision time limit per choice'
      },
      { 
        name: '🎵 Music Command', 
        value: 
          `\`${prefix}generatemusic [lyrics]Your lyrics here[/lyrics]\` (\`${prefix}music\`) - Generate and play AI-created music\n` +
          '   - Format your lyrics between [lyrics] and [/lyrics] tags\n' +
          `   - Example: \`${prefix}music [lyrics]In the silence, I hear your name\nEchoes of love that still remain[/lyrics]\`\n` +
          '   - You can optionally attach an audio file to use as a base for the generation\n' +
          '   - You must be in a voice channel to use this command\n'
      },
      { 
        name: '📝 Story Command', 
        value: 
          `\`${prefix}generatestory @user1 @user2...\` (\`${prefix}story\`) - Create an interactive story with mentioned users as characters\n` +
          '   - First mention users to include as characters (at least one required)\n' +
          '   - Then provide a scenario description in your next message\n' +
          '   - Bot will generate a story (1000-2000 words) with AI-created scene images\n' +
          '   - Each mentioned user\'s avatar will be incorporated into the story images\n'
      },
      { 
        name: '🖼️ Image Commands', 
        value: 
          `\`${prefix}generateimage @user1 @user2...\` (\`${prefix}image\`) - Create an AI image featuring mentioned users\' avatars\n` +
          '   - First mention users, then provide a detailed scene description\n' +
          `   - Example: \`${prefix}image @user1 @user2 superheroes fighting robots in a futuristic city\`\n` +
          '   - Supports multiple users (up to 5 recommended)\n' 
      },
      { 
        name: '📝 Academic Writing Helper', 
        value: 
          `\`${prefix}generatehuman [topic]\` (\`${prefix}human\`) - Create academic text that mimics your writing style\n` +
          `   - Example: \`${prefix}human climate change\`\n` +
          '   - Bot will ask you a question about the topic\n' +
          '   - Your response should be at least 50 words for best results\n' +
          '   - You\'ll then choose how many words to generate (100-3000)\n' +
          '   - Bot analyzes your writing style, vocabulary, grammar patterns, and perspective\n' +
          '   - Generate academic text that matches your personal style and level\n' 
      },
      { 
        name: '⚙️ Configuration Commands', 
        value: 
          `\`${prefix}prefix\` - Show current command prefix\n` +
          `\`${prefix}prefix <new-prefix>\` - Change the command prefix (Admin only)\n` +
          `\`${prefix}invite\` - Get an invite link to add this bot to another server\n` +
          `\`${prefix}help\` - Show this help message`
      }
    )
    .addFields(
      {
        name: '🤖 AI Attribution',
        value: 
          'Game Generator: tngtech/deepseek-r1t2-chimera:free via OpenRouter\n' +
          'Story Generator: tngtech/deepseek-r1t2-chimera:free (story) & tngtech/deepseek-r1t2-chimera:free (scene descriptions) via OpenRouter\n' +
          'Quiz Generator: tngtech/deepseek-r1t2-chimera:free via OpenRouter\n' +
          'Image Generator: FLUX.1 Model via Hugging Face\n' +
          'Music Generator: MiniMax-01 Model via Segmind API\n' +
          'Financial Analysis: tngtech/deepseek-r1t2-chimera:free via OpenRouter\n' +
          'Human Text Generator: tngtech/deepseek-r1t2-chimera:free via OpenRouter\n' +
          'Market Data: Alpha Vantage API & News API'
      }
    )
    .setFooter({ text: `Type ${prefix}command to get started!` });

  return embed;
}

module.exports = { handleHelpCommand };
