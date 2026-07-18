const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// CONFIGURATION
// ============================================================

const MAX_CONCURRENT_BROWSERS = process.env.MAX_BROWSERS || 3;
const BROWSER_TIMEOUT = parseInt(process.env.BROWSER_TIMEOUT) || 60000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 600000;
const MAX_CACHE_SIZE = parseInt(process.env.MAX_CACHE_SIZE) || 100;

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
console.log(`📊 Max concurrent browsers: ${MAX_CONCURRENT_BROWSERS}`);
console.log(`⏱️  Browser timeout: ${BROWSER_TIMEOUT}ms`);

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
// LOGGING FUNCTIONS
// ============================================================

function logStep(step, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] 📌 ${step}: ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

function logSuccess(message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] ✅ ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

function logError(message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] ❌ ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

function logWarning(message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] ⚠️ ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

function logInfo(message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] ℹ️ ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

function logBrowser(message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] 🌐 ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

function logNetwork(message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] 📡 ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    console.log(logMsg);
}

// ============================================================
// BROWSER POOL
// ============================================================

class BrowserPool {
    constructor(maxSize = 3) {
        this.maxSize = maxSize;
        this.browsers = [];
        this.queue = [];
        this.activeCount = 0;
        logInfo('Browser pool initialized', { maxSize });
    }

    async acquire() {
        logInfo('Acquiring browser', { active: this.activeCount, max: this.maxSize, waiting: this.queue.length });
        
        return new Promise((resolve, reject) => {
            const available = this.browsers.find(b => !b.inUse);
            if (available) {
                available.inUse = true;
                this.activeCount++;
                logInfo('Browser acquired (reused)', { active: this.activeCount });
                resolve(available.browser);
                return;
            }

            if (this.browsers.length < this.maxSize) {
                logInfo('Creating new browser', { total: this.browsers.length + 1, max: this.maxSize });
                this.createBrowser().then(browser => {
                    this.browsers.push({ browser, inUse: true });
                    this.activeCount++;
                    logInfo('New browser created', { total: this.browsers.length, active: this.activeCount });
                    resolve(browser);
                }).catch(reject);
                return;
            }

            logInfo('Browser queueing', { waiting: this.queue.length + 1 });
            this.queue.push({ resolve, reject });
        });
    }

    async createBrowser() {
        logBrowser('Launching Chromium browser');
        const browser = await chromium.launch({
            headless: true,
            slowMo: 30,
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
        logBrowser('Browser launched successfully');
        return browser;
    }

    release(browser) {
        const entry = this.browsers.find(b => b.browser === browser);
        if (entry) {
            entry.inUse = false;
            this.activeCount--;
            logInfo('Browser released', { active: this.activeCount, waiting: this.queue.length });
            
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                logInfo('Processing queued request', { remaining: this.queue.length });
                this.acquire().then(next.resolve).catch(next.reject);
            }
        }
    }

    async close() {
        logInfo('Closing all browsers...');
        for (const entry of this.browsers) {
            try { 
                await entry.browser.close(); 
                logBrowser('Browser closed');
            } catch (e) {}
        }
        this.browsers = [];
        this.activeCount = 0;
        logInfo('All browsers closed');
    }

    getStats() {
        return {
            total: this.browsers.length,
            active: this.activeCount,
            waiting: this.queue.length,
            max: this.maxSize
        };
    }
}

const browserPool = new BrowserPool(MAX_CONCURRENT_BROWSERS);

// ============================================================
// VIDEO CACHE
// ============================================================

class VideoCache {
    constructor(maxSize = 100, ttl = 600000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
        logInfo('Cache initialized', { maxSize, ttl: `${ttl/60000}min` });
    }

    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
            logInfo('Cache evicted oldest entry');
        }
        this.cache.set(key, {
            value: value,
            timestamp: Date.now()
        });
        logInfo('Cached entry', { key, size: this.cache.size });
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            logInfo('Cache miss', { key });
            return null;
        }
        
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            logInfo('Cache expired', { key });
            return null;
        }
        
        logInfo('Cache hit', { key });
        return entry.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        this.cache.delete(key);
        logInfo('Cache deleted', { key });
    }

    size() {
        return this.cache.size;
    }

    clear() {
        this.cache.clear();
        logInfo('Cache cleared');
    }
}

const videoCache = new VideoCache(MAX_CACHE_SIZE, CACHE_TTL);

// ============================================================
// GET VIDEO TITLE
// ============================================================

async function getVideoTitle(videoId) {
    logStep('Fetch Title', 'Getting video title from Noembed API', { videoId });
    try {
        const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        if (data && data.title) {
            logSuccess('Title fetched', { videoId, title: data.title });
            return data.title;
        }
        logWarning('No title in API response', { videoId });
        return null;
    } catch (error) {
        logError('Noembed API failed', { videoId, error: error.message });
        return null;
    }
}

// ============================================================
// Y2MATE.GS - BOTH VIDEO (MP4) AND AUDIO (MP3)
// ============================================================

async function getY2MateDownloadUrl(videoId, format = 'mp4', quality = '720p') {
    logStep('Start Y2Mate Download', `Processing ${format.toUpperCase()}`, { videoId, quality });
    
    const videoUrl = `https://youtu.be/${videoId}`;
    const qualityText = QUALITY_MAP[quality] || '720p';
    let browser = null;
    let context = null;
    let page = null;
    const startTime = Date.now();
    
    try {
        logStep('Step 1', 'Acquiring browser');
        browser = await browserPool.acquire();
        logSuccess('Browser acquired');
        
        logStep('Step 2', 'Creating browser context and page');
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        page = await context.newPage();
        logSuccess('Context and page created');
        
        // ============================================================
        // NETWORK INTERCEPTION - Capture ONLY download URLs (NOT convert)
        // ============================================================
        let downloadUrl = null;
        let urlCaptured = false;
        let responseCount = 0;
        
        context.on('response', async (response) => {
            responseCount++;
            const url = response.url();
            
            // Log first 15 responses for debugging
            if (responseCount <= 15) {
                logNetwork(`Response ${responseCount}`, { url: url.substring(0, 100) });
            }
            
            // ONLY capture actual download URLs (not convert, not progress, not auth)
            if (!urlCaptured && url) {
                const isDownloadUrl = (
                    url.includes('/api/v1/download') &&
                    url.includes('sig=') &&
                    url.includes('f=')
                );
                
                // Also check for direct file URLs
                const isDirectFile = (
                    url.includes('.mp4') || 
                    url.includes('.mp3')
                );
                
                if (isDownloadUrl || isDirectFile) {
                    // Skip analytics/tracking
                    if (!url.includes('google-analytics') && 
                        !url.includes('analytics') && 
                        !url.includes('tracking')) {
                        downloadUrl = url;
                        urlCaptured = true;
                        logNetwork(`${format.toUpperCase()} DOWNLOAD URL captured`, { url: url.substring(0, 100) });
                    }
                }
            }
        });
        
        logStep('Step 3', 'Navigating to Y2Mate.gs');
        await page.goto('https://y2mate.gs/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
        await page.waitForTimeout(2000);
        logSuccess('Page loaded', { elapsed: `${Date.now() - startTime}ms`, responses: responseCount });
        
        logStep('Step 4', 'Looking for input field');
        let inputField = null;
        
        try {
            inputField = page.getByRole('textbox', { name: 'Paste your YouTube link' });
            if (await inputField.isVisible({ timeout: 5000 })) {
                logSuccess('Input field found', { name: 'Paste your YouTube link' });
            }
        } catch (e) {
            logWarning('Primary input selector failed', { error: e.message });
        }
        
        if (!inputField) {
            try {
                inputField = page.getByPlaceholder('Paste your YouTube link');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    logSuccess('Input field found', { placeholder: 'Paste your YouTube link' });
                }
            } catch (e) {}
        }
        
        if (!inputField) {
            try {
                inputField = page.getByRole('textbox');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    logSuccess('Input field found', { role: 'textbox' });
                }
            } catch (e) {}
        }
        
        if (!inputField) {
            logError('Input field not found');
            return { success: false, error: 'Input field not found' };
        }
        
        logStep('Step 5', `Entering YouTube URL: ${videoUrl}`);
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await inputField.fill(videoUrl);
        await page.waitForTimeout(500);
        logSuccess('URL entered');
        
        // ============================================================
        // STEP 6: Click Format Button (MP4 or MP3)
        // ============================================================
        const formatLabel = format === 'mp4' ? 'MP4' : 'MP3';
        logStep('Step 6', `Clicking ${formatLabel} button`);
        let formatClicked = false;
        
        try {
            const formatBtn = page.getByRole('button', { name: formatLabel });
            if (await formatBtn.isVisible({ timeout: 3000 })) {
                await formatBtn.click();
                formatClicked = true;
                logSuccess(`${formatLabel} button clicked`);
            }
        } catch (e) {
            logWarning(`${formatLabel} button not found`, { error: e.message });
        }
        
        if (!formatClicked) {
            logStep('Step 6', `Trying alternative ${formatLabel} button`);
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.textContent();
                if (text && text.trim() === formatLabel) {
                    await btn.click();
                    formatClicked = true;
                    logSuccess(`${formatLabel} button clicked (alternative)`);
                    break;
                }
            }
        }
        
        if (!formatClicked) {
            logWarning(`${formatLabel} button not found, proceeding anyway`);
        }
        
        // ============================================================
        // STEP 7: Click Convert Button
        // ============================================================
        logStep('Step 7', 'Clicking Convert button');
        let convertClicked = false;
        
        try {
            const convertBtn = page.getByRole('button', { name: 'Convert' });
            if (await convertBtn.isVisible({ timeout: 3000 })) {
                await convertBtn.click();
                convertClicked = true;
                logSuccess('Convert button clicked');
            }
        } catch (e) {
            logWarning('Convert button not found', { error: e.message });
        }
        
        if (!convertClicked) {
            logStep('Step 7', 'Trying alternative Convert button');
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.textContent();
                if (text && (text.trim() === 'Convert' || text.includes('Convert'))) {
                    await btn.click();
                    convertClicked = true;
                    logSuccess('Convert button clicked (alternative)');
                    break;
                }
            }
        }
        
        if (!convertClicked) {
            logStep('Step 7', 'Pressing Enter as fallback');
            await page.keyboard.press('Enter');
        }
        
        // ============================================================
        // STEP 8: Wait for conversion (8 seconds)
        // ============================================================
        logStep('Step 8', 'Waiting for conversion (8s)');
        await page.waitForTimeout(8000);
        logSuccess('Conversion wait complete');
        
        // ============================================================
        // STEP 9: Click Download button - This triggers the actual download URL
        // ============================================================
        logStep('Step 9', 'Clicking Download button');
        try {
            const downloadBtn = page.getByRole('button', { name: 'Download' });
            if (await downloadBtn.isVisible({ timeout: 5000 })) {
                await downloadBtn.click();
                logSuccess('Download button clicked');
            } else {
                logWarning('Download button not found');
            }
        } catch (e) {
            logWarning('Error clicking download button', { error: e.message });
        }
        
        // ============================================================
        // STEP 10: Wait for the actual download URL to appear
        // ============================================================
        logStep('Step 10', 'Waiting for actual download URL (10s)');
        
        // Wait up to 15 seconds for the download URL
        let waitTime = 0;
        const maxWait = 15000;
        const checkInterval = 500;
        
        while (!urlCaptured && waitTime < maxWait) {
            await page.waitForTimeout(checkInterval);
            waitTime += checkInterval;
            
            // Log every 2 seconds
            if (waitTime % 2000 === 0) {
                logStep('Step 10', `Still waiting for download URL... (${waitTime/1000}s)`);
            }
        }
        
        if (urlCaptured) {
            logSuccess(`Download URL captured after ${waitTime}ms`);
        } else {
            logWarning(`Download URL not captured after ${waitTime}ms, trying HTML search`);
        }
        
        // ============================================================
        // STEP 11: Extract title
        // ============================================================
        logStep('Step 11', 'Extracting title');
        let videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return null;
        });
        
        if (!videoTitle) {
            videoTitle = await getVideoTitle(videoId) || `${format}_${videoId}`;
        }
        logSuccess('Title extracted', { title: videoTitle });
        
        // ============================================================
        // STEP 12: Search HTML for download URL if not captured
        // ============================================================
        if (!downloadUrl) {
            logStep('Step 12', 'Searching HTML for download URL');
            const pageHtml = await page.content();
            
            // Look for the specific download URL pattern
            const downloadPattern = /https?:\/\/[^\s"']*etacloud\.org\/api\/v1\/download[^\s"']*f=(mp4|mp3)[^\s"']*/gi;
            const matches = pageHtml.match(downloadPattern);
            
            if (matches && matches.length > 0) {
                // Get the correct format
                for (const match of matches) {
                    if (format === 'mp4' && match.includes('f=mp4')) {
                        downloadUrl = match;
                        logSuccess(`Found ${format.toUpperCase()} download URL in HTML`, { url: downloadUrl.substring(0, 100) });
                        break;
                    } else if (format === 'mp3' && match.includes('f=mp3')) {
                        downloadUrl = match;
                        logSuccess(`Found ${format.toUpperCase()} download URL in HTML`, { url: downloadUrl.substring(0, 100) });
                        break;
                    }
                }
            }
            
            if (!downloadUrl) {
                // Try to find any etacloud URL with download
                const anyDownload = pageHtml.match(/https?:\/\/[^\s"']*etacloud\.org\/api\/v1\/download[^\s"']*/gi);
                if (anyDownload && anyDownload.length > 0) {
                    downloadUrl = anyDownload[0];
                    logSuccess(`Found etacloud download URL (any)`, { url: downloadUrl.substring(0, 100) });
                } else {
                    logWarning(`No ${format.toUpperCase()} download URL found in HTML`);
                }
            }
        }
        
        // ============================================================
        // STEP 13: Validate the download URL
        // ============================================================
        if (downloadUrl && (downloadUrl.includes('/convert') || downloadUrl.includes('/progress') || downloadUrl.includes('/auth'))) {
            logWarning(`Download URL is convert/progress/auth, trying to find real download`, { url: downloadUrl.substring(0, 100) });
            
            // Try to find the real download URL in the page one more time
            const pageHtml = await page.content();
            const realDownloadPattern = /https?:\/\/[^\s"']*etacloud\.org\/api\/v1\/download[^\s"']*f=(mp4|mp3)[^\s"']*/gi;
            const realMatches = pageHtml.match(realDownloadPattern);
            if (realMatches && realMatches.length > 0) {
                downloadUrl = realMatches[0];
                logSuccess(`Found real download URL in HTML`, { url: downloadUrl.substring(0, 100) });
            } else {
                downloadUrl = null;
            }
        }
        
        const totalTime = Date.now() - startTime;
        const extension = format === 'mp4' ? 'mp4' : 'mp3';
        const filename = `${videoTitle || 'video'}.${extension}`;
        
        logSuccess(`${format.toUpperCase()} download URL obtained in ${totalTime}ms`, { 
            success: !!downloadUrl,
            totalTime: `${totalTime}ms`
        });
        
        return {
            success: !!downloadUrl,
            downloadUrl: downloadUrl || null,
            title: videoTitle || `${format}_${videoId}`,
            quality: quality,
            format: format,
            filename: filename
        };
        
    } catch (error) {
        logError(`${format.toUpperCase()} download failed`, { error: error.message });
        return { success: false, error: error.message };
    } finally {
        if (page) {
            try { await page.close(); logBrowser('Page closed'); } catch (e) {}
        }
        if (context) {
            try { await context.close(); logBrowser('Context closed'); } catch (e) {}
        }
        if (browser) {
            browserPool.release(browser);
            logInfo('Browser released to pool', { stats: browserPool.getStats() });
        }
    }
}

// ============================================================
// STREAM FILE
// ============================================================

async function streamFile(url, filename, res) {
    logStep('Stream Start', `Streaming file: ${filename}`, { url: url.substring(0, 100) });
    
    if (!url) {
        logError('No URL provided for streaming');
        res.status(400).json({ error: 'No URL provided' });
        return;
    }
    
    try {
        const encodedFilename = encodeURIComponent(filename);
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Content-Type', filename.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4');
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('Cache-Control', 'no-cache');
        logStep('Stream Headers', 'Headers set', { filename });
        
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
                'Referer': 'https://y2mate.gs/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 120000,
            maxRedirects: 5
        });
        
        let contentLength = response.headers['content-length'];
        let fileSize = contentLength ? parseInt(contentLength) : 0;
        
        if (fileSize > 0) {
            res.setHeader('Content-Length', fileSize);
            logStep('Stream Size', `File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        } else {
            res.setHeader('Transfer-Encoding', 'chunked');
            logStep('Stream Size', 'File size: unknown (chunked)');
        }
        
        response.data.pipe(res);
        logSuccess('Stream started');
        
        response.data.on('end', () => {
            logSuccess('Stream complete', { filename });
        });
        
        response.data.on('error', (err) => {
            logError('Stream error', { filename, error: err.message });
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        });
        
    } catch (error) {
        logError('Stream failed', { filename, error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
}

// ============================================================
// API ENDPOINTS
// ============================================================

app.post('/api/download', async (req, res) => {
    const { videoId, quality = '720p', type = 'video' } = req.body;
    const format = type === 'audio' ? 'mp3' : 'mp4';
    
    logStep('Download Request', `Downloading ${format.toUpperCase()}`, { videoId, quality });
    
    if (!videoId) {
        logError('Missing videoId');
        return res.status(400).json({ error: 'videoId required' });
    }
    
    const cacheKey = `${videoId}_${quality}_${format}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached && cached.url) {
        logSuccess('Using cached download', { cacheKey });
        await streamFile(cached.url, cached.filename || `${cached.title || 'video'}.${format}`, res);
        videoCache.delete(cacheKey);
        return;
    }
    
    try {
        const result = await getY2MateDownloadUrl(videoId, format, quality);
        
        if (!result.success || !result.downloadUrl) {
            logError('Download failed', { error: result.error });
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        videoCache.set(cacheKey, {
            url: result.downloadUrl,
            title: result.title,
            quality: quality,
            format: format,
            filename: result.filename,
            timestamp: Date.now()
        });
        
        logSuccess('Download ready, streaming', { filename: result.filename });
        await streamFile(result.downloadUrl, result.filename, res);
        
    } catch (error) {
        logError('Download error', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

app.get('/api/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    const format = type === 'audio' ? 'mp3' : 'mp4';
    
    logStep('Download Request (GET)', `Downloading ${format.toUpperCase()}`, { videoId, quality });
    
    const cacheKey = `${videoId}_${quality}_${format}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached && cached.url) {
        logSuccess('Using cached download (GET)', { cacheKey });
        await streamFile(cached.url, cached.filename || `${cached.title || 'video'}.${format}`, res);
        videoCache.delete(cacheKey);
        return;
    }
    
    try {
        const result = await getY2MateDownloadUrl(videoId, format, quality);
        
        if (!result.success || !result.downloadUrl) {
            logError('Download failed (GET)', { error: result.error });
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        videoCache.set(cacheKey, {
            url: result.downloadUrl,
            title: result.title,
            quality: quality,
            format: format,
            filename: result.filename,
            timestamp: Date.now()
        });
        
        logSuccess('Download ready, streaming (GET)', { filename: result.filename });
        await streamFile(result.downloadUrl, result.filename, res);
        
    } catch (error) {
        logError('Download error (GET)', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

app.get('/api/health', (req, res) => {
    logStep('Health Check', 'Server health check');
    res.json({
        status: 'running',
        mode: 'Y2Mate.gs (MP4 + MP3)',
        environment: process.env.RENDER ? 'render' : 'local',
        cacheSize: videoCache.size(),
        pool: browserPool.getStats(),
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGTERM', async () => {
    logStep('Shutdown', 'Received SIGTERM, shutting down...');
    await browserPool.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logStep('Shutdown', 'Received SIGINT, shutting down...');
    await browserPool.close();
    process.exit(0);
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log('');
    console.log(`🚀 YouTube Downloader Server running on port ${PORT}`);
    console.log(`🔗 Using: Y2Mate.gs (MP4 Video + MP3 Audio)`);
    console.log(`📊 Browser Pool: ${MAX_CONCURRENT_BROWSERS} concurrent browsers`);
    console.log(`📊 Cache: ${MAX_CACHE_SIZE} items, TTL: ${CACHE_TTL/60000} minutes`);
    console.log(`📌 POST /api/download - Download video/audio`);
    console.log(`📌 GET /api/download/:videoId - Browser download`);
    console.log(`📌 GET /api/health - Health check`);
    console.log(`📁 Temp directory: ${TEMP_DIR}`);
    console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);
});