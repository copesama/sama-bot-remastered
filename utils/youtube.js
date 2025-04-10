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
 * Sample a single random video from a YouTube channel
 */
async function sampleYouTubeChannel(channelUrl, count = 1) {
  try {
    const channelIdentifier = extractChannelIdentifier(channelUrl);
    
    console.log(`Searching for channel: ${channelIdentifier}`);
    
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
    
    // Get limited number of videos from channel
    let videos = await YouTube.search(`${channelInfo.name}`, {
      limit: 10, // Very small limit to conserve memory
      type: 'video',
      channelID: channelInfo.id
    });
    
    console.log(`Found ${videos.length} videos in channel`);
    
    if (videos.length === 0) {
      throw new Error('No videos found in channel');
    }
    
    // Get a single random video
    const randomIndex = Math.floor(Math.random() * videos.length);
    const selectedVideo = videos[randomIndex];
    
    // Return as an array with one item
    return [{
      id: selectedVideo.id,
      title: selectedVideo.title,
      url: `https://www.youtube.com/watch?v=${selectedVideo.id}`,
    }];
  } catch (error) {
    throw new Error(`Failed to sample YouTube channel: ${error.message}`);
  }
}

module.exports = {
  sampleYouTubeChannel
};
