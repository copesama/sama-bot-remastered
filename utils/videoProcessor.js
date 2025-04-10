const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Creates a compilation video from the given video files
 * Each clip will be 5 seconds from the start of the original video
 */
async function createVideoCompilation(videos, tempDir) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(tempDir, 'compilation.mp4');
    const clipPaths = [];
    
    // Process each video to create 5-second clips
    const processClips = async () => {
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const clipPath = path.join(tempDir, `clip-${i}.mp4`);
        clipPaths.push(clipPath);
        
        await new Promise((clipResolve, clipReject) => {
          ffmpeg(video.localPath)
            .setStartTime(0)
            .setDuration(5)
            .output(clipPath)
            .on('end', clipResolve)
            .on('error', clipReject)
            .run();
        });
      }
    };
    
    // Create the concatenation file
    const createConcatFile = () => {
      const concatFilePath = path.join(tempDir, 'concat.txt');
      const fileContent = clipPaths.map(p => `file '${p}'`).join('\n');
      fs.writeFileSync(concatFilePath, fileContent);
      return concatFilePath;
    };
    
    // Main process
    processClips()
      .then(() => {
        const concatFilePath = createConcatFile();
        
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
      })
      .catch(reject);
  });
}

module.exports = {
  createVideoCompilation
};
