require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');

/**
 * Finance News Module - Fetches, summarizes and posts financial news
 */
class FinanceNews {
  constructor(client) {
    this.client = client;
    this.channelName = 'finance-news';
  }

  /**
   * Initialize the finance news feature
   */
  init() {
    console.log('Initializing Finance News feature...');
    
    // Schedule daily execution at 8:00 AM
    cron.schedule('0 8 * * *', () => {
      console.log('Running scheduled finance news summary task');
      this.fetchAndPostFinanceNews();
    });
    
    // Also provide a method for manual triggering
    return this;
  }

  /**
   * Fetch news from Yahoo Finance, summarize, and post to Discord
   */
  async fetchAndPostFinanceNews() {
    try {
      console.log('Fetching finance news...');
      
      // Try to fetch from multiple sources with fallbacks
      let newsArticles = [];
      
      try {
        // First try Yahoo Finance
        newsArticles = await this.fetchYahooFinanceNews();
        console.log(`Found ${newsArticles.length} articles from Yahoo Finance`);
      } catch (yahooError) {
        console.error('Error fetching from Yahoo Finance, trying fallback source:', yahooError);
        
        // Fallback to MarketWatch
        try {
          newsArticles = await this.fetchMarketWatchNews();
          console.log(`Found ${newsArticles.length} articles from MarketWatch fallback`);
        } catch (marketwatchError) {
          console.error('Error fetching from MarketWatch fallback:', marketwatchError);
          
          // Second fallback to Investing.com
          try {
            newsArticles = await this.fetchInvestingComNews();
            console.log(`Found ${newsArticles.length} articles from Investing.com fallback`);
          } catch (investingError) {
            console.error('Error fetching from all news sources:', investingError);
          }
        }
      }
      
      if (!newsArticles || newsArticles.length === 0) {
        console.log('No finance news articles found from any source');
        return;
      }
      
      console.log(`Proceeding with ${newsArticles.length} finance news articles`);
      
      // Prepare content for summarization
      const newsContent = newsArticles
        .map(article => `HEADLINE: ${article.title}\nURL: ${article.url}\nSUMMARY: ${article.summary || 'N/A'}`)
        .join('\n\n');
      
      // Get AI summary of the news
      const summary = await this.summarizeFinanceNews(newsContent);
      
      // Post to Discord
      await this.postToDiscord(summary, newsArticles);
      
    } catch (error) {
      console.error('Error in fetchAndPostFinanceNews:', error);
    }
  }

  /**
   * Fetch the latest finance news from Yahoo Finance with improved error handling
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchYahooFinanceNews() {
    try {
      // Use a more robust configuration for the request
      const response = await axios.get('https://finance.yahoo.com/news/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 10000, // 10 second timeout
        maxContentLength: 10 * 1024 * 1024, // 10MB max response size
        decompress: true, // Handle gzip/deflate
      });
      
      const $ = cheerio.load(response.data);
      const articles = [];
      
      // Try multiple selectors to account for potential Yahoo Finance layout changes
      const contentSelectors = [
        'li.js-stream-content', 
        'div.Cf', 
        'div.NewsArticle',
        'ul.My\\(0\\) > li'
      ];
      
      for (const selector of contentSelectors) {
        $(selector).each((i, element) => {
          if (articles.length >= 15) return false; // Limit to 15 articles total
          
          // Try different title selectors
          const titleSelectors = ['h3', 'h2', '.headline', 'a > div > div'];
          let title = null;
          
          for (const titleSelector of titleSelectors) {
            const titleElement = $(element).find(titleSelector).first();
            if (titleElement.length) {
              title = titleElement.text().trim();
              if (title) break;
            }
          }
          
          if (!title) return; // Skip if no title found
          
          // Try different link selectors
          const linkSelectors = ['a', 'a.js-content-viewer'];
          let url = null;
          
          for (const linkSelector of linkSelectors) {
            const linkElement = $(element).find(linkSelector).first();
            if (linkElement.length) {
              url = linkElement.attr('href');
              if (url) break;
            }
          }
          
          // Fix relative URLs
          if (url && url.startsWith('/')) {
            url = 'https://finance.yahoo.com' + url;
          }
          
          // Extract short summary if available
          const summarySelectors = ['p', '.summary', '.description'];
          let summary = null;
          
          for (const summarySelector of summarySelectors) {
            const summaryElement = $(element).find(summarySelector).first();
            if (summaryElement.length) {
              summary = summaryElement.text().trim();
              if (summary) break;
            }
          }
          
          if (title && url) {
            // Check for duplicates before adding
            if (!articles.some(article => article.title === title)) {
              articles.push({
                title,
                url,
                summary: summary || ''
              });
            }
          }
        });
        
        // If we found articles using this selector, no need to try others
        if (articles.length > 0) {
          break;
        }
      }
      
      return articles;
      
    } catch (error) {
      console.error('Error fetching Yahoo Finance news:', error);
      throw error; // Propagate error for fallback handling
    }
  }
  
  /**
   * Fetch the latest finance news from MarketWatch as a fallback
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchMarketWatchNews() {
    try {
      const response = await axios.get('https://www.marketwatch.com/latest-news', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 10000,
      });
      
      const $ = cheerio.load(response.data);
      const articles = [];
      
      // MarketWatch latest news articles
      $('.article__content').each((i, element) => {
        if (i >= 15) return false; // Limit to 15 articles
        
        const titleElement = $(element).find('.article__headline');
        const title = titleElement.text().trim();
        
        if (!title) return; // Skip if no title
        
        const linkElement = $(element).find('a.link').first();
        let url = linkElement.attr('href');
        
        // Extract short summary if available
        const summaryElement = $(element).find('.article__summary');
        const summary = summaryElement.text().trim();
        
        if (title && url) {
          articles.push({
            title,
            url,
            summary: summary || ''
          });
        }
      });
      
      return articles;
      
    } catch (error) {
      console.error('Error fetching MarketWatch news:', error);
      throw error; // Propagate error for next fallback
    }
  }
  
  /**
   * Fetch the latest finance news from Investing.com as a second fallback
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchInvestingComNews() {
    try {
      const response = await axios.get('https://www.investing.com/news/latest-news', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 10000,
      });
      
      const $ = cheerio.load(response.data);
      const articles = [];
      
      // Investing.com latest news articles
      $('.largeTitle article').each((i, element) => {
        if (i >= 15) return false; // Limit to 15 articles
        
        const titleElement = $(element).find('.title');
        const title = titleElement.text().trim();
        
        if (!title) return; // Skip if no title
        
        const linkElement = titleElement.find('a').first();
        let url = linkElement.attr('href');
        
        // Fix relative URLs
        if (url && url.startsWith('/')) {
          url = 'https://www.investing.com' + url;
        }
        
        // No summary available on this page
        
        if (title && url) {
          articles.push({
            title,
            url,
            summary: 'No summary available'
          });
        }
      });
      
      return articles;
      
    } catch (error) {
      console.error('Error fetching Investing.com news:', error);
      
      // Last fallback - return manually created market data
      return this.createFallbackMarketData();
    }
  }
  
  /**
   * Create fallback market data when all sources fail
   * @returns {Array} Array of basic market data articles
   */
  createFallbackMarketData() {
    console.log('Using hardcoded fallback market data');
    
    // Get today's date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    return [
      {
        title: `Market Summary for ${dateStr}`,
        url: 'https://finance.yahoo.com/quote/%5EGSPC/',
        summary: 'S&P 500 index data for today'
      },
      {
        title: `Dow Jones Industrial Average - ${dateStr}`,
        url: 'https://finance.yahoo.com/quote/%5EDJI/',
        summary: 'DJIA performance summary'
      },
      {
        title: `NASDAQ Composite - ${dateStr}`,
        url: 'https://finance.yahoo.com/quote/%5EIXIC/',
        summary: 'NASDAQ market activity'
      },
      {
        title: `Global Markets Overview - ${dateStr}`,
        url: 'https://finance.yahoo.com/world-indices/',
        summary: 'Overview of global market indices'
      },
      {
        title: `Commodities Report - ${dateStr}`,
        url: 'https://finance.yahoo.com/commodities/',
        summary: 'Latest commodity prices including oil, gold and silver'
      }
    ];
  }

  /**
   * Summarize finance news using OpenRouter API with improved error handling
   * @param {string} newsContent Content to summarize
   * @returns {Promise<string>} Summarized content
   */
  async summarizeFinanceNews(newsContent) {
    try {
      console.log('Summarizing finance news with AI...');
      
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'google/gemini-2.0-flash-exp:free',
          messages: [
            {
              role: 'system',
              content: `You are a financial analyst tasked with summarizing daily financial news for investors.
              
              Provide a comprehensive yet concise summary of the day's most important financial news, including:
              1. Market movements and key index changes
              2. Major corporate news and earnings announcements
              3. Economic data and its implications
              4. Notable sector trends
              5. International market influences
              
              Format your response with clear section headers, bullet points where appropriate, and a "Key Takeaways" section at the end.
              Keep your analysis factual, balanced and insightful.`
            },
            {
              role: 'user',
              content: `Here are today's top financial news articles. Please analyze them and provide a well-organized daily financial market summary:\n\n${newsContent}`
            }
          ],
          temperature: 0.3,
          max_tokens: 1500
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      // Extract the summary from the response
      const summary = response.data.choices[0].message.content;
      return summary;
      
    } catch (error) {
      console.error('Error summarizing finance news:', error);
      if (error.response) {
        console.error('API error details:', error.response.data);
      }
      
      // Return a simple fallback summary
      return this.createFallbackSummary();
    }
  }
  
  /**
   * Create a fallback summary when AI summarization fails
   * @returns {string} Basic finance summary
   */
  createFallbackSummary() {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    return `# Financial Market Summary - ${dateStr}

## Market Overview
* Markets are experiencing regular trading activities
* Please check the links below for specific index performances
* Economic data releases continue to influence market sentiment

## Notable Sectors
* Technology, Healthcare, and Financial sectors remain key areas to watch
* Commodity prices continue to impact related industries

## Key Takeaways
* Stay informed on major index movements
* Watch for significant earnings announcements
* Monitor central bank communications for policy signals

*Note: This is a system-generated summary due to technical difficulties with our regular finance news summarization. Please check the links below for detailed market information.*`;
  }

  /**
   * Post the finance news summary to Discord
   * @param {string} summary Summarized news content
   * @param {Array} articles Original news articles
   */
  async postToDiscord(summary, articles) {
    try {
      console.log('Posting finance news to Discord...');
      
      // Find or create the finance-news channel
      const channel = await this.findOrCreateNewsChannel();
      
      if (!channel) {
        console.error('Failed to find or create finance-news channel');
        return;
      }
      
      // Get current date in a readable format
      const currentDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      // Create an embed for the summary
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`📈 Financial Market Summary - ${currentDate}`)
        .setDescription(summary.length > 4096 ? summary.substring(0, 4093) + '...' : summary)
        .setTimestamp()
        .setFooter({ 
          text: 'Powered by Yahoo Finance & AI | Data may be delayed', 
        });
      
      // Add the top 3 news sources as fields if the summary isn't too long
      if (summary.length < 3500 && articles.length > 0) {
        embed.addFields(
          { name: '\u200B', value: '**Top Finance Stories:**' }
        );
        
        // Add up to 3 articles as fields
        articles.slice(0, 3).forEach((article, index) => {
          embed.addFields({
            name: `${index + 1}. ${article.title}`,
            value: `[Read more](${article.url})`,
            inline: false
          });
        });
      }
      
      // Send the embed to the channel
      await channel.send({ embeds: [embed] });
      
      console.log('Finance news posted successfully');
      
    } catch (error) {
      console.error('Error posting to Discord:', error);
    }
  }

  /**
   * Find or create the finance-news channel
   * @returns {Promise<TextChannel|null>} The Discord channel
   */
  async findOrCreateNewsChannel() {
    try {
      // Loop through all guilds the bot is in
      for (const guild of this.client.guilds.cache.values()) {
        // Check if the channel already exists
        let channel = guild.channels.cache.find(
          ch => ch.name === this.channelName && ch.type === 0 // Type 0 is a text channel
        );
        
        // If channel doesn't exist, create it
        if (!channel) {
          console.log(`Creating finance-news channel in guild ${guild.name}...`);
          try {
            channel = await guild.channels.create({
              name: this.channelName,
              type: 0, // Text Channel
              topic: 'Daily summaries of financial market news',
              reason: 'Automated finance news updates'
            });
            
            // Send initial message to the channel
            await channel.send({
              content: '👋 This channel has been created for daily financial market news summaries. You will receive updates each morning at 8:00 AM.'
            });
            
          } catch (createError) {
            console.error(`Error creating channel in guild ${guild.name}:`, createError);
            continue; // Try next guild
          }
        }
        
        return channel;
      }
      
      // If we reach here, we couldn't find or create a channel
      return null;
      
    } catch (error) {
      console.error('Error in findOrCreateNewsChannel:', error);
      return null;
    }
  }
}

module.exports = FinanceNews;
