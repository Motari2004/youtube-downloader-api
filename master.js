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
// TEMP LOCATION - Only for temporary storage during processing
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

// ============================================================
// QUALITY MAPPING - Zeemo
// ============================================================

const QUALITY_MAP = {
    '1080p': '1080p',
    '720p': '720p',
    '480p': '480p',
    '360p': '360p',
    'best': '720p'
};

// ============================================================
// GET DOWNLOAD URL - ZEEMO.TO
// ============================================================

async function getDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting download URL for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    console.log(`🔗 Using: Zeemo.to`);
    
    const qualityText = QUALITY_MAP[quality] || '720p';
    
    let browser;
    let context;
    
    try {
        console.log('🚀 Launching browser...');
        
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
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=BlockInsecurePrivateNetworkRequests'
            ]
        });
        
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            screen: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });
        
        const page = await context.newPage();
        
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
        });
        
        await page.setViewportSize({ width: 1920, height: 1080 });
        
        const videoUrl = `https://youtu.be/${videoId}`;
        
        // ============================================================
        // STEP 1: NAVIGATE TO ZEEMO
        // ============================================================
        console.log('📌 Opening Zeemo.to...');
        await page.goto('https://zeemo.to/en2/', {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        console.log('✅ Page loaded');
        await page.waitForTimeout(3000);
        
        // ============================================================
        // STEP 2: FIND INPUT FIELD
        // ============================================================
        console.log('📌 Looking for input field...');
        
        let inputField = null;
        
        try {
            inputField = page.locator('#app').getByRole('textbox');
            if (await inputField.isVisible({ timeout: 5000 })) {
                console.log('✅ Found input by: #app textbox');
            } else {
                inputField = null;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!inputField) {
            try {
                inputField = page.getByRole('textbox');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    console.log('✅ Found input by role: textbox');
                } else {
                    inputField = null;
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
        }
        
        if (!inputField) {
            const inputSelectors = [
                'input[type="url"]',
                'input[type="text"]',
                'input[placeholder*="Paste"]',
                'input[placeholder*="paste"]',
                'input[placeholder*="link"]',
                'input[name="url"]',
                'input[id*="url"]',
                '.url-input',
                'textarea',
                'input[class*="input"]'
            ];
            
            for (const selector of inputSelectors) {
                try {
                    const el = await page.$(selector);
                    if (el && await el.isVisible()) {
                        inputField = el;
                        console.log(`✅ Found input by: ${selector}`);
                        break;
                    }
                } catch (e) {}
            }
        }
        
        if (!inputField) {
            console.log('❌ Input field not found');
            return { success: false, error: 'Input field not found' };
        }
        
        // ============================================================
        // STEP 3: ENTER URL
        // ============================================================
        console.log(`📌 Entering URL: ${videoUrl}`);
        
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);
        await inputField.fill(videoUrl);
        console.log('✅ URL entered');
        await page.waitForTimeout(500);
        
        // ============================================================
        // STEP 4: CLICK THE "Search" BUTTON
        // ============================================================
        console.log('📌 Looking for "Search" button...');
        
        let searchClicked = false;
        
        try {
            const searchButton = page.getByRole('button', { name: 'Search' });
            if (await searchButton.isVisible({ timeout: 3000 })) {
                await searchButton.click();
                console.log('✅ Clicked "Search" button by role!');
                searchClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!searchClicked) {
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await btn.textContent();
                    if (text && (text.trim() === 'Search' || text.includes('Search'))) {
                        await btn.click();
                        console.log('✅ Clicked "Search" button by text!');
                        searchClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
        }
        
        if (!searchClicked) {
            console.log('⚠️  No "Search" button found, pressing Enter...');
            await page.keyboard.press('Enter');
        }
        
        // ============================================================
        // STEP 5: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ WAITING 5 seconds for results...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 6: SET UP NETWORK INTERCEPTION
        // ============================================================
        console.log('📌 Setting up network interception for video URL...');
        
        let videoDownloadUrl = null;
        
        context.on('response', async (response) => {
            const url = response.url();
            
            if (url && (
                url.includes('sf-converter.com/prod-new/download') ||
                url.includes('.mp4') || 
                url.includes('googlevideo')
            )) {
                if (!url.includes('google-analytics') && 
                    !url.includes('analytics') && 
                    !url.includes('tracking') &&
                    !url.includes('collect')) {
                    console.log(`🌐 Captured video URL: ${url.substring(0, 100)}...`);
                    videoDownloadUrl = url;
                }
            }
        });
        
        // ============================================================
        // STEP 7: CLICK THE "Download" BUTTON
        // ============================================================
        console.log('📌 Looking for "Download" button...');
        
        let downloadClicked = false;
        
        try {
            const downloadButtons = await page.$$('button.table__result-download');
            if (downloadButtons.length > 0) {
                await downloadButtons[0].click();
                console.log(`✅ Clicked first "Download" button! (${downloadButtons.length} found)`);
                downloadClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!downloadClicked) {
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await btn.textContent();
                    if (text && (text.trim() === 'Download' || text.includes('Download'))) {
                        await btn.click();
                        console.log('✅ Clicked "Download" button by text!');
                        downloadClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
        }
        
        if (!downloadClicked) {
            console.log('⚠️  No "Download" button found, continuing...');
        }
        
        console.log('⏳ WAITING 5 seconds for "Download video" button to appear...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 8: CLICK THE "Download video" BUTTON
        // ============================================================
        console.log('📌 Looking for "Download video" button...');
        
        let downloadVideoClicked = false;
        
        try {
            const downloadVideoBtn = page.getByRole('button', { name: 'Download video' });
            if (await downloadVideoBtn.isVisible({ timeout: 3000 })) {
                await downloadVideoBtn.click();
                console.log('✅ Clicked "Download video" button by role!');
                downloadVideoClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!downloadVideoClicked) {
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await btn.textContent();
                    if (text && (text.trim() === 'Download video' || text.includes('Download video'))) {
                        await btn.click();
                        console.log('✅ Clicked "Download video" button by text!');
                        downloadVideoClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
        }
        
        if (!downloadVideoClicked) {
            console.log('⚠️  No "Download video" button found!');
        }
        
        console.log('⏳ WAITING 10 seconds for network response...');
        await page.waitForTimeout(10000);
        
        // ============================================================
        // STEP 9: GET VIDEO URL
        // ============================================================
        let downloadUrl = null;
        let selectedQuality = qualityText;
        
        if (videoDownloadUrl) {
            downloadUrl = videoDownloadUrl;
            console.log(`✅ Video URL captured from network: ${downloadUrl.substring(0, 100)}...`);
        } else {
            console.log('📌 No video URL captured, searching HTML...');
            
            const pageHtml = await page.content();
            
            const sfMatches = pageHtml.match(/https?:\/\/[^\s"']*sf-converter\.com\/prod-new\/download[^\s"']*/gi);
            if (sfMatches && sfMatches.length > 0) {
                downloadUrl = sfMatches[0];
                console.log(`✅ Found sf-converter URL in HTML: ${downloadUrl.substring(0, 80)}...`);
            }
        }
        
        // ============================================================
        // STEP 10: GET VIDEO TITLE
        // ============================================================
        let videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"], .video-title, .filename');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return 'video';
        });
        
        console.log(`📊 Video title: ${videoTitle}`);
        console.log(`📊 Download URL found: ${!!downloadUrl}`);
        
        return {
            success: !!downloadUrl,
            downloadUrl: downloadUrl || null,
            title: videoTitle || 'video',
            quality: quality,
            videoId: videoId,
            selectedQuality: selectedQuality,
            service: 'Zeemo'
        };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            console.log('🔒 Closing browser...');
            try { await browser.close(); } catch (e) {}
        }
    }
}

// ============================================================
// STREAM FILE DIRECTLY TO CLIENT (BROWSER DOWNLOAD)
// ============================================================

async function streamFile(url, filename, res) {
    console.log(`📥 Streaming file to client: ${filename}`);
    
    if (!url) {
        res.status(400).json({ error: 'No URL provided' });
        return;
    }
    
    try {
        // Set headers for browser download
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('Cache-Control', 'no-cache');
        
        // Stream the file directly from the source to the client
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
                'Referer': 'https://zeemo.to/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 120000
        });
        
        // Pipe the stream directly to the response
        response.data.pipe(res);
        
        // Log progress
        let downloaded = 0;
        const total = parseInt(response.headers['content-length']) || 0;
        console.log(`📊 File size: ${(total / 1024 / 1024).toFixed(2)} MB`);
        
        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            const percent = total ? (downloaded / total * 100).toFixed(1) : '?';
            process.stdout.write(`\r   Streaming: ${percent}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
        });
        
        response.data.on('end', () => {
            console.log('');
            console.log(`✅ Stream complete: ${filename}`);
        });
        
        response.data.on('error', (err) => {
            console.error('❌ Stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        });
        
    } catch (error) {
        console.error('❌ Error streaming file:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
}

// ============================================================
// API ENDPOINTS
// ============================================================

// ============================================================
// POST endpoint - for curl and programmatic use
// ============================================================
app.post('/api/download', async (req, res) => {
    const { videoId, quality = '720p' } = req.body;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }
    
    try {
        const result = await getDownloadUrl(videoId, quality);
        
        if (!result.success || !result.downloadUrl) {
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const filename = `${result.title}_${result.quality}_${videoId}.mp4`;
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        console.error('Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
});

// ============================================================
// GET endpoint - for browser download (paste URL in address bar)
// ============================================================
app.get('/api/download', async (req, res) => {
    const { videoId, quality = '720p' } = req.query;
    
    if (!videoId) {
        return res.status(400).json({ 
            error: 'videoId required. Example: /api/download?videoId=3qwF8aO9MmM&quality=720p' 
        });
    }
    
    try {
        const result = await getDownloadUrl(videoId, quality);
        
        if (!result.success || !result.downloadUrl) {
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const filename = `${result.title}_${result.quality}_${videoId}.mp4`;
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        console.error('Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
});

// ============================================================
// GET endpoint for direct browser download with URL parameters
// ============================================================
app.get('/api/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p' } = req.query;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }
    
    try {
        const result = await getDownloadUrl(videoId, quality);
        
        if (!result.success || !result.downloadUrl) {
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const filename = `${result.title}_${result.quality}_${videoId}.mp4`;
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        console.error('Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'Zeemo (streaming)',
        tempDir: TEMP_DIR,
        screenshotDir: SCREENSHOT_DIR,
        environment: process.env.RENDER ? 'render' : 'local',
        browserMode: 'headless',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/screenshots', (req, res) => {
    try {
        const files = fs.readdirSync(SCREENSHOT_DIR);
        res.json({
            success: true,
            screenshots: files,
            count: files.length,
            directory: SCREENSHOT_DIR
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/screenshot/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.sendFile(filePath);
});

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 YouTube Downloader Server running at http://localhost:' + PORT);
    console.log('🔗 Using: Zeemo.to');
    console.log('');
    console.log('📌 Browser Download (paste in address bar):');
    console.log(`   http://localhost:${PORT}/api/download?videoId=3qwF8aO9MmM&quality=720p`);
    console.log('');
    console.log('📌 Or use:');
    console.log(`   http://localhost:${PORT}/api/download/3qwF8aO9MmM?quality=720p`);
    console.log('');
    console.log('📌 POST /api/download - For curl/API use');
    console.log('📌 GET  /api/health  - Health check');
    console.log('📌 GET  /api/screenshots - List screenshots');
    console.log('');
    console.log('📁 Temp directory: ' + TEMP_DIR);
    console.log('📸 Screenshot location: ' + SCREENSHOT_DIR);
});