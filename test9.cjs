const axios = require('axios');
require('dotenv').config();

async function testFB() {
    const FB_PAGE_ID = process.env.FB_PAGE_ID;
    const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
    const url = 'https://bhd.1cdn.vn/2026/04/26/e4031fb93269edfeb9a566ea055eeeefa0b2-_ttxvn-tong-bi-thu-chu-tich-nuoc-to-lam-dang-huong-tuong-niem-cac-vua-hung-8.jpg.avif.jpg';
    
    console.log("Testing FB upload with URL...");
    try {
        const photoUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`;
        const photoRes = await axios.post(photoUrl, null, {
            params: {
                url: url,
                published: false,
                access_token: FB_ACCESS_TOKEN
            }
        });
        console.log("FB upload SUCCESS. ID:", photoRes.data.id);
    } catch (e) {
        console.error("FB upload FAILED:", e.response ? e.response.data : e.message);
    }
}
testFB();
