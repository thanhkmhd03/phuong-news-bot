const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

async function testFB() {
    const FB_PAGE_ID = process.env.FB_PAGE_ID;
    const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
    const url = 'https://bhd.1cdn.vn/thumbs/540x360/2026/04/20/huan-chuong(1).jpg';
    
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
