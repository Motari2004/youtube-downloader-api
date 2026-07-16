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
// FIND INPUT FIELD - Y2MATE
// ============================================================

async function findInputField(page, videoId) {
    console.log('📌 Looking for input field on Y2mate...');
    
    // Wait for page to stabilize
    await page.waitForTimeout(3000);
    
    // Take screenshot for debugging
    try {
        const screenshotPath = path.join(SCREENSHOT_DIR, `${videoId}_y2mate_page.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } catch (e) {
        console.log('⚠️  Could not take screenshot');
    }
    
    // Y2mate specific selectors
    const selectors = [
        'input#txt-url',
        'input[type="text"]',
        'input[placeholder*="paste"]',
        'input[placeholder*="Paste"]',
        'input[placeholder*="keyword"]',
        'input[placeholder*="YouTube"]',
        'input[name="q"]',
        'input[name="url"]',
        'input[class*="url"]',
        '#url-input',
        '.form-control',
        'input[type="search"]'
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
    
    // Try by role
    try {
        const input = page.getByRole('textbox');
        if (await input.isVisible({ timeout: 3000 })) {
            console.log('✅ Found input by role');
            return input;
        }
    } catch (e) {}
    
    // Try by placeholder text
    try {
        const input = page.getByPlaceholder(/paste|youtube|link|keyword/i);
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
                if (type === 'text' || type === 'url' || type === 'search' || !type) {
                    console.log('✅ Found visible input');
                    return input;
                }
            }
        }
    } catch (e) {}
    
    // Save HTML for debugging
    try {
        const htmlPath = path.join(SCREENSHOT_DIR, `${videoId}_y2mate_page.html`);
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
                'Referer': 'https://v24.www-y2mate.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
// GET DOWNLOAD URL - Y2MATE
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
        // STEP 1: NAVIGATE TO Y2MATE
        // ============================================================
        console.log('📌 Opening Y2mate...');
        await page.goto('https://v24.www-y2mate.com/', {
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
            // Clear and fill
            await inputField.click({ clickCount: 3 });
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
        // STEP 3: CLICK START/SEARCH
        // ============================================================
        console.log('📌 Clicking Start/Convert...');
        
        // Try different button selectors
        const buttonSelectors = [
            'button[type="submit"]',
            'button:has-text("Start")',
            'button:has-text("Convert")',
            'button:has-text("Download")',
            'input[type="submit"]',
            '.btn-start',
            '.btn-primary',
            '#btn-submit'
        ];
        
        let startClicked = false;
        for (const selector of buttonSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn && await btn.isVisible()) {
                    await btn.click();
                    console.log(`✅ Clicked: ${selector}`);
                    startClicked = true;
                    break;
                }
            } catch (e) {}
        }
        
        if (!startClicked) {
            console.log('⚠️  No start button found, pressing Enter...');
            await page.keyboard.press('Enter');
        }
        
        // ============================================================
        // STEP 4: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ Waiting 5 seconds for results...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 5: SELECT QUALITY & GET DOWNLOAD LINK
        // ============================================================
        console.log(`📌 Looking for ${qualityText} quality options...`);
        
        // Y2mate usually shows quality buttons like "720p", "1080p" etc.
        const qualityLinks = await page.$$('a[download], a[href*="download"], .btn-download, .download-btn');
        console.log(`📊 Found ${qualityLinks.length} download links`);
        
        if (qualityLinks.length > 0) {
            // Look for quality in text or href
            let targetLink = null;
            let targetQuality = qualityText;
            
            for (const link of qualityLinks) {
                const text = await link.textContent();
                const href = await link.getAttribute('href');
                const combined = `${text} ${href || ''}`;
                
                console.log(`   - Checking: ${text}`);
                
                // Look for quality match (e.g., "720p", "1080p")
                if (combined.includes(qualityText) || 
                    (qualityText === '720p' && combined.includes('720')) ||
                    (qualityText === '1080p' && combined.includes('1080'))) {
                    targetLink = link;
                    targetQuality = qualityText;
                    break;
                }
            }
            
            // If no quality match, use first available
            if (!targetLink) {
                console.log(`⚠️  No ${qualityText} found, using first available`);
                targetLink = qualityLinks[0];
            }
            
            if (targetLink) {
                // Get the download URL
                const href = await targetLink.getAttribute('href');
                if (href) {
                    downloadUrl = href.startsWith('http') ? href : `https://v24.www-y2mate.com${href}`;
                    console.log(`✅ Download link found: ${downloadUrl}`);
                    selectedQuality = targetQuality;
                } else {
                    // Try clicking the link
                    await targetLink.click();
                    console.log('✅ Clicked download link');
                }
            }
        } else {
            // Try to find download links in the page
            console.log('📌 Searching HTML for download links...');
            const pageHtml = await page.content();
            
            // Look for download URLs
            const downloadMatches = pageHtml.match(/https?:\/\/[^\s"']*\.(mp4|webm|3gp|avi)[^\s"']*/gi);
            if (downloadMatches && downloadMatches.length > 0) {
                downloadUrl = downloadMatches[0];
                console.log(`✅ Found download URL in HTML: ${downloadUrl}`);
            }
        }
        
        // ============================================================
        // STEP 6: NETWORK INTERCEPTION (for AJAX downloads)
        // ============================================================
        console.log('📌 Setting up network interception...');
        let capturedUrl = null;
        
        context.on('response', (response) => {
            const url = response.url();
            if (url && (url.includes('.mp4') || url.includes('.webm') || 
                       url.includes('googlevideo') || url.includes('download'))) {
                console.log(`🌐 Video URL captured: ${url.substring(0, 100)}...`);
                capturedUrl = url;
            }
        });
        
        // ============================================================
        // STEP 7: WAIT FOR DOWNLOAD
        // ============================================================
        console.log('⏳ Waiting 10 seconds for download...');
        await page.waitForTimeout(10000);
        
        if (capturedUrl) {
            downloadUrl = capturedUrl;
            console.log('✅ Download URL captured from network!');
        }
        
        // ============================================================
        // STEP 8: GET VIDEO TITLE
        // ============================================================
        videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"], .video-title, .filename');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return 'youtube_video';
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
        service: 'Y2mate'
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
        mode: 'Y2mate',
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