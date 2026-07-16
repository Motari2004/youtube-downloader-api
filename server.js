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
// DOWNLOAD LOCATION - Render uses /tmp for ephemeral storage
// ============================================================

const DOWNLOAD_DIR = process.env.RENDER 
    ? '/tmp/downloads' 
    : path.join(__dirname, 'downloads');

const SCREENSHOT_DIR = process.env.RENDER 
    ? '/tmp/screenshots' 
    : path.join(__dirname, 'screenshots');

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log(`📁 Downloads: ${DOWNLOAD_DIR}`);
console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);

// ============================================================
// QUALITY MAPPING - CutYT
// ============================================================

const QUALITY_MAP = {
    '1080p': '1080p',
    '720p': '720p',
    '480p': '480p',
    '360p': '360p',
    'best': '720p'
};

// ============================================================
// GET DOWNLOAD URL - CUTYT
// ============================================================

async function getDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting download URL for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    console.log(`🔗 Using: CutYT.com`);
    
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
        // STEP 1: NAVIGATE TO CUTYT
        // ============================================================
        console.log('📌 Opening CutYT...');
        await page.goto('https://www.cutyt.com/', {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        console.log('✅ Page loaded');
        await page.waitForTimeout(3000);
        
        // Save screenshot for debugging
        try {
            const screenshotPath = path.join(SCREENSHOT_DIR, `${videoId}_page.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (e) {
            console.log('⚠️  Could not save screenshot');
        }
        
        // ============================================================
        // STEP 2: FIND INPUT FIELD - MULTIPLE METHODS
        // ============================================================
        console.log('📌 Looking for input field...');
        
        await page.waitForTimeout(2000);
        
        // Try multiple selectors
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
            'input[class*="input"]',
            'input[class*="search"]',
            'input[class*="form"]',
            '#url-input',
            '#link-input',
            '.form-control'
        ];
        
        let inputField = null;
        let foundSelector = '';
        
        for (const selector of inputSelectors) {
            try {
                const el = await page.$(selector);
                if (el) {
                    const isVisible = await el.isVisible();
                    if (isVisible) {
                        inputField = el;
                        foundSelector = selector;
                        console.log(`✅ Found input by: ${selector}`);
                        break;
                    }
                }
            } catch (e) {}
        }
        
        // Try by placeholder text
        if (!inputField) {
            try {
                const placeholderTexts = ['Paste', 'paste', 'link', 'URL', 'url'];
                for (const text of placeholderTexts) {
                    try {
                        inputField = await page.getByPlaceholder(text);
                        if (await inputField.isVisible({ timeout: 1000 })) {
                            foundSelector = `placeholder: ${text}`;
                            console.log(`✅ Found input by placeholder: "${text}"`);
                            break;
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        }
        
        // Try by role
        if (!inputField) {
            try {
                inputField = page.getByRole('textbox');
                if (await inputField.isVisible({ timeout: 2000 })) {
                    foundSelector = 'role: textbox';
                    console.log('✅ Found input by role');
                } else {
                    inputField = null;
                }
            } catch (e) {}
        }
        
        // Try to find any visible input
        if (!inputField) {
            try {
                const inputs = await page.$$('input');
                for (const el of inputs) {
                    const isVisible = await el.isVisible();
                    if (isVisible) {
                        const type = await el.getAttribute('type');
                        if (type === 'text' || type === 'url' || !type) {
                            inputField = el;
                            foundSelector = 'any visible input';
                            console.log('✅ Found any visible input');
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
        
        if (!inputField) {
            console.log('❌ Input field not found');
            // Save HTML for debugging
            try {
                const htmlPath = path.join(SCREENSHOT_DIR, `${videoId}_page.html`);
                const html = await page.content();
                fs.writeFileSync(htmlPath, html);
                console.log(`📄 HTML saved: ${htmlPath}`);
            } catch (e) {}
            return { success: false, error: 'Input field not found' };
        }
        
        // ============================================================
        // STEP 3: ENTER URL
        // ============================================================
        console.log(`📌 Entering URL: ${videoUrl}`);
        
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(100);
        await inputField.fill(videoUrl);
        console.log('✅ URL entered');
        await page.waitForTimeout(500);
        
        // ============================================================
        // STEP 4: CLICK THE "Start" BUTTON
        // ============================================================
        console.log('📌 Looking for "Start" button...');
        
        let startClicked = false;
        
        try {
            const startButton = page.getByRole('button', { name: 'Start' });
            if (await startButton.isVisible({ timeout: 3000 })) {
                await startButton.click();
                console.log('✅ Clicked "Start" button by role!');
                startClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Role method failed:', e.message);
        }
        
        if (!startClicked) {
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await btn.textContent();
                    if (text && (text.trim() === 'Start' || text.includes('Start'))) {
                        await btn.click();
                        console.log('✅ Clicked "Start" button by text!');
                        startClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Text method failed:', e.message);
            }
        }
        
        if (!startClicked) {
            try {
                const startButton = page.getByLabel('Start');
                if (await startButton.isVisible({ timeout: 2000 })) {
                    await startButton.click();
                    console.log('✅ Clicked "Start" button by aria-label!');
                    startClicked = true;
                }
            } catch (e) {}
        }
        
        if (!startClicked) {
            try {
                const startButton = await page.$('[class*="start"], [id*="start"], .btn-start, #start-btn');
                if (startButton && await startButton.isVisible()) {
                    await startButton.click();
                    console.log('✅ Clicked "Start" button by class/id!');
                    startClicked = true;
                }
            } catch (e) {}
        }
        
        if (!startClicked) {
            console.log('⚠️  No "Start" button found, pressing Enter...');
            await page.keyboard.press('Enter');
        }
        
        // ============================================================
        // STEP 5: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ Waiting for conversion...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 6: CLICK THE "MP4" LINK
        // ============================================================
        console.log('📌 Looking for "MP4" link...');
        
        let mp4Clicked = false;
        
        try {
            const mp4Link = page.getByRole('link', { name: 'MP4' });
            if (await mp4Link.isVisible({ timeout: 3000 })) {
                await mp4Link.click();
                console.log('✅ Clicked "MP4" link by role!');
                mp4Clicked = true;
            }
        } catch (e) {
            console.log('⚠️  Role method failed:', e.message);
        }
        
        if (!mp4Clicked) {
            try {
                const links = await page.$$('a');
                for (const link of links) {
                    const text = await link.textContent();
                    if (text && text.trim() === 'MP4') {
                        await link.click();
                        console.log('✅ Clicked "MP4" link by text!');
                        mp4Clicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Text method failed:', e.message);
            }
        }
        
        if (!mp4Clicked) {
            try {
                const mp4Link = await page.$('a[href*="mp4"], a[href*="MP4"]');
                if (mp4Link && await mp4Link.isVisible()) {
                    await mp4Link.click();
                    console.log('✅ Clicked "MP4" link by href!');
                    mp4Clicked = true;
                }
            } catch (e) {
                console.log('⚠️  Href method failed:', e.message);
            }
        }
        
        if (!mp4Clicked) {
            console.log('⚠️  No "MP4" link found');
        }
        
        // ============================================================
        // ⏰ WAIT 60 SECONDS AFTER CLICKING MP4
        // ============================================================
        console.log('⏳ WAITING 60 SECONDS (1 minute) after clicking MP4...');
        await page.waitForTimeout(60000);
        
        // ============================================================
        // STEP 7: CLICK THE "Download MP4 now" BUTTON
        // ============================================================
        console.log('📌 Looking for "Download MP4 now" button...');
        
        let downloadNowClicked = false;
        
        try {
            const downloadNowBtn = page.getByRole('link', { name: 'Download MP4 now' });
            if (await downloadNowBtn.isVisible({ timeout: 3000 })) {
                await downloadNowBtn.click();
                console.log('✅ Clicked "Download MP4 now" button by role!');
                downloadNowClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Role method failed:', e.message);
        }
        
        if (!downloadNowClicked) {
            try {
                const links = await page.$$('a, button');
                for (const el of links) {
                    const text = await el.textContent();
                    if (text && text.includes('Download MP4 now')) {
                        await el.click();
                        console.log('✅ Clicked "Download MP4 now" by text!');
                        downloadNowClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Text method failed:', e.message);
            }
        }
        
        if (!downloadNowClicked) {
            try {
                const downloadBtn = await page.$('[class*="download"], [id*="download"], .btn-download, #download-btn');
                if (downloadBtn && await downloadBtn.isVisible()) {
                    await downloadBtn.click();
                    console.log('✅ Clicked download button by class/id!');
                    downloadNowClicked = true;
                }
            } catch (e) {
                console.log('⚠️  Class method failed:', e.message);
            }
        }
        
        if (!downloadNowClicked) {
            console.log('⚠️  No "Download MP4 now" button found');
        }
        
        // Wait for download to start
        console.log('⏳ Waiting for download to start...');
        await page.waitForTimeout(3000);
        
        // ============================================================
        // STEP 8: LOOK FOR DOWNLOAD LINKS
        // ============================================================
        console.log('📌 Looking for download links...');
        
        let downloadUrl = null;
        let selectedQuality = qualityText;
        
        const allElements = await page.$$('a, button, .btn, [class*="download"], [class*="quality"], [class*="format"]');
        console.log(`📊 Found ${allElements.length} elements`);
        
        for (const el of allElements) {
            try {
                const text = await el.textContent();
                const html = await el.innerHTML();
                const combined = `${text} ${html}`.toLowerCase();
                
                if (combined.includes('download') || 
                    combined.includes('mp4') || 
                    combined.includes('720') || 
                    combined.includes('1080') ||
                    combined.includes('480') ||
                    combined.includes('get')) {
                    
                    console.log(`📌 Found potential element: ${text?.trim() || 'no text'}`);
                    
                    const href = await el.getAttribute('href');
                    if (href && (href.includes('http') || href.includes('/download'))) {
                        downloadUrl = href.startsWith('http') ? href : `https://www.cutyt.com${href}`;
                        console.log(`✅ Found download URL from href: ${downloadUrl.substring(0, 80)}...`);
                        break;
                    }
                    
                    if (!downloadUrl) {
                        try {
                            console.log(`🖱️  Clicking element: ${text?.trim() || 'no text'}`);
                            await el.click();
                            await page.waitForTimeout(2000);
                            
                            const newHref = await el.getAttribute('href');
                            if (newHref && (newHref.includes('http') || newHref.includes('/download'))) {
                                downloadUrl = newHref.startsWith('http') ? newHref : `https://www.cutyt.com${newHref}`;
                                console.log(`✅ Download URL after click: ${downloadUrl.substring(0, 80)}...`);
                                break;
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        }
        
        // ============================================================
        // STEP 9: FALLBACK - SEARCH HTML
        // ============================================================
        if (!downloadUrl) {
            console.log('📌 Searching HTML for video URL...');
            const pageHtml = await page.content();
            
            const mp4Matches = pageHtml.match(/https?:\/\/[^\s"']*\.mp4[^\s"']*/gi);
            if (mp4Matches && mp4Matches.length > 0) {
                downloadUrl = mp4Matches[0];
                console.log(`✅ Found MP4 URL: ${downloadUrl.substring(0, 80)}...`);
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
            service: 'CutYT'
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
                'Referer': 'https://www.cutyt.com/',
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
        mode: 'CutYT',
        downloadDir: DOWNLOAD_DIR,
        screenshotDir: SCREENSHOT_DIR,
        environment: process.env.RENDER ? 'render' : 'local',
        browserMode: 'headless',
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

// ============================================================
// SCREENSHOTS ENDPOINT - ADDED FOR DEBUGGING
// ============================================================

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
    console.log('🔗 Using: CutYT.com');
    console.log('📌 POST /api/download - Download video');
    console.log('📌 GET  /api/health  - Health check');
    console.log('📌 GET  /api/files   - List downloaded files');
    console.log('📌 GET  /api/screenshots - List screenshots');
    console.log('📌 GET  /api/screenshot/:filename - View screenshot');
    console.log('');
    console.log('📁 Download location: ' + DOWNLOAD_DIR);
    console.log('📸 Screenshot location: ' + SCREENSHOT_DIR);
});