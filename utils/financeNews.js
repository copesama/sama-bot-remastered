const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Fetches financial news headlines from CNBC
 * @returns {Promise<Array>} Array of news headline objects with title and link
 */
async function fetchCNBCNews() {
  try {
    // Fetch the CNBC homepage content
    const response = await axios.get('https://www.cnbc.com/');
    const html = response.data;
    
    // Load HTML into cheerio
    const $ = cheerio.load(html);
    const headlines = [];
    
    // Target the headline cards that appear on the CNBC homepage
    // Adjust selector based on CNBC's current page structure
    $('.Card-titleContainer .Card-title').each((index, element) => {
      const title = $(element).text().trim();
      let link = $(element).closest('a').attr('href');
      
      // Only process non-empty headlines
      if (title && title.length > 0) {
        // Ensure link is an absolute URL
        if (link && !link.startsWith('http')) {
          link = `https://www.cnbc.com${link}`;
        }
        
        headlines.push({
          title: title,
          link: link || null
        });
      }
    });
    
    // Get additional headlines from the "Latest News" section if available
    $('.LatestNews-headline').each((index, element) => {
      const title = $(element).text().trim();
      let link = $(element).closest('a').attr('href');
      
      if (title && title.length > 0) {
        if (link && !link.startsWith('http')) {
          link = `https://www.cnbc.com${link}`;
        }
        
        headlines.push({
          title: title,
          link: link || null
        });
      }
    });
    
    // Filter out duplicates by title
    const uniqueHeadlines = Array.from(
      new Map(headlines.map(item => [item.title, item])).values()
    );
    
    // Limit to top 15 headlines to prevent excessive message length
    return uniqueHeadlines.slice(0, 15);
  } catch (error) {
    console.error('Error fetching CNBC news:', error);
    throw new Error('Failed to fetch finance news from CNBC');
  }
}

module.exports = { fetchCNBCNews };
