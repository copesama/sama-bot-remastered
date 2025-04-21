const axios = require('axios');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const shortid = require('shortid');
const { EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');

// Keep track of active voice connections and players (moved from server.js)
const voiceConnections = new Map();
const audioPlayers = new Map();

// Function to generate music using Segmind API
async function generateMusic(prompt, lyrics = null, songFileUrl = null) {
  try {
    const formData = new FormData();
    
    // Check if the prompt contains lyrics or if separate lyrics were provided
    const extractedLyrics = lyrics || prompt.includes('[verse]') ? prompt : null;
    const musicPrompt = extractedLyrics ? "Generate music for these lyrics" : prompt;
    
    // For logging purposes - store what we're sending to the API
    const requestParams = {};
    
    // Set up form data for the request - properly handle null values
    if (extractedLyrics) {
      formData.append('lyrics', extractedLyrics);
      requestParams.lyrics = extractedLyrics;
    } else {
      // Use a template for lyrics based on the prompt
      const defaultLyrics = `[verse]\n${prompt}`;
      formData.append('lyrics', defaultLyrics);
      requestParams.lyrics = defaultLyrics;
    }
    
    // Add required parameters with proper values
    formData.append('bitrate', '256000');
    requestParams.bitrate = '256000';
    
    formData.append('sample_rate', '44100');
    requestParams.sample_rate = '44100';
    
    // Use the provided song file URL or default
    const songFile = songFileUrl || 'https://replicate.delivery/pbxt/M9zum1Y6qujy02jeigHTJzn0lBTQOemB7OkH5XmmPSC5OUoO/MiniMax-Electronic.wav';
    formData.append('song_file', songFile);
    requestParams.song_file = songFile;
    
    // Log parameters
    console.log('Sending music generation request with parameters:', requestParams);

    const response = await axios.post(
      'https://api.segmind.com/v1/minimax-music-01',
      formData,
      {
        headers: {
          'x-api-key': process.env.SEGMIND_API_KEY,
          ...formData.getHeaders()
        },
        responseType: 'arraybuffer', // Important for receiving binary audio data
        validateStatus: false, // Allow non-2xx responses for better error handling
        timeout: 120000 // 2 minute timeout for long music generation
      }
    );

    // Check if response contains an error
    if (response.status !== 200) {
      let errorMessage;
      try {
        errorMessage = Buffer.from(response.data).toString('utf8');
        console.error('Music API error response:', errorMessage);
        
        // Try to parse as JSON for better error messaging
        try {
          const jsonError = JSON.parse(errorMessage);
          if (jsonError.error) {
            errorMessage = jsonError.error;
          }
        } catch (e) {
          // If it's not valid JSON, keep the original error message
        }
        
      } catch (e) {
        errorMessage = `HTTP status ${response.status}`;
      }
      throw new Error(`Music generation failed: ${errorMessage}`);
    }

    // Generate unique ID for the music file
    const musicId = shortid.generate();
    const musicPath = path.join(process.cwd(), 'music', `${musicId}.mp3`);

    // Save the music file
    fs.writeFileSync(musicPath, Buffer.from(response.data));
    console.log(`Music file saved to ${musicPath}`);

    return { musicId, musicPath };
  } catch (error) {
    console.error('Error generating music:', error);
    
    if (error.response) {
      console.error('Error status:', error.response.status);
      try {
        const errorData = Buffer.from(error.response.data).toString('utf8');
        console.error('API error response:', errorData);
      } catch (e) {
        console.error('Could not parse error response data');
      }
    }
    
    // Add more detailed error for timeouts
    if (error.code === 'ECONNABORTED') {
      throw new Error('Music generation timed out. The server took too long to respond.');
    }
    
    throw error;
  }
}

// Function to play music in a voice channel
async function playMusicInVoiceChannel(voiceChannel, musicPath) {
  try {
    // Create a voice connection
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    
    // Create an audio player
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });
    
    // Create an audio resource from the generated file
    const resource = createAudioResource(musicPath);
    
    // Play the audio
    player.play(resource);
    connection.subscribe(player);
    
    // Store the connection and player for cleanup later
    voiceConnections.set(voiceChannel.guild.id, connection);
    audioPlayers.set(voiceChannel.guild.id, player);
    
    // Return a Promise that resolves when audio finishes or rejects on error
    return new Promise((resolve, reject) => {
      // Handle when audio finishes playing
      player.on(AudioPlayerStatus.Idle, () => {
        // Disconnect after playing
        connection.destroy();
        voiceConnections.delete(voiceChannel.guild.id);
        audioPlayers.delete(voiceChannel.guild.id);
        
        // Clean up the file
        try {
          fs.unlinkSync(musicPath);
          console.log(`Deleted music file: ${musicPath}`);
        } catch (err) {
          console.error(`Error deleting music file: ${err}`);
        }
        
        resolve();
      });
      
      // Add error handling for player errors
      player.on('error', error => {
        console.error(`Error playing audio: ${error.message}`);
        connection.destroy();
        voiceConnections.delete(voiceChannel.guild.id);
        audioPlayers.delete(voiceChannel.guild.id);
        
        // Clean up the file
        try {
          fs.unlinkSync(musicPath);
          console.log(`Deleted music file (after error): ${musicPath}`);
        } catch (err) {
          console.error(`Error deleting music file: ${err}`);
        }
        
        reject(error);
      });
    });
  } catch (error) {
    console.error('Error connecting to voice channel:', error);
    throw error;
  }
}

// Main handler function for the !createmusic command
async function handleMusicCommand(message) {
  const fullContent = message.content.slice('!createmusic'.length).trim();
  
  // Check if there are lyrics in the format "[lyrics] ... [/lyrics]"
  let prompt, lyrics;
  const lyricsMatch = fullContent.match(/\[lyrics\]([\s\S]*?)\[\/lyrics\]/);
  
  if (lyricsMatch) {
    // Extract lyrics from the special format
    lyrics = lyricsMatch[1].trim();
    // Get the remaining text as the prompt
    prompt = fullContent.replace(/\[lyrics\][\s\S]*?\[\/lyrics\]/, '').trim();
    if (!prompt) prompt = "Generate music for these lyrics";
  } else {
    prompt = fullContent;
    lyrics = null;
  }
  
  if (!prompt) {
    return message.reply('Please provide a prompt for the music. Examples:\n- `!createmusic upbeat jazz with piano solo`\n- `!createmusic [lyrics]In the silence, I hear your name\nEchoes of love that still remain[/lyrics] soft piano ballad`\n- Attach an audio file with your command to use it as a base for music generation');
  }
  
  // Check if user is in a voice channel
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    return message.reply('You need to join a voice channel first!');
  }
  
  // Check if a file is attached to the message
  let songFileUrl = 'https://replicate.delivery/pbxt/M9zum1Y6qujy02jeigHTJzn0lBTQOemB7OkH5XmmPSC5OUoO/MiniMax-Electronic.wav';
  const hasAttachment = message.attachments.size > 0;
  
  if (hasAttachment) {
    const attachment = message.attachments.first();
    // Check if the attachment is an audio file
    const isAudio = attachment.contentType && attachment.contentType.startsWith('audio/');
    
    if (isAudio) {
      songFileUrl = attachment.url;
      console.log(`Using user-provided song file: ${songFileUrl}`);
    } else {
      await message.reply('The attached file is not recognized as an audio file. Using the default sample instead.');
    }
  }
  
  // Send initial response with better messaging about timing
  const loadingMessage = await message.reply(`🎵 Generating your custom music track${hasAttachment ? ' using your audio file' : ''}... This might take 1-2 minutes. Please be patient!`);
  
  try {
    // Generate the music with the song file URL (default or from attachment)
    const { musicId, musicPath } = await generateMusic(prompt, lyrics, songFileUrl);
    
    // Create an embed with the music information
    const musicEmbed = new EmbedBuilder()
      .setColor('#9966ff')
      .setTitle('🎵 Your Custom Music Track is Ready!')
      .setDescription(`**Music prompt:** ${prompt}${lyrics ? '\n\n**With custom lyrics**' : ''}${hasAttachment ? '\n\n**Using your provided audio file**' : ''}`)
      .setFooter({ text: 'Generated using AI • Now playing in your voice channel' })
      .setTimestamp();
    
    // Edit the loading message and attach the music file
    await loadingMessage.edit({ content: 'Music created successfully!', embeds: [musicEmbed], files: [musicPath] });
    
    // Play the music in the voice channel
    try {
      await playMusicInVoiceChannel(voiceChannel, musicPath);
    } catch (voiceError) {
      console.error('Error playing music in voice channel:', voiceError);
      message.channel.send('Failed to play the music in your voice channel. Please check permissions or try again later.');
      
      // Ensure file cleanup if voice playback fails
      setTimeout(() => {
        try {
          fs.unlinkSync(musicPath);
          console.log(`Deleted music file (voice error): ${musicPath}`);
        } catch (err) {
          console.error(`Error deleting music file: ${err}`);
        }
      }, 10000); // 10 seconds delay
    }
    
  } catch (error) {
    console.error('Error generating music:', error);
    
    // Provide more helpful error message to the user
    let errorMessage = 'Sorry, there was an error generating your music. Please try again later.';
    
    if (error.message.includes('timed out')) {
      errorMessage = 'Sorry, music generation timed out. Please try a simpler prompt or try again later.';
    } else if (error.message.includes('vocal_id null not found')) {
      errorMessage = 'Sorry, there was an issue with the music generation service. Please try a different prompt.';
    }
    
    await loadingMessage.edit(errorMessage);
  }
}

// Function for cleanup
function cleanupVoiceConnections() {
  voiceConnections.forEach(connection => {
    connection.destroy();
  });
}

module.exports = {
  handleMusicCommand,
  cleanupVoiceConnections
};
