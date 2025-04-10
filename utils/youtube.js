const YouTube = require('youtube-sr').default;
const fs = require('fs');
const path = require('path');

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
    console.log(`Found channel: ${channelInfo.name}`);
    
    // Get videos from channel
    let videos = await YouTube.search(`${channelInfo.name}`, {
      limit: 100,
      type: 'video',
      channelID: channelInfo.id
    });
    
    console.log(`Found ${videos.length} videos in channel`);
    
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
    
    return sampledVideos;
  } catch (error) {
    throw new Error(`Failed to sample YouTube channel: ${error.message}`);
  }
}

module.exports = {
  sampleYouTubeChannel
};
