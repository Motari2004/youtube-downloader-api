const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Get download link using yt-dlp
async function getDownloadLink(videoId, quality = 'best', type = 'video') {
    console.log(`🎬 Fetching: https://youtu.be/${videoId}`);
    console.log(`📌 Type: ${type}, Quality: ${quality}`);
    
    try {
        const command = `yt-dlp -j --no-warnings "https://youtu.be/${videoId}"`;
        console.log('📌 Running yt-dlp...');
        
        const result = await new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) reject(new Error(error.message));
                else resolve(stdout);
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
            
            // Get audio-only formats
            const audioFormats = formats.filter(f => 
                (!f.vcodec || f.vcodec === 'none') && 
                f.acodec && f.acodec !== 'none'
            );
            
            // Sort by bitrate (highest first)
            audioFormats.sort((a, b) => {
                const bitrateA = parseInt(a.abr) || 0;
                const bitrateB = parseInt(b.abr) || 0;
                return bitrateB - bitrateA;
            });
            
            console.log(`📊 Found ${audioFormats.length} audio-only formats`);
            audioFormats.forEach(f => {
                console.log(`   - ${f.ext} (${f.abr || '?'}kbps): ${formatSize(f.filesize || 0)}`);
            });
            
            // Select best audio format
            let selectedAudio = null;
            let bitrateLabel = '128kbps';
            
            // Priority: m4a > mp4 > webm
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

// API endpoints
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
        const command = `yt-dlp -j --no-warnings "https://youtu.be/${videoId}"`;
        const result = await new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) reject(new Error(error.message));
                else resolve(stdout);
            });
        });
        
        const videoInfo = JSON.parse(result);
        const formats = videoInfo.formats || [];
        
        // Get video qualities
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
        
        // Get audio formats
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
    exec('yt-dlp --version', (error, stdout) => {
        if (error) {
            res.json({ installed: false, message: 'yt-dlp not installed' });
        } else {
            res.json({ installed: true, message: 'yt-dlp is installed', version: stdout.trim() });
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'yt-dlp backend',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📌 POST /api/download - Download video/audio`);
    console.log(`📌 POST /api/info     - Get video info`);
    console.log(`📌 GET  /api/check   - Check yt-dlp`);
    console.log(`📌 GET  /api/health  - Health check`);
    console.log('');
    console.log('⚡ Using yt-dlp backend');
    console.log('📌 Video: MP4 with best quality');
    console.log('📌 Audio: MP3 format');
});