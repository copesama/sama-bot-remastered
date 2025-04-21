const axios = require('axios');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');

// Path for storing channel configuration
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const FINANCE_CONFIG_PATH = path.join(CONFIG_DIR, 'finance_channels.json');

// Create config directory if it doesn't exist
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Store subscribed channels (guildId -> channelId)
let subscribedChannels = new Map();
let dailyNewsJob = null;
let cachedNewsArticles = null;
let lastFetchDate = null;
let cachedAnalysis = null;
let lastAnalysisDate = null;

/**
 * Loads subscribed channels from the configuration file
 */
function loadSubscribedChannels() {
  try {
    if (fs.existsSync(FINANCE_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(FINANCE_CONFIG_PATH, 'utf8'));
      subscribedChannels = new Map(Object.entries(data));
      console.log(`Loaded ${subscribedChannels.size} finance news subscriptions`);
    }
  } catch (error) {
    console.error('Error loading finance channel subscriptions:', error);
    subscribedChannels = new Map();
  }
}

/**
 * Saves subscribed channels to the configuration file
 */
function saveSubscribedChannels() {
  try {
    const data = Object.fromEntries(subscribedChannels);
    fs.writeFileSync(FINANCE_CONFIG_PATH, JSON.stringify(data, null, 2));
    console.log(`Saved ${subscribedChannels.size} finance news subscriptions`);
  } catch (error) {
    console.error('Error saving finance channel subscriptions:', error);
  }
}

/**
 * Subscribe a channel to daily finance news
 * @param {string} guildId - Discord server ID
 * @param {string} channelId - Channel ID to receive news
 * @returns {boolean} - Success status
 */
function subscribeChannel(guildId, channelId) {
  subscribedChannels.set(guildId, channelId);
  saveSubscribedChannels();
  return true;
}

/**
 * Unsubscribe a channel from daily finance news
 * @param {string} guildId - Discord server ID
 * @returns {boolean} - Success status
 */
function unsubscribeChannel(guildId) {
  const wasSubscribed = subscribedChannels.has(guildId);
  subscribedChannels.delete(guildId);
  saveSubscribedChannels();
  return wasSubscribed;
}

/**
 * Check if a guild is subscribed to finance news
 * @param {string} guildId - Discord server ID
 * @returns {string|null} - Channel ID if subscribed, null otherwise
 */
function getSubscribedChannel(guildId) {
  return subscribedChannels.get(guildId) || null;
}

/**
 * Fetches finance news from NewsAPI
 * @param {string} apiKey - NewsAPI API key
 * @param {number} limit - Maximum number of news items to return
 * @returns {Promise<Array>} - Array of news articles
 */
async function fetchFinanceNews(apiKey, limit = 15) {
  // Check if we already have fresh news (less than 24 hours old)
  const now = new Date();
  if (cachedNewsArticles && lastFetchDate && 
      (now.getTime() - lastFetchDate.getTime() < 24 * 60 * 60 * 1000)) {
    console.log('Using cached finance news');
    return cachedNewsArticles;
  }

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
      // Cache the results
      cachedNewsArticles = response.data.articles.slice(0, limit);
      lastFetchDate = new Date();
      return cachedNewsArticles;
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
 * Generates financial analysis and stock advice using OpenRouter API
 * @param {Array} newsArticles - Array of news articles
 * @returns {Promise<string>} - Financial analysis and stock advice
 */
async function generateFinancialAnalysis(newsArticles) {
  // Check if we already have fresh analysis (less than a day old)
  const now = new Date();
  if (cachedAnalysis && lastAnalysisDate && 
      (now.getTime() - lastAnalysisDate.getTime() < 24 * 60 * 60 * 1000)) {
    console.log('Using cached financial analysis');
    return cachedAnalysis;
  }

  try {
    // If there are no articles, return empty analysis
    if (!newsArticles || newsArticles.length === 0) {
      return "No financial analysis available due to lack of news data.";
    }

    // Extract titles and summaries for analysis
    const newsData = newsArticles.map(article => {
      return {
        title: article.title || '',
        description: article.description || article.content || '',
        source: article.source && article.source.name ? article.source.name : 'Unknown Source'
      };
    });

    const newsText = newsData.map((item, index) => 
      `${index + 1}. ${item.title} - ${item.description} (Source: ${item.source})`
    ).join('\n\n');

    // Make request to OpenRouter API
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [
          {
            role: 'system',
            content: `You are a professional financial analyst and investment advisor with decades of experience in the stock market. 
            Analyze the provided financial news headlines and provide:
            1. A deep market sentiment and trend analysis
            2. SPECIFIC stock recommendations including:
               - At least 3-5 specific stocks to BUY with clear reasoning (e.g., "I would buy MSFT because...")
               - At least 3-5 specific stocks to SELL with clear reasoning (e.g., "I would sell META because...")
               - Include well-known stocks (AAPL, MSFT, GOOGL, AMZN, META, TSLA, etc.)
               - Also include lesser-known but promising stocks that are relevant to current trends

            
            Keep your analysis professional, balanced, and evidence-based. Make your stock recommendations extremely clear and actionable.
            Format your response in clear sections with bullet points, with stock tickers in bold.
            For lesser-known stocks, briefly explain what the company does.
            Add a disclaimer that this is for informational purposes only and not financial advice.
            Keep total response under 500 words, but make it detailed and actionable.`
          },
          {
            role: 'user',
            content: `Please analyze these financial news headlines and provide market insights with specific stock recommendations:\n\n${newsText}`
          }
        ],
        temperature: 0.4
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data && response.data.choices && response.data.choices[0].message.content) {
      // Cache the analysis
      cachedAnalysis = response.data.choices[0].message.content;
      lastAnalysisDate = new Date();
      return cachedAnalysis;
    } else {
      console.log('Failed to generate financial analysis');
      return "No financial analysis available at this time.";
    }
  } catch (error) {
    console.error('Error generating financial analysis:', error);
    if (error.response) {
      console.error('API error status:', error.response.status);
      console.error('API error data:', error.response.data);
    }
    return "Failed to generate financial analysis due to an error.";
  }
}

/**
 * Creates a Discord embed with finance news
 * @param {Array} newsArticles - Array of news articles from NewsAPI
 * @param {string} analysis - Financial analysis and stock advice
 * @returns {EmbedBuilder} - Discord embed with formatted news
 */
function createNewsEmbed(newsArticles, analysis = null) {
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
 * Schedule a job to send daily finance news to all subscribed channels
 * @param {Object} client - Discord client
 * @param {string} apiKey - NewsAPI API key
 */
function scheduleDailyNews(client, apiKey) {
  // Cancel any existing job
  if (dailyNewsJob) {
    dailyNewsJob.cancel();
  }
  
  // Schedule job to run at 8:30 AM (market opening time for major markets)
  // This is a good time for daily financial updates before trading day starts
  dailyNewsJob = schedule.scheduleJob('0 30 8 * * *', async function() {
    try {
      console.log('Running scheduled finance news update');
      
      // NEWS AND ANALYSIS ARE FETCHED ONLY ONCE PER DAY
      // Then the same content is distributed to all subscribed channels
      // This is more efficient and avoids redundant API calls
      
      // Fetch news articles once for all channels
      const newsArticles = await fetchFinanceNews(apiKey, 15);
      
      if (newsArticles.length === 0) {
        console.log('No finance news to send for daily update');
        return;
      }
      
      // Generate financial analysis once for all channels
      const analysis = await generateFinancialAnalysis(newsArticles);
      
      // Create a single embed to be reused across all channels (without analysis)
      const newsEmbed = createNewsEmbed(newsArticles);
      
      // Send the same content to all subscribed channels
      let successCount = 0;
      let failCount = 0;
      
      for (const [guildId, channelId] of subscribedChannels.entries()) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel && channel.isTextBased()) {
            // Send news headlines first
            await channel.send({ 
              content: '📈 Here are today\'s top financial news headlines:', 
              embeds: [newsEmbed] 
            });
            
            // Send analysis as a separate message
            if (analysis) {
              const analysisEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('💹 Financial Market Analysis & Investment Insights')
                .setDescription(analysis)
                .setTimestamp()
                .setFooter({ text: 'AI-powered market analysis • This is not financial advice' });
                
              await channel.send({ embeds: [analysisEmbed] });
            }
            
            successCount++;
          } else {
            console.log(`Cannot send to channel ${channelId} in guild ${guildId} - not a text channel`);
            failCount++;
          }
        } catch (error) {
          console.error(`Error sending news to guild ${guildId}, channel ${channelId}:`, error);
          failCount++;
        }
      }
      
      console.log(`Daily finance news sent to ${successCount} channels (${failCount} failed)`);
    } catch (error) {
      console.error('Error in scheduled finance news job:', error);
    }
  });
  
  console.log('Daily finance news scheduled for 8:30 AM');
}

/**
 * Initialize the finance news system
 * @param {Object} client - Discord client
 * @param {string} apiKey - NewsAPI API key
 */
function initFinanceNews(client, apiKey) {
  // Load subscribed channels
  loadSubscribedChannels();
  
  // Schedule daily news
  scheduleDailyNews(client, apiKey);
  
  console.log('Finance news system initialized');
}

/**
 * Handles the finance news command
 * @param {Object} message - Discord message object
 * @param {string} apiKey - NewsAPI API key
 * @param {Object} client - Discord client object
 */
async function handleFinanceNewsCommand(message, apiKey, client) {
  try {
    // Check if the command is a subscription management command
    const parts = message.content.toLowerCase().split(' ');
    
    // Admin commands for channel subscription
    if (parts.length > 1) {
      // Check if user has admin permissions
      const hasPermission = message.member && message.member.permissions.has(PermissionFlagsBits.Administrator);
      
      if (!hasPermission) {
        await message.reply('You need administrator permissions to manage finance news subscriptions.');
        return;
      }
      
      const action = parts[1];
      
      if (action === 'subscribe') {
        // Subscribe this channel to daily updates
        subscribeChannel(message.guild.id, message.channel.id);
        await message.reply('✅ This channel will now receive daily financial news updates at 8:30 AM.');
        return;
      } 
      else if (action === 'unsubscribe') {
        // Unsubscribe this server from daily updates
        const wasSubscribed = unsubscribeChannel(message.guild.id);
        if (wasSubscribed) {
          await message.reply('✅ This server will no longer receive daily financial news updates.');
        } else {
          await message.reply('This server is not currently subscribed to daily financial news.');
        }
        return;
      }
      else if (action === 'status') {
        // Check subscription status
        const subscribedChannelId = getSubscribedChannel(message.guild.id);
        if (subscribedChannelId) {
          const channelMention = `<#${subscribedChannelId}>`;
          await message.reply(`This server is subscribed to daily financial news in channel ${channelMention}.`);
        } else {
          await message.reply('This server is not currently subscribed to daily financial news.');
        }
        return;
      }
    }
    
    // If not a subscription command, treat as a regular news request
    const loadingMessage = await message.reply('📊 Fetching the latest financial news headlines and analysis...');
    
    // Check if API key is available
    if (!apiKey) {
      await loadingMessage.edit('Error: NewsAPI key is not configured. Please check the server configuration.');
      return;
    }
    
    // Fetch finance news
    const newsArticles = await fetchFinanceNews(apiKey, 15);
    
    // Create and send the news embed (without analysis)
    const newsEmbed = createNewsEmbed(newsArticles);
    await loadingMessage.edit({ 
      content: '📈 Here are today\'s top financial news headlines:', 
      embeds: [newsEmbed] 
    });
    
    // Generate financial analysis and send as a separate message
    try {
      const loadingAnalysis = await message.channel.send('📊 Generating market analysis...');
      const analysis = await generateFinancialAnalysis(newsArticles);
      
      if (analysis) {
        const analysisEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('💹 Financial Market Analysis & Investment Insights')
          .setDescription(analysis)
          .setTimestamp()
          .setFooter({ text: 'AI-powered market analysis • This is not financial advice' });
          
        await loadingAnalysis.edit({ 
          content: '💹 Here\'s my analysis of today\'s financial news:', 
          embeds: [analysisEmbed] 
        });
      } else {
        await loadingAnalysis.edit('Sorry, I couldn\'t generate a financial analysis at this time.');
      }
    } catch (analysisError) {
      console.error('Error generating analysis:', analysisError);
      await message.channel.send('Sorry, there was an error generating the financial analysis.').catch(console.error);
    }
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
    
    // Send error message
    try {
      await message.reply(errorMessage);
    } catch (e) {
      console.error('Error sending error message:', e);
      await message.channel.send(errorMessage).catch(console.error);
    }
  }
}

module.exports = {
  fetchFinanceNews,
  createNewsEmbed,
  handleFinanceNewsCommand,
  initFinanceNews,
  getSubscribedChannel,
  subscribeChannel,
  unsubscribeChannel,
  generateFinancialAnalysis
};