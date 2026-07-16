const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const path = require('path');

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

// Download file function
function downloadFile(url, filename, retries = 3) {
    return new Promise((resolve, reject) => {
        console.log(`📥 Downloading: ${filename}`);
        console.log(`🔗 URL: ${url.substring(0, 80)}...`);
        
        const file = fs.createWriteStream(filename);
        let downloaded = 0;
        let total = 0;
        
        const protocol = url.startsWith('https') ? https : require('http');
        
        const request = protocol.get(url, {
            headers: {
                'Referer': 'https://youtubegrab.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`🔄 Redirecting...`);
                const newUrl = response.headers.location;
                if (newUrl) {
                    downloadFile(newUrl, filename, retries).then(resolve).catch(reject);
                    return;
                }
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
                console.log(`📊 Size: ${(downloaded / 1024 / 1024).toFixed(2)} MB`);
                resolve({ success: true, filename, size: downloaded });
            });
            
            file.on('error', (err) => {
                console.log('');
                reject(err);
            });
        });
        
        request.on('error', (err) => {
            console.log('');
            if (retries > 0) {
                console.log(`⚠️  Error: ${err.message}, retrying...`);
                setTimeout(() => {
                    downloadFile(url, filename, retries - 1).then(resolve).catch(reject);
                }, 2000);
            } else {
                reject(err);
            }
        });
        
        request.setTimeout(60000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

// Configuration
const DOWNLOAD_TYPE = 'video'; // 'video' or 'audio'
const VIDEO_URL = 'https://youtu.be/i6hpV-XiNfI?list=RDPwXYIBJlR1s';

(async () => {
    console.log(`🚀 YouTubeGrab Automation - ${DOWNLOAD_TYPE.toUpperCase()}`);
    console.log('');
    
    const executablePath = findPlaywrightChrome();
    
    if (!executablePath) {
        console.log('❌ No browser found!');
        return;
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
    
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    
    const videoIdMatch = VIDEO_URL.match(/youtu\.be\/([^?]+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : 'i6hpV-XiNfI';
    
    console.log(`📹 Video: ${VIDEO_URL}`);
    console.log(`📹 Video ID: ${videoId}`);
    console.log('📌 Opening youtubegrab.com...');
    
    let downloadUrl = null;
    let videoTitle = 'video';
    
    try {
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
        
        // Method 1: Try by test ID
        let inputField = await page.$('[data-testid="url-input"]');
        
        // Method 2: Try by placeholder
        if (!inputField) {
            inputField = await page.$('input[placeholder*="Paste"]');
        }
        
        // Method 3: Try by any input
        if (!inputField) {
            inputField = await page.$('input[type="text"]');
        }
        
        if (inputField) {
            await inputField.click();
            await inputField.fill(VIDEO_URL);
            console.log('✅ URL entered');
        } else {
            console.log('⚠️  Input field not found, using keyboard...');
            await page.keyboard.type(VIDEO_URL);
        }
        
        await page.waitForTimeout(1000);
        
        // ============================================================
        // STEP 3: CLICK DOWNLOAD / SUBMIT
        // ============================================================
        console.log('📌 Clicking Download...');
        
        // Method 1: By test ID
        const downloadBtn = page.getByTestId('url-submit').getByText('Download');
        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();
            console.log('✅ Download clicked!');
        } else {
            // Method 2: By text
            const btn = page.getByText('Download', { exact: false });
            if (await btn.isVisible()) {
                await btn.click();
                console.log('✅ Download clicked by text');
            } else {
                console.log('⚠️  Could not find Download button');
            }
        }
        
        // ============================================================
        // STEP 4: WAIT FOR RESULTS
        // ============================================================
        console.log('⏳ Waiting for results...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 5: SELECT VIDEO OR AUDIO
        // ============================================================
        if (DOWNLOAD_TYPE === 'audio') {
            console.log('📌 Looking for Audio option...');
            const audioTab = await page.$('text=Audio');
            if (audioTab) {
                await audioTab.click();
                console.log('✅ Audio selected');
            } else {
                const mp3Tab = await page.$('text=MP3');
                if (mp3Tab) {
                    await mp3Tab.click();
                    console.log('✅ MP3 selected');
                }
            }
        } else {
            console.log('📌 Looking for Video option...');
            const videoTab = await page.$('text=Video');
            if (videoTab) {
                await videoTab.click();
                console.log('✅ Video selected');
            } else {
                const mp4Tab = await page.$('text=MP4');
                if (mp4Tab) {
                    await mp4Tab.click();
                    console.log('✅ MP4 selected');
                }
            }
        }
        
        // ============================================================
        // STEP 6: WAIT FOR DOWNLOAD CTA
        // ============================================================
        console.log('⏳ Waiting for download CTA...');
        await page.waitForTimeout(3000);
        
        // ============================================================
        // STEP 7: CLICK DOWNLOAD CTA
        // ============================================================
        console.log('📌 Clicking Download CTA...');
        
        const ctaBtn = await page.$('[data-testid="download-cta"]');
        if (ctaBtn) {
            await ctaBtn.click();
            console.log('✅ Download CTA clicked');
        } else {
            // Try by text
            const cta = page.getByText('Download Video', { exact: false });
            if (await cta.isVisible()) {
                await cta.click();
                console.log('✅ Download CTA clicked by text');
            } else {
                const btn = page.getByText('Download', { exact: false });
                if (await btn.isVisible()) {
                    await btn.click();
                    console.log('✅ Download clicked by text');
                }
            }
        }
        
        // ============================================================
        // STEP 8: WAIT AND CAPTURE DOWNLOAD URL
        // ============================================================
        console.log('⏳ Waiting for download URL (20 seconds)...');
        await page.waitForTimeout(20000);
        
        // ============================================================
        // STEP 9: SEARCH FOR VIDEO URL
        // ============================================================
        console.log('📌 Searching for video URL...');
        
        // Get full page HTML
        const pageHtml = await page.content();
        
        // Look for googlevideo.com URL
        const googlevideoMatch = pageHtml.match(/https?:\/\/[a-zA-Z0-9\-\.]+\.googlevideo\.com\/[^\s"']+/);
        if (googlevideoMatch) {
            downloadUrl = googlevideoMatch[0];
            console.log('✅ Found googlevideo URL');
        }
        
        // Look for any MP4 URL
        if (!downloadUrl) {
            const mp4Match = pageHtml.match(/https?:\/\/[^\s"']*\.mp4[^\s"']*/);
            if (mp4Match) {
                downloadUrl = mp4Match[0];
                console.log('✅ Found MP4 URL');
            }
        }
        
        // Look for any download link
        if (!downloadUrl) {
            downloadUrl = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*="download"], a[href*="video"]');
                for (const link of links) {
                    if (link.href && !link.href.includes('google-analytics')) {
                        return link.href;
                    }
                }
                return null;
            });
        }
        
        // Get video title
        videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            return titleEl ? titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_') : 'video';
        });
        
        await browser.close();
        
        if (downloadUrl && !downloadUrl.includes('google-analytics')) {
            console.log(`✅ Download URL found!`);
            console.log(`🔗 ${downloadUrl.substring(0, 80)}...`);
            console.log('');
            
            const extension = DOWNLOAD_TYPE === 'video' ? 'mp4' : 'mp3';
            const filename = `${videoTitle}_${videoId}.${extension}`;
            const filepath = path.join(__dirname, filename);
            
            await downloadFile(downloadUrl, filepath);
            
        } else {
            console.log('❌ No download URL found');
            console.log('📌 The download may have started automatically.');
            console.log('📌 Check your browser\'s download folder.');
            console.log('📌 Keeping browser open for inspection...');
            await page.waitForTimeout(15000);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await browser.close();
    }
    
    console.log('');
    console.log('✅ Test complete');
})();