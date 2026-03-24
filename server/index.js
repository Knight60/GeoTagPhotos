const express = require('express');
const cors = require('cors');
const fg = require('fast-glob');
const exifr = require('exifr');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());

// Serve the overarching directory where the files are stored
// This allows the frontend to access them via /media/...
app.use('/media', express.static('E:/@ UAVs'));

// Target directories
const targetDirs = [
  'E:/@ UAVs/DJI-Mini3 Pro @ 20260212',
  'E:/@ UAVs/DJI-Mini3 Pro @ 20260213',
  'E:/@ UAVs/DJI-Mini3 Pro @ 20260214',
  'E:/@ UAVs/DJI-Mini3 Pro @ 20260215',
];

// Helper to convert Windows path backslashes to forward slashes for fast-glob
const normalizePath = (p) => p.replace(/\\/g, '/');

const CACHE_FILE = path.join(__dirname, 'catalog-cache.json');

// API endpoint to get catalog
app.get('/api/catalog', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';

    // 1. Try to load from cache if not forcing refresh
    if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
      console.log('Serving catalog from cache...');
      const cachedData = fs.readFileSync(CACHE_FILE, 'utf-8');
      return res.json(JSON.parse(cachedData));
    }

    console.log('Fetching catalog and reading EXIF data (this may take a while)...');
    const catalog = [];

    for (const dir of targetDirs) {
      if (!fs.existsSync(dir)) {
        console.warn(`Directory not found: ${dir}`);
        continue;
      }

      const globPattern = normalizePath(path.join(dir, '**/*.{jpg,jpeg,mp4,JPG,JPEG,MP4}'));
      const files = await fg(globPattern, { absolute: true });

      // We process files in chunks to avoid blocking but allow some concurrency
      const chunkSize = 50;
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);

        await Promise.all(chunk.map(async (file) => {
          const urlPath = file.substring('E:/@ UAVs/'.length); // get relative path
          const ext = path.extname(file).toLowerCase();
          const isVideo = ext === '.mp4';

          let lat = null;
          let lng = null;
          let date = null;
          let yaw = null;

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
              }
              if (!date) {
                const stat = fs.statSync(file);
                date = stat.mtime;
              }
            } else {
              const stat = fs.statSync(file);
              date = stat.mtime;
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
            lat,
            lng,
            yaw,
            date,
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

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
