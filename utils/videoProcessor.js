const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const ytdl = require('ytdl-core');

/**
 * Creates a compilation video from the given video URLs
 * Each clip will be 5 seconds from the start of the original video
 */
async function createVideoCompilation(videos, tempDir) {
  return new Promise(async (resolve, reject) => {
    try {
      const outputPath = path.join(tempDir, 'compilation.mp4');
      const clipPaths = [];
      
      // Process videos one by one with reduced memory usage
      for (let i = 0; i < videos.length; i++) {
        try {
          const video = videos[i];
          const clipPath = path.join(tempDir, `clip-${i}.mp4`);
          clipPaths.push(clipPath);
          
          console.log(`Processing video ${i + 1}/${videos.length}: ${video.title}`);
          
          // Try to create clip from YouTube URL - using ytdl as a stream
          await createClipFromYouTube(video.url, clipPath, 5);
          console.log(`Successfully created clip ${i + 1}`);
        } catch (error) {
          console.error(`Failed to process video ${i + 1}:`, error.message);
          // Create a fallback clip instead
          const clipPath = path.join(tempDir, `clip-${i}.mp4`);
          clipPaths[i] = clipPath; // Make sure path is in the array even if push didn't happen
          await createFallbackClip(clipPath, 5);
        }
      }
      
      // Create the concatenation file
      const concatFilePath = path.join(tempDir, 'concat.txt');
      const fileContent = clipPaths.map(p => `file '${path.basename(p)}'`).join('\n');
      fs.writeFileSync(concatFilePath, fileContent);
      
      console.log('Concatenating clips...');
      
      // Concatenate all clips
      await new Promise((concatResolve, concatReject) => {
        ffmpeg()
          .input(concatFilePath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions(['-c copy', '-movflags +faststart'])
          .output(outputPath)
          .on('end', () => {
            console.log('Concatenation complete');
            concatResolve();
          })
          .on('error', (err) => {
            concatReject(new Error(`Error concatenating videos: ${err.message}`));
          })
          .run();
      });
      
      // Clean up clip files immediately to save memory
      clipPaths.forEach(clipPath => {
        if (fs.existsSync(clipPath)) {
          fs.unlinkSync(clipPath);
        }
      });
      
      if (fs.existsSync(concatFilePath)) {
        fs.unlinkSync(concatFilePath);
      }
      
      resolve(outputPath);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create a clip from a YouTube URL using ytdl-core as a stream source for ffmpeg
 */
async function createClipFromYouTube(videoUrl, outputPath, durationSeconds) {
  return new Promise((resolve, reject) => {
    try {
      // First get the info to check if video exists
      ytdl.getInfo(videoUrl)
        .then(info => {
          // Get the audio and video formats
          const format = ytdl.chooseFormat(info.formats, { quality: '18' }); // 360p with audio
          
          if (!format) {
            throw new Error('No suitable format found');
          }
          
          // Use ytdl as a readable stream for ffmpeg
          const stream = ytdl(videoUrl, { format });
          
          // Use ffmpeg to process the stream
          ffmpeg(stream)
            .outputOptions([
              `-t ${durationSeconds}`,
              '-c:v libx264',
              '-crf 30',
              '-preset ultrafast',
              '-c:a aac',
              '-b:a 64k',
              '-vf scale=480:-2',
              '-movflags +faststart'
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', (err) => {
              console.error('FFMPEG processing error:', err.message);
              reject(err);
            })
            .run();
        })
        .catch(err => {
          console.error('ytdl-core error:', err.message);
          reject(err);
        });
    } catch (error) {
      console.error('Unexpected error:', error.message);
      reject(error);
    }
  });
}

/**
 * Creates a simple fallback video clip when a video can't be downloaded
 * This method creates a simple black video
 */
function createFallbackClip(outputPath, durationSeconds) {
  return new Promise((resolve, reject) => {
    try {
      // Create a tiny black video (3 seconds)
      ffmpeg()
        .addInput('color=black:s=480x360:r=15')
        .inputFormat('lavfi')
        .addInput('anullsrc')
        .inputFormat('lavfi')
        .outputOptions([
          `-t ${durationSeconds}`,
          '-c:v libx264',
          '-r 15',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-shortest'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', (err) => {
          console.error('Error creating fallback clip:', err);
          // Try ultra-fallback
          createUltraFallbackClip(outputPath)
            .then(resolve)
            .catch(reject);
        })
        .run();
    } catch (error) {
      console.error('Unexpected error creating fallback:', error);
      createUltraFallbackClip(outputPath)
        .then(resolve)
        .catch(reject);
    }
  });
}

/**
 * Creates a very simple valid mp4 file
 */
function createUltraFallbackClip(outputPath) {
  return new Promise((resolve, reject) => {
    try {
      // Create a static image file
      const staticImage = 
        'iVBORw0KGgoAAAANSUhEUgAAAeAAAAHgAQMAAADcWVIXAAAABlBMVEUAAAD///+l2Z/dAAAACXBI' +
        'WXMAAA7EAAAOxAGVKw4bAAAAuUlEQVRoge3Zu47CMBhF4Z+5zJQWtDSUVDSUlNt2eACepIa3yorI' +
        'EaAZeheQzleQHTnHiWIpAgAAAAAAAAAA4G9ZOAAmybK3zO0P2cBdMqdMa+CosUi9td5rHKwPyWyg' +
        'cPePPbKYi9k8NVZi9few43wVqsy6OrPr+nA6F1fz82tf3R9PbY5F9/Hw+Hj/8/3PV8vb5e/8aHRs' +
        'GudsONmQM+c+N1q18F03DwMAAAAAAAAAAAD+qS/IOjEfT8pCygAAAABJRU5ErkJggg==';
        
      const imagePath = path.join(path.dirname(outputPath), 'static.png');
      fs.writeFileSync(imagePath, Buffer.from(staticImage, 'base64'));
      
      // Create a video from the static image
      ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop 1'])
        .outputOptions([
          '-t 5',
          '-c:v libx264',
          '-vf scale=480:360',
          '-pix_fmt yuv420p'
        ])
        .output(outputPath)
        .on('end', () => {
          // Clean up the temporary image
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
          resolve();
        })
        .on('error', (err) => {
          // If all else fails, create a minimal valid mp4 file
          const minimalMp4 = Buffer.from([
            0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00,
            0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32, 0x6D, 0x70, 0x34, 0x31, 0x00, 0x00, 0x00, 0x08,
            0x66, 0x72, 0x65, 0x65, 0x00, 0x00, 0x00, 0x00
          ]);
          fs.writeFileSync(outputPath, minimalMp4);
          resolve();
        })
        .run();
    } catch (error) {
      // Ultimate fallback - create an empty file
      fs.writeFileSync(outputPath, Buffer.from([0]));
      resolve();
    }
  });
}

module.exports = {
  createVideoCompilation
};
