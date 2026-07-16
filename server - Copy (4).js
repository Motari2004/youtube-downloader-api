const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// ============================================================
// DOWNLOAD LOCATION
// ============================================================

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log(`📁 Downloads: ${DOWNLOAD_DIR}`);
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
// GET DOWNLOAD URL - ZEEMO.TO
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
        
        console.log('✅ Page loaded - LOOK AT THE BROWSER!');
        await page.waitForTimeout(3000);
        
        // Save screenshot
        try {
            const screenshotPath = path.join(SCREENSHOT_DIR, `${videoId}_zeemo_page.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (e) {
            console.log('⚠️  Could not save screenshot');
        }
        
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
            try {
                inputField = page.locator('#app input');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    console.log('✅ Found input by: #app input');
                } else {
                    inputField = null;
                }
            } catch (e) {
                console.log('⚠️  Method 4 failed:', e.message);
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
        // STEP 6: SET UP NETWORK INTERCEPTION - ONLY CAPTURE VIDEO URLs
        // ============================================================
        console.log('📌 Setting up network interception for video URL...');
        
        let videoDownloadUrl = null;
        
        // Listen for all responses
        context.on('response', async (response) => {
            const url = response.url();
            
            // ONLY capture real video URLs - ignore analytics, ads, etc.
            if (url && (
                url.includes('sf-converter.com/prod-new/download') ||
                url.includes('.mp4') || 
                url.includes('googlevideo')
            )) {
                // Make sure it's not analytics or tracking
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
        // STEP 7: FIND AND CLICK THE "Download" BUTTON (FIRST ONE)
        // ============================================================
        console.log('📌 Looking for "Download" button...');
        console.log('👀 WATCH the browser - clicking "Download"!');
        
        let downloadClicked = false;
        
        // Get all download buttons and click the first one (720p)
        try {
            const downloadButtons = await page.$$('button.table__result-download');
            if (downloadButtons.length > 0) {
                // Click the first download button (usually 720p)
                await downloadButtons[0].click();
                console.log(`✅ Clicked first "Download" button! (${downloadButtons.length} found)`);
                downloadClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        // Fallback: find by text
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
        
        // ============================================================
        // ⏰ WAIT 5 SECONDS FOR "Download video" BUTTON TO APPEAR
        // ============================================================
        console.log('⏳ WAITING 5 seconds for "Download video" button to appear...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 8: CLICK THE "Download video" BUTTON
        // ============================================================
        console.log('📌 Looking for "Download video" button...');
        console.log('👀 WATCH the browser - this will trigger the actual download!');
        
        let downloadVideoClicked = false;
        
        // Method 1: Using getByRole
        try {
            const downloadVideoBtn = page.getByRole('button', { name: 'Download video' });
            if (await downloadVideoBtn.isVisible({ timeout: 3000 })) {
                await downloadVideoBtn.click();
                console.log('✅ Clicked "Download video" button by role! - CHECK NETWORK!');
                downloadVideoClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        // Method 2: Find by text
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
        
        // Method 3: Try as link
        if (!downloadVideoClicked) {
            try {
                const downloadVideoBtn = page.getByRole('link', { name: 'Download video' });
                if (await downloadVideoBtn.isVisible({ timeout: 2000 })) {
                    await downloadVideoBtn.click();
                    console.log('✅ Clicked "Download video" link!');
                    downloadVideoClicked = true;
                }
            } catch (e) {
                console.log('⚠️  Method 3 failed:', e.message);
            }
        }
        
        if (!downloadVideoClicked) {
            console.log('⚠️  No "Download video" button found!');
        }
        
        // ============================================================
        // STEP 9: WAIT FOR NETWORK RESPONSE
        // ============================================================
        console.log('⏳ WAITING 10 seconds for network response...');
        await page.waitForTimeout(10000);
        
        // ============================================================
        // STEP 10: GET VIDEO URL FROM NETWORK OR HTML
        // ============================================================
        let downloadUrl = null;
        let selectedQuality = qualityText;
        
        if (videoDownloadUrl) {
            downloadUrl = videoDownloadUrl;
            console.log(`✅ Video URL captured from network: ${downloadUrl.substring(0, 100)}...`);
        } else {
            console.log('📌 No video URL captured from network, searching HTML...');
            
            const pageHtml = await page.content();
            
            const mp4Matches = pageHtml.match(/https?:\/\/[^\s"']*\.mp4[^\s"']*/gi);
            if (mp4Matches && mp4Matches.length > 0) {
                downloadUrl = mp4Matches[0];
                console.log(`✅ Found MP4 URL in HTML: ${downloadUrl.substring(0, 80)}...`);
            }
            
            if (!downloadUrl) {
                const sfMatches = pageHtml.match(/https?:\/\/[^\s"']*sf-converter\.com\/prod-new\/download[^\s"']*/gi);
                if (sfMatches && sfMatches.length > 0) {
                    downloadUrl = sfMatches[0];
                    console.log(`✅ Found sf-converter URL in HTML: ${downloadUrl.substring(0, 80)}...`);
                }
            }
            
            if (!downloadUrl) {
                const gvMatches = pageHtml.match(/https?:\/\/[^\s"']*googlevideo\.com[^\s"']*/gi);
                if (gvMatches && gvMatches.length > 0) {
                    downloadUrl = gvMatches[0];
                    console.log(`✅ Found Google Video URL: ${downloadUrl.substring(0, 80)}...`);
                }
            }
        }
        
        // ============================================================
        // STEP 11: GET VIDEO TITLE
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
        
        // Keep browser open
        console.log('⏳ Keeping browser open for 5 seconds...');
        await page.waitForTimeout(5000);
        
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
// SAVE FILE
// ============================================================

async function saveFile(url, filename) {
    return new Promise((resolve, reject) => {
        const filePath = path.join(DOWNLOAD_DIR, filename);
        console.log(`📥 Saving to: ${filePath}`);
        
        if (!url) {
            reject(new Error('No URL provided'));
            return;
        }
        
        const file = fs.createWriteStream(filePath);
        let downloaded = 0;
        let total = 0;
        
        const protocol = url.startsWith('https') ? require('https') : require('http');
        
        const request = protocol.get(url, {
            headers: {
                'Referer': 'https://zeemo.to/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`🔄 Redirecting...`);
                saveFile(response.headers.location, filename).then(resolve).catch(reject);
                return;
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            
            total = parseInt(response.headers['content-length']) || 0;
            console.log(`📊 File size: ${(total / 1024 / 1024).toFixed(2)} MB`);
            
            response.on('data', (chunk) => {
                downloaded += chunk.length;
                const percent = total ? (downloaded / total * 100).toFixed(1) : '?';
                process.stdout.write(`\r   Downloading: ${percent}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log('');
                console.log(`✅ Download complete: ${filename}`);
                console.log(`📁 Saved to: ${filePath}`);
                console.log(`📊 Size: ${(downloaded / 1024 / 1024).toFixed(2)} MB`);
                resolve({ success: true, filePath, size: downloaded });
            });
            
            file.on('error', (err) => {
                console.log('');
                reject(err);
            });
        });
        
        request.on('error', (err) => {
            console.log('');
            reject(err);
        });
        
        request.setTimeout(120000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
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
        
        if (result.success && result.downloadUrl) {
            const filename = `${result.title}_${result.quality}_${videoId}.mp4`;
            console.log(`📥 Downloading file to: ${DOWNLOAD_DIR}`);
            
            try {
                const saveResult = await saveFile(result.downloadUrl, filename);
                result.filePath = saveResult.filePath;
                result.savedTo = DOWNLOAD_DIR;
                result.size = saveResult.size;
            } catch (downloadError) {
                console.error('❌ Error saving file:', downloadError.message);
                result.saveError = downloadError.message;
            }
        }
        
        res.json(result);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'Zeemo',
        downloadDir: DOWNLOAD_DIR,
        screenshotDir: SCREENSHOT_DIR,
        environment: 'local',
        browserMode: 'visible',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOAD_DIR);
        res.json({
            success: true,
            files: files,
            count: files.length,
            directory: DOWNLOAD_DIR
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
    console.log('📌 POST /api/download - Download video');
    console.log('📌 GET  /api/health  - Health check');
    console.log('📌 GET  /api/files   - List downloaded files');
    console.log('📌 GET  /api/screenshots - List screenshots');
    console.log('');
    console.log('📁 Download location: ' + DOWNLOAD_DIR);
    console.log('📸 Screenshot location: ' + SCREENSHOT_DIR);
});