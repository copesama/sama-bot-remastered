const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

/**
 * Fetches finance news from NewsAPI
 * @param {string} apiKey - NewsAPI API key
 * @param {number} limit - Maximum number of news items to return
 * @returns {Promise<Array>} - Array of news articles
 */
async function fetchFinanceNews(apiKey, limit = 10) {
  try {
    // Get the current date in YYYY-MM-DD format for the API
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    
    // Fetch financial news from NewsAPI
    const response = await axios.get('https://newsapi.org/v2/top-headlines', {
      params: {
        apiKey: apiKey,
        category: 'business',
        language: 'en',
        from: formattedDate,
        pageSize: limit
      }
    });

    // Check if we got valid results
    if (response.data && response.data.articles && response.data.articles.length > 0) {
      return response.data.articles.slice(0, limit);
    } else {
      console.log('No finance news found or API limit reached');
      return [];
    }
  } catch (error) {
    console.error('Error fetching finance news:', error);
    if (error.response) {
      console.error('API error status:', error.response.status);
      console.error('API error data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Creates a Discord embed with finance news
 * @param {Array} newsArticles - Array of news articles from NewsAPI
 * @returns {EmbedBuilder} - Discord embed with formatted news
 */
function createNewsEmbed(newsArticles) {
  // Create the main embed
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('📈 Today\'s Financial News Headlines')
    .setDescription('The latest updates from the financial world')
    .setTimestamp()
    .setFooter({ text: 'Powered by NewsAPI • Updated just now' });

  // If no articles found, add a message
  if (!newsArticles || newsArticles.length === 0) {
    embed.addFields({ 
      name: 'No News Available', 
      value: 'Could not retrieve financial news at this time. Please try again later.'
    });
    return embed;
  }

  // Add each news article as a field
  newsArticles.forEach((article, index) => {
    if (article.title && article.url) {
      // Format source information
      const source = article.source && article.source.name ? article.source.name : 'Unknown Source';
      
      // Process the description - truncate if too long, provide a fallback if missing
      let description = article.description || article.content || 'No summary available';
      
      // Remove HTML tags if present
      description = description.replace(/<[^>]*>?/gm, '');
      
      // Truncate if too long (Discord field values have a 1024 character limit)
      if (description.length > 300) {
        description = description.substring(0, 297) + '...';
      }
      
      // Format the timestamp
      const timestamp = article.publishedAt 
        ? new Date(article.publishedAt).toLocaleString() 
        : 'Unknown date';
      
      // Create a field for each news item with title, summary, and link
      embed.addFields({ 
        name: `${index + 1}. ${article.title}`,
        value: `**Summary:** ${description}\n\n[Read more](${article.url}) • Source: ${source} • ${timestamp}`
      });
    }
  });

  return embed;
}

/**
 * Handles the finance news command
 * @param {Object} message - Discord message object
 * @param {string} apiKey - NewsAPI API key
 * @param {number} limit - Maximum number of news articles to display
 */
async function handleFinanceNewsCommand(message, apiKey, limit = 8) {
  try {
    // Send initial loading message
    const loadingMessage = await message.reply('📊 Fetching the latest financial news headlines...');
    
    // Check if API key is available
    if (!apiKey) {
      await loadingMessage.edit('Error: NewsAPI key is not configured. Please check the server configuration.');
      return;
    }
    
    // Fetch finance news
    const newsArticles = await fetchFinanceNews(apiKey, limit);
    
    // Create and send the embed
    const newsEmbed = createNewsEmbed(newsArticles);
    await loadingMessage.edit({ content: '📈 Here are today\'s top financial news headlines:', embeds: [newsEmbed] });
  } catch (error) {
    console.error('Error in finance news command:', error);
    
    // Handle various error scenarios
    let errorMessage = 'Sorry, there was an error fetching financial news. Please try again later.';
    
    if (error.response) {
      if (error.response.status === 401) {
        errorMessage = 'Error: Invalid NewsAPI API key. Please check the server configuration.';
      } else if (error.response.status === 429) {
        errorMessage = 'Error: API request limit reached. Please try again later.';
      }
    }
    
    // Try to edit the loading message if it exists
    try {
      if (message._loadingMessage) {
        await message._loadingMessage.edit(errorMessage);
      } else {
        await message.reply(errorMessage);
      }
    } catch (e) {
      console.error('Error sending error message:', e);
      await message.channel.send(errorMessage).catch(console.error);
    }
  }
}

module.exports = {
  fetchFinanceNews,
  createNewsEmbed,
  handleFinanceNewsCommand
};
