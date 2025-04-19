const axios = require('axios');
const cheerio = require('cheerio');
const { EmbedBuilder } = require('discord.js');

/**
 * Fetches finance news headlines from multiple sources
 * @returns {Promise<Array>} - Array of news items with title, url, and source
 */
async function fetchFinanceNews() {
    try {
        const newsSources = [
            {
                name: 'Yahoo Finance',
                url: 'https://finance.yahoo.com/',
                scraper: scrapeYahooFinance
            },
            {
                name: 'CNBC',
                url: 'https://www.cnbc.com/markets/',
                scraper: scrapeCNBC
            },
            {
                name: 'MarketWatch',
                url: 'https://www.marketwatch.com/',
                scraper: scrapeMarketWatch
            }
        ];

        // Fetch from all sources concurrently
        const newsPromises = newsSources.map(source => 
            source.scraper(source.url, source.name)
                .catch(err => {
                    console.error(`Error scraping ${source.name}:`, err.message);
                    return []; // Return empty array if source fails
                })
        );

        const newsArrays = await Promise.all(newsPromises);
        
        // Flatten and mix the results from different sources
        const allNews = newsArrays.flat();
        
        // Sort by newest first (if timestamp available) or randomize
        return allNews.sort(() => Math.random() - 0.5).slice(0, 10);
    } catch (error) {
        console.error('Error fetching finance news:', error);
        throw error;
    }
}

/**
 * Scrapes news headlines from Yahoo Finance
 */
async function scrapeYahooFinance(url, sourceName) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        // Yahoo Finance headline structure
        $('h3').each((i, element) => {
            const titleElement = $(element);
            const title = titleElement.text().trim();
            
            if (title && title.length > 10) {
                const linkElement = titleElement.closest('a');
                let url = linkElement.attr('href');
                
                // Fix relative URLs
                if (url && url.startsWith('/')) {
                    url = `https://finance.yahoo.com${url}`;
                }
                
                if (url && !newsItems.some(item => item.title === title)) {
                    newsItems.push({
                        title,
                        url,
                        source: sourceName
                    });
                }
            }
        });
        
        return newsItems.slice(0, 5); // Return top 5 headlines
    } catch (error) {
        console.error(`Error scraping ${sourceName}:`, error);
        return [];
    }
}

/**
 * Scrapes news headlines from CNBC Markets
 */
async function scrapeCNBC(url, sourceName) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        // CNBC headline structure
        $('.Card-title').each((i, element) => {
            const titleElement = $(element);
            const title = titleElement.text().trim();
            
            if (title && title.length > 10) {
                const linkElement = titleElement.closest('a');
                let url = linkElement.attr('href');
                
                if (url && !newsItems.some(item => item.title === title)) {
                    newsItems.push({
                        title,
                        url,
                        source: sourceName
                    });
                }
            }
        });
        
        return newsItems.slice(0, 5); // Return top 5 headlines
    } catch (error) {
        console.error(`Error scraping ${sourceName}:`, error);
        return [];
    }
}

/**
 * Scrapes news headlines from MarketWatch
 */
async function scrapeMarketWatch(url, sourceName) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        // MarketWatch headline structure
        $('h3.article__headline').each((i, element) => {
            const titleElement = $(element);
            const title = titleElement.text().trim();
            const linkElement = titleElement.find('a');
            const url = linkElement.attr('href');
            
            if (title && url && !newsItems.some(item => item.title === title)) {
                newsItems.push({
                    title,
                    url,
                    source: sourceName
                });
            }
        });
        
        return newsItems.slice(0, 5); // Return top 5 headlines
    } catch (error) {
        console.error(`Error scraping ${sourceName}:`, error);
        return [];
    }
}

/**
 * Creates a Discord embed with finance news
 */
function createNewsEmbed(newsItems) {
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('📈 Latest Finance News Headlines')
        .setDescription('The latest headlines from top financial news sources')
        .setTimestamp()
        .setFooter({ text: 'Data from Yahoo Finance, CNBC, and MarketWatch' });
    
    // Group news by source
    const newsBySource = {};
    newsItems.forEach(item => {
        if (!newsBySource[item.source]) {
            newsBySource[item.source] = [];
        }
        newsBySource[item.source].push(item);
    });
    
    // Add each source as a field
    Object.keys(newsBySource).forEach(source => {
        const sourceNews = newsBySource[source];
        embed.addFields({
            name: `🔸 ${source}`,
            value: sourceNews.map(item => `[${item.title}](${item.url})`).join('\n\n')
        });
    });
    
    return embed;
}

module.exports = {
    fetchFinanceNews,
    createNewsEmbed
};
