// test-download.js
const axios = require('axios');

async function testDownload() {
    const videoId = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
    const quality = '720p';

    console.log(`🎬 Testing download for video: ${videoId}`);
    console.log(`📌 Quality: ${quality}`);
    console.log('');

    try {
        const response = await axios.post('http://localhost:3003/api/download', {
            videoId: videoId,
            quality: quality
        });

        console.log('📊 Response:');
        console.log(`   Success: ${response.data.success}`);
        console.log(`   Title: ${response.data.title}`);
        console.log(`   Quality: ${response.data.selectedQuality || response.data.quality}`);
        console.log(`   Download URL: ${response.data.downloadUrl ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
        
        if (response.data.downloadUrl) {
            console.log(`   URL: ${response.data.downloadUrl.substring(0, 100)}...`);
        }
        
        if (response.data.filePath) {
            console.log(`   File saved: ${response.data.filePath}`);
        }
        
        if (response.data.error) {
            console.log(`   Error: ${response.data.error}`);
        }
        
        console.log('');
        console.log('📸 Check screenshots in the screenshots folder:');
        console.log(`   - ${videoId}_y2mate_page.png`);
        console.log(`   - ${videoId}_input_not_found.png (if input not found)`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('   Response data:', error.response.data);
        }
    }
}

testDownload();