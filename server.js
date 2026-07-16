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

console.log(`📁 Downloads: ${DOWNLOAD_DIR}`);
console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);

// ============================================================
// QUALITY MAPPING
// ============================================================

const QUALITY_MAP = {
    '1080p': '1080p',
    '720p': '720p',
    '480p': '480p',
    '360p': '360p',
    '240p': '240p',
    '144p': '144p',
    'best': '720p'
};

// ============================================================
// FIND INPUT FIELD - YTDOWN.TO (MULTIPLE METHODS)
// ============================================================

async function findInputField(page, videoId) {
    console.log('📌 Looking for input field...');
    
    // Wait for page to stabilize
    await page.waitForTimeout(3000);
    
    // Take screenshot of the page
    try {
        const screenshotPath = path.join(SCREENSHOT_DIR, `${videoId}_page.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } catch (e) {
        console.log('⚠️  Could not take screenshot');
    }
    
    // Try all possible selectors
    const selectors = [
        '#postUrl',
        'input[type="text"]',
        'input[placeholder*="Paste"]',
        'input[placeholder*="paste"]',
        'input[placeholder*="YouTube"]',
        'input[placeholder*="link"]',
        'input[class*="url"]',
        'input[name="url"]',
        '.url-input',
        '#url-input'
    ];
    
    for (const selector of selectors) {
        try {
            const input = await page.$(selector);
            if (input && await input.isVisible()) {
                console.log(`✅ Found input by: ${selector}`);
                return input;
            }
        } catch (e) {}
    }
    
    // Try by role (Playwright's built-in)
    try {
        const input = page.getByRole('textbox');
        if (await input.isVisible({ timeout: 3000 })) {
            console.log('✅ Found input by role');
            return input;
        }
    } catch (e) {}
    
    // Try by placeholder text
    try {
        const input = page.getByPlaceholder('Paste your YouTube video link');
        if (await input.isVisible({ timeout: 3000 })) {
            console.log('✅ Found input by placeholder');
            return input;
        }
    } catch (e) {}
    
    // Try to find any visible input
    try {
        const inputs = await page.$$('input');
        for (const input of inputs) {
            const isVisible = await input.isVisible();
            if (isVisible) {
                const type = await input.getAttribute('type');
                if (type === 'text' || type === 'url' || !type) {
                    console.log('✅ Found visible input');
                    return input;
                }
            }
        }
    } catch (e) {}
    
    // Save HTML for debugging
    try {
        const htmlPath = path.join(SCREENSHOT_DIR, `${videoId}_page.html`);
        const html = await page.content();
        fs.writeFileSync(htmlPath, html);
        console.log(`📄 HTML saved: ${htmlPath}`);
    } catch (e) {}
    
    console.log('❌ Input field not found');
    return null;
}

// ============================================================
// SAVE FILE TO DOWNLOADS FOLDER
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
                'Referer': 'https://app.ytdown.to/',
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
        
        request.setTimeout(60000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

// ============================================================
// GET DOWNLOAD URL - YTDOWN.TO
// ============================================================

async function getDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting download URL for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    
    const qualityText = QUALITY_MAP[quality] || '720p';
    
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
                    '--disable-features=IsolateOrigins,site-per-process'
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
        // STEP 1: NAVIGATE TO YTDOWN.TO
        // ============================================================
        console.log('📌 Opening ytdown.to...');
        await page.goto('https://app.ytdown.to/en35/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        
        console.log('✅ Page loaded');
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
            // Take screenshot of failure
            try {
                const failPath = path.join(SCREENSHOT_DIR, `${videoId}_input_not_found.png`);
                await page.screenshot({ path: failPath });
                console.log(`📸 Input not found screenshot: ${failPath}`);
            } catch (e) {}
            
            console.log('❌ Input field not found');
            return { success: false, error: 'Input field not found' };
        }
        
        // ============================================================
        // STEP 3: CLICK DOWNLOAD
        // ============================================================
        console.log('📌 Clicking Download...');
        const downloadBtn = await page.$('.download-label');
        if (downloadBtn) {
            await downloadBtn.click();
            console.log('✅ Download clicked!');
        } else {
            console.log('⚠️  Download button not found');
        }
        
        // ============================================================
        // STEP 4: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ Waiting 5 seconds for results...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 5: SELECT QUALITY
        // ============================================================
        console.log(`📌 Looking for ${qualityText} quality...`);
        
        const qualityOptions = await page.$$('.download-option');
        console.log(`📊 Found ${qualityOptions.length} quality options`);
        
        if (qualityOptions.length > 0) {
            for (const opt of qualityOptions) {
                const text = await opt.textContent();
                console.log(`   - ${text}`);
            }
            
            let qualitySelected = false;
            for (const opt of qualityOptions) {
                const text = await opt.textContent();
                if (text && text.includes(qualityText)) {
                    await opt.click();
                    console.log(`✅ ${qualityText} selected!`);
                    selectedQuality = qualityText;
                    qualitySelected = true;
                    break;
                }
            }
            
            if (!qualitySelected) {
                console.log(`⚠️  Using first available quality`);
                await qualityOptions[0].click();
                console.log(`✅ Used first available quality`);
            }
        } else {
            console.log('⚠️  No quality options found');
        }
        
        // ============================================================
        // STEP 6: CLICK START
        // ============================================================
        console.log('📌 Clicking Start...');
        await page.waitForTimeout(2000);
        
        const startBtn = await page.$('#downloadButton');
        if (startBtn) {
            await startBtn.click();
            console.log('✅ Start clicked!');
        } else {
            console.log('⚠️  Start button not found');
        }
        
        // ============================================================
        // STEP 7: NETWORK INTERCEPTION
        // ============================================================
        console.log('📌 Setting up network interception...');
        let capturedUrl = null;
        
        context.on('response', (response) => {
            const url = response.url();
            if (url && (url.includes('.mp4') || url.includes('.webm') || url.includes('googlevideo'))) {
                console.log(`🌐 Video URL captured`);
                capturedUrl = url;
            }
        });
        
        // ============================================================
        // STEP 8: WAIT FOR DOWNLOAD
        // ============================================================
        console.log('⏳ Waiting 10 seconds for download...');
        await page.waitForTimeout(10000);
        
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
            const match = pageHtml.match(/https?:\/\/[^\s"']*\.(mp4|webm)[^\s"']*/);
            if (match) {
                downloadUrl = match[0];
                console.log('✅ Found video URL in HTML');
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
        selectedQuality: selectedQuality
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

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'YTDownload.to',
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