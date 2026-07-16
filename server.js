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

console.log(`📁 Downloads will be saved to: ${DOWNLOAD_DIR}`);
console.log(`📸 Screenshots will be saved to: ${SCREENSHOT_DIR}`);

// ============================================================
// QUALITY MAPPING
// ============================================================

const QUALITY_MAP = {
    '1080p': '1080P',
    '720p': '720P',
    '480p': '480P',
    '360p': '360P',
    '240p': '240P',
    '144p': '144P',
    'best': '720P'
};

// ============================================================
// FIND INPUT FIELD - MULTIPLE SELECTORS WITH SCREENSHOT
// ============================================================

async function findInputField(page, videoId) {
    console.log('📌 Waiting for input field...');
    
    await page.waitForTimeout(3000);
    
    // Take screenshot of the page
    const screenshotPath = path.join(SCREENSHOT_DIR, `${videoId}_page.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);
    
    // Also get page HTML for debugging
    const htmlPath = path.join(SCREENSHOT_DIR, `${videoId}_page.html`);
    const htmlContent = await page.content();
    fs.writeFileSync(htmlPath, htmlContent);
    console.log(`📄 HTML saved: ${htmlPath}`);
    
    const selectors = [
        '#url-input-wrapper',
        'input[type="text"]',
        'input[placeholder*="Paste"]',
        'input[placeholder*="paste"]',
        'input[placeholder*="YouTube"]',
        'input[placeholder*="link"]',
        'input[class*="url"]',
        'input[class*="input"]',
        'input[name="url"]',
        'input[name="link"]',
        '#url-input',
        '#search-input',
        '.url-input',
        '.search-input'
    ];
    
    for (const selector of selectors) {
        try {
            const input = await page.waitForSelector(selector, { 
                timeout: 3000 
            });
            if (input) {
                console.log(`✅ Found input by: ${selector}`);
                // Take screenshot of the input found
                const foundPath = path.join(SCREENSHOT_DIR, `${videoId}_input_found.png`);
                await page.screenshot({ path: foundPath });
                console.log(`📸 Input found screenshot: ${foundPath}`);
                return input;
            }
        } catch (e) {}
    }
    
    // Take screenshot of failure
    const failPath = path.join(SCREENSHOT_DIR, `${videoId}_input_not_found.png`);
    await page.screenshot({ path: failPath });
    console.log(`📸 Input not found screenshot: ${failPath}`);
    
    console.log('❌ All input selectors failed');
    return null;
}

// ============================================================
// FIND DOWNLOAD ICON
// ============================================================

async function findDownloadIcon(page) {
    console.log('📌 Looking for download icon...');
    
    const selectors = [
        '[alt="download icon"]',
        'img[alt*="download"]',
        'img[src*="download"]',
        '.download-icon',
        '[class*="download-icon"]',
        'button[class*="download"]',
        'a[class*="download"]'
    ];
    
    for (const selector of selectors) {
        try {
            const icon = await page.$(selector);
            if (icon) {
                console.log(`✅ Found download icon by: ${selector}`);
                return icon;
            }
        } catch (e) {}
    }
    
    console.log('⚠️  Download icon not found');
    return null;
}

// ============================================================
// FIND DOWNLOAD BUTTON
// ============================================================

async function findDownloadButton(page) {
    console.log('📌 Looking for download button...');
    
    const selectors = [
        'span.text-\\[0\\.28rem\\].text-\\[var\\(--brand-primary\\)\\].md\\:text-\\[18px\\]',
        'text=Download',
        'button:has-text("Download")',
        'a:has-text("Download")',
        '.download-btn',
        '.btn-download',
        'button[class*="download"]',
        'a[class*="download"]'
    ];
    
    for (const selector of selectors) {
        try {
            const btn = await page.$(selector);
            if (btn) {
                console.log(`✅ Found download button by: ${selector}`);
                return btn;
            }
        } catch (e) {}
    }
    
    try {
        const btns = await page.$$('button, a');
        for (const btn of btns) {
            const text = await btn.textContent();
            if (text && text.toLowerCase().includes('download')) {
                console.log('✅ Found download button by text');
                return btn;
            }
        }
    } catch (e) {}
    
    console.log('⚠️  Download button not found');
    return null;
}

// ============================================================
// SAVE FILE TO DOWNLOADS FOLDER
// ============================================================

async function saveFile(url, filename) {
    return new Promise((resolve, reject) => {
        const filePath = path.join(DOWNLOAD_DIR, filename);
        console.log(`📥 Saving to: ${filePath}`);
        
        if (!url || (!url.includes('vidssave.com') && !url.includes('googlevideo.com') && !url.includes('.mp4'))) {
            console.log('❌ URL is not a valid video URL');
            reject(new Error('Invalid video URL'));
            return;
        }
        
        const file = fs.createWriteStream(filePath);
        let downloaded = 0;
        let total = 0;
        
        const protocol = url.startsWith('https') ? require('https') : require('http');
        
        const request = protocol.get(url, {
            headers: {
                'Referer': 'https://vidssave.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`🔄 Redirecting...`);
                saveFile(response.headers.location, filename).then(resolve).catch(reject);
                return;
            }
            
            const contentType = response.headers['content-type'] || '';
            if (contentType.includes('text/html')) {
                console.log('⚠️  Received HTML instead of video!');
                reject(new Error('URL points to webpage, not video'));
                return;
            }
            
            if (response.statusCode === 403) {
                console.log('⚠️  URL expired (403). Need to get fresh URL.');
                reject(new Error('URL expired. Please try again.'));
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
        
        request.setTimeout(60000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

// ============================================================
// GET DOWNLOAD URL - WITH SCREENSHOTS
// ============================================================

async function getDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting download URL for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    
    const qualityText = QUALITY_MAP[quality] || '720P';
    
    let context;
    try {
        context = await chromium.launchPersistentContext(
            '/tmp/playwright-profile',
            {
                headless: true,
                slowMo: 100,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            }
        );
    } catch (error) {
        console.error('❌ Failed to launch browser:', error.message);
        return { success: false, error: 'Browser launch failed: ' + error.message };
    }
    
    let page = null;
    let downloadUrl = null;
    let videoTitle = 'video';
    let selectedQuality = 'None';
    
    try {
        page = await context.newPage();
        
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });
        
        await page.setViewportSize({ width: 1366, height: 768 });
        
        const videoUrl = `https://youtu.be/${videoId}`;
        
        // ============================================================
        // STEP 1: NAVIGATE TO VIDSSAVE
        // ============================================================
        console.log('📌 Opening vidssave.com...');
        await page.goto('https://vidssave.com/youtube-video-downloader-7gt', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        
        console.log('✅ Page loaded');
        
        // Take screenshot of initial page
        const initialScreenshot = path.join(SCREENSHOT_DIR, `${videoId}_initial.png`);
        await page.screenshot({ path: initialScreenshot });
        console.log(`📸 Initial screenshot: ${initialScreenshot}`);
        
        await page.waitForTimeout(3000);
        
        // ============================================================
        // STEP 2: ENTER URL
        // ============================================================
        const inputField = await findInputField(page, videoId);
        
        if (inputField) {
            await inputField.click();
            await inputField.fill(videoUrl);
            console.log('✅ URL entered');
        } else {
            console.log('❌ Input field not found');
            return { success: false, error: 'Input field not found' };
        }
        
        // ============================================================
        // STEP 3: CLICK DOWNLOAD ICON
        // ============================================================
        const downloadIcon = await findDownloadIcon(page);
        if (downloadIcon) {
            await downloadIcon.click();
            console.log('✅ Download icon clicked!');
        } else {
            console.log('⚠️  Download icon not found, continuing...');
        }
        
        // Take screenshot after clicking
        const afterClickScreenshot = path.join(SCREENSHOT_DIR, `${videoId}_after_click.png`);
        await page.screenshot({ path: afterClickScreenshot });
        console.log(`📸 After click screenshot: ${afterClickScreenshot}`);
        
        // ============================================================
        // STEP 4: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ Waiting 8 seconds for results...');
        await page.waitForTimeout(8000);
        
        // Take screenshot of results
        const resultsScreenshot = path.join(SCREENSHOT_DIR, `${videoId}_results.png`);
        await page.screenshot({ path: resultsScreenshot });
        console.log(`📸 Results screenshot: ${resultsScreenshot}`);
        
        console.log('📌 Waiting for quality options...');
        try {
            await page.waitForSelector('.download-option, button[data-testid="format-pill"], .quality-option', { 
                timeout: 15000 
            });
            console.log('✅ Quality options found');
        } catch (e) {
            console.log('⚠️  Quality options not found');
        }
        
        await page.waitForTimeout(2000);
        
        // ============================================================
        // STEP 5: SELECT QUALITY
        // ============================================================
        console.log(`📌 Looking for ${qualityText} quality...`);
        
        try {
            const qualityElement = page.getByText(qualityText);
            if (await qualityElement.isVisible({ timeout: 5000 })) {
                await qualityElement.click();
                console.log(`✅ ${qualityText} selected!`);
                selectedQuality = qualityText;
            }
        } catch (e) {
            console.log(`⚠️  Error selecting ${qualityText}:`, e.message);
        }
        
        if (selectedQuality === 'None') {
            console.log('📌 Trying to find any quality option...');
            const qualities = ['1080P', '720P', '480P', '360P', '240P', '144P'];
            for (const q of qualities) {
                try {
                    const el = page.getByText(q);
                    if (await el.isVisible({ timeout: 2000 })) {
                        await el.click();
                        console.log(`✅ ${q} selected!`);
                        selectedQuality = q;
                        break;
                    }
                } catch (e) {}
            }
        }
        
        // ============================================================
        // STEP 6: NETWORK INTERCEPTION
        // ============================================================
        console.log('📌 Setting up network interception...');
        let capturedUrl = null;
        
        context.on('response', (response) => {
            const url = response.url();
            if (url && (url.includes('vidssave.com/download') || url.includes('.mp4'))) {
                console.log(`🌐 Download URL captured`);
                capturedUrl = url;
            }
        });
        
        // ============================================================
        // STEP 7: CLICK DOWNLOAD
        // ============================================================
        const downloadBtn = await findDownloadButton(page);
        if (downloadBtn) {
            await Promise.all([
                page.waitForResponse(
                    response => response.url().includes('vidssave.com/download') || 
                               response.url().includes('.mp4'),
                    { timeout: 15000 }
                ).then(response => {
                    if (response && !capturedUrl) {
                        capturedUrl = response.url();
                        console.log(`✅ Download URL captured from network!`);
                    }
                }).catch(() => {}),
                downloadBtn.click()
            ]);
            console.log('✅ Download clicked');
        } else {
            console.log('⚠️  Download button not found');
        }
        
        // Take screenshot before closing
        const finalScreenshot = path.join(SCREENSHOT_DIR, `${videoId}_final.png`);
        await page.screenshot({ path: finalScreenshot });
        console.log(`📸 Final screenshot: ${finalScreenshot}`);
        
        // ============================================================
        // STEP 8: WAIT FOR NETWORK
        // ============================================================
        console.log('⏳ Waiting 5 seconds for network...');
        await page.waitForTimeout(5000);
        
        if (capturedUrl) {
            downloadUrl = capturedUrl;
            console.log('✅ Download URL captured!');
        }
        
        // ============================================================
        // STEP 9: FALLBACK - SEARCH HTML
        // ============================================================
        if (!downloadUrl) {
            console.log('📌 Searching HTML for download URL...');
            const pageHtml = await page.content();
            let match = pageHtml.match(/https?:\/\/[a-zA-Z0-9\-\.]+\.vidssave\.com\/[^\s"']+download[^\s"']*/);
            if (match) {
                downloadUrl = match[0];
                console.log('✅ Found vidssave download URL in HTML');
            }
        }
        
        videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            return titleEl ? titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_') : 'video';
        });
        
        console.log(`📊 Video title: ${videoTitle}`);
        console.log(`📊 Download URL found: ${!!downloadUrl}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (page) {
            try { await page.close(); } catch (e) {}
        }
        try { await context.close(); } catch (e) {}
    }
    
    return {
        success: !!downloadUrl,
        downloadUrl: downloadUrl || null,
        title: videoTitle || 'video',
        quality: quality,
        videoId: videoId,
        selectedQuality: selectedQuality,
        screenshots: SCREENSHOT_DIR
    };
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
            } catch (downloadError) {
                console.error('❌ Error saving file:', downloadError.message);
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

// ============================================================
// VIEW SCREENSHOTS ENDPOINT
// ============================================================

app.get('/api/screenshots', (req, res) => {
    try {
        const files = fs.readdirSync(SCREENSHOT_DIR);
        const screenshotFiles = files.filter(f => f.endsWith('.png') || f.endsWith('.html'));
        res.json({
            success: true,
            screenshots: screenshotFiles,
            count: screenshotFiles.length,
            directory: SCREENSHOT_DIR
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// SERVE SCREENSHOTS
// ============================================================

app.get('/api/screenshot/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.sendFile(filePath);
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'Vidssave Automation',
        downloadDir: DOWNLOAD_DIR,
        screenshotDir: SCREENSHOT_DIR,
        environment: process.env.RENDER ? 'render' : 'local',
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

app.get('/api/check', (req, res) => {
    res.json({
        status: 'ready',
        downloadDir: DOWNLOAD_DIR,
        screenshotDir: SCREENSHOT_DIR,
        environment: process.env.RENDER ? 'render' : 'local'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 YouTube Downloader Server running at http://localhost:${PORT}`);
    console.log(`📌 POST /api/download - Download video`);
    console.log(`📌 GET  /api/health  - Health check`);
    console.log(`📌 GET  /api/files   - List downloaded files`);
    console.log(`📌 GET  /api/screenshots - List screenshots`);
    console.log(`📌 GET  /api/screenshot/:filename - View screenshot`);
    console.log('');
    console.log(`📁 Download location: ${DOWNLOAD_DIR}`);
    console.log(`📸 Screenshot location: ${SCREENSHOT_DIR}`);
});