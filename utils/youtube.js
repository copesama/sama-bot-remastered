const YouTube = require('youtube-sr').default;
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Extract channel ID or name from YouTube channel URL
 */
function extractChannelIdentifier(channelUrl) {
  // Remove trailing slash if exists
  channelUrl = channelUrl.replace(/\/$/, '');
  
  // Handle different URL formats
  if (channelUrl.includes('/channel/')) {
    return channelUrl.split('/channel/')[1].split('/')[0];
  } else if (channelUrl.includes('/c/')) {
    return channelUrl.split('/c/')[1].split('/')[0];
  } else if (channelUrl.includes('/user/')) {
    return channelUrl.split('/user/')[1].split('/')[0];
  } else if (channelUrl.includes('@')) {
    return channelUrl.split('/').filter(part => part.startsWith('@'))[0];
  } else {
    throw new Error('Invalid YouTube channel URL format');
  }
}

/**
 * Try to download a video using an alternative method if ytdl-core fails
 */
async function downloadVideo(videoUrl, outputPath) {
  try {
    // First try with ytdl-core
    await new Promise((resolve, reject) => {
      const stream = ytdl(videoUrl, { 
        quality: 'lowest',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        }
      })
      .pipe(fs.createWriteStream(outputPath));
      
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  } catch (error) {
    console.log(`ytdl-core failed, falling back to alternative method: ${error.message}`);
    
    // If ytdl fails due to 410 Gone or other errors, we'll just return the URL without downloading
    // The video processor will handle it differently
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

/**
 * Sample random videos from a YouTube channel
 */
async function sampleYouTubeChannel(channelUrl, count = 5) {
  try {
    const channelIdentifier = extractChannelIdentifier(channelUrl);
    
    // Search for the channel first
    const searchResults = await YouTube.search(channelIdentifier, {
      type: 'channel',
      limit: 1
    });
    
    if (!searchResults || searchResults.length === 0) {
      throw new Error('Channel not found');
    }
    
    const channelInfo = searchResults[0];
    
    // Get videos from channel
    let videos = await YouTube.search(`${channelInfo.name}`, {
      limit: 100,
      type: 'video',
      channelID: channelInfo.id
    });
    
    if (videos.length < count) {
      throw new Error(`Channel only has ${videos.length} videos, needed ${count}`);
    }
    
    // Randomly sample videos
    const sampledVideos = [];
    const videosCopy = [...videos];
    
    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * videosCopy.length);
      const selectedVideo = videosCopy.splice(randomIndex, 1)[0];
      sampledVideos.push({
        id: selectedVideo.id,
        title: selectedVideo.title,
        url: `https://www.youtube.com/watch?v=${selectedVideo.id}`,
        duration: selectedVideo.duration || 60 // fallback duration if not provided
      });
    }
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    // Instead of downloading, we'll just return the video info
    // The video processor will handle the download or streaming
    return sampledVideos;
  } catch (error) {
    throw new Error(`Failed to sample YouTube channel: ${error.message}`);
  }
}

module.exports = {
  sampleYouTubeChannel
};
