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

// Create a more generic browser-like headers object to avoid detection
const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
};

// Function to clean up text by removing excessive whitespace
function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

// Helper function to add a simple text similarity check
function isSimilarText(str1, str2, threshold = 0.7) {
    if (Math.abs(str1.length - str2.length) / Math.max(str1.length, str2.length) > 0.3) {
        return false;
    }
    
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    
    let commonWords = 0;
    for (const word of words1) {
        if (words2.includes(word) && word.length > 2) {
            commonWords++;
        }
    }
    
    const totalUniqueWords = new Set([...words1, ...words2]).size;
    const similarity = commonWords / totalUniqueWords;
    
    return similarity >= threshold;
}

// Scrape CNBC for top headlines
async function getCNBCNews() {
    try {
        console.log('Fetching CNBC news...');
        const response = await axios.get('https://www.cnbc.com/business/', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('.Card-titleContainer, .Card-title, .Card, .MarketsBanner-storyTitle, .teaser-content').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('.Card-title, .teaser-title');
                let headline = cleanText(headlineElement.text());

                if (!headline) {
                    headline = cleanText($(element).text());
                }

                let link;
                const linkElement = $(element).closest('a');
                if (linkElement.length) {
                    link = linkElement.attr('href');
                } else {
                    link = $(element).find('a').attr('href');
                }

                if (headline && link && headline.length > 15) {
                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'CNBC'
                    });
                }
            } catch (err) {
                console.error('Error processing CNBC item:', err.message);
            }
        });

        if (newsItems.length === 0) {
            const fallbackResponse = await axios.get('https://www.cnbc.com/markets/', {
                headers: browserHeaders,
                timeout: 10000
            });

            const fallback$ = cheerio.load(fallbackResponse.data);
            fallback$('.Card, article').slice(0, 10).each((index, element) => {
                try {
                    const headline = cleanText(fallback$(element).find('.Card-title').text());
                    const link = fallback$(element).find('a').attr('href');

                    if (headline && link && headline.length > 15) {
                        newsItems.push({
                            headline: headline.substring(0, 80),
                            link,
                            source: 'CNBC'
                        });
                    }
                } catch (err) {
                    console.error('Error processing CNBC fallback item:', err.message);
                }
            });
        }

        console.log(`Found ${newsItems.length} CNBC news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping CNBC:', error.message);
        return [];
    }
}

// Scrape Kiplinger for top headlines
async function getKiplingerNews() {
    try {
        console.log('Fetching Kiplinger news...');
        const response = await axios.get('https://www.kiplinger.com/investing', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('.article-card, .article-tile, article').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('h3, .card-title');
                const headline = cleanText(headlineElement.text());

                let link = $(element).find('a').attr('href');

                if (headline && link && headline.length > 15) {
                    if (link && link.startsWith('/')) {
                        link = 'https://www.kiplinger.com' + link;
                    }

                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'Kiplinger'
                    });
                }
            } catch (err) {
                console.error('Error processing Kiplinger item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} Kiplinger news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Kiplinger:', error.message);
        return [];
    }
}

// Scrape Fox Business for financial news
async function getFoxBusinessNews() {
    try {
        console.log('Fetching Fox Business news...');
        const response = await axios.get('https://www.foxbusiness.com/markets', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('.article, .story, .content, .m-article, [data-article-id]').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('h2, h3, h4, .title, .headline');
                const headline = cleanText(headlineElement.text());

                let link;
                const directLink = $(element).find('a').attr('href');
                const parentLink = $(element).parent('a').attr('href');
                
                link = directLink || parentLink;

                if (headline && link && headline.length > 15) {
                    if (link && link.startsWith('/')) {
                        link = 'https://www.foxbusiness.com' + link;
                    }

                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'Fox Business'
                    });
                }
            } catch (err) {
                console.error('Error processing Fox Business item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} Fox Business news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Fox Business:', error.message);
        return [];
    }
}

// Scrape Seeking Alpha for financial news
async function getSeekingAlphaNews() {
    try {
        console.log('Fetching Seeking Alpha news...');
        const response = await axios.get('https://seekingalpha.com/market-news', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('article, .media-article, [data-test-id="post-list-item"]').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('a[data-test-id="post-list-item-title"], h3, .title');
                const headline = cleanText(headlineElement.text());

                let link = headlineElement.attr('href') || $(element).find('a').attr('href');

                if (headline && link && headline.length > 15) {
                    if (link && link.startsWith('/')) {
                        link = 'https://seekingalpha.com' + link;
                    }

                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'Seeking Alpha'
                    });
                }
            } catch (err) {
                console.error('Error processing Seeking Alpha item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} Seeking Alpha news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Seeking Alpha:', error.message);
        return [];
    }
}

// Scrape Investing.com through a proxy
async function getInvestingComNews() {
    try {
        console.log('Fetching Investing.com news through proxy...');
        const response = await axios.get('https://financialmodelingprep.com/api/v3/stock_news?limit=10&apikey=demo', {
            timeout: 10000
        });

        const newsItems = [];

        if (response.data && Array.isArray(response.data)) {
            response.data.forEach(item => {
                try {
                    if (item.title && item.url) {
                        newsItems.push({
                            headline: cleanText(item.title).substring(0, 80),
                            link: item.url,
                            source: item.site || 'Financial News'
                        });
                    }
                } catch (err) {
                    console.error('Error processing Financial Modeling Prep item:', err.message);
                }
            });
        }

        console.log(`Found ${newsItems.length} Investing.com proxy news items`);
        return newsItems;
    } catch (error) {
        console.error('Error fetching Investing.com proxy news:', error.message);
        return [];
    }
}

// Get news from Yahoo Finance RSS feed
async function getYahooFinanceRSS() {
    try {
        console.log('Fetching Yahoo Finance RSS news...');
        const response = await axios.get('https://finance.yahoo.com/rss/topstories', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)',
                'Accept': 'application/rss+xml'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data, {
            xmlMode: true
        });

        const newsItems = [];

        $('item').slice(0, 10).each((index, element) => {
            try {
                const title = $(element).find('title').text();
                const link = $(element).find('link').text();
                
                if (title && link) {
                    newsItems.push({
                        headline: cleanText(title).substring(0, 80),
                        link,
                        source: 'Yahoo Finance'
                    });
                }
            } catch (err) {
                console.error('Error processing Yahoo Finance RSS item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} Yahoo Finance RSS news items`);
        return newsItems;
    } catch (error) {
        console.error('Error fetching Yahoo Finance RSS:', error.message);
        return [];
    }
}

// Fallback method: Get financial news from a public API
async function getNewsFromPublicAPI() {
    try {
        console.log('Fetching news from public API...');
        const response = await axios.get('https://api.marketaux.com/v1/news/all?symbols=AAPL,TSLA,MSFT&filter_entities=true&language=en&api_token=demo', {
            timeout: 10000
        });

        const newsItems = [];

        if (response.data && response.data.data && Array.isArray(response.data.data)) {
            response.data.data.forEach(item => {
                try {
                    if (item.title && item.url) {
                        newsItems.push({
                            headline: cleanText(item.title).substring(0, 80),
                            link: item.url,
                            source: item.source || 'Market News'
                        });
                    }
                } catch (err) {
                    console.error('Error processing Public API item:', err.message);
                }
            });
        }

        console.log(`Found ${newsItems.length} Public API news items`);
        return newsItems;
    } catch (error) {
        console.error('Error fetching Public API news:', error.message);
        return [];
    }
}

// Combine news from all sources
async function getAllFinanceNews() {
    try {
        const results = await Promise.allSettled([
            getCNBCNews(),
            getKiplingerNews(),
            getFoxBusinessNews(),
            getSeekingAlphaNews(),
            getYahooFinanceRSS(),
            getInvestingComNews(),
            getNewsFromPublicAPI(),
            getCryptoMarketData()
        ]);
        
        const cnbcNews = results[0].status === 'fulfilled' ? results[0].value : [];
        const kiplingerNews = results[1].status === 'fulfilled' ? results[1].value : [];
        const foxNews = results[2].status === 'fulfilled' ? results[2].value : [];
        const seekingAlphaNews = results[3].status === 'fulfilled' ? results[3].value : [];
        const yahooRssNews = results[4].status === 'fulfilled' ? results[4].value : [];
        const investingComNews = results[5].status === 'fulfilled' ? results[5].value : [];
        const publicApiNews = results[6].status === 'fulfilled' ? results[6].value : [];
        const cryptoData = results[7].status === 'fulfilled' ? results[7].value : [];
        
        console.log(`News source success: CNBC: ${cnbcNews.length > 0}, Kiplinger: ${kiplingerNews.length > 0}, Fox: ${foxNews.length > 0}, SeekingAlpha: ${seekingAlphaNews.length > 0}, YahooRSS: ${yahooRssNews.length > 0}, InvestingAPI: ${investingComNews.length > 0}, PublicAPI: ${publicApiNews.length > 0}`);
        
        let allNews = [
            ...(cnbcNews.length > 0 ? cnbcNews : []),
            ...(kiplingerNews.length > 0 ? kiplingerNews : []),
            ...(foxNews.length > 0 ? foxNews : []),
            ...(seekingAlphaNews.length > 0 ? seekingAlphaNews : []),
            ...(yahooRssNews.length > 0 ? yahooRssNews : []),
            ...(investingComNews.length > 0 ? investingComNews : []),
            ...(publicApiNews.length > 0 ? publicApiNews : [])
        ];
        
        const uniqueHeadlines = [];
        allNews = allNews.filter(item => {
            const normalizedHeadline = item.headline.toLowerCase()
                .replace(/\b(the|a|an|and|in|on|at|to|for|with|by|of|from)\b/g, '')
                .replace(/[^\w\s]/g, '')
                .trim();
            
            for (const existingHeadline of uniqueHeadlines) {
                if (isSimilarText(normalizedHeadline, existingHeadline)) {
                    return false;
                }
            }
            
            uniqueHeadlines.push(normalizedHeadline);
            return true;
        });
        
        allNews.sort((a, b) => a.source.localeCompare(b.source));
        
        const maxNewsItems = 5;
        const sourcesIncluded = new Set();
        const priorityNews = [];
        
        for (const item of allNews) {
            if (!sourcesIncluded.has(item.source)) {
                priorityNews.push(item);
                sourcesIncluded.add(item.source);
                
                if (priorityNews.length >= maxNewsItems) {
                    break;
                }
            }
        }
        
        if (priorityNews.length < maxNewsItems) {
            const remainingNews = allNews.filter(item => 
                !priorityNews.some(p => p.headline === item.headline && p.source === item.source)
            );
            
            priorityNews.push(...remainingNews.slice(0, maxNewsItems - priorityNews.length));
        }
        
        allNews = priorityNews;
        
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

// Create news embed with proper length limits
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

        for (let i = 0; i < news.length; i++) {
            const item = news[i];
            const itemText = `${i + 1}. [${item.headline}](${item.link}) - *${item.source}*\n\n`;

            if (newsText.length + itemText.length > 950) {
                newsText += `*Additional news items available...*`;
                break;
            }

            newsText += itemText;
        }

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
            const coinText = `**${coin.name} (${coin.symbol})**: ${coin.price} | ${changeSymbol} ${coin.change24h}\n`;

            if (cryptoText.length + coinText.length < 950) {
                cryptoText += coinText;
            }
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
