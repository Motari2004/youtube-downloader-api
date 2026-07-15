const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// COOKIES - Read from Secret Files
// ============================================================

function findCookiesFile() {
    // Secret files are available at /etc/secrets/<filename>
    const secretPath = '/etc/secrets/cookies.txt';
    
    if (fs.existsSync(secretPath)) {
        console.log(`✅ Found cookies at: ${secretPath}`);
        return secretPath;
    }
    
    // Fallback paths (for local development)
    const fallbackPaths = [
        './cookies.txt',
        path.join(__dirname, 'cookies.txt'),
        path.join(process.cwd(), 'cookies.txt'),
        '/tmp/cookies.txt'
    ];
    
    for (const p of fallbackPaths) {
        if (fs.existsSync(p)) {
            console.log(`✅ Found cookies at: ${p}`);
            return p;
        }
    }
    
    console.log('⚠️  No cookies file found');
    console.log('📌 Add cookies.txt as a Secret File in Render:');
    console.log('   1. Go to your service → Secrets tab');
    console.log('   2. Click "Add Secret File"');
    console.log('   3. Filename: cookies.txt');
    console.log('   4. Paste your cookie content');
    console.log('   5. Save and redeploy');
    return null;
}

const COOKIES_PATH = findCookiesFile();
const COOKIES_OPTION = COOKIES_PATH ? `--cookies "${COOKIES_PATH}"` : '';

// Get download link using yt-dlp
async function getDownloadLink(videoId, quality = 'best', type = 'video') {
    console.log(`🎬 Fetching: https://youtu.be/${videoId}`);
    console.log(`📌 Type: ${type}, Quality: ${quality}`);
    
    try {
        // Build command with cookies
        let command = `yt-dlp ${COOKIES_OPTION} -j --no-warnings --extractor-args "youtube:player_client=web" "https://youtu.be/${videoId}"`;
        console.log('📌 Running yt-dlp...');
        
        const result = await new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    // Fallback: try with android client
                    const fallbackCommand = `yt-dlp ${COOKIES_OPTION} -j --no-warnings --extractor-args "youtube:player_client=android" "https://youtu.be/${videoId}"`;
                    console.log(`🔄 Trying fallback: ${fallbackCommand}`);
                    
                    exec(fallbackCommand, { maxBuffer: 50 * 1024 * 1024 }, (err, out, errOut) => {
                        if (err) {
                            reject(new Error(errOut || err.message));
                            return;
                        }
                        resolve(out);
                    });
                    return;
                }
                resolve(stdout);
            });
        });
        
        const videoInfo = JSON.parse(result);
        console.log(`📹 Video: ${videoInfo.title}`);
        
        const formats = videoInfo.formats || [];
        
        // ============================================================
        // AUDIO ONLY
        // ============================================================
        if (type === 'audio') {
            console.log('🎵 Looking for audio-only formats...');
            
            const audioFormats = formats.filter(f => 
                (!f.vcodec || f.vcodec === 'none') && 
                f.acodec && f.acodec !== 'none'
            );
            
            audioFormats.sort((a, b) => {
                const bitrateA = parseInt(a.abr) || 0;
                const bitrateB = parseInt(b.abr) || 0;
                return bitrateB - bitrateA;
            });
            
            console.log(`📊 Found ${audioFormats.length} audio-only formats`);
            audioFormats.forEach(f => {
                console.log(`   - ${f.ext} (${f.abr || '?'}kbps): ${formatSize(f.filesize || 0)}`);
            });
            
            let selectedAudio = null;
            let bitrateLabel = '128kbps';
            
            if (quality === 'best' || quality === 'default') {
                selectedAudio = audioFormats.find(f => f.ext === 'm4a' && parseInt(f.abr) >= 128) ||
                               audioFormats.find(f => f.ext === 'm4a') ||
                               audioFormats[0];
                bitrateLabel = `${selectedAudio?.abr || '128'}kbps`;
            } else if (quality === 'high') {
                selectedAudio = audioFormats.find(f => f.ext === 'm4a' && parseInt(f.abr) >= 192) ||
                               audioFormats.find(f => f.ext === 'm4a' && parseInt(f.abr) >= 128) ||
                               audioFormats[0];
                bitrateLabel = `${selectedAudio?.abr || '192'}kbps`;
            } else if (quality === 'medium') {
                selectedAudio = audioFormats.find(f => f.ext === 'm4a' && parseInt(f.abr) >= 128) ||
                               audioFormats.find(f => f.ext === 'm4a') ||
                               audioFormats[0];
                bitrateLabel = `${selectedAudio?.abr || '128'}kbps`;
            } else if (quality === 'low') {
                selectedAudio = audioFormats.find(f => f.ext === 'm4a' && parseInt(f.abr) <= 64) ||
                               audioFormats[audioFormats.length - 1] ||
                               audioFormats[0];
                bitrateLabel = `${selectedAudio?.abr || '64'}kbps`;
            } else {
                selectedAudio = audioFormats[0];
                bitrateLabel = `${selectedAudio?.abr || '128'}kbps`;
            }
            
            if (selectedAudio && selectedAudio.url) {
                console.log(`✅ Selected audio: ${selectedAudio.ext} (${bitrateLabel})`);
                
                return {
                    success: true,
                    videoId: videoId,
                    downloadUrl: selectedAudio.url,
                    quality: bitrateLabel,
                    title: videoInfo.title || 'audio',
                    format: 'mp3',
                    type: 'audio',
                    filesize: selectedAudio.filesize || 0,
                    thumbnail: videoInfo.thumbnail,
                    channel: videoInfo.channel || videoInfo.uploader,
                    duration: videoInfo.duration
                };
            }
            
            return { success: false, error: 'No audio format found' };
        }
        
        // ============================================================
        // VIDEO
        // ============================================================
        console.log('🎬 Looking for video formats...');
        
        const videoWithAudio = formats.filter(f => 
            f.vcodec && f.vcodec !== 'none' && 
            f.acodec && f.acodec !== 'none'
        );
        
        videoWithAudio.sort((a, b) => {
            const hA = parseInt(a.height) || 0;
            const hB = parseInt(b.height) || 0;
            return hB - hA;
        });
        
        let selectedFormat = null;
        let qualityLabel = '';
        
        if (quality === 'best') {
            selectedFormat = videoWithAudio[0];
            qualityLabel = selectedFormat ? (selectedFormat.height + 'p') : 'best';
        } else {
            const targetHeight = parseInt(quality) || 0;
            if (targetHeight > 0) {
                selectedFormat = videoWithAudio.find(f => parseInt(f.height) === targetHeight);
            }
            if (!selectedFormat) {
                selectedFormat = videoWithAudio[0];
            }
            qualityLabel = selectedFormat ? (selectedFormat.height + 'p') : 'best';
        }
        
        if (selectedFormat && selectedFormat.url) {
            console.log(`✅ Selected ${qualityLabel} video`);
            return {
                success: true,
                videoId: videoId,
                downloadUrl: selectedFormat.url,
                quality: qualityLabel,
                title: videoInfo.title || 'video',
                format: selectedFormat.ext || 'mp4',
                filesize: selectedFormat.filesize || 0,
                thumbnail: videoInfo.thumbnail,
                channel: videoInfo.channel || videoInfo.uploader,
                duration: videoInfo.duration,
                type: 'video'
            };
        }
        
        return {
            success: false,
            videoId: videoId,
            error: 'No download URL found'
        };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return {
            success: false,
            videoId: videoId,
            error: error.message
        };
    }
}

// Helper: Format file size
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================
// API ENDPOINTS
// ============================================================

app.post('/api/download', async (req, res) => {
    const { videoId, quality = 'best', type = 'video' } = req.body;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }
    
    const result = await getDownloadLink(videoId, quality, type);
    res.json(result);
});

app.post('/api/info', async (req, res) => {
    const { videoId } = req.body;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }
    
    try {
        const command = `yt-dlp ${COOKIES_OPTION} -j --no-warnings "https://youtu.be/${videoId}"`;
        const result = await new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve(stdout);
            });
        });
        
        const videoInfo = JSON.parse(result);
        const formats = videoInfo.formats || [];
        
        const videoFormats = formats.filter(f => 
            f.vcodec && f.vcodec !== 'none' && 
            f.acodec && f.acodec !== 'none'
        );
        
        const qualities = [];
        const seen = new Set();
        for (const f of videoFormats) {
            const height = parseInt(f.height) || 0;
            if (height > 0 && !seen.has(height)) {
                seen.add(height);
                qualities.push({
                    height: height,
                    label: height + 'p',
                    format: f.ext || 'mp4',
                    filesize: f.filesize || 0
                });
            }
        }
        qualities.sort((a, b) => b.height - a.height);
        
        const audioFormats = formats.filter(f => 
            (!f.vcodec || f.vcodec === 'none') && 
            f.acodec && f.acodec !== 'none'
        ).map(f => ({
            format: f.ext || 'm4a',
            bitrate: f.abr || '128',
            filesize: f.filesize || 0,
            label: `${f.ext || 'm4a'} (${f.abr || '128'}kbps) - ${formatSize(f.filesize || 0)}`
        }));
        
        res.json({
            success: true,
            title: videoInfo.title,
            duration: videoInfo.duration,
            thumbnail: videoInfo.thumbnail,
            channel: videoInfo.channel || videoInfo.uploader,
            qualities: qualities,
            audioFormats: audioFormats,
            viewCount: videoInfo.view_count
        });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/check', (req, res) => {
    const checks = {
        cookies: {
            exists: COOKIES_PATH !== null,
            path: COOKIES_PATH,
            source: 'Secret File'
        }
    };
    
    exec('yt-dlp --version', (error, stdout) => {
        checks.ytDlp = {
            installed: !error,
            version: error ? null : stdout.trim()
        };
        res.json(checks);
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'yt-dlp backend',
        cookies: COOKIES_PATH ? '✅ Present' : '❌ Missing',
        cookieSource: COOKIES_PATH ? 'Secret File' : 'None',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📌 POST /api/download - Download video/audio`);
    console.log(`📌 POST /api/info     - Get video info`);
    console.log(`📌 GET  /api/check   - Check dependencies`);
    console.log(`📌 GET  /api/health  - Health check`);
    console.log('');
    console.log(`🍪 Cookies: ${COOKIES_PATH ? '✅ Found' : '❌ Not found'}`);
    console.log(`📌 Cookie Source: ${COOKIES_PATH ? 'Secret File' : 'None'}`);
    console.log('⚡ Using yt-dlp backend');
    console.log('📌 Video: MP4 with best quality');
    console.log('📌 Audio: MP3 format');
});