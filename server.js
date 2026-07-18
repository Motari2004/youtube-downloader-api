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
// VIDEO CACHE WITH TTL
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
// GET VIDEO TITLE FROM NOEMBED API
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
// ZEEMO.TO - VIDEO DOWNLOAD
// ============================================================

async function getVideoDownloadUrl(videoId, quality = '720p') {
    logStep('Start Video Download', `Processing video: ${videoId}`, { quality });
    
    const qualityText = QUALITY_MAP[quality] || '720p';
    let browser = null;
    let context = null;
    let page = null;
    const startTime = Date.now();
    
    try {
        // ============================================================
        // STEP 1: Acquire browser
        // ============================================================
        logStep('Step 1', 'Acquiring browser from pool');
        browser = await browserPool.acquire();
        logSuccess('Browser acquired');
        
        // ============================================================
        // STEP 2: Create context and page
        // ============================================================
        logStep('Step 2', 'Creating browser context and page');
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        page = await context.newPage();
        logSuccess('Context and page created');
        
        // ============================================================
        // STEP 3: Navigate to Zeemo
        // ============================================================
        logStep('Step 3', 'Navigating to Zeemo.to');
        await page.goto('https://zeemo.to/en2/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
        await page.waitForTimeout(2000);
        logSuccess('Page loaded', { elapsed: `${Date.now() - startTime}ms` });
        
        // ============================================================
        // STEP 4: Find input field
        // ============================================================
        logStep('Step 4', 'Looking for input field');
        let inputField = null;
        try {
            inputField = page.locator('#app').getByRole('textbox');
            if (await inputField.isVisible({ timeout: 5000 })) {
                logSuccess('Input field found', { selector: '#app textbox' });
            }
        } catch (e) {
            logWarning('Primary input selector failed', { error: e.message });
        }
        
        if (!inputField) {
            logStep('Step 4', 'Trying alternative input selectors');
            const inputSelectors = ['input[type="url"]', 'input[type="text"]', 'input[placeholder*="Paste"]', 'input[name="url"]'];
            for (const selector of inputSelectors) {
                try {
                    inputField = await page.$(selector);
                    if (inputField && await inputField.isVisible()) {
                        logSuccess('Input field found', { selector });
                        break;
                    }
                } catch (e) {}
            }
        }
        
        if (!inputField) {
            logError('Input field not found');
            return { success: false, error: 'Input field not found' };
        }
        
        // ============================================================
        // STEP 5: Enter URL
        // ============================================================
        logStep('Step 5', 'Entering YouTube URL', { url: `https://youtu.be/${videoId}` });
        const videoUrl = `https://youtu.be/${videoId}`;
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await inputField.fill(videoUrl);
        await page.waitForTimeout(500);
        logSuccess('URL entered');
        
        // ============================================================
        // STEP 6: Click Search
        // ============================================================
        logStep('Step 6', 'Clicking Search button');
        try {
            const searchButton = page.getByRole('button', { name: 'Search' });
            if (await searchButton.isVisible({ timeout: 3000 })) {
                await searchButton.click();
                logSuccess('Search button clicked');
            }
        } catch (e) {
            logWarning('Search button not found');
        }
        
        // ============================================================
        // STEP 7: Wait for results
        // ============================================================
        logStep('Step 7', 'Waiting for results (5s)');
        await page.waitForTimeout(5000);
        logSuccess('Results loaded');
        
        // ============================================================
        // STEP 8: Get video title
        // ============================================================
        logStep('Step 8', 'Extracting video title');
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
        logSuccess('Title extracted', { title: videoTitle });
        
        // ============================================================
        // STEP 9: Set up network interception
        // ============================================================
        logStep('Step 9', 'Setting up network interception for video URL');
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
                logNetwork('Video URL captured', { url: url.substring(0, 100) });
            }
        });
        
        // ============================================================
        // STEP 10: Find and click quality button
        // ============================================================
        logStep('Step 10', `Finding quality button: ${qualityText}`);
        const rows = await page.$$('tr');
        let downloadClicked = false;
        logInfo(`Found ${rows.length} rows`);
        
        for (let i = 0; i < rows.length; i++) {
            try {
                const rowText = await rows[i].textContent();
                if (rowText && rowText.includes(qualityText)) {
                    const buttonsInRow = await rows[i].$$('button');
                    if (buttonsInRow.length > 0) {
                        await buttonsInRow[0].click();
                        downloadClicked = true;
                        logSuccess(`Quality button clicked`, { row: i, quality: qualityText });
                        break;
                    }
                }
            } catch (e) {}
        }
        
        if (!downloadClicked) {
            logWarning('Quality button not found, using fallback');
            const buttons = await page.$$('button.table__result-download');
            if (buttons.length > 0) {
                await buttons[0].click();
                downloadClicked = true;
                logSuccess(`Fallback download button clicked`, { count: buttons.length });
            }
        }
        
        // ============================================================
        // STEP 11: Check for direct download
        // ============================================================
        logStep('Step 11', 'Checking for direct download (3s)');
        await page.waitForTimeout(3000);
        
        if (videoDownloadUrl && videoDownloadUrl.includes('googlevideo.com')) {
            logSuccess('Direct download detected', { url: videoDownloadUrl.substring(0, 100) });
            return {
                success: true,
                downloadUrl: videoDownloadUrl,
                title: videoTitle,
                quality: quality
            };
        }
        
        // ============================================================
        // STEP 12: Click "Download video" if needed
        // ============================================================
        logStep('Step 12', 'Looking for "Download video" button (5s)');
        await page.waitForTimeout(5000);
        
        try {
            const downloadVideoBtn = page.getByRole('button', { name: 'Download video' });
            if (await downloadVideoBtn.isVisible({ timeout: 3000 })) {
                await downloadVideoBtn.click();
                logSuccess('"Download video" button clicked');
            } else {
                logWarning('"Download video" button not found');
            }
        } catch (e) {
            logWarning('Error clicking "Download video"', { error: e.message });
        }
        
        // ============================================================
        // STEP 13: Final wait
        // ============================================================
        logStep('Step 13', 'Final wait for network response (10s)');
        await page.waitForTimeout(10000);
        
        let downloadUrl = videoDownloadUrl;
        if (!downloadUrl) {
            logStep('Step 13', 'Searching HTML for video URL');
            const pageHtml = await page.content();
            const gvMatches = pageHtml.match(/https?:\/\/[^\s"']*googlevideo\.com[^\s"']*/gi);
            if (gvMatches && gvMatches.length > 0) {
                downloadUrl = gvMatches[0];
                logSuccess('Found Google Video URL in HTML', { url: downloadUrl.substring(0, 100) });
            } else {
                logWarning('No video URL found in HTML');
            }
        }
        
        const totalTime = Date.now() - startTime;
        logSuccess(`Video download URL obtained in ${totalTime}ms`, { 
            success: !!downloadUrl,
            totalTime: `${totalTime}ms`
        });
        
        return {
            success: !!downloadUrl,
            downloadUrl: downloadUrl || null,
            title: videoTitle,
            quality: quality
        };
        
    } catch (error) {
        logError('Video download failed', { error: error.message });
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
// Y2MATE.GS - AUDIO DOWNLOAD
// ============================================================

async function getAudioDownloadUrl(videoId) {
    logStep('Start Audio Download', `Processing audio: ${videoId}`);
    
    const videoUrl = `https://youtu.be/${videoId}`;
    let browser = null;
    let context = null;
    let page = null;
    const startTime = Date.now();
    
    try {
        // ============================================================
        // STEP 1: Acquire browser
        // ============================================================
        logStep('Step 1', 'Acquiring browser for audio');
        browser = await browserPool.acquire();
        logSuccess('Browser acquired for audio');
        
        // ============================================================
        // STEP 2: Create context and page
        // ============================================================
        logStep('Step 2', 'Creating browser context and page for audio');
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        page = await context.newPage();
        logSuccess('Context and page created for audio');
        
        // ============================================================
        // STEP 3: Set up network interception for MP3
        // ============================================================
        logStep('Step 3', 'Setting up network interception for MP3');
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
                        logNetwork('MP3 URL captured', { url: url.substring(0, 100) });
                    }
                }
            }
        });
        
        // ============================================================
        // STEP 4: Navigate to Y2Mate
        // ============================================================
        logStep('Step 4', 'Navigating to Y2Mate.gs');
        await page.goto('https://y2mate.gs/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
        await page.waitForTimeout(2000);
        logSuccess('Page loaded', { elapsed: `${Date.now() - startTime}ms` });
        
        // ============================================================
        // STEP 5: Find input field
        // ============================================================
        logStep('Step 5', 'Looking for input field');
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
            logError('Input field not found for audio');
            return { success: false, error: 'Input field not found' };
        }
        
        // ============================================================
        // STEP 6: Enter URL
        // ============================================================
        logStep('Step 6', 'Entering YouTube URL for audio', { url: videoUrl });
        await inputField.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await inputField.fill(videoUrl);
        await page.waitForTimeout(500);
        logSuccess('URL entered for audio');
        
        // ============================================================
        // STEP 7: Click MP3 button
        // ============================================================
        logStep('Step 7', 'Clicking MP3 button');
        let mp3Clicked = false;
        try {
            const mp3Btn = page.getByRole('button', { name: 'MP3' });
            if (await mp3Btn.isVisible({ timeout: 3000 })) {
                await mp3Btn.click();
                mp3Clicked = true;
                logSuccess('MP3 button clicked');
            }
        } catch (e) {
            logWarning('MP3 button not found', { error: e.message });
        }
        
        if (!mp3Clicked) {
            logStep('Step 7', 'Trying alternative MP3 button');
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.textContent();
                if (text && text.trim() === 'MP3') {
                    await btn.click();
                    mp3Clicked = true;
                    logSuccess('MP3 button clicked (alternative)');
                    break;
                }
            }
        }
        
        // ============================================================
        // STEP 8: Click Convert button
        // ============================================================
        logStep('Step 8', 'Clicking Convert button');
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
            logStep('Step 8', 'Trying alternative Convert button');
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
            logStep('Step 8', 'Pressing Enter as fallback');
            await page.keyboard.press('Enter');
        }
        
        // ============================================================
        // STEP 9: Wait for conversion
        // ============================================================
        logStep('Step 9', 'Waiting for conversion (8s)');
        await page.waitForTimeout(8000);
        logSuccess('Conversion wait complete');
        
        // ============================================================
        // STEP 10: Click Download button
        // ============================================================
        logStep('Step 10', 'Clicking Download button');
        try {
            const downloadBtn = page.getByRole('button', { name: 'Download' });
            if (await downloadBtn.isVisible({ timeout: 5000 })) {
                await downloadBtn.click();
                logSuccess('Download button clicked');
            }
        } catch (e) {
            logWarning('Download button not found', { error: e.message });
        }
        
        await page.waitForTimeout(3000);
        
        // ============================================================
        // STEP 11: Get video title
        // ============================================================
        logStep('Step 11', 'Extracting audio title');
        let videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return 'audio';
        });
        logSuccess('Title extracted for audio', { title: videoTitle });
        
        // ============================================================
        // STEP 12: Find MP3 URL
        // ============================================================
        if (!mp3Url) {
            logStep('Step 12', 'Searching HTML for MP3 URL');
            const pageHtml = await page.content();
            const mp3Matches = pageHtml.match(/https?:\/\/[^\s"']*\.mp3[^\s"']*/gi);
            if (mp3Matches && mp3Matches.length > 0) {
                mp3Url = mp3Matches[0];
                logSuccess('Found MP3 URL in HTML', { url: mp3Url.substring(0, 100) });
            } else {
                logWarning('No MP3 URL found in HTML');
            }
        }
        
        const totalTime = Date.now() - startTime;
        logSuccess(`Audio download URL obtained in ${totalTime}ms`, { 
            success: !!mp3Url,
            totalTime: `${totalTime}ms`
        });
        
        return {
            success: !!mp3Url,
            downloadUrl: mp3Url || null,
            title: videoTitle || 'audio',
            videoId: videoId
        };
        
    } catch (error) {
        logError('Audio download failed', { error: error.message });
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
            logInfo('Browser released from audio', { stats: browserPool.getStats() });
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
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('Cache-Control', 'no-cache');
        logStep('Stream Headers', 'Headers set', { filename });
        
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

// Prepare endpoint
app.post('/api/prepare/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    const cacheKey = `${videoId}_${quality}_${type}`;
    
    logStep('Prepare Request', `Preparing ${type}`, { videoId, quality });
    
    const existing = videoCache.get(cacheKey);
    if (existing) {
        if (existing.error) {
            logWarning('Cached failed entry', { cacheKey });
            return res.json({ success: false, error: existing.error, cached: true });
        }
        logSuccess('Using cached entry', { cacheKey });
        return res.json({ success: true, cached: true, videoId, quality, type });
    }
    
    try {
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
                logSuccess(`Prepared ${type}`, { cacheKey });
            } else {
                videoCache.set(cacheKey, { error: result.error || 'Failed to get download URL' });
                logError(`Failed to prepare ${type}`, { cacheKey, error: result.error });
            }
            return result;
        }).catch(error => {
            videoCache.set(cacheKey, { error: error.message });
            logError(`Prepare error`, { cacheKey, error: error.message });
            return { success: false, error: error.message };
        });
        
        res.json({ success: true, processing: true, videoId, quality, type });
        
    } catch (error) {
        logError('Prepare endpoint error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Status endpoint
app.get('/api/status/:videoId', (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    const cacheKey = `${videoId}_${quality}_${type}`;
    
    const cached = videoCache.get(cacheKey);
    logStep('Status Check', 'Checking cache', { videoId, quality, type, found: !!cached });
    
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
    
    logStep('Download Request (POST)', `Downloading ${type}`, { videoId, quality });
    
    if (!videoId) {
        logError('Missing videoId');
        return res.status(400).json({ error: 'videoId required' });
    }
    
    const cacheKey = `${videoId}_${quality}_${type}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached && cached.url) {
        logSuccess('Using cached download', { cacheKey });
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
            logError('Download failed', { error: result.error });
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        const filename = `${result.title || 'video'}.${extension}`;
        logSuccess('Download ready, streaming', { filename });
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        logError('Download error', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Download endpoint - GET
app.get('/api/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { quality = '720p', type = 'video' } = req.query;
    
    logStep('Download Request (GET)', `Downloading ${type}`, { videoId, quality });
    
    const cacheKey = `${videoId}_${quality}_${type}`;
    const cached = videoCache.get(cacheKey);
    
    if (cached && cached.url) {
        logSuccess('Using cached download (GET)', { cacheKey });
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
            logError('Download failed (GET)', { error: result.error });
            return res.status(404).json({ 
                success: false, 
                error: result.error || 'Could not get download URL' 
            });
        }
        
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        const filename = `${result.title || 'video'}.${extension}`;
        logSuccess('Download ready, streaming (GET)', { filename });
        await streamFile(result.downloadUrl, filename, res);
        
    } catch (error) {
        logError('Download error (GET)', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Pool stats endpoint
app.get('/api/pool', (req, res) => {
    logStep('Pool Stats', 'Requested pool statistics');
    res.json({
        pool: browserPool.getStats(),
        cache: {
            size: videoCache.size(),
            maxSize: MAX_CACHE_SIZE,
            ttl: CACHE_TTL
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    logStep('Health Check', 'Server health check');
    res.json({
        status: 'running',
        mode: 'Zeemo + Y2Mate',
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
    console.log(`🔗 Using: Zeemo.to (Video) + Y2Mate.gs (Audio)`);
    console.log(`📊 Browser Pool: ${MAX_CONCURRENT_BROWSERS} concurrent browsers`);
    console.log(`📊 Cache: ${MAX_CACHE_SIZE} items, TTL: ${CACHE_TTL/60000} minutes`);
    console.log(`📌 POST /api/download - Download video/audio`);
    console.log(`📌 GET /api/download/:videoId - Browser download`);
    console.log(`📌 POST /api/prepare/:videoId - Prepare video/audio`);
    console.log(`📌 GET /api/status/:videoId - Check status`);
    console.log(`📌 GET /api/pool - Pool statistics`);
    console.log(`📌 GET /api/health - Health check`);
    console.log(`📁 Temp directory: ${TEMP_DIR}`);
    console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);
});