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
      console.log('Fetching finance news from Yahoo Finance...');
      const newsArticles = await this.fetchYahooFinanceNews();
      
      if (!newsArticles || newsArticles.length === 0) {
        console.log('No finance news articles found');
        return;
      }
      
      console.log(`Found ${newsArticles.length} finance news articles`);
      
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
   * Fetch the latest finance news from Yahoo Finance
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchYahooFinanceNews() {
    try {
      // Fetch the Yahoo Finance front page
      const response = await axios.get('https://finance.yahoo.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      const articles = [];
      
      // Extract articles from the main page
      $('li.js-stream-content').each((i, element) => {
        if (i >= 15) return false; // Limit to 15 articles
        
        const titleElement = $(element).find('h3');
        const title = titleElement.text().trim();
        
        if (!title) return; // Skip if no title
        
        const linkElement = $(element).find('a').first();
        let url = linkElement.attr('href');
        
        // Fix relative URLs
        if (url && url.startsWith('/')) {
          url = 'https://finance.yahoo.com' + url;
        }
        
        // Extract short summary if available
        const summaryElement = $(element).find('p');
        const summary = summaryElement.text().trim();
        
        if (title && url) {
          articles.push({
            title,
            url,
            summary
          });
        }
      });
      
      return articles;
      
    } catch (error) {
      console.error('Error fetching Yahoo Finance news:', error);
      return [];
    }
  }

  /**
   * Summarize finance news using OpenRouter API
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
          temperature: 0.3
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          }
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
      return 'Error generating finance news summary. Please check the logs for details.';
    }
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
