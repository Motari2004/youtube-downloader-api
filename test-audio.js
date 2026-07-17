const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// ============================================================
// DOWNLOAD MP3 TO PC
// ============================================================

async function downloadFile(url, filename) {
    const downloadPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Downloads', filename);
    console.log(`📥 Downloading to: ${downloadPath}`);
    
    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
                'Referer': 'https://y2mate.gs/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 120000
        });
        
        const writer = fs.createWriteStream(downloadPath);
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`✅ Download complete: ${filename}`);
                console.log(`📁 Saved to: ${downloadPath}`);
                resolve(downloadPath);
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('❌ Download error:', error.message);
        throw error;
    }
}

// ============================================================
// GET MP3 URL FROM Y2MATE.GS
// ============================================================

async function getMp3Url(videoId) {
    console.log(`🎵 Getting MP3 URL for: ${videoId}`);
    
    const videoUrl = `https://youtu.be/${videoId}`;
    let browser;
    let context;
    
    try {
        console.log('🚀 Launching browser...');
        
        browser = await chromium.launch({
            headless: false,  // 👈 VISIBLE for debugging
            slowMo: 200,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--start-maximized',
                '--window-position=0,0',
                '--window-size=1920,1080',
                '--disable-infobars'
            ]
        });
        
        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // ============================================================
        // SET UP NETWORK INTERCEPTION
        // ============================================================
        let mp3Url = null;
        
        context.on('response', async (response) => {
            const url = response.url();
            // Look for MP3 files or download URLs
            if (url && (
                url.includes('.mp3') ||
                url.includes('download') ||
                url.includes('get_audio') ||
                url.includes('audio')
            )) {
                // Skip analytics and tracking
                if (!url.includes('google-analytics') && 
                    !url.includes('analytics') && 
                    !url.includes('tracking')) {
                    console.log(`🌐 Captured URL: ${url.substring(0, 100)}...`);
                    // Only capture if it's likely an MP3
                    if (url.includes('.mp3') || url.includes('download')) {
                        mp3Url = url;
                        console.log(`✅ MP3 URL captured!`);
                    }
                }
            }
        });
        
        // ============================================================
        // STEP 1: NAVIGATE TO Y2MATE.GS
        // ============================================================
        console.log('📌 Opening Y2Mate.gs...');
        await page.goto('https://y2mate.gs/', {
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
            inputField = page.getByRole('textbox', { name: 'Paste your YouTube link' });
            if (await inputField.isVisible({ timeout: 5000 })) {
                console.log('✅ Found input by role: "Paste your YouTube link"');
            } else {
                inputField = null;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!inputField) {
            try {
                inputField = page.getByPlaceholder('Paste your YouTube link');
                if (await inputField.isVisible({ timeout: 3000 })) {
                    console.log('✅ Found input by placeholder');
                } else {
                    inputField = null;
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
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
                console.log('⚠️  Method 3 failed:', e.message);
            }
        }
        
        if (!inputField) {
            console.log('❌ Input field not found');
            return null;
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
        // STEP 4: CLICK "MP3" BUTTON
        // ============================================================
        console.log('📌 Clicking "MP3" button...');
        
        let mp3Clicked = false;
        
        try {
            const mp3Btn = page.getByRole('button', { name: 'MP3' });
            if (await mp3Btn.isVisible({ timeout: 3000 })) {
                await mp3Btn.click();
                console.log('✅ Clicked "MP3" button by role!');
                mp3Clicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!mp3Clicked) {
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await btn.textContent();
                    if (text && text.trim() === 'MP3') {
                        await btn.click();
                        console.log('✅ Clicked "MP3" button by text!');
                        mp3Clicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
        }
        
        if (!mp3Clicked) {
            console.log('⚠️  "MP3" button not found');
        }
        
        await page.waitForTimeout(1000);
        
        // ============================================================
        // STEP 5: CLICK "Convert" BUTTON
        // ============================================================
        console.log('📌 Clicking "Convert" button...');
        
        let convertClicked = false;
        
        try {
            const convertBtn = page.getByRole('button', { name: 'Convert' });
            if (await convertBtn.isVisible({ timeout: 3000 })) {
                await convertBtn.click();
                console.log('✅ Clicked "Convert" button by role!');
                convertClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
        if (!convertClicked) {
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await btn.textContent();
                    if (text && (text.trim() === 'Convert' || text.includes('Convert'))) {
                        await btn.click();
                        console.log('✅ Clicked "Convert" button by text!');
                        convertClicked = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️  Method 2 failed:', e.message);
            }
        }
        
        if (!convertClicked) {
            console.log('⚠️  "Convert" button not found, pressing Enter...');
            await page.keyboard.press('Enter');
        }
        
        // ============================================================
        // STEP 6: WAIT FOR CONVERSION
        // ============================================================
        console.log('⏳ WAITING for conversion to complete...');
        console.log('👀 WATCH THE BROWSER - conversion in progress...');
        await page.waitForTimeout(8000);
        
        // ============================================================
        // STEP 7: CLICK "Download" BUTTON
        // ============================================================
        console.log('📌 Looking for "Download" button...');
        
        let downloadClicked = false;
        
        try {
            const downloadBtn = page.getByRole('button', { name: 'Download' });
            if (await downloadBtn.isVisible({ timeout: 5000 })) {
                await downloadBtn.click();
                console.log('✅ Clicked "Download" button by role!');
                downloadClicked = true;
            }
        } catch (e) {
            console.log('⚠️  Method 1 failed:', e.message);
        }
        
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
        
        // ============================================================
        // STEP 8: WAIT FOR NETWORK RESPONSE
        // ============================================================
        console.log('⏳ WAITING for network response...');
        await page.waitForTimeout(5000);
        
        // ============================================================
        // STEP 9: GET VIDEO TITLE
        // ============================================================
        let videoTitle = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, .title, [class*="title"]');
            if (titleEl) {
                return titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            }
            return 'audio';
        });
        
        console.log(`📊 Title: ${videoTitle}`);
        console.log(`📊 MP3 URL found from network: ${!!mp3Url}`);
        
        return {
            success: !!mp3Url,
            downloadUrl: mp3Url,
            title: videoTitle || 'audio',
            videoId: videoId
        };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return null;
    } finally {
        if (browser) {
            console.log('🔒 Closing browser...');
            try { await browser.close(); } catch (e) {}
        }
    }
}

// ============================================================
// MAIN FUNCTION
// ============================================================

async function main() {
    const videoId = process.argv[2] || 'dQw4w9WgXcQ';
    
    console.log('');
    console.log('🎵 Y2Mate.gs Audio Download Test');
    console.log('================================');
    console.log(`📌 Video ID: ${videoId}`);
    console.log(`📌 Video URL: https://youtu.be/${videoId}`);
    console.log('');
    
    const result = await getMp3Url(videoId);
    
    if (result && result.success && result.downloadUrl) {
        console.log('');
        console.log('📥 Downloading MP3...');
        const filename = `${result.title}.mp3`;
        await downloadFile(result.downloadUrl, filename);
        console.log('');
        console.log('✅ Audio downloaded to your Downloads folder!');
        console.log(`📁 ${filename}`);
    } else {
        console.log('');
        console.log('❌ Failed to get MP3 URL');
        console.log('💡 Make sure to watch the browser - the MP3 URL should appear in the network tab');
    }
}

// ============================================================
// RUN
// ============================================================

main();