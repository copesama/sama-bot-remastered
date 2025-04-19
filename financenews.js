const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const cron = require('node-cron');

// Path to store channel configuration
const CONFIG_PATH = path.join(__dirname, 'finance_channels.json');

// Keep track of channels for finance news
let financeChannels = [];

// Load existing finance channels from config file
function loadFinanceChannels() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            financeChannels = JSON.parse(data);
            console.log(`Loaded ${financeChannels.length} finance news channels`);
        } else {
            console.log('No finance channels config found, creating new config');
            saveFinanceChannels();
        }
    } catch (error) {
        console.error('Error loading finance channels:', error);
        financeChannels = [];
        saveFinanceChannels();
    }
}

// Save finance channels to config file
function saveFinanceChannels() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(financeChannels, null, 2));
        console.log(`Saved ${financeChannels.length} finance news channels to config`);
    } catch (error) {
        console.error('Error saving finance channels:', error);
    }
}

// Check if user has admin permissions
function isAdmin(member) {
    return member.permissions.has('ADMINISTRATOR');
}

// Scrape Yahoo Finance for top headlines
async function getYahooFinanceNews() {
    try {
        console.log('Fetching Yahoo Finance news...');
        const response = await axios.get('https://finance.yahoo.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        // Yahoo Finance structure may change - adjust selectors as needed
        $('li.js-stream-content').slice(0, 8).each((index, element) => {
            const headlineElement = $(element).find('h3');
            const headline = headlineElement.text().trim();
            
            const linkElement = $(element).find('a').first();
            let link = linkElement.attr('href');
            if (link && !link.startsWith('http')) {
                link = 'https://finance.yahoo.com' + link;
            }
            
            if (headline && link) {
                newsItems.push({
                    headline,
                    link,
                    source: 'Yahoo Finance'
                });
            }
        });
        
        console.log(`Found ${newsItems.length} Yahoo Finance news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Yahoo Finance:', error);
        return [];
    }
}

// Scrape MarketWatch for top headlines
async function getMarketWatchNews() {
    try {
        console.log('Fetching MarketWatch news...');
        const response = await axios.get('https://www.marketwatch.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        // MarketWatch structure may change - adjust selectors as needed
        $('.article__content').slice(0, 8).each((index, element) => {
            const headlineElement = $(element).find('.article__headline');
            const headline = headlineElement.text().trim();
            
            const linkElement = $(element).find('a.link').first();
            let link = linkElement.attr('href');
            
            if (headline && link) {
                newsItems.push({
                    headline,
                    link,
                    source: 'MarketWatch'
                });
            }
        });
        
        console.log(`Found ${newsItems.length} MarketWatch news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping MarketWatch:', error);
        return [];
    }
}

// Scrape CNBC for top headlines
async function getCNBCNews() {
    try {
        console.log('Fetching CNBC news...');
        const response = await axios.get('https://www.cnbc.com/markets/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        // CNBC structure may change - adjust selectors as needed
        $('.Card-titleContainer').slice(0, 8).each((index, element) => {
            const headlineElement = $(element).find('.Card-title');
            const headline = headlineElement.text().trim();
            
            const linkElement = $(element).closest('a');
            let link = linkElement.attr('href');
            
            if (headline && link) {
                newsItems.push({
                    headline,
                    link,
                    source: 'CNBC'
                });
            }
        });
        
        console.log(`Found ${newsItems.length} CNBC news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping CNBC:', error);
        return [];
    }
}

// Get crypto market data
async function getCryptoMarketData() {
    try {
        console.log('Fetching crypto market data...');
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
            params: {
                vs_currency: 'usd',
                order: 'market_cap_desc',
                per_page: 5,
                page: 1,
                sparkline: false
            }
        });
        
        return response.data.map(coin => ({
            name: coin.name,
            symbol: coin.symbol.toUpperCase(),
            price: `$${coin.current_price.toLocaleString()}`,
            change24h: `${coin.price_change_percentage_24h.toFixed(2)}%`,
            marketCap: `$${(coin.market_cap / 1000000000).toFixed(2)}B`,
            positive: coin.price_change_percentage_24h > 0
        }));
    } catch (error) {
        console.error('Error fetching crypto data:', error);
        return [];
    }
}

// Combine news from all sources
async function getAllFinanceNews() {
    try {
        // Fetch news from all sources in parallel
        const [yahooNews, marketWatchNews, cnbcNews, cryptoData] = await Promise.all([
            getYahooFinanceNews(),
            getMarketWatchNews(),
            getCNBCNews(),
            getCryptoMarketData()
        ]);
        
        // Combine and shuffle the news to get a diverse mix
        let allNews = [...yahooNews, ...marketWatchNews, ...cnbcNews];
        
        // Shuffle array to mix news from different sources
        allNews = allNews.sort(() => 0.5 - Math.random());
        
        // Take top 10 news items
        allNews = allNews.slice(0, 10);
        
        return {
            news: allNews,
            cryptoData
        };
    } catch (error) {
        console.error('Error getting combined finance news:', error);
        return {
            news: [],
            cryptoData: []
        };
    }
}

// Create news embed
function createNewsEmbed(newsData) {
    const { news, cryptoData } = newsData;
    
    // Create main news embed
    const newsEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📈 Daily Finance News Update')
        .setDescription('Top financial news from around the world')
        .setTimestamp()
        .setFooter({ text: 'Powered by Finance News Bot' });
    
    // Add news items
    if (news.length > 0) {
        let newsText = '';
        news.forEach((item, index) => {
            newsText += `${index + 1}. [${item.headline}](${item.link})\n`;
            if (index < news.length - 1) newsText += '\n';
        });
        newsEmbed.addFields({ name: '📰 Top Headlines', value: newsText });
    } else {
        newsEmbed.addFields({ name: '📰 Top Headlines', value: 'Unable to fetch news at this time.' });
    }
    
    // Create crypto embed if we have data
    if (cryptoData && cryptoData.length > 0) {
        const cryptoEmbed = new EmbedBuilder()
            .setColor('#f7931a')
            .setTitle('🪙 Cryptocurrency Market Update')
            .setTimestamp();
        
        let cryptoText = '';
        cryptoData.forEach(coin => {
            const changeSymbol = coin.positive ? '🟢' : '🔴';
            cryptoText += `**${coin.name} (${coin.symbol})**: ${coin.price} | ${changeSymbol} ${coin.change24h}\n`;
        });
        
        cryptoEmbed.setDescription(cryptoText);
        
        return [newsEmbed, cryptoEmbed];
    }
    
    return [newsEmbed];
}

// Post finance news to all registered channels
async function postFinanceNewsToChannels(client) {
    try {
        console.log('Starting finance news broadcast to channels...');
        
        if (financeChannels.length === 0) {
            console.log('No finance channels registered');
            return;
        }
        
        const newsData = await getAllFinanceNews();
        const embeds = createNewsEmbed(newsData);
        
        for (const channelId of financeChannels) {
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel) {
                    await channel.send({ embeds });
                    console.log(`Posted finance news to channel ${channelId}`);
                } else {
                    console.log(`Channel ${channelId} not found, removing from list`);
                    financeChannels = financeChannels.filter(id => id !== channelId);
                    saveFinanceChannels();
                }
            } catch (error) {
                console.error(`Error posting to channel ${channelId}:`, error);
                // If we can't access the channel, remove it from our list
                if (error.code === 10003 || error.code === 50001) {
                    console.log(`Removing inaccessible channel ${channelId}`);
                    financeChannels = financeChannels.filter(id => id !== channelId);
                    saveFinanceChannels();
                }
            }
        }
    } catch (error) {
        console.error('Error posting finance news:', error);
    }
}

// Initialize the finance news module
function initializeFinanceNews(client) {
    // Load existing finance channels
    loadFinanceChannels();
    
    // Schedule daily news posting at 9:00 AM
    cron.schedule('0 9 * * *', () => {
        console.log('Running scheduled finance news update');
        postFinanceNewsToChannels(client);
    });
    
    console.log('Finance news module initialized');
}

// Handle the !financenews command
async function handleFinanceNewsCommand(message) {
    // Check if user has admin permissions
    if (!isAdmin(message.member)) {
        return message.reply('Sorry, only administrators can set up finance news channels.');
    }
    
    const channelId = message.channel.id;
    
    // Check if this channel is already registered
    if (financeChannels.includes(channelId)) {
        // Remove the channel
        financeChannels = financeChannels.filter(id => id !== channelId);
        saveFinanceChannels();
        return message.reply('✅ This channel will no longer receive daily finance news updates.');
    } else {
        // Add the channel
        financeChannels.push(channelId);
        saveFinanceChannels();
        
        // Send a confirmation message
        await message.reply('✅ This channel has been set up to receive daily finance news updates at 9:00 AM.');
        
        // Send a sample news update
        await message.channel.send('📊 Here\'s a sample of the daily finance news update:');
        const newsData = await getAllFinanceNews();
        const embeds = createNewsEmbed(newsData);
        await message.channel.send({ embeds });
        
        return null;
    }
}

// Export the functions
module.exports = {
    initializeFinanceNews,
    handleFinanceNewsCommand,
    postFinanceNewsToChannels
};
