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

const TEMP_DIR = path.join(__dirname, 'temp');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log(`📁 Temp directory: ${TEMP_DIR}`);
console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);
console.log(`👁️  Browser mode: VISIBLE (headless: false)`);

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
// GET DOWNLOAD URL - ZEEMO.TO (HANDLES BOTH SCENARIOS)
// ============================================================

async function getDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting download URL for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    console.log(`🔗 Using: Zeemo.to`);
    console.log(`👁️  Browser is VISIBLE - watch what happens!`);
    
    const qualityText = QUALITY_MAP[quality] || '720p';
    
    let browser;
    let context;
    
    try {
        console.log('🚀 Launching browser (VISIBLE mode)...');
        
        browser = await chromium.launch({
            headless: false,
            slowMo: 200,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--start-maximized',
                '--window-position=0,0',
                '--window-size=1920,1080',
                '--force-device-scale-factor=1',
                '--disable-infobars'
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
        await page.waitForTimeout(2000);
        
        // ============================================================
        // STEP 2: FIND INPUT FIELD
        // ============================================================
        console.log('📌 Looking for input field...');
        
        let inputField = null;
        
        try {
            inputField = page.locator('#app').getByRole('textbox');
            if (await inputField.isVisible({ timeout: 5000 })) {
                console.log('✅ Found input by: #app textbox');
            }
        } catch (e) {}
        
        if (!inputField) {
            try {
                inputField = page.getByRole('textbox');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    console.log('✅ Found input by role');
                }
            } catch (e) {}
        }
        
        if (!inputField) {
            const inputSelectors = [
                'input[type="url"]',
                'input[type="text"]',
                'input[placeholder*="Paste"]',
                'input[name="url"]',
                '.url-input',
                'textarea'
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
        } catch (e) {}
        
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
            } catch (e) {}
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
        // STEP 6: SET UP NETWORK INTERCEPTION - CAPTURE BOTH URL TYPES
        // ============================================================
        console.log('📌 Setting up network interception...');
        
        let videoDownloadUrl = null;
        
        context.on('response', async (response) => {
            const url = response.url();
            
            // Capture both sf-converter AND googlevideo URLs
            if (url && (
                url.includes('sf-converter.com/prod-new/download') ||
                url.includes('googlevideo.com/videoplayback') ||
                url.includes('.mp4')
            )) {
                console.log(`🌐 Captured video URL: ${url.substring(0, 100)}...`);
                videoDownloadUrl = url;
            }
        });
        
        // ============================================================
        // STEP 7: FIND AND CLICK THE SPECIFIC QUALITY BUTTON
        // ============================================================
        console.log(`📌 Looking for quality: ${qualityText}`);
        console.log('👀 WATCH THE BROWSER - clicking quality download button...');
        
        let downloadClicked = false;
        
        // Get all table rows
        const rows = await page.$$('tr');
        console.log(`📊 Found ${rows.length} rows`);
        
        for (let i = 0; i < rows.length; i++) {
            try {
                const rowText = await rows[i].textContent();
                console.log(`   Row ${i}: ${rowText?.substring(0, 60)}...`);
                
                if (rowText && rowText.includes(qualityText)) {
                    console.log(`✅ Found quality ${qualityText} in row ${i}!`);
                    
                    const buttonsInRow = await rows[i].$$('button');
                    console.log(`📊 Found ${buttonsInRow.length} buttons in this row`);
                    
                    if (buttonsInRow.length > 0) {
                        await buttonsInRow[0].click();
                        console.log(`✅ Clicked download button for ${qualityText}!`);
                        downloadClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log(`   Row ${i} error:`, e.message);
            }
        }
        
        // Fallback: click first download button
        if (!downloadClicked) {
            try {
                console.log('📌 Fallback: Clicking first download button');
                const buttons = await page.$$('button.table__result-download');
                if (buttons.length > 0) {
                    await buttons[0].click();
                    console.log(`✅ Clicked first download button (${buttons.length} found)`);
                    downloadClicked = true;
                }
            } catch (e) {
                console.log('⚠️  Fallback failed:', e.message);
            }
        }
        
        if (!downloadClicked) {
            console.log('❌ Could not find any download button to click');
        }
        
        // ============================================================
        // STEP 8: CHECK IF DOWNLOAD STARTED DIRECTLY (Google Video URL)
        // ============================================================
        console.log('⏳ WAITING 3 seconds to check if download started directly...');
        await page.waitForTimeout(3000);
        
        // Check if we already captured a Google Video URL
        if (videoDownloadUrl && videoDownloadUrl.includes('googlevideo.com')) {
            console.log('✅ Direct download detected (Google Video URL)!');
            console.log(`📥 Video URL: ${videoDownloadUrl.substring(0, 100)}...`);
            
            // Get video title
            let videoTitle = await page.evaluate(() => {
                const titleEl = document.querySelector('h1, .title, [class*="title"]');
                if (titleEl) {
                    return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                }
                return 'video';
            });
            
            console.log(`📊 Video title: ${videoTitle}`);
            
            // Keep browser open
            console.log('⏳ Keeping browser open for 3 seconds...');
            await page.waitForTimeout(3000);
            
            return {
                success: true,
                downloadUrl: videoDownloadUrl,
                title: videoTitle || 'video',
                quality: quality,
                videoId: videoId,
                selectedQuality: qualityText,
                service: 'Zeemo'
            };
        }
        
        // ============================================================
        // STEP 9: IF NOT DIRECT, WAIT FOR "Download video" BUTTON
        // ============================================================
        console.log('⏳ WAITING 5 seconds for "Download video" button to appear...');
        console.log('👀 WATCH THE BROWSER - "Download video" button should appear if needed...');
        await page.waitForTimeout(5000);
        
        // Check again for Google Video URL after waiting
        if (videoDownloadUrl && videoDownloadUrl.includes('googlevideo.com')) {
            console.log('✅ Direct download detected (Google Video URL) after waiting!');
            
            let videoTitle = await page.evaluate(() => {
                const titleEl = document.querySelector('h1, .title, [class*="title"]');
                if (titleEl) {
                    return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                }
                return 'video';
            });
            
            console.log(`📊 Video title: ${videoTitle}`);
            
            return {
                success: true,
                downloadUrl: videoDownloadUrl,
                title: videoTitle || 'video',
                quality: quality,
                videoId: videoId,
                selectedQuality: qualityText,
                service: 'Zeemo'
            };
        }
        
        // ============================================================
        // STEP 10: CLICK THE "Download video" BUTTON IF IT EXISTS
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
            console.log('⚠️  No "Download video" button found - checking network again...');
        }
        
        // ============================================================
        // STEP 11: WAIT FOR NETWORK RESPONSE
        // ============================================================
        console.log('⏳ WAITING 10 seconds for network response...');
        await page.waitForTimeout(10000);
        
        // ============================================================
        // STEP 12: GET VIDEO URL
        // ============================================================
        let downloadUrl = null;
        
        if (videoDownloadUrl) {
            downloadUrl = videoDownloadUrl;
            console.log(`✅ Video URL captured from network: ${downloadUrl.substring(0, 100)}...`);
        } else {
            console.log('📌 No video URL captured, searching HTML...');
            
            const pageHtml = await page.content();
            
            const sfMatches = pageHtml.match(/https?:\/\/[^\s"']*sf-converter\.com\/prod-new\/download[^\s"']*/gi);
            if (sfMatches && sfMatches.length > 0) {
                downloadUrl = sfMatches[0];
                console.log(`✅ Found sf-converter URL in HTML`);
            }
            
            if (!downloadUrl) {
                const mp4Matches = pageHtml.match(/https?:\/\/[^\s"']*\.mp4[^\s"']*/gi);
                if (mp4Matches && mp4Matches.length > 0) {
                    downloadUrl = mp4Matches[0];
                    console.log(`✅ Found MP4 URL in HTML`);
                }
            }
            
            if (!downloadUrl) {
                const gvMatches = pageHtml.match(/https?:\/\/[^\s"']*googlevideo\.com[^\s"']*/gi);
                if (gvMatches && gvMatches.length > 0) {
                    downloadUrl = gvMatches[0];
                    console.log(`✅ Found Google Video URL in HTML`);
                }
            }
        }
        
        // ============================================================
        // STEP 13: GET VIDEO TITLE
        // ============================================================
        let videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return 'video';
        });
        
        console.log(`📊 Video title: ${videoTitle}`);
        console.log(`📊 Download URL found: ${!!downloadUrl}`);
        
        console.log('⏳ Keeping browser open for 5 seconds...');
        await page.waitForTimeout(5000);
        
        return {
            success: !!downloadUrl,
            downloadUrl: downloadUrl || null,
            title: videoTitle || 'video',
            quality: quality,
            videoId: videoId,
            selectedQuality: qualityText,
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
// STREAM FILE DIRECTLY TO CLIENT
// ============================================================

async function streamFile(url, filename, res) {
    console.log(`📥 Streaming file to client: ${filename}`);
    
    if (!url) {
        res.status(400).json({ error: 'No URL provided' });
        return;
    }
    
    try {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
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
            timeout: 120000
        });
        
        response.data.pipe(res);
        
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

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'Zeemo (streaming)',
        tempDir: TEMP_DIR,
        screenshotDir: SCREENSHOT_DIR,
        environment: 'local',
        browserMode: 'visible',
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
    console.log('👁️  Browser is VISIBLE - watch it work!');
    console.log('');
    console.log('📌 Browser Download (paste in address bar):');
    console.log(`   http://localhost:${PORT}/api/download/VIDEO_ID?quality=720p`);
    console.log('');
    console.log('📌 POST /api/download - For curl/API use');
    console.log('📌 GET  /api/health  - Health check');
    console.log('');
    console.log('📁 Temp directory: ' + TEMP_DIR);
    console.log('📸 Screenshot location: ' + SCREENSHOT_DIR);
});