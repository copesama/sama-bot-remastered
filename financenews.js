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

// Scrape MSN Money for financial news
async function getMSNMoneyNews() {
    try {
        console.log('Fetching MSN Money news...');
        const response = await axios.get('https://www.msn.com/en-us/money/markets', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('.cardContainer, .card, article').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('.title, h3, .cardText');
                const headline = cleanText(headlineElement.text());

                let link;
                const cardLink = $(element).find('a').attr('href');

                if (cardLink) {
                    if (cardLink.startsWith('/')) {
                        link = 'https://www.msn.com' + cardLink;
                    } else {
                        link = cardLink;
                    }
                }

                if (headline && link && headline.length > 15) {
                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'MSN Money'
                    });
                }
            } catch (err) {
                console.error('Error processing MSN Money item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} MSN Money news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping MSN Money:', error.message);
        return [];
    }
}

// Scrape MarketWatch for top headlines
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
                const headline = cleanText(headlineElement.text());

                const linkElement = $(element).find('a').first();
                let link = linkElement.attr('href');

                if (!link && $(element).is('a')) {
                    link = $(element).attr('href');
                }

                if (headline && link && headline.length > 15) {
                    if (link && !link.startsWith('http')) {
                        link = 'https://www.marketwatch.com' + link;
                    }

                    newsItems.push({
                        headline: headline.substring(0, 80),
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

// Scrape The Street for financial news
async function getTheStreetNews() {
    try {
        console.log('Fetching The Street financial news...');
        const response = await axios.get('https://www.thestreet.com/', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('article, .news-story').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('h3, .news-title');
                const headline = cleanText(headlineElement.text());

                let link = $(element).find('a').attr('href');

                if (headline && link && headline.length > 15) {
                    if (link && link.startsWith('/')) {
                        link = 'https://www.thestreet.com' + link;
                    }

                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'The Street'
                    });
                }
            } catch (err) {
                console.error('Error processing The Street item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} The Street news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping The Street:', error.message);
        return [];
    }
}

// Get news directly from Business Insider
async function getBusinessInsiderNews() {
    try {
        console.log('Fetching Business Insider news...');
        const response = await axios.get('https://www.businessinsider.com/markets', {
            headers: browserHeaders,
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const newsItems = [];

        $('.top-vertical-trio-item, article, .tout-title-link').slice(0, 10).each((index, element) => {
            try {
                const headlineElement = $(element).find('h2, h3, .tout-title, a');
                const headline = cleanText(headlineElement.text());

                let link;
                if ($(element).is('a')) {
                    link = $(element).attr('href');
                } else {
                    link = $(element).find('a').attr('href');
                }

                if (headline && link && headline.length > 15) {
                    if (link && link.startsWith('/')) {
                        link = 'https://www.businessinsider.com' + link;
                    }

                    newsItems.push({
                        headline: headline.substring(0, 80),
                        link,
                        source: 'Business Insider'
                    });
                }
            } catch (err) {
                console.error('Error processing Business Insider item:', err.message);
            }
        });

        console.log(`Found ${newsItems.length} Business Insider news items`);
        return newsItems;
    } catch (error) {
        console.error('Error scraping Business Insider:', error.message);
        return [];
    }
}

// Get news from Kiplinger
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
    } catch (coinGeckoError) {
        console.error('Error fetching crypto data from CoinGecko:', coinGeckoError.message);

        try {
            console.log('Trying fallback to CoinCap API...');
            const fallbackResponse = await axios.get('https://api.coincap.io/v2/assets?limit=5', {
                timeout: 10000
            });

            return fallbackResponse.data.data.map(coin => ({
                name: coin.name,
                symbol: coin.symbol,
                price: `$${parseFloat(coin.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                change24h: `${parseFloat(coin.changePercent24Hr).toFixed(2)}%`,
                marketCap: `$${(parseFloat(coin.marketCapUsd) / 1000000000).toFixed(2)}B`,
                positive: parseFloat(coin.changePercent24Hr) > 0
            }));
        } catch (coincapError) {
            console.error('Error with crypto fallback API:', coincapError.message);

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
}

// Combine news from all sources
async function getAllFinanceNews() {
    try {
        const results = await Promise.allSettled([
            getMSNMoneyNews(),
            getMarketWatchNews(),
            getCNBCNews(),
            getTheStreetNews(),
            getBusinessInsiderNews(),
            getKiplingerNews(),
            getCryptoMarketData()
        ]);

        const msnNews = results[0].status === 'fulfilled' ? results[0].value : [];
        const marketWatchNews = results[1].status === 'fulfilled' ? results[1].value : [];
        const cnbcNews = results[2].status === 'fulfilled' ? results[2].value : [];
        const theStreetNews = results[3].status === 'fulfilled' ? results[3].value : [];
        const businessInsiderNews = results[4].status === 'fulfilled' ? results[4].value : [];
        const kiplingerNews = results[5].status === 'fulfilled' ? results[5].value : [];
        const cryptoData = results[6].status === 'fulfilled' ? results[6].value : [];

        console.log(`News source success: MSN: ${msnNews.length > 0}, MarketWatch: ${marketWatchNews.length > 0}, CNBC: ${cnbcNews.length > 0}, TheStreet: ${theStreetNews.length > 0}, BusinessInsider: ${businessInsiderNews.length > 0}, Kiplinger: ${kiplingerNews.length > 0}`);

        let allNews = [
            ...(msnNews.length > 0 ? msnNews : []),
            ...(marketWatchNews.length > 0 ? marketWatchNews : []),
            ...(cnbcNews.length > 0 ? cnbcNews : []),
            ...(theStreetNews.length > 0 ? theStreetNews : []),
            ...(businessInsiderNews.length > 0 ? businessInsiderNews : []),
            ...(kiplingerNews.length > 0 ? kiplingerNews : [])
        ];

        const uniqueHeadlines = new Set();
        allNews = allNews.filter(item => {
            const normalizedHeadline = item.headline.toLowerCase()
                .replace(/\b(the|a|an|and|in|on|at|to|for|with|by|of|from)\b/g, '')
                .replace(/[^\w\s]/g, '')
                .trim();

            if (uniqueHeadlines.has(normalizedHeadline)) {
                return false;
            }
            uniqueHeadlines.add(normalizedHeadline);
            return true;
        });

        allNews = allNews.sort(() => 0.5 - Math.random());
        allNews = allNews.slice(0, 5);

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
