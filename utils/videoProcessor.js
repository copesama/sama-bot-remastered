const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/**
 * Creates a compilation video from the given video URLs
 * Each clip will be 5 seconds from the start of the original video
 */
async function createVideoCompilation(videos, tempDir) {
  return new Promise(async (resolve, reject) => {
    try {
      const outputPath = path.join(tempDir, 'compilation.mp4');
      const clipPaths = [];
      
      // Process each video URL directly to create 5-second clips
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const clipPath = path.join(tempDir, `clip-${i}.mp4`);
        clipPaths.push(clipPath);
        
        await new Promise((clipResolve, clipReject) => {
          // Use ffmpeg to download a segment directly from YouTube
          const ffmpegProcess = ffmpeg()
            .input(video.url)
            .inputOptions(['-ss 0'])
            .outputOptions([
              '-t 5',
              '-c:v libx264',
              '-crf 30',
              '-preset ultrafast',
              '-c:a aac',
              '-b:a 128k',
              '-vf scale=640:-2'
            ])
            .output(clipPath)
            .on('end', () => {
              console.log(`Clip ${i} created successfully`);
              clipResolve();
            })
            .on('error', (err) => {
              console.error(`Error creating clip ${i}:`, err.message);
              
              // If there's an error, create a silent clip instead
              createSilentClip(clipPath, 5)
                .then(clipResolve)
                .catch(clipReject);
            });
            
          ffmpegProcess.run();
        });
      }
      
      // Create the concatenation file
      const concatFilePath = path.join(tempDir, 'concat.txt');
      const fileContent = clipPaths.map(p => `file '${p}'`).join('\n');
      fs.writeFileSync(concatFilePath, fileContent);
      
      // Concatenate all clips
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions('-c copy')
        .output(outputPath)
        .on('end', () => {
          // Clean up clip files
          clipPaths.forEach(clipPath => {
            if (fs.existsSync(clipPath)) {
              fs.unlinkSync(clipPath);
            }
          });
          fs.unlinkSync(concatFilePath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(new Error(`Error concatenating videos: ${err.message}`));
        })
        .run();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Creates a silent video clip of specified duration
 */
function createSilentClip(outputPath, durationSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('color=c=black:s=640x360:r=30')
      .inputFormat('lavfi')
      .inputOptions(['-f lavfi'])
      .outputOptions([
        `-t ${durationSeconds}`,
        '-c:v libx264',
        '-tune stillimage',
        '-pix_fmt yuv420p'
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = {
  createVideoCompilation
};
