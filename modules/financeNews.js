const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

/**
 * Fetches financial news from Alpha Vantage API
 * @param {string} apiKey - Alpha Vantage API key
 * @param {number} limit - Maximum number of news items to return (optional)
 * @returns {Promise<Array>} Array of news items
 */
async function fetchFinancialNews(apiKey, limit = 10) {
  try {
    const response = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'NEWS_SENTIMENT',
        topics: 'financial_markets,economy,earnings',
        sort: 'LATEST',
        limit: Math.min(limit, 50), // API allows max 50 items per request
        apikey: apiKey
      },
      timeout: 10000 // 10 second timeout
    });

    if (response.data && response.data.feed) {
      return response.data.feed.slice(0, limit);
    } else {
      console.error('Invalid response from Alpha Vantage:', response.data);
      throw new Error('Invalid response format from Alpha Vantage API');
    }
  } catch (error) {
    console.error('Error fetching financial news:', error);
    throw error;
  }
}

/**
 * Creates a Discord embed for a batch of news items
 * @param {Array} newsItems - Array of news items
 * @param {number} page - Page number
 * @param {number} totalPages - Total number of pages
 * @returns {EmbedBuilder} Discord embed with news items
 */
function createNewsEmbed(newsItems, page, totalPages) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`📈 Financial News Today (Page ${page}/${totalPages})`)
    .setDescription('Latest headlines from financial markets')
    .setTimestamp()
    .setFooter({ text: 'Source: Alpha Vantage • Powered by LuckOff' });

  // Add each news item to the embed
  newsItems.forEach((item, index) => {
    const publishedDate = new Date(item.time_published);
    const formattedDate = publishedDate.toLocaleString();
    
    let sourceName = item.source;
    if (sourceName.length > 20) {
      sourceName = sourceName.substring(0, 17) + '...';
    }

    // Get sentiment if available
    let sentimentIcon = '';
    if (item.overall_sentiment_score) {
      const score = parseFloat(item.overall_sentiment_score);
      if (score > 0.25) sentimentIcon = '🟢'; // Positive
      else if (score < -0.25) sentimentIcon = '🔴'; // Negative
      else sentimentIcon = '🟡'; // Neutral
    }

    // Format the field title with the article number and sentiment indicator
    const fieldTitle = `${index + 1}. ${sentimentIcon} ${item.title}`;

    // Format the field value with source and timestamp
    const fieldValue = `**Source:** ${sourceName} | **Published:** ${formattedDate}\n[Read more](${item.url})`;

    // Add field to embed (limit title length to avoid Discord limits)
    embed.addFields({
      name: fieldTitle.length > 256 ? fieldTitle.substring(0, 253) + '...' : fieldTitle,
      value: fieldValue
    });
  });

  return embed;
}

/**
 * Processes financial news data and sends embeds to Discord
 * @param {string} apiKey - Alpha Vantage API key
 * @param {Object} message - Discord message object
 * @param {number} limit - Maximum number of news items to fetch
 * @returns {Promise<void>}
 */
async function sendFinancialNews(apiKey, message, limit = 10) {
  try {
    const loadingMessage = await message.reply('📊 Fetching the latest financial news...');
    
    // Fetch news data
    const newsItems = await fetchFinancialNews(apiKey, limit);
    
    if (!newsItems || newsItems.length === 0) {
      await loadingMessage.edit('Sorry, no financial news available at the moment.');
      return;
    }
    
    // Split news into pages (max 5 items per page for readability)
    const itemsPerPage = 5;
    const newsPages = [];
    
    for (let i = 0; i < newsItems.length; i += itemsPerPage) {
      newsPages.push(newsItems.slice(i, i + itemsPerPage));
    }
    
    // Create embeds for each page
    const totalPages = newsPages.length;
    const embeds = newsPages.map((pageItems, index) => 
      createNewsEmbed(pageItems, index + 1, totalPages)
    );
    
    // Edit loading message with first page
    await loadingMessage.edit({ 
      content: `${message.author} Here's today's financial news:`, 
      embeds: [embeds[0]] 
    });
    
    // Send additional pages if any
    for (let i = 1; i < embeds.length; i++) {
      await message.channel.send({ embeds: [embeds[i]] });
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } catch (error) {
    console.error('Error in sendFinancialNews:', error);
    
    // More detailed error handling for common issues
    let errorMessage = 'Sorry, there was an error fetching financial news. Please try again later.';
    
    if (error.response) {
      // API returned an error
      if (error.response.status === 401) {
        errorMessage = 'Error: Invalid API key for Alpha Vantage. Please check your configuration.';
      } else if (error.response.status === 429) {
        errorMessage = 'Error: Alpha Vantage API rate limit exceeded. Please try again later.';
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Error: Connection to Alpha Vantage API timed out. Please try again later.';
    }
    
    // Try to update loading message or send new message if that fails
    try {
      if (loadingMessage) {
        await loadingMessage.edit(errorMessage);
      } else {
        await message.reply(errorMessage);
      }
    } catch (e) {
      console.error('Error sending error message:', e);
      await message.channel.send(errorMessage);
    }
  }
}

module.exports = { sendFinancialNews };
