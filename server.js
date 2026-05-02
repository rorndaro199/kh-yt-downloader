const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

function sanitizeFileName(name) {
  return name
    .replace(/[<>:\"\/\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function normalizeYouTubeUrl(input) {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return `https://www.youtube.com/watch?v=${input}`;
  }
  return input;
}

function getAvailableVideoFormats(formats) {
  const valid = formats.filter(f => f.vcodec !== 'none');
  const unique = [];
  const seen = new Set();

  valid
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))
    .forEach(f => {
      const key = f.format_id;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
    });

  return unique.map(f => ({
    formatId: f.format_id,
    label: `${f.height || 'Video'}${f.height ? 'p' : ''} ${f.ext.toUpperCase()}${f.acodec === 'none' ? ' (video-only)' : ''}`,
    description: `${f.format}${f.acodec === 'none' ? ' • no audio' : ''} • ${f.filesize ? Math.round(f.filesize / 1024 / 1024) + 'MB' : 'size unknown'}`
  }));
}

function getAvailableAudioFormats(formats) {
  const valid = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
  const unique = [];
  const seen = new Set();

  valid
    .sort((a, b) => (b.abr || 0) - (a.abr || 0) || (b.filesize || 0) - (a.filesize || 0))
    .forEach(f => {
      const key = `${f.abr || 0}-${f.ext}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
    });

  return unique.map(f => ({
    formatId: f.format_id,
    label: `${f.ext.toUpperCase()} ${f.abr ? f.abr + 'kbps' : ''}`.trim(),
    description: `${f.format} • ${f.filesize ? Math.round(f.filesize / 1024 / 1024) + 'MB' : 'size unknown'}`
  }));
}

function getFormatString(quality) {
  switch (quality) {
    case 'best':
      return 'best[ext=mp4]/best';
    case '1080p':
      return 'best[height<=1080][ext=mp4]/best[ext=mp4]/best';
    case '720p':
      return 'best[height<=720][ext=mp4]/best[ext=mp4]/best';
    case '480p':
      return 'best[height<=480][ext=mp4]/best[ext=mp4]/best';
    case '360p':
      return 'best[height<=360][ext=mp4]/best[ext=mp4]/best';
    case 'audio':
      return 'bestaudio[ext=m4a]/bestaudio/best';
    default:
      return 'best[ext=mp4]/best';
  }
}

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseProgress(line) {
  const match = line.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!match) return null;
  return Number(match[1]);
}

function parseSpeed(line) {
  const match = line.match(/at\s+([\d\.]+[KMG]?i?B\/s)/i);
  return match ? match[1] : null;
}

app.get('/api/video', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const url = normalizeYouTubeUrl(rawUrl);

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
      flatPlaylist: false
    });

    const thumbnails = info.thumbnails || [];
    const thumbnail = thumbnails.length ? thumbnails[thumbnails.length - 1].url : '';
    const availableVideoFormats = getAvailableVideoFormats(info.formats);
    const availableAudioFormats = getAvailableAudioFormats(info.formats);

    res.json({
      title: info.title,
      channel: info.uploader || info.uploader_id || 'Unknown',
      views: info.view_count || 'Unknown',
      duration: info.duration || 'Unknown',
      uploadDate: info.upload_date || 'Unknown',
      thumbnail,
      availableVideoFormats,
      availableAudioFormats
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch video information' });
  }
});

app.get('/api/download-stream', async (req, res) => {
  const rawUrl = req.query.url;
  const formatId = req.query.formatId;
  const mode = req.query.mode;
  const location = req.query.location;

  if (!rawUrl || !formatId || !mode || !location) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const url = normalizeYouTubeUrl(rawUrl);
  const saveDir = path.resolve(location);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const sendProgress = (percent, speed, message) => {
    sendSseEvent(res, 'progress', { percent, speed, message });
  };

  const sendDone = (filePaths) => {
    sendSseEvent(res, 'done', { filePaths });
    res.end();
  };

  const sendError = (message) => {
    sendSseEvent(res, 'error', { message });
    res.end();
  };

  const runDownload = async () => {
    try {
      await fs.promises.mkdir(saveDir, { recursive: true });
      const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true,
        flatPlaylist: false
      });

      const title = sanitizeFileName(info.title || 'youtube-download');
      const downloadResults = [];

      const runProcess = (format, outputPath, stageOffset = 0, stageScale = 100) => {
        return new Promise((resolve, reject) => {
          const subprocess = youtubedl.exec(url, {
            output: outputPath,
            format,
            noWarnings: true,
            noCallHome: true,
            preferFreeFormats: true,
            youtubeSkipDashManifest: true,
            newline: true,
            ...(format.includes('+') ? { mergeOutputFormat: 'mp4' } : {})
          });

          let lastPercent = 0;
          subprocess.stderr.on('data', chunk => {
            const lines = chunk.toString().split(/\r?\n/);
            lines.forEach(line => {
              const pct = parseProgress(line);
              if (pct !== null) {
                lastPercent = pct;
                const percent = Math.min(100, Math.max(0, stageOffset + (pct * stageScale / 100)));
                const speed = parseSpeed(line);
                sendProgress(percent, speed, line.trim());
              }
            });
          });

          subprocess.on('close', code => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`yt-dlp exited with code ${code}`));
            }
          });

          subprocess.on('error', reject);
        });
      };

      if (mode === 'video') {
        const outputPath = path.join(saveDir, `${title} - ${formatId}.mp4`);
        await runProcess(formatId, outputPath, 0, 100);
        downloadResults.push({ type: 'video', path: outputPath });
      } else if (mode === 'audio') {
        const outputPath = path.join(saveDir, `${title} - audio.m4a`);
        await runProcess(formatId, outputPath, 0, 100);
        downloadResults.push({ type: 'audio', path: outputPath });
      } else if (mode === 'both') {
        const outputPath = path.join(saveDir, `${title}.mp4`);
        const mergeFormat = `${formatId}+bestaudio/best`;
        await runProcess(mergeFormat, outputPath, 0, 100);
        downloadResults.push({ type: 'merged', path: outputPath });
      }

      sendDone(downloadResults.map(item => item.path));
    } catch (err) {
      sendError(err.message || 'Download failed');
    }
  };

  runDownload();
});

app.post('/api/download', async (req, res) => {
  const { url: rawUrl, formatId, mode, location } = req.body;

  if (!rawUrl || !formatId || !mode || !location) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const url = normalizeYouTubeUrl(rawUrl);
  const saveDir = path.resolve(location);

  try {
    await fs.promises.mkdir(saveDir, { recursive: true });
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
      flatPlaylist: false
    });

    const title = sanitizeFileName(info.title || 'youtube-download');
    const downloadResults = [];

    if (mode === 'video') {
      const outputPath = path.join(saveDir, `${title} - ${formatId}.mp4`);

      await youtubedl(url, {
        output: outputPath,
        format: formatId,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true
      });

      downloadResults.push({ type: 'video', path: outputPath });
    } else if (mode === 'audio') {
      const audioFormat = formatId;
      const outputPath = path.join(saveDir, `${title} - audio.m4a`);

      await youtubedl(url, {
        output: outputPath,
        format: audioFormat,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true
      });

      downloadResults.push({ type: 'audio', path: outputPath });
    } else if (mode === 'both') {
      const outputPath = path.join(saveDir, `${title}.mp4`);
      const mergeFormat = `${formatId}+bestaudio/best`;

      await youtubedl(url, {
        output: outputPath,
        format: mergeFormat,
        mergeOutputFormat: 'mp4',
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true
      });

      downloadResults.push({ type: 'merged', path: outputPath });
    }

    res.json({
      filePaths: downloadResults.map(item => item.path),
      message: 'Download completed successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Download failed' });
  }
});

app.listen(port, () => {
  console.log(`KH-TOUTUBE-DOWNLOADER server running on http://localhost:${port}`);
});
