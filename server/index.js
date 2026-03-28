const express = require('express');
const cors = require('cors');
const fg = require('fast-glob');
const exifr = require('exifr');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const config = require('./config.json');

const app = express();
app.use(cors());

// Serve the overarching directory where the files are stored
// This allows the frontend to access them via /media/...
app.use('/media', express.static(config.mediaBaseDir));

// Target directories
const targetDirs = config.targetDirs;

// Helper to convert Windows path backslashes to forward slashes for fast-glob
const normalizePath = (p) => p.replace(/\\/g, '/');

const CACHE_FILE = path.join(__dirname, 'catalog-cache.json');

// Ensure thumbnails cache directory exists
const THUMB_CACHE_DIR = path.join(__dirname, 'thumbs');
if (!fs.existsSync(THUMB_CACHE_DIR)) {
  fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
}

// API endpoint to get catalog
app.get('/api/catalog', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';

    // 1. Try to load from cache if not forcing refresh
    if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
      console.log('Serving catalog from cache...');
      let cachedData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      
      // Auto-inject thumbUrl if missing from old cache to ensure thumbnails always work
      if (cachedData.length > 0 && !cachedData[0].thumbUrl) {
          cachedData = cachedData.map(item => ({
              ...item,
              thumbUrl: item.type === 'video' ? item.url : item.url.replace('/media/', '/api/thumb/')
          }));
          // Optionally, re-save the cache so we don't map it every time
          fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedData));
      }
      
      return res.json(cachedData);
    }

    // 🌟 Read config dynamically on every refresh so we don't need to restart the server
    const currentConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

    console.log('Fetching catalog and reading EXIF data (this may take a while)...');
    console.log('Target directories from config:', currentConfig.targetDirs);
    const catalog = [];

    for (const dir of currentConfig.targetDirs) {
      if (!fs.existsSync(dir)) {
        console.warn(`Directory not found: ${dir}`);
        continue;
      }

      const globPattern = normalizePath(path.join(dir, '**/*.{jpg,jpeg,mp4,JPG,JPEG,MP4}'));
      const files = await fg(globPattern, { absolute: true });
      console.log(`Directory: ${dir}, Pattern: ${globPattern}, Found: ${files.length} files`);

      // We process files in chunks to avoid blocking but allow some concurrency
      const chunkSize = 50;
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);

        await Promise.all(chunk.map(async (file) => {
          // get relative path (handle potential trailing slash in config)
          const baseLen = currentConfig.mediaBaseDir.endsWith('/') ? currentConfig.mediaBaseDir.length : currentConfig.mediaBaseDir.length + 1;
          const urlPath = file.substring(baseLen);
          const ext = path.extname(file).toLowerCase();
          const isVideo = ext === '.mp4';

          let lat = null;
          let lng = null;
          let date = null;
          let yaw = null;
          let isPano = false;

          try {
            if (!isVideo) {
              const gps = await exifr.gps(file).catch(() => null);
              const metadata = await exifr.parse(file, { xmp: true }).catch(() => null);

              if (gps) {
                lat = gps.latitude;
                lng = gps.longitude;
              }
              if (metadata) {
                if (metadata.DateTimeOriginal) date = metadata.DateTimeOriginal;
                if (metadata.GimbalYawDegree !== undefined) yaw = metadata.GimbalYawDegree;
                else if (metadata.FlightYawDegree !== undefined) yaw = metadata.FlightYawDegree;
                if (metadata.ProjectionType === 'equirectangular') isPano = true;
              }
              if (!date) {
                const stat = fs.statSync(file);
                date = stat.mtime;
              }
            } else {
              // Try to read GPS from companion SRT file (DJI format)
              const srtPath = file.replace(/\.mp4$/i, '.SRT');
              if (fs.existsSync(srtPath)) {
                try {
                  const srtContent = fs.readFileSync(srtPath, 'utf8');
                  // Extract first occurrence of latitude/longitude
                  const gpsMatch = srtContent.match(/\[latitude:\s*([\d.\-]+)\]\s*\[longitude:\s*([\d.\-]+)\]/);
                  if (gpsMatch) {
                    lat = parseFloat(gpsMatch[1]);
                    lng = parseFloat(gpsMatch[2]);
                  }
                  // Extract first date from SRT (format: 2026-02-12 11:15:29.246)
                  const dateMatch = srtContent.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
                  if (dateMatch) {
                    date = new Date(dateMatch[1]);
                  }
                  // Extract yaw if available
                  const yawMatch = srtContent.match(/\[gb_yaw:\s*([\d.\-]+)\]/);
                  if (yawMatch) {
                    yaw = parseFloat(yawMatch[1]);
                  }
                } catch (srtErr) {
                  console.error(`Error reading SRT for ${file}:`, srtErr.message);
                }
              }
              if (!date) {
                const stat = fs.statSync(file);
                date = stat.mtime;
              }
            }
          } catch (err) {
            console.error(`Error parsing metadata for ${file}:`, err.message);
          }

          catalog.push({
            id: Buffer.from(file).toString('base64'),
            name: path.basename(file),
            folder: path.basename(path.dirname(file)),
            type: isVideo ? 'video' : 'image',
            url: `/media/${urlPath}`,
            thumbUrl: isVideo ? `/media/${urlPath}` : `/api/thumb/${urlPath}`,
            lat,
            lng,
            yaw,
            date,
            isPano,
          });
        }));
      }
    }

    // Sort by date descending
    catalog.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 2. Save result to cache file
    fs.writeFileSync(CACHE_FILE, JSON.stringify(catalog));
    console.log(`Cache generated with ${catalog.length} items`);

    res.json(catalog);
  } catch (err) {
    console.error('Error generating catalog:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to generate and serve thumbnails for images
app.get(/^\/api\/thumb\/(.*)$/, async (req, res) => {
  try {
    const urlPath = req.params[0];
    const originalPath = path.join(config.mediaBaseDir, decodeURIComponent(urlPath));

    if (!fs.existsSync(originalPath)) {
      return res.status(404).send('Not found');
    }

    const ext = path.extname(originalPath).toLowerCase();
    
    // We only resize images
    if (ext !== '.jpg' && ext !== '.jpeg') {
        return res.redirect(`/media/${urlPath}`);
    }

    // Generate a safe hash for the cached thumb filename
    const hash = crypto.createHash('md5').update(originalPath).digest('hex');
    const thumbPath = path.join(THUMB_CACHE_DIR, `${hash}.jpg`);

    if (fs.existsSync(thumbPath)) {
      return res.sendFile(thumbPath);
    }

    // Generate thumb on the fly and save
    await sharp(originalPath)
      .resize({ width: 256 })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    return res.sendFile(thumbPath);
  } catch (err) {
    console.error('Error serving thumb for:', req.params[0], err.message);
    res.status(500).send('Error generating thumb');
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
