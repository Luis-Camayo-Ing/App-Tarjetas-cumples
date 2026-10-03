// server.js
// Lightweight Express server using a JSON file as storage (no native modules required)
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Try to use ffmpeg-static for local FFmpeg binary
let ffmpegPath = null;
try {
  const ffmpegStatic = require('ffmpeg-static');
  ffmpegPath = ffmpegStatic;
  console.log('FFmpeg found at:', ffmpegPath);
} catch (e) {
  console.log('ffmpeg-static not available, will try system FFmpeg');
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'image/*', limit: '10mb' }));
app.use(express.raw({ type: 'audio/*', limit: '10mb' }));

// Serve the static frontend (index.html, assets) so hitting http://localhost:3000 works
app.use(express.static(__dirname));

const dbFile = path.join(__dirname, 'data', 'app.json');

function loadDB() {
  if (!fs.existsSync(dbFile)) return { phrases: [], templates: [], fields: [], events: [] };
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch (err) {
    console.error('Failed to read DB file, using empty DB', err);
    return { phrases: [], templates: [], fields: [], events: [] };
  }
}

function saveDB(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(items) {
  if (!items || items.length === 0) return 1;
  return Math.max(...items.map(i => i.id || 0)) + 1;
}

app.post('/api/phrase', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const db = loadDB();
  const id = nextId(db.phrases);
  const item = { id, text, created_at: new Date().toISOString() };
  db.phrases.push(item);
  saveDB(db);
  res.json({ id });
});

app.post('/api/event', (req, res) => {
  const { type, payload } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  const db = loadDB();
  const id = nextId(db.events);
  const item = { id, type, payload: payload || null, created_at: new Date().toISOString() };
  db.events.push(item);
  saveDB(db);
  res.json({ id });
});

app.post('/api/template', (req, res) => {
  const { name, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data required' });
  const db = loadDB();
  const id = nextId(db.templates);
  const item = { id, name: name || null, data, created_at: new Date().toISOString() };
  db.templates.push(item);
  saveDB(db);
  res.json({ id });
});

app.post('/api/field', (req, res) => {
  const { name, x, y, size_ratio } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = loadDB();
  const id = nextId(db.fields);
  const item = { id, name, x: x || null, y: y || null, size_ratio: size_ratio || null, created_at: new Date().toISOString() };
  db.fields.push(item);
  saveDB(db);
  res.json({ id });
});

app.get('/api/phrases', (req, res) => {
  const db = loadDB();
  const rows = (db.phrases || []).slice(-200).reverse();
  res.json(rows);
});

// Endpoint to generate video from image + audio
app.post('/api/generate-video', async (req, res) => {
  try {
    const { imageDataUrl, audioDataUrl } = req.body;
    
    if (!imageDataUrl || !audioDataUrl) {
      return res.status(400).json({ error: 'imageDataUrl and audioDataUrl required' });
    }

    // Create temp directory
    const tempDir = path.join(os.tmpdir(), 'idarraga-video-' + Date.now());
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    try {
      // Extract base64 and save image
      const imageBase64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const imagePath = path.join(tempDir, 'image.jpg');
      fs.writeFileSync(imagePath, imageBuffer);
      
      // Extract base64 and save audio
      const audioBase64 = audioDataUrl.includes(',') ? audioDataUrl.split(',')[1] : audioDataUrl;
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const audioPath = path.join(tempDir, 'audio.mp3');
      fs.writeFileSync(audioPath, audioBuffer);
      
      const outputPath = path.join(tempDir, 'output.mp4');
      
      // Use child_process to run ffmpeg directly with proper command
      const { spawn } = require('child_process');
      
      const ffmpegCmd = ffmpegPath || 'ffmpeg';
      
      return new Promise((resolve) => {
        // FFmpeg command with proper scale filter to ensure dimensions are divisible by 2
        const ffmpeg = spawn(ffmpegCmd, [
          '-loop', '1',                           // Loop the image
          '-i', imagePath,                        // Input image
          '-i', audioPath,                        // Input audio
          '-c:v', 'libx264',                      // Video codec
          '-c:a', 'aac',                          // Audio codec
          '-b:a', '192k',                         // Audio bitrate
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',  // Ensure dimensions divisible by 2
          '-pix_fmt', 'yuv420p',                  // Pixel format
          '-shortest',                            // Stop when shortest input ends
          '-preset', 'ultrafast',                 // Fast encoding
          '-y',                                   // Overwrite output
          outputPath                              // Output file
        ]);
        
        let ffmpegOutput = '';
        let ffmpegError = '';
        
        ffmpeg.stdout.on('data', (data) => {
          ffmpegOutput += data.toString();
        });
        
        ffmpeg.stderr.on('data', (data) => {
          ffmpegError += data.toString();
          console.log('FFmpeg progress:', data.toString().substring(0, 100));
        });
        
        ffmpeg.on('close', (code) => {
          console.log('FFmpeg exited with code:', code);
          
          if (code === 0 && fs.existsSync(outputPath)) {
            try {
              // Read the video file
              const videoBuffer = fs.readFileSync(outputPath);
              const videoBase64 = videoBuffer.toString('base64');
              
              // Cleanup
              fs.rmSync(tempDir, { recursive: true, force: true });
              
              res.json({ 
                success: true, 
                video: 'data:video/mp4;base64,' + videoBase64 
              });
              resolve();
            } catch (err) {
              console.error('Error reading output:', err);
              // Cleanup and return fallback
              try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
              res.json({
                success: true,
                image: imageDataUrl,
                audio: audioDataUrl,
                message: 'Could not read video output. Image and audio provided separately.'
              });
              resolve();
            }
          } else {
            console.error('FFmpeg failed. Code:', code);
            
            // Cleanup and return fallback
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
            res.json({
              success: true,
              image: imageDataUrl,
              audio: audioDataUrl,
              message: 'FFmpeg error. Image and audio provided separately.'
            });
            resolve();
          }
        });
        
        ffmpeg.on('error', (err) => {
          console.error('FFmpeg process error:', err);
          // Cleanup and return fallback
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
          res.json({
            success: true,
            image: imageDataUrl,
            audio: audioDataUrl,
            message: 'FFmpeg not available. Image and audio provided separately.'
          });
          resolve();
        });
      });
    } catch (err) {
      console.error('File write/read error:', err);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
      res.json({
        success: true,
        image: imageDataUrl,
        audio: audioDataUrl,
        message: 'File error. Image and audio provided separately.'
      });
    }
  } catch (err) {
    console.error('Video generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
