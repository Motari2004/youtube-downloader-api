const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test video ID - use a real YouTube video
const videoId = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
const videoUrl = `https://youtu.be/${videoId}`;

console.log('🧪 Testing MP3 Audio Download from YouTube');
console.log('=' .repeat(60));
console.log(`📹 Video ID: ${videoId}`);
console.log(`🔗 URL: ${videoUrl}`);
console.log('');

// ============================================================
// METHOD 1: yt-dlp with extract-audio
// ============================================================
async function testYtDlpMP3() {
    console.log('📌 METHOD 1: yt-dlp with --extract-audio');
    console.log('─'.repeat(40));
    
    return new Promise((resolve) => {
        const filename = `test_audio_${Date.now()}`;
        const tempFile = path.join(__dirname, `${filename}.mp3`);
        
        console.log(`📁 Output: ${tempFile}`);
        console.log('📥 Downloading and converting to MP3...');
        
        // Use yt-dlp to download audio and convert to MP3
        const command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 128K -o "${filename}" --no-playlist --no-warnings "https://youtu.be/${videoId}"`;
        
        console.log(`📌 Command: ${command}`);
        
        exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.log('❌ Error:', error.message);
                resolve(null);
                return;
            }
            
            // Check if file was created
            const finalFile = path.join(__dirname, `${filename}.mp3`);
            if (fs.existsSync(finalFile)) {
                const stats = fs.statSync(finalFile);
                console.log(`✅ MP3 created successfully!`);
                console.log(`📁 File: ${finalFile}`);
                console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                resolve({ success: true, file: finalFile, size: stats.size });
            } else {
                console.log('❌ MP3 file was not created');
                resolve(null);
            }
        });
    });
}

// ============================================================
// METHOD 2: yt-dlp with format selection only
// ============================================================
async function testYtDlpFormat() {
    console.log('');
    console.log('📌 METHOD 2: yt-dlp with format selection');
    console.log('─'.repeat(40));
    
    return new Promise((resolve) => {
        const formatSelector = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio';
        const command = `yt-dlp -f "${formatSelector}" -g --no-warnings "https://youtu.be/${videoId}"`;
        
        console.log(`📌 Format: ${formatSelector}`);
        console.log(`📌 Command: ${command}`);
        
        exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.log('❌ Error:', error.message);
                resolve(null);
                return;
            }
            
            const url = stdout.trim();
            if (url && url.startsWith('http')) {
                console.log('✅ Audio URL found!');
                console.log(`🔗 URL: ${url.substring(0, 80)}...`);
                resolve({ success: true, url: url });
            } else {
                console.log('❌ No URL found');
                resolve(null);
            }
        });
    });
}

// ============================================================
// METHOD 3: Test with different quality settings
// ============================================================
async function testQualityOptions() {
    console.log('');
    console.log('📌 METHOD 3: Different quality settings');
    console.log('─'.repeat(40));
    
    const qualities = ['64K', '128K', '192K'];
    
    for (const quality of qualities) {
        console.log(`\n📌 Testing quality: ${quality}`);
        
        await new Promise((resolve) => {
            const filename = `test_${quality}_${Date.now()}`;
            
            const command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${quality} -o "${filename}" --no-playlist --no-warnings "https://youtu.be/${videoId}"`;
            
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
                const finalFile = path.join(__dirname, `${filename}.mp3`);
                if (fs.existsSync(finalFile)) {
                    const stats = fs.statSync(finalFile);
                    console.log(`✅ ${quality}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    // Clean up
                    fs.unlinkSync(finalFile);
                    resolve();
                } else {
                    console.log(`❌ ${quality}: Failed`);
                    resolve();
                }
            });
        });
    }
}

// ============================================================
// METHOD 4: Check if ffmpeg is available (required for conversion)
// ============================================================
function checkFFmpeg() {
    console.log('');
    console.log('📌 Checking FFmpeg (required for MP3 conversion)');
    console.log('─'.repeat(40));
    
    return new Promise((resolve) => {
        exec('ffmpeg -version', (error, stdout) => {
            if (error) {
                console.log('❌ FFmpeg not found!');
                console.log('📌 Install FFmpeg:');
                console.log('   Windows: https://ffmpeg.org/download.html');
                console.log('   Mac: brew install ffmpeg');
                console.log('   Linux: sudo apt install ffmpeg');
                resolve(false);
            } else {
                const version = stdout.split('\n')[0];
                console.log(`✅ FFmpeg found: ${version}`);
                resolve(true);
            }
        });
    });
}

// ============================================================
// METHOD 5: Direct URL streaming (no conversion)
// ============================================================
async function testDirectAudio() {
    console.log('');
    console.log('📌 METHOD 5: Direct audio URL (no conversion)');
    console.log('─'.repeat(40));
    
    return new Promise((resolve) => {
        const command = `yt-dlp -f bestaudio -g --no-warnings "https://youtu.be/${videoId}"`;
        
        exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.log('❌ Error:', error.message);
                resolve(null);
                return;
            }
            
            const url = stdout.trim();
            if (url && url.startsWith('http')) {
                console.log('✅ Audio URL found!');
                console.log(`🔗 URL: ${url.substring(0, 80)}...`);
                
                // Check if it's audio only
                const isAudio = !url.includes('video') && (url.includes('itag=140') || url.includes('itag=141') || url.includes('mime=audio'));
                console.log(`📌 Audio only: ${isAudio ? 'Yes ✅' : 'No ⚠️'}`);
                resolve({ success: true, url: url, isAudio: isAudio });
            } else {
                console.log('❌ No URL found');
                resolve(null);
            }
        });
    });
}

// ============================================================
// RUN ALL TESTS
// ============================================================
async function main() {
    console.log('🎵 MP3 Download Test Suite');
    console.log('=' .repeat(60));
    
    // Check FFmpeg first
    const ffmpegAvailable = await checkFFmpeg();
    
    // Test direct audio URL
    const directResult = await testDirectAudio();
    
    // Test format selection
    const formatResult = await testYtDlpFormat();
    
    if (ffmpegAvailable) {
        // Test MP3 conversion
        const mp3Result = await testYtDlpMP3();
        
        // Test quality options
        await testQualityOptions();
    }
    
    console.log('');
    console.log('=' .repeat(60));
    console.log('✅ All tests complete!');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   📥 Direct audio: ${directResult ? '✅ Working' : '❌ Failed'}`);
    console.log(`   📥 Format selection: ${formatResult ? '✅ Working' : '❌ Failed'}`);
    console.log(`   🎵 MP3 conversion: ${ffmpegAvailable ? '✅ Available' : '❌ FFmpeg required'}`);
}

// Run the tests
main();