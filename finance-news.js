const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// File to store channel configurations
const CONFIG_FILE = path.join(__dirname, 'finance-news-config.json');

// Default configuration
let config = {
  channels: {}
};

// Load configuration if exists
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading finance news configuration:', error);
  }
}

// Save configuration
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving finance news configuration:', error);
  }
}

// Fetch finance news from Yahoo Finance
async function fetchYahooFinanceNews() {
  try {
    console.log('Fetching Yahoo Finance news...');
    const response = await axios.get('https://finance.yahoo.com/news/');
    const $ = cheerio.load(response.data);
    
    const articles = [];
    
    // Extract news articles
    $('li.js-stream-content').each((index, element) => {
      // Limit to 10 articles
      if (index >= 10) return false;
      
      const titleElement = $(element).find('h3');
      const title = titleElement.text().trim();
      
      const urlElement = $(element).find('a');
      const url = urlElement.attr('href');
      
      const summaryElement = $(element).find('p');
      const summary = summaryElement.text().trim();
      
      // Only include articles with title and URL
      if (title && url) {
        articles.push({
          title,
          url: url.startsWith('/') ? `https://finance.yahoo.com${url}` : url,
          summary: summary || 'No summary available'
        });
      }
    });
    
    console.log(`Found ${articles.length} finance news articles`);
    return articles;
  } catch (error) {
    console.error('Error fetching Yahoo Finance news:', error);
    throw error;
  }
}

// Summarize news articles using OpenRouter API
async function summarizeNews(articles) {
  try {
    if (!articles || articles.length === 0) {
      return 'No finance news articles found to summarize.';
    }
    
    console.log('Summarizing finance news...');
    
    // Format articles as input for the AI
    const articlesText = articles.map((article, index) => {
      return `Article ${index + 1}: ${article.title}\nSummary: ${article.summary}\nURL: ${article.url}`;
    }).join('\n\n');
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-pro-exp:free',  // Using a model good at summarization
        messages: [
          {
            role: 'system',
            content: `You are a financial news expert and analyst. Your task is to create a concise, informative daily summary 
            of the financial markets based on recent news articles. Focus on major market movements, significant company news, 
            economic indicators, and potential impacts for investors. Include relevant statistics, figures, and trends. 
            Organize your summary into sections with clear headings. Be objective but highlight critical insights that would 
            be valuable for investors.`
          },
          {
            role: 'user',
            content: `Please summarize these finance news articles into a comprehensive daily market update:

${articlesText}

Format your response as a structured daily financial news summary with:
1. A catchy headline summarizing today's market situation
2. Market Overview section with key index movements
3. Top Stories section highlighting 3-4 significant developments
4. Brief Economic Outlook based on the news
5. Key Takeaways section with bullet points for investors`
          }
        ],
        temperature: 0.2, // Lower temperature for more factual, consistent output
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error summarizing finance news:', error);
    throw error;
  }
}

// Send finance news to the configured channels
async function sendFinanceNews(client) {
  try {
    console.log('Starting finance news update process...');
    
    // Check if we have any configured channels
    const guildChannels = config.channels;
    if (Object.keys(guildChannels).length === 0) {
      console.log('No channels configured for finance news updates');
      return;
    }
    
    // Fetch and summarize the news
    const articles = await fetchYahooFinanceNews();
    
    // If no articles found, send a fallback message
    if (!articles || articles.length === 0) {
      console.log('No finance articles found, sending fallback message');
      
      for (const [guildId, channelId] of Object.entries(guildChannels)) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (!guild) continue;
          
          const channel = guild.channels.cache.get(channelId);
          if (!channel) continue;
          
          const fallbackEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📈 Daily Finance Market Update')
            .setDescription('No finance news articles were found today. Please check back later.')
            .setTimestamp()
            .setFooter({ text: 'Powered by Yahoo Finance • Summarized with AI' });
          
          await channel.send({ embeds: [fallbackEmbed] });
        } catch (error) {
          console.error(`Error sending fallback finance news to guild ${guildId}:`, error);
        }
      }
      return;
    }
    
    // Try to get summary
    let summary;
    try {
      summary = await summarizeNews(articles);
    } catch (error) {
      console.error('Error during news summarization:', error);
      summary = null;
    }
    
    // Ensure we have a valid description for the embed
    // Discord.js requires non-empty strings for descriptions
    const defaultDescription = 'Today\'s financial market summary could not be generated. Please see the article links below for the latest news.';
    const safeDescription = summary && summary.trim() 
      ? (summary.length > 4096 ? summary.substring(0, 4093) + '...' : summary) 
      : defaultDescription;
    
    // Create an embed for the news
    const newsEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📈 Daily Finance Market Update')
      .setDescription(safeDescription) // Now using safe description that's never empty
      .setTimestamp()
      .setFooter({ text: 'Powered by Yahoo Finance • Summarized with AI' });
    
    // Send to all configured channels
    for (const [guildId, channelId] of Object.entries(guildChannels)) {
      try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          console.log(`Guild ${guildId} not found`);
          continue;
        }
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
          console.log(`Channel ${channelId} not found in guild ${guild.name}`);
          continue;
        }
        
        console.log(`Sending finance news to #${channel.name} in ${guild.name}`);
        await channel.send({ embeds: [newsEmbed] });
        
        // Send article links as a follow-up message
        if (articles.length > 0) {
          const linksText = articles.map((article, index) => {
            const title = article.title || 'Untitled Article';
            const url = article.url || 'https://finance.yahoo.com';
            return `${index + 1}. [${title}](${url})`;
          }).join('\n');
          
          const linksEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Today\'s Finance News Sources')
            .setDescription(linksText || 'No article links available') // Ensure non-empty description
            .setFooter({ text: 'Click on article titles to read the full stories' });
          
          await channel.send({ embeds: [linksEmbed] });
        }
      } catch (error) {
        console.error(`Error sending finance news to guild ${guildId}:`, error);
      }
    }
    
    console.log('Finance news update completed');
  } catch (error) {
    console.error('Error sending finance news:', error);
  }
}

// Register a channel for daily finance news
function registerChannel(guildId, channelId) {
  config.channels[guildId] = channelId;
  saveConfig();
  console.log(`Registered channel ${channelId} in guild ${guildId} for finance news`);
}

// Unregister a channel
function unregisterChannel(guildId) {
  if (config.channels[guildId]) {
    delete config.channels[guildId];
    saveConfig();
    console.log(`Unregistered finance news for guild ${guildId}`);
    return true;
  }
  return false;
}

// Initialize scheduled job
function initScheduledNews(client) {
  // Schedule daily news at 8:00 AM (adjust as needed)
  cron.schedule('0 8 * * *', () => {
    console.log('Running scheduled finance news update');
    sendFinanceNews(client);
  });
  
  console.log('Finance news scheduler initialized');
}

module.exports = {
  initScheduledNews,
  registerChannel,
  unregisterChannel,
  sendFinanceNews
};
