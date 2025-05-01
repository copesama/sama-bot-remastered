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
let dailyReportJob = null;
let cachedNewsArticles = null;
let lastFetchDate = null;
let cachedAnalysis = null;
let lastAnalysisDate = null;
let lastAnalysisStocks = null; // Store stock tickers from the last analysis

/**
 * Loads subscribed channels from the configuration file
 */
function loadSubscribedChannels() {
  try {
    if (fs.existsSync(FINANCE_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(FINANCE_CONFIG_PATH, 'utf8'));
      subscribedChannels = new Map(Object.entries(data));
    }
  } catch (error) {
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
  } catch (error) {
    // Failed to save
  }
}

/**
 * Subscribe a channel to daily finance news
 * @param {string} guildId - Discord server ID
 * @param {string} channelId - Channel ID to receive news
 * @returns {boolean} - Success status and whether it was already subscribed
 */
function subscribeChannel(guildId, channelId) {
  // Check if already subscribed to this channel
  const existingChannelId = subscribedChannels.get(guildId);
  const alreadySubscribed = existingChannelId === channelId;
  
  subscribedChannels.set(guildId, channelId);
  saveSubscribedChannels();
  
  return {
    success: true,
    alreadySubscribed: alreadySubscribed
  };
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
      (now.getTime() - lastFetchDate.getTime() < 23 * 60 * 60 * 1000)) {
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
      return [];
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Extract stock tickers from financial analysis text
 * @param {string} analysisText - The financial analysis text
 * @returns {Array<string>} - Array of stock tickers
 */
function extractStockTickers(analysisText) {
  if (!analysisText) return [];
  
  // Look for stock tickers with a dollar sign prefix ($TICKER)
  const tickerRegex = /\$([A-Z]{1,5})\b/g;
  const tickers = [];
  let match;
  
  // Find all matches
  while ((match = tickerRegex.exec(analysisText)) !== null) {
    // match[1] contains the ticker without the dollar sign
    tickers.push(match[1]);
  }
  
  // Remove duplicates
  return [...new Set(tickers)];
}

/**
 * Fetch real-time stock performance data
 * @param {Array<string>} tickers - Array of stock tickers
 * @returns {Promise<Array>} - Array of stock performance data
 */
async function fetchStockPerformance(tickers) {
  if (!tickers || tickers.length === 0) return [];
  
  try {
    const stockData = [];
    const batchSize = 5;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (ticker) => {
        try {
          const response = await axios.get('https://www.alphavantage.co/query', {
            params: {
              function: 'GLOBAL_QUOTE',
              symbol: ticker,
              apikey: process.env.ALPHAVANTAGE_API_KEY
            }
          });
          
          if (response.data && response.data['Global Quote']) {
            const quote = response.data['Global Quote'];
            return {
              ticker,
              price: quote['05. price'] ? parseFloat(quote['05. price']).toFixed(2) : 'N/A',
              change: quote['10. change percent'] ? quote['10. change percent'] : 'N/A',
              valid: quote['05. price'] ? true : false
            };
          }
          return { ticker, price: 'N/A', change: 'N/A', valid: false };
        } catch (error) {
          return { ticker, price: 'N/A', change: 'N/A', valid: false };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      stockData.push(...batchResults);
      
      if (i + batchSize < tickers.length) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    return stockData.filter(stock => stock.valid);
  } catch (error) {
    return [];
  }
}

/**
 * Creates a Discord embed with stock performance data
 * @param {Array} stockData - Array of stock performance data
 * @returns {EmbedBuilder} - Discord embed with formatted stock performance
 */
function createMarketReportEmbed(stockData) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('📊 Daily Market Performance Report')
    .setDescription('Performance of stocks mentioned in today\'s financial analysis')
    .setTimestamp()
    .setFooter({ text: 'Market data from Alpha Vantage • For informational purposes only' });
  
  if (!stockData || stockData.length === 0) {
    embed.addFields({ 
      name: 'No Stock Data Available', 
      value: 'Could not retrieve market data for the stocks mentioned in today\'s analysis.'
    });
    return embed;
  }
  
  stockData.sort((a, b) => {
    const changeA = parseFloat(a.change.replace('%', '')) || 0;
    const changeB = parseFloat(b.change.replace('%', '')) || 0;
    return changeB - changeA;
  });
  
  const gainers = stockData.filter(stock => parseFloat(stock.change.replace('%', '')) > 0);
  const losers = stockData.filter(stock => parseFloat(stock.change.replace('%', '')) < 0);
  const neutral = stockData.filter(stock => parseFloat(stock.change.replace('%', '')) === 0);
  
  if (gainers.length > 0) {
    embed.addFields({ 
      name: '📈 Top Gainers',
      value: gainers.map(stock => `**${stock.ticker}**: $${stock.price} (${stock.change})`).join('\n') || 'None'
    });
  }
  
  if (losers.length > 0) {
    embed.addFields({ 
      name: '📉 Top Losers',
      value: losers.map(stock => `**${stock.ticker}**: $${stock.price} (${stock.change})`).join('\n') || 'None'
    });
  }
  
  if (neutral.length > 0) {
    embed.addFields({ 
      name: '➖ Unchanged',
      value: neutral.map(stock => `**${stock.ticker}**: $${stock.price} (${stock.change})`).join('\n') || 'None'
    });
  }
  
  // Calculate AI Performance
  if (cachedAnalysis) {
    // Find stocks mentioned in the analysis
    const buySection = cachedAnalysis.match(/BUY\s*([\s\S]*?)(?:SELL|AVOID|DISCLAIMER|$)/i);
    const sellSection = cachedAnalysis.match(/(?:SELL|AVOID)\s*([\s\S]*?)(?:DISCLAIMER|$)/i);
    
    let buyTickers = [];
    let sellTickers = [];
    
    // Extract tickers from BUY section
    if (buySection && buySection[1]) {
      // Look for $TICKER patterns in the BUY section
      const buyMatches = [...buySection[1].matchAll(/\$([A-Z]{1,5})\b/g)];
      buyTickers = buyMatches.map(match => match[1]);
    }
    
    // Extract tickers from SELL section
    if (sellSection && sellSection[1]) {
      // Look for $TICKER patterns in the SELL section
      const sellMatches = [...sellSection[1].matchAll(/\$([A-Z]{1,5})\b/g)];
      sellTickers = sellMatches.map(match => match[1]);
    }
    
    // Remove duplicates and ensure no ticker is in both lists
    buyTickers = [...new Set(buyTickers)].filter(ticker => !sellTickers.includes(ticker));
    sellTickers = [...new Set(sellTickers)].filter(ticker => !buyTickers.includes(ticker));
    
    // Match with stock data
    const buyStocks = stockData.filter(stock => buyTickers.includes(stock.ticker));
    const sellStocks = stockData.filter(stock => sellTickers.includes(stock.ticker));
    
    let buyPerformance = 0;
    let sellPerformance = 0;
    let buyCount = 0;
    let sellCount = 0;
    
    // Calculate performance of BUY recommendations (positive if they went up)
    buyStocks.forEach(stock => {
      const changeValue = parseFloat(stock.change.replace('%', '')) || 0;
      buyPerformance += changeValue;
      buyCount++;
    });
    
    // Calculate performance of SELL recommendations (positive if they went down)
    sellStocks.forEach(stock => {
      const changeValue = parseFloat(stock.change.replace('%', '')) || 0;
      sellPerformance -= changeValue; // Negate the change for sell recommendations
      sellCount++;
    });
    
    const totalPerformance = (buyPerformance + sellPerformance).toFixed(2);
    const sign = parseFloat(totalPerformance) >= 0 ? '+' : '';
    
    // Create performance summary
    let performanceSummary = `**AI Recommendation Performance: ${sign}${totalPerformance}%**\n\n`;
    
    if (buyStocks.length > 0) {
      const buySign = buyPerformance >= 0 ? '+' : '';
      performanceSummary += `**BUY Recommendations (${buySign}${buyPerformance.toFixed(2)}%)**\n`;
      performanceSummary += buyStocks.map(stock => {
        const changeValue = parseFloat(stock.change.replace('%', '')) || 0;
        return `$${stock.ticker}: ${stock.change} (${changeValue > 0 ? '✅' : '❌'})`;
      }).join('\n') + '\n\n';
    } else if (buyTickers.length > 0) {
      performanceSummary += `**BUY Recommendations**\n`;
      performanceSummary += `Could not retrieve market data for the recommended buy stocks.\n\n`;
    }
    
    if (sellStocks.length > 0) {
      const sellSign = sellPerformance >= 0 ? '+' : '';
      performanceSummary += `**SELL/AVOID Recommendations (${sellSign}${sellPerformance.toFixed(2)}%)**\n`;
      performanceSummary += sellStocks.map(stock => {
        const changeValue = parseFloat(stock.change.replace('%', '')) || 0;
        return `$${stock.ticker}: ${stock.change} (${changeValue < 0 ? '✅' : '❌'})`;
      }).join('\n') + '\n\n';
    } else if (sellTickers.length > 0) {
      performanceSummary += `**SELL/AVOID Recommendations**\n`;
      performanceSummary += `Could not retrieve market data for the recommended sell stocks.\n\n`;
    }
    
    performanceSummary += `*For BUY recommendations, positive changes are good.*\n`;
    performanceSummary += `*For SELL recommendations, negative changes are good.*\n`;
    performanceSummary += `*Total performance: +${Math.abs(buyPerformance.toFixed(2))}% (BUY) ${sellPerformance >= 0 ? '+' : ''}${sellPerformance.toFixed(2)}% (SELL) = ${sign}${totalPerformance}%*`;
    
    embed.addFields({ 
      name: '🤖 AI Recommendation Performance',
      value: performanceSummary
    });
  } else {
    embed.addFields({ 
      name: '🤖 AI Recommendation Performance',
      value: 'No AI analysis available to evaluate performance.'
    });
  }
  
  return embed;
}

/**
 * Sends a market performance report to all subscribed channels
 * @param {Object} client - Discord client
 */
async function sendMarketPerformanceReport(client) {
  try {
    if (!lastAnalysisStocks || lastAnalysisStocks.length === 0) {
      return;
    }
    
    const stockData = await fetchStockPerformance(lastAnalysisStocks);
    
    if (stockData.length === 0) {
      return;
    }
    
    const reportEmbed = createMarketReportEmbed(stockData);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const [guildId, channelId] of subscribedChannels.entries()) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
          await channel.send({ 
            content: '📊 Here\'s today\'s market performance report for stocks mentioned in our morning analysis:', 
            embeds: [reportEmbed] 
          });
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
    }
  } catch (error) {
    // Error in market performance report
  }
}

/**
 * Generates financial analysis and stock advice using OpenRouter API
 * @param {Array} newsArticles - Array of news articles
 * @returns {Promise<string>} - Financial analysis and stock advice
 */
async function generateFinancialAnalysis(newsArticles) {
  const now = new Date();
  if (cachedAnalysis && lastAnalysisDate && 
      (now.getTime() - lastAnalysisDate.getTime() < 23 * 60 * 60 * 1000)) {
    return cachedAnalysis;
  }

  try {
    if (!newsArticles || newsArticles.length === 0) {
      return "No financial analysis available due to lack of news data.";
    }

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

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: `You are a professional financial analyst and investment advisor with decades of experience in the stock market. 
            Analyze the provided financial news headlines and summaries and provide:
            1. A detailed market sentiment and trend analysis. Don't display any stock ticker for this section
            2. SPECIFIC short-term stock recommendations including:
               - Stocks to BUY with clear reasoning
               - Stocks to SELL or AVOID with clear reasoning 
               - Include a mix of well-known and lesser-known stocks
               - Display the stock tickers like this $STOCK:
               - Don't display any tickers in the reasoning
               - Don't add any other category than BUY and SELL/AVOID
            
            IMPORTANT: Do NOT include cryptocurrencies in your recommendations. Focus only on traditional stocks traded on major exchanges.

            Keep your analysis professional, balanced, and evidence-based. Make your stock recommendations extremely clear and actionable.
            Format your response in clear sections with bullet points, with stock tickers in bold.
            Add a disclaimer that this is for informational purposes only and not financial advice.
            Keep total response under 350 words, but make it detailed and actionable.`
          },
          {
            role: 'user',
            content: `Please analyze these financial news headlines and summaries and provide market insights with specific stock recommendations:\n\n${newsText}`
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
      cachedAnalysis = response.data.choices[0].message.content;
      lastAnalysisDate = new Date();
      lastAnalysisStocks = extractStockTickers(cachedAnalysis);
      return cachedAnalysis;
    } else {
      return "No financial analysis available at this time.";
    }
  } catch (error) {
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
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('📈 Today\'s Financial News Headlines')
    .setDescription('The latest updates from the financial world')
    .setTimestamp()
    .setFooter({ text: 'Powered by NewsAPI • Updated just now' });

  if (!newsArticles || newsArticles.length === 0) {
    embed.addFields({ 
      name: 'No News Available', 
      value: 'Could not retrieve financial news at this time. Please try again later.'
    });
    return embed;
  }

  newsArticles.forEach((article, index) => {
    if (article.title && article.url) {
      const source = article.source && article.source.name ? article.source.name : 'Unknown Source';
      let description = article.description || article.content || 'No summary available';
      description = description.replace(/<[^>]*>?/gm, '');
      const timestamp = article.publishedAt 
        ? new Date(article.publishedAt).toLocaleString() 
        : 'Unknown date';
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
  // Cancel existing jobs if they exist
  if (dailyNewsJob) {
    dailyNewsJob.cancel();
  }
  
  if (dailyReportJob) {
    dailyReportJob.cancel();
  }
  
  // Schedule new jobs with proper cron format
  // Run at 8:15 AM EST/EDT (13:15 UTC) for morning news
  dailyNewsJob = schedule.scheduleJob('0 15 13 * * *', async function() {
    try {
      const newsArticles = await fetchFinanceNews(apiKey, 15);
      
      if (newsArticles.length === 0) {
        return;
      }
      
      const analysis = await generateFinancialAnalysis(newsArticles);
      
      const newsEmbed = createNewsEmbed(newsArticles);
      
      let successCount = 0;
      let failCount = 0;
      
      for (const [guildId, channelId] of subscribedChannels.entries()) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel && channel.isTextBased()) {
            await channel.send({ 
              content: '📈 Here are today\'s top financial news headlines:', 
              embeds: [newsEmbed] 
            });
            
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
            failCount++;
          }
        } catch (error) {
          failCount++;
        }
      }
    } catch (error) {
      // Error in scheduled finance news job
    }
  });
  
  // Run at 4:05 PM EST/EDT (20:05 UTC) for market performance report
  dailyReportJob = schedule.scheduleJob('0 5 20 * * *', async function() {
    await sendMarketPerformanceReport(client);
  });
}

/**
 * Initialize the finance news system
 * @param {Object} client - Discord client
 * @param {string} apiKey - NewsAPI API key
 */
function initFinanceNews(client, apiKey) {
  loadSubscribedChannels();
  scheduleDailyNews(client, apiKey);
}

/**
 * Generates and sends a market performance report on demand
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord client object
 */
async function handleFinanceReportCommand(message, client) {
  try {
    const loadingMessage = await message.reply('📊 Generating market performance report...');
    
    if (!lastAnalysisStocks || lastAnalysisStocks.length === 0) {
      await loadingMessage.edit('No stock tickers available. Please run `!financenews` first to generate financial analysis.');
      return;
    }
    
    const stockData = await fetchStockPerformance(lastAnalysisStocks);
    
    if (stockData.length === 0) {
      await loadingMessage.edit('Could not retrieve stock data for any of the analyzed stocks. Please try again later.');
      return;
    }
    
    const reportEmbed = createMarketReportEmbed(stockData);
    
    await loadingMessage.edit({ 
      content: '📊 Here\'s the market performance report for stocks mentioned in our analysis:', 
      embeds: [reportEmbed] 
    });
    
  } catch (error) {
    try {
      await message.reply('Sorry, there was an error generating the financial report. Please try again later.');
    } catch (e) {
      // Error sending error message
    }
  }
}

/**
 * Handles the finance news command
 * @param {Object} message - Discord message object
 * @param {string} apiKey - NewsAPI API key
 * @param {Object} client - Discord client object
 */
async function handleFinanceNewsCommand(message, apiKey, client) {
  try {
    const parts = message.content.toLowerCase().split(' ');
    
    if (parts.length > 1) {
      const hasPermission = message.member && message.member.permissions.has(PermissionFlagsBits.Administrator);
      
      if (!hasPermission) {
        await message.reply('You need administrator permissions to manage finance news subscriptions.');
        return;
      }
      
      const action = parts[1];
      
      if (action === 'subscribe') {
        const result = subscribeChannel(message.guild.id, message.channel.id);
        if (result.alreadySubscribed) {
          await message.reply('✅ This channel is already subscribed to daily financial updates. News will be posted at 8:15 AM EST and market reports at 4:05 PM EST.');
        } else {
          await message.reply('✅ This channel will now receive daily financial analysis at 8:15 AM EST and market performance reports at 4:05 PM EST.');
        }
        return;
      } 
      else if (action === 'unsubscribe') {
        const wasSubscribed = unsubscribeChannel(message.guild.id);
        if (wasSubscribed) {
          await message.reply('✅ This server will no longer receive daily financial news updates.');
        } else {
          await message.reply('This server is not currently subscribed to daily financial news.');
        }
        return;
      }
      else if (action === 'status') {
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
    
    const loadingMessage = await message.reply('📊 Fetching the latest financial news headlines and analysis...');
    
    if (!apiKey) {
      await loadingMessage.edit('Error: NewsAPI key is not configured. Please check the server configuration.');
      return;
    }
    
    const newsArticles = await fetchFinanceNews(apiKey, 15);
    
    const newsEmbed = createNewsEmbed(newsArticles);
    await loadingMessage.edit({ 
      content: '📈 Here are today\'s top financial news headlines:', 
      embeds: [newsEmbed] 
    });
    
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
      await message.channel.send('Sorry, there was an error generating the financial analysis.').catch(() => {});
    }
  } catch (error) {
    let errorMessage = 'Sorry, there was an error fetching financial news. Please try again later.';
    
    if (error.response) {
      if (error.response.status === 401) {
        errorMessage = 'Error: Invalid NewsAPI API key. Please check the server configuration.';
      } else if (error.response.status === 429) {
        errorMessage = 'Error: API request limit reached. Please try again later.';
      }
    }
    
    try {
      await message.reply(errorMessage);
    } catch (e) {
      await message.channel.send(errorMessage).catch(() => {});
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
  generateFinancialAnalysis,
  extractStockTickers,
  fetchStockPerformance,
  createMarketReportEmbed,
  sendMarketPerformanceReport,
  handleFinanceReportCommand
};