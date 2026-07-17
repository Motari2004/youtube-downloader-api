const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// ============================================================
// TEMP LOCATION
// ============================================================

const TEMP_DIR = process.env.RENDER 
    ? '/tmp/downloads' 
    : path.join(__dirname, 'temp');

const SCREENSHOT_DIR = process.env.RENDER 
    ? '/tmp/screenshots' 
    : path.join(__dirname, 'screenshots');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log(`📁 Temp directory: ${TEMP_DIR}`);
console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);
console.log(`👁️  Browser mode: ${process.env.RENDER ? 'HEADLESS' : 'VISIBLE'}`);

// ============================================================
// QUALITY MAPPING
// ============================================================

const QUALITY_MAP = {
    '1080p': '1080p',
    '720p': '720p',
    '480p': '480p',
    '360p': '360p',
    'best': '720p'
};

// ============================================================
// VIDEO CACHE
// ============================================================

const videoCache = new Map();

// ============================================================
// GET VIDEO TITLE FROM NOEMBED API
// ============================================================

async function getVideoTitle(videoId) {
    try {
        const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        if (data && data.title) {
            return data.title;
        }
        return null;
    } catch (error) {
        console.log(`⚠️  Noembed API failed: ${error.message}`);
        return null;
    }
}

// ============================================================
// ZEEMO.TO - VIDEO DOWNLOAD
// ============================================================

async function getVideoDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting video URL from Zeemo: ${videoId}`);
    
    const qualityText = QUALITY_MAP[quality] || '720p';
    let browser;
    let context;
    
    try {
        browser = await chromium.launch({
            headless: true,
            slowMo: 50,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1920,1080'
            ]
        });
        
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Navigate to Zeemo
        await page.goto('https://zeemo.to/en2/', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2000);
        
        // Find input field
        let inputField = null;
        try {
            inputField = page.locator('#app').getByRole('textbox');
            if (await inputField.isVisible({ timeout: 5000 })) {
                console.log('✅ Found input field');
            }
        } catch (e) {}
        
        if (!inputField) {
            const inputSelectors = ['input[type="url"]', 'input[type="text"]', 'input[placeholder*="Paste"]', 'input[name="url"]'];
            for (const selector of inputSelectors) {
                try {
                    inputField = await page.$(selector);
                    if (inputField && await inputField.isVisible()) break;
                } catch (e) {}
            }
        }
        
        if (!inputField) {
            return { success: false, error: 'Input field not found' };
        }
        
        // Enter URL
        const videoUrl = `https://youtu.be/${videoId}`;
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await inputField.fill(videoUrl);
        await page.waitForTimeout(500);
        
        // Click Search
        try {
            const searchButton = page.getByRole('button', { name: 'Search' });
            if (await searchButton.isVisible({ timeout: 3000 })) {
                await searchButton.click();
            }
        } catch (e) {}
        
        await page.waitForTimeout(5000);
        
        // Get video title
        let videoTitle = await page.evaluate(() => {
            const h2Elements = document.querySelectorAll('h2');
            for (const h2 of h2Elements) {
                const text = h2.textContent.trim();
                if (text && text.length > 0 && text.length < 200 &&
                    !text.includes('Download') && !text.includes('Convert') &&
                    !text.includes('YouTube') && !text.includes('Free')) {
                    return text;
                }
            }
            return null;
        });
        
        if (!videoTitle) videoTitle = `video_${videoId}`;
        
        // Set up network interception
        let videoDownloadUrl = null;
        let urlCaptured = false;
        
        context.on('response', async (response) => {
            const url = response.url();
            if (!urlCaptured && url && (
                url.includes('sf-converter.com/prod-new/download') ||
                url.includes('googlevideo.com/videoplayback') ||
                url.includes('.mp4')
            )) {
                videoDownloadUrl = url;
                urlCaptured = true;
            }
        });
        
        // Find and click quality button
        const rows = await page.$$('tr');
        let downloadClicked = false;
        
        for (const row of rows) {
            try {
                const rowText = await row.textContent();
                if (rowText && rowText.includes(qualityText)) {
                    const buttonsInRow = await row.$$('button');
                    if (buttonsInRow.length > 0) {
                        await buttonsInRow[0].click();
                        downloadClicked = true;
                        break;
                    }
                }
            } catch (e) {}
        }
        
        if (!downloadClicked) {
            const buttons = await page.$$('button.table__result-download');
            if (buttons.length > 0) {
                await buttons[0].click();
            }
        }
        
        await page.waitForTimeout(3000);
        
        // Check for direct download
        if (videoDownloadUrl && videoDownloadUrl.includes('googlevideo.com')) {
            return {
                success: true,
                downloadUrl: videoDownloadUrl,
                title: videoTitle,
                quality: quality
            };
        }
        
        // Click "Download video" if needed
        await page.waitForTimeout(5000);
        
        try {
            const downloadVideoBtn = page.getByRole('button', { name: 'Download video' });
            if (await downloadVideoBtn.isVisible({ timeout: 3000 })) {
                await downloadVideoBtn.click();
            }
        } catch (e) {}
        
        await page.waitForTimeout(10000);
        
        let downloadUrl = videoDownloadUrl;
        if (!downloadUrl) {
            const pageHtml = await page.content();
            const gvMatches = pageHtml.match(/https?:\/\/[^\s"']*googlevideo\.com[^\s"']*/gi);
            if (gvMatches && gvMatches.length > 0) {
                downloadUrl = gvMatches[0];
            }
        }
        
        return {
            success: !!downloadUrl,
            downloadUrl: downloadUrl || null,
            title: videoTitle,
            quality: quality
        };
        
    } catch (error) {
        console.error('❌ Video error:', error.message);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
    }
}

// ============================================================
// Y2MATE.GS - AUDIO DOWNLOAD
// ============================================================

async function getAudioDownloadUrl(videoId) {
    console.log(`🎵 Getting audio URL from Y2Mate: ${videoId}`);
    
    const videoUrl = `https://youtu.be/${videoId}`;
    let browser;
    let context;
    
    try {
        browser = await chromium.launch({
            headless: true,
            slowMo: 50,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Set up network interception for MP3
        let mp3Url = null;
        
        context.on('response', async (response) => {
            const url = response.url();
            if (url && (
                url.includes('.mp3') ||
                url.includes('download') ||
                url.includes('get_audio')
            )) {
                if (!url.includes('google-analytics') && 
                    !url.includes('analytics') && 
                    !url.includes('tracking')) {
                    if (url.includes('.mp3') || url.includes('download')) {
                        mp3Url = url;
                    }
                }
            }
        });
        
        // Navigate to Y2Mate
        await page.goto('https://y2mate.gs/', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2000);
        
        // Find input field
        let inputField = null;
        try {
            inputField = page.getByRole('textbox', { name: 'Paste your YouTube link' });
            if (await inputField.isVisible({ timeout: 5000 })) {
                console.log('✅ Found input field');
            }
        } catch (e) {}
        
        if (!inputField) {
            try {
                inputField = page.getByPlaceholder('Paste your YouTube link');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    console.log('✅ Found input by placeholder');
                }
            } catch (e) {}
        }
        
        if (!inputField) {
            try {
                inputField = page.getByRole('textbox');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    console.log('✅ Found input by role');
                }
            } catch (e) {}
        }
        
        if (!inputField) {
            return { success: false, error: 'Input field not found' };
        }
        
        // Enter URL
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await inputField.fill(videoUrl);
        await page.waitForTimeout(500);
        
        // Click MP3 button
        let mp3Clicked = false;
        try {
            const mp3Btn = page.getByRole('button', { name: 'MP3' });
            if (await mp3Btn.isVisible({ timeout: 3000 })) {
                await mp3Btn.click();
                mp3Clicked = true;
            }
        } catch (e) {}
        
        if (!mp3Clicked) {
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.textContent();
                if (text && text.trim() === 'MP3') {
                    await btn.click();
                    mp3Clicked = true;
                    break;
                }
            }
        }
        
        await page.waitForTimeout(1000);
        
        // Click Convert button
        let convertClicked = false;
        try {
            const convertBtn = page.getByRole('button', { name: 'Convert' });
            if (await convertBtn.isVisible({ timeout: 3000 })) {
                await convertBtn.click();
                convertClicked = true;
            }
        } catch (e) {}
        
        if (!convertClicked) {
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.textContent();
                if (text && (text.trim() === 'Convert' || text.includes('Convert'))) {
                    await btn.click();
                    convertClicked = true;
                    break;
                }
            }
        }
        
        if (!convertClicked) {
            await page.keyboard.press('Enter');
        }
        
        // Wait for conversion
        await page.waitForTimeout(8000);
        
        // Click Download button
        try {
            const downloadBtn = page.getByRole('button', { name: 'Download' });
            if (await downloadBtn.isVisible({ timeout: 5000 })) {
                await downloadBtn.click();
            }
        } catch (e) {}
        
        await page.waitForTimeout(3000);
        
        // Get video title
        let videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return 'audio';
        });
        
        // If no MP3 URL from network, search HTML
        if (!mp3Url) {
            const pageHtml = await page.content();
            const mp3Matches = pageHtml.match(/https?:\/\/[^\s"']*\.mp3[^\s"']*/gi);
            if (mp3Matches && mp3Matches.length > 0) {
                mp3Url = mp3Matches[0];
            }
        }
        
        return {
            success: !!mp3Url,
            downloadUrl: mp3Url || null,
            title: videoTitle || 'audio',
            videoId: videoId
        };
        
    } catch (error) {
        console.error('❌ Audio error:', error.message);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
    }
}

// ============================================================
// STREAM FILE
// ============================================================

async function streamFile(url, filename, res) {
    if (!url) {
        res.status(400).json({ error: 'No URL provided' });
        return;
    }
    
    try {
        const encodedFilename = encodeURIComponent(filename);
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('Cache-Control', 'no-cache');
        
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
                'Referer': 'https://zeemo.to/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 120000,
            maxRedirects: 5
        });
        
        let contentLength = response.headers['content-length'];
        let fileSize = contentLength ? parseInt(contentLength) : 0;
        
        if (fileSize > 0) {
            res.setHeader('Content-Length', fileSize);
        } else {
            res.setHeader('Transfer-Encoding', 'chunked');
        }
        
        response.data.pipe(res);
    } catch (error) {
        console.error('❌ Stream error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Prepare endpoint
app.post('/api/prepare/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    const cacheKey = `${videoId}_${quality}_${type}`;
    
    if (videoCache.has(cacheKey)) {
        return res.json({ success: true, cached: true, videoId, quality, type });
    }
    
    try {
        console.log(`📤 Preparing ${type}: ${videoId} (${quality})`);
        
        let processor;
        if (type === 'audio') {
            processor = getAudioDownloadUrl(videoId);
        } else {
            processor = getVideoDownloadUrl(videoId, quality);
        }
        
        processor.then(result => {
            if (result.success && result.downloadUrl) {
                videoCache.set(cacheKey, {
                    url: result.downloadUrl,
                    title: result.title,
                    quality: result.quality || '720p',
                    type: type,
                    timestamp: Date.now()
                });
                console.log(`✅ ${type} ${cacheKey} prepared successfully`);
            } else {
                videoCache.set(cacheKey, { error: result.error || 'Failed to get download URL' });
                console.log(`❌ ${type} ${cacheKey} preparation failed`);
            }
        }).catch(error => {
            videoCache.set(cacheKey, { error: error.message });
            console.log(`❌ ${type} ${cacheKey} error:`, error.message);
        });
        
        res.json({ success: true, processing: true, videoId, quality, type });
        
    } catch (error) {
        console.error('❌ Prepare error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Status endpoint
app.get('/api/status/:videoId', (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    const cacheKey = `${videoId}_${quality}_${type}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached) {
        if (cached.error) {
            res.json({ ready: false, error: cached.error });
        } else {
            res.json({ ready: true, url: cached.url, title: cached.title });
        }
    } else {
        res.json({ ready: false });
    }
});

// Download endpoint - POST
app.post('/api/download', async (req, res) => {
    const { videoId, quality = '720p', type = 'video' } = req.body;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }
    
    const cacheKey = `${videoId}_${quality}_${type}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached && cached.url) {
        console.log(`📦 Using cached ${type}: ${cacheKey}`);
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        const filename = `${cached.title || 'video'}.${extension}`;
        await streamFile(cached.url, filename, res);
        videoCache.delete(cacheKey);
        return;
    }
    
    try {
        let result;
        if (type === 'audio') {
            result = await getAudioDownloadUrl(videoId);
        } else {
            result = await getVideoDownloadUrl(videoId, quality);
        }
        
        if (!result.success || !result.downloadUrl) {
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        const filename = `${result.title || 'video'}.${extension}`;
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        console.error('Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Download endpoint - GET
app.get('/api/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    
    const cacheKey = `${videoId}_${quality}_${type}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached && cached.url) {
        console.log(`📦 Using cached ${type}: ${cacheKey}`);
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        const filename = `${cached.title || 'video'}.${extension}`;
        await streamFile(cached.url, filename, res);
        videoCache.delete(cacheKey);
        return;
    }
    
    try {
        let result;
        if (type === 'audio') {
            result = await getAudioDownloadUrl(videoId);
        } else {
            result = await getVideoDownloadUrl(videoId, quality);
        }
        
        if (!result.success || !result.downloadUrl) {
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        const filename = `${result.title || 'video'}.${extension}`;
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        console.error('Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'Zeemo + Y2Mate',
        environment: process.env.RENDER ? 'render' : 'local',
        cacheSize: videoCache.size,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 YouTube Downloader Server running on port ' + PORT);
    console.log('🔗 Using: Zeemo.to (Video) + Y2Mate.gs (Audio)');
    console.log('📌 POST /api/download - Download video/audio');
    console.log('📌 GET /api/download/:videoId - Browser download');
    console.log('📌 POST /api/prepare/:videoId - Prepare video/audio');
    console.log('📌 GET /api/status/:videoId - Check status');
    console.log('📌 GET /api/health - Health check');
    console.log('');
    console.log('📁 Temp directory: ' + TEMP_DIR);
});