const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// Find Playwright chromium executable
function findPlaywrightChrome() {
    const homeDir = process.env.USERPROFILE || process.env.HOME;
    const playwrightDir = path.join(homeDir, 'AppData', 'Local', 'ms-playwright');
    
    if (!fs.existsSync(playwrightDir)) {
        console.log('❌ Playwright folder not found');
        return null;
    }
    
    const dirs = ['chromium-1208', 'chromium-1200'];
    
    for (const dir of dirs) {
        const chromePath = path.join(playwrightDir, dir, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(chromePath)) {
            console.log(`✅ Found Chrome: ${chromePath}`);
            return chromePath;
        }
        const chromeExe = path.join(playwrightDir, dir, 'chrome.exe');
        if (fs.existsSync(chromeExe)) {
            console.log(`✅ Found Chrome: ${chromeExe}`);
            return chromeExe;
        }
    }
    return null;
}

// Get video info and download URL
async function getDownloadUrl(videoId, quality = '720p') {
    console.log(`🎬 Getting download URL for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    
    const executablePath = findPlaywrightChrome();
    
    if (!executablePath) {
        throw new Error('Chrome not found');
    }
    
    const browser = await chromium.launch({
        headless: false,
        slowMo: 150,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1366, height: 768 });
        
        const videoUrl = `https://youtu.be/${videoId}`;
        let downloadUrl = null;
        let videoTitle = 'video';
        
        // ============================================================
        // STEP 1: NAVIGATE TO SITE
        // ============================================================
        await page.goto('https://youtubegrab.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        console.log('✅ Page loaded');
        await page.waitForTimeout(2000);
        
        // ============================================================
        // STEP 2: ENTER URL
        // ============================================================
        console.log('📌 Entering URL...');
        const inputField = await page.$('[data-testid="url-input"]');
        if (inputField) {
            await inputField.click();
            await inputField.fill(videoUrl);
            console.log('✅ URL entered');
        }
        
        // ============================================================
        // STEP 3: CLICK DOWNLOAD
        // ============================================================
        console.log('📌 Clicking Download...');
        const downloadBtn = page.getByTestId('url-submit').getByText('Download');
        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();
            console.log('✅ Download clicked!');
        }
        
        // ============================================================
        // STEP 4: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ Waiting for results...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 5: CLICK VIDEO BUTTON
        // ============================================================
        console.log('📌 Clicking Video button...');
        const videoButton = await page.$('button[data-testid="format-bucket"][data-bucket="video"]');
        if (videoButton) {
            await videoButton.click();
            console.log('✅ Video button clicked!');
        }
        
        // ============================================================
        // STEP 6: SELECT QUALITY (controlled by extension)
        // ============================================================
        console.log(`📌 Selecting ${quality} quality...`);
        
        // Map quality to display text
        const qualityMap = {
            '1080p': '1080p',
            '720p': '720p',
            '480p': '480p',
            '360p': '360p'
        };
        
        const qualityText = qualityMap[quality] || '720p';
        
        // Find and click the quality button
        const qualityButtons = await page.$$('button[data-testid="format-pill"]');
        let qualitySelected = false;
        
        for (const btn of qualityButtons) {
            const text = await btn.textContent();
            if (text && text.includes(qualityText) && text.includes('MB')) {
                const isPressed = await btn.getAttribute('aria-pressed');
                if (isPressed === 'true') {
                    console.log(`✅ ${qualityText} already selected`);
                } else {
                    await btn.click();
                    console.log(`✅ ${qualityText} selected!`);
                }
                qualitySelected = true;
                break;
            }
        }
        
        if (!qualitySelected) {
            console.log(`⚠️  Could not find ${qualityText}, using first available`);
            const firstBtn = qualityButtons[0];
            if (firstBtn) {
                await firstBtn.click();
                console.log(`✅ Used first available quality`);
            }
        }
        
        // ============================================================
        // STEP 7: VERIFY SELECTION
        // ============================================================
        await page.waitForTimeout(1000);
        
        const selectedQuality = await page.evaluate(() => {
            const selected = document.querySelector('button[data-testid="format-pill"][aria-pressed="true"]');
            return selected ? selected.textContent : 'None';
        });
        console.log(`📊 Selected quality: ${selectedQuality}`);
        
        // ============================================================
        // STEP 8: CLICK DOWNLOAD CTA
        // ============================================================
        console.log('📌 Clicking Download CTA...');
        const ctaBtn = await page.$('[data-testid="download-cta"]');
        if (ctaBtn) {
            await ctaBtn.click();
            console.log('✅ Download CTA clicked!');
        }
        
        // ============================================================
        // STEP 9: WAIT FOR DOWNLOAD
        // ============================================================
        console.log('⏳ Waiting for download (20 seconds)...');
        await page.waitForTimeout(20000);
        
        // ============================================================
        // STEP 10: EXTRACT DOWNLOAD URL
        // ============================================================
        console.log('📌 Extracting download URL...');
        
        const pageHtml = await page.content();
        const googlevideoMatch = pageHtml.match(/https?:\/\/[a-zA-Z0-9\-\.]+\.googlevideo\.com\/[^\s"']+/);
        if (googlevideoMatch) {
            downloadUrl = googlevideoMatch[0];
            console.log('✅ Found googlevideo URL');
        }
        
        if (!downloadUrl) {
            const mp4Match = pageHtml.match(/https?:\/\/[^\s"']*\.mp4[^\s"']*/);
            if (mp4Match) {
                downloadUrl = mp4Match[0];
                console.log('✅ Found MP4 URL');
            }
        }
        
        if (!downloadUrl) {
            downloadUrl = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*="download"]');
                for (const link of links) {
                    if (link.href && !link.href.includes('google-analytics')) {
                        return link.href;
                    }
                }
                return null;
            });
        }
        
        videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            return titleEl ? titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_') : 'video';
        });
        
        await browser.close();
        
        return {
            success: !!downloadUrl,
            downloadUrl: downloadUrl,
            title: videoTitle,
            quality: quality,
            videoId: videoId,
            selectedQuality: selectedQuality
        };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await browser.close();
        throw error;
    }
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Download video
app.post('/api/download', async (req, res) => {
    const { videoId, quality = '720p' } = req.body;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }
    
    try {
        const result = await getDownloadUrl(videoId, quality);
        res.json(result);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        mode: 'YouTubeGrab Automation',
        timestamp: new Date().toISOString()
    });
});

// Check dependencies
app.get('/api/check', (req, res) => {
    const chromePath = findPlaywrightChrome();
    res.json({
        chromeFound: !!chromePath,
        chromePath: chromePath,
        status: 'ready'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 YouTubeGrab Server running at http://localhost:${PORT}`);
    console.log(`📌 POST /api/download - Download video (quality: 1080p, 720p, 480p, 360p)`);
    console.log(`📌 GET  /api/health  - Health check`);
    console.log(`📌 GET  /api/check   - Check dependencies`);
    console.log('');
    console.log(`⚡ Using YouTubeGrab.com`);
    console.log(`📌 Quality controlled by extension`);
});