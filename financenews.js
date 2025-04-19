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

// Create a reusable browser-like headers object to avoid detection
const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.google.com/',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

// Scrape Yahoo Finance for top headlines
async function getYahooFinanceNews() {
    try {
        console.log('Fetching Yahoo Finance news...');
        const response = await axios.get('https://finance.yahoo.com/', {
            headers: browserHeaders,
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
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
        console.error('Error scraping Yahoo Finance:', error.message);
        return [];
    }
}

// Scrape MarketWatch for top headlines (updated with more robust approach)
async function getMarketWatchNews() {
    try {
        console.log('Fetching MarketWatch news...');
        const response = await axios.get('https://www.marketwatch.com/latest-news', {
            headers: {
                ...browserHeaders,
                'Cookie': 'gdprApplies=false; country=us; ccpaApplies=false; mw_loc=www.marketwatch.com'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        $('.article__content, .link-content').slice(0, 8).each((index, element) => {
            try {
                const headlineElement = $(element).find('.article__headline, a.link, h3');
                const headline = headlineElement.text().trim();
                
                const linkElement = $(element).find('a').first();
                let link = linkElement.attr('href');
                
                if (!link && $(element).is('a')) {
                    link = $(element).attr('href');
                }
                
                if (headline && link) {
                    if (link && !link.startsWith('http')) {
                        link = 'https://www.marketwatch.com' + link;
                    }
                    
                    newsItems.push({
                        headline,
                        link,
                        source: 'MarketWatch'
                    });
                }
            } catch (err) {
                console.error('Error processing MarketWatch item:', err.message);
            }
        });
        
        console.log(`Found ${newsItems.length} MarketWatch news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping MarketWatch:', error.message);
        try {
            console.log('Trying alternative MarketWatch URL...');
            const response = await axios.get('https://www.marketwatch.com/investing', {
                headers: browserHeaders,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const newsItems = [];
            
            $('.element--article').slice(0, 8).each((index, element) => {
                try {
                    const headline = $(element).find('h3').text().trim();
                    let link = $(element).find('a').attr('href');
                    
                    if (headline && link) {
                        if (!link.startsWith('http')) {
                            link = 'https://www.marketwatch.com' + link;
                        }
                        
                        newsItems.push({
                            headline,
                            link,
                            source: 'MarketWatch'
                        });
                    }
                } catch (err) {
                    console.error('Error processing alternative MarketWatch item:', err.message);
                }
            });
            
            console.log(`Found ${newsItems.length} news items from alternative MarketWatch URL`);
            return newsItems;
        } catch (fallbackError) {
            console.error('Error with MarketWatch fallback:', fallbackError.message);
            return [];
        }
    }
}

// Scrape CNBC for top headlines (with improved reliability)
async function getCNBCNews() {
    try {
        console.log('Fetching CNBC news...');
        const response = await axios.get('https://www.cnbc.com/markets/', {
            headers: browserHeaders,
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        $('.Card-titleContainer, .Card-title, .Card, .MarketsBanner-storyTitle').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('.Card-title');
                let headline = headlineElement.text().trim();
                
                if (!headline) {
                    headline = $(element).text().trim();
                }
                
                let link;
                const linkElement = $(element).closest('a');
                if (linkElement.length) {
                    link = linkElement.attr('href');
                } else {
                    link = $(element).find('a').attr('href');
                }
                
                if (headline && link) {
                    headline = headline.replace(/\s+/g, ' ').trim();
                    
                    newsItems.push({
                        headline,
                        link,
                        source: 'CNBC'
                    });
                }
            } catch (err) {
                console.error('Error processing CNBC item:', err.message);
            }
        });
        
        console.log(`Found ${newsItems.length} CNBC news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping CNBC:', error.message);
        return [];
    }
}

// New function: Scrape Investing.com as additional source
async function getInvestingComNews() {
    try {
        console.log('Fetching Investing.com news...');
        const response = await axios.get('https://www.investing.com/news/stock-market-news', {
            headers: browserHeaders,
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        $('.largeTitle article').slice(0, 8).each((index, element) => {
            try {
                const headlineElement = $(element).find('.title');
                const headline = headlineElement.text().trim();
                
                const linkElement = $(element).find('a').first();
                let link = linkElement.attr('href');
                
                if (headline && link) {
                    if (link && !link.startsWith('http')) {
                        link = 'https://www.investing.com' + link;
                    }
                    
                    newsItems.push({
                        headline,
                        link,
                        source: 'Investing.com'
                    });
                }
            } catch (err) {
                console.error('Error processing Investing.com item:', err.message);
            }
        });
        
        console.log(`Found ${newsItems.length} Investing.com news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Investing.com:', error.message);
        return [];
    }
}

// New function: Scrape Reuters Business news as additional source
async function getReutersNews() {
    try {
        console.log('Fetching Reuters Business news...');
        const response = await axios.get('https://www.reuters.com/business/', {
            headers: browserHeaders,
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const newsItems = [];
        
        $('article, .media-story-card').slice(0, 8).each((index, element) => {
            try {
                const headlineElement = $(element).find('h3, .media-story-card__heading__eqhp9');
                const headline = headlineElement.text().trim();
                
                let link = $(element).find('a').attr('href');
                
                if (headline && link) {
                    if (link && !link.startsWith('http')) {
                        link = 'https://www.reuters.com' + link;
                    }
                    
                    newsItems.push({
                        headline,
                        link,
                        source: 'Reuters'
                    });
                }
            } catch (err) {
                console.error('Error processing Reuters item:', err.message);
            }
        });
        
        console.log(`Found ${newsItems.length} Reuters news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Reuters:', error.message);
        return [];
    }
}

// Get crypto market data with better error handling
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
            },
            timeout: 10000
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
        console.error('Error fetching crypto data:', error.message);
        
        return [
            {
                name: 'Bitcoin',
                symbol: 'BTC',
                price: 'Price data unavailable',
                change24h: 'N/A',
                marketCap: 'N/A',
                positive: true
            },
            {
                name: 'Ethereum',
                symbol: 'ETH',
                price: 'Price data unavailable',
                change24h: 'N/A',
                marketCap: 'N/A',
                positive: true
            }
        ];
    }
}

// Combine news from all sources with improved error handling
async function getAllFinanceNews() {
    try {
        const results = await Promise.allSettled([
            getYahooFinanceNews(),
            getMarketWatchNews(),
            getCNBCNews(),
            getInvestingComNews(),
            getReutersNews(),
            getCryptoMarketData()
        ]);
        
        const yahooNews = results[0].status === 'fulfilled' ? results[0].value : [];
        const marketWatchNews = results[1].status === 'fulfilled' ? results[1].value : [];
        const cnbcNews = results[2].status === 'fulfilled' ? results[2].value : [];
        const investingNews = results[3].status === 'fulfilled' ? results[3].value : [];
        const reutersNews = results[4].status === 'fulfilled' ? results[4].value : [];
        const cryptoData = results[5].status === 'fulfilled' ? results[5].value : [];
        
        console.log(`News source success: Yahoo: ${yahooNews.length > 0}, MarketWatch: ${marketWatchNews.length > 0}, CNBC: ${cnbcNews.length > 0}, Investing.com: ${investingNews.length > 0}, Reuters: ${reutersNews.length > 0}`);
        
        let allNews = [...yahooNews, ...marketWatchNews, ...cnbcNews, ...investingNews, ...reutersNews];
        
        const uniqueHeadlines = new Set();
        allNews = allNews.filter(item => {
            const normalizedHeadline = item.headline.toLowerCase();
            if (uniqueHeadlines.has(normalizedHeadline)) {
                return false;
            }
            uniqueHeadlines.add(normalizedHeadline);
            return true;
        });
        
        allNews = allNews.sort(() => 0.5 - Math.random());
        
        allNews = allNews.slice(0, 10);
        
        if (allNews.length === 0) {
            allNews = [{
                headline: "Finance news temporarily unavailable. Please check back later.",
                link: "https://www.google.com/search?q=latest+financial+news",
                source: "System Message"
            }];
        }
        
        return {
            news: allNews,
            cryptoData
        };
    } catch (error) {
        console.error('Error getting combined finance news:', error.message);
        return {
            news: [{
                headline: "Finance news temporarily unavailable. Please check back later.",
                link: "https://www.google.com/search?q=latest+financial+news",
                source: "System Message"
            }],
            cryptoData: []
        };
    }
}

// Create news embed with better empty state handling
function createNewsEmbed(newsData) {
    const { news, cryptoData } = newsData;
    
    const newsEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📈 Daily Finance News Update')
        .setDescription('Top financial news from around the world')
        .setTimestamp()
        .setFooter({ text: 'Powered by Finance News Bot' });
    
    if (news.length > 0) {
        let newsText = '';
        news.forEach((item, index) => {
            newsText += `${index + 1}. [${item.headline}](${item.link})`;
            if (item.source) {
                newsText += ` - *${item.source}*`;
            }
            newsText += '\n';
            if (index < news.length - 1) newsText += '\n';
        });
        newsEmbed.addFields({ name: '📰 Top Headlines', value: newsText });
    } else {
        newsEmbed.addFields({ 
            name: '📰 Top Headlines', 
            value: 'Unable to fetch news at this time. Please check back later or visit [Google Finance](https://www.google.com/finance/).' 
        });
    }
    
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
    loadFinanceChannels();
    
    cron.schedule('0 9 * * *', () => {
        console.log('Running scheduled finance news update');
        postFinanceNewsToChannels(client);
    });
    
    console.log('Finance news module initialized');
}

// Handle the !financenews command
async function handleFinanceNewsCommand(message) {
    if (!isAdmin(message.member)) {
        return message.reply('Sorry, only administrators can set up finance news channels.');
    }
    
    const channelId = message.channel.id;
    
    const loadingMessage = await message.reply('⏳ Processing finance news request...');
    
    try {
        if (financeChannels.includes(channelId)) {
            financeChannels = financeChannels.filter(id => id !== channelId);
            saveFinanceChannels();
            await loadingMessage.edit('✅ This channel will no longer receive daily finance news updates.');
        } else {
            financeChannels.push(channelId);
            saveFinanceChannels();
            
            await loadingMessage.edit('✅ This channel has been set up to receive daily finance news updates at 9:00 AM. Preparing sample update...');
            
            try {
                const newsData = await getAllFinanceNews();
                const embeds = createNewsEmbed(newsData);
                await message.channel.send({ 
                    content: '📊 Here\'s a sample of the daily finance news update:',
                    embeds 
                });
                
                await loadingMessage.edit('✅ This channel has been set up to receive daily finance news updates at 9:00 AM.');
            } catch (newsError) {
                console.error('Error generating sample news:', newsError);
                await loadingMessage.edit('✅ This channel has been set up to receive daily finance news updates at 9:00 AM, but there was an error generating the sample. The scheduled updates should still work properly.');
            }
        }
    } catch (error) {
        console.error('Error handling finance news command:', error);
        await loadingMessage.edit('❌ There was an error processing your request. Please try again later.');
    }
    
    return null;
}

// Export the functions
module.exports = {
    initializeFinanceNews,
    handleFinanceNewsCommand,
    postFinanceNewsToChannels
};
