const axios = require('axios');
require('dotenv').config();

async function testAlbum() {
    const FB_PAGE_ID = process.env.FB_PAGE_ID;
    const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
    const images = [
        'https://bhd.1cdn.vn/2026/04/26/e4031fb93269edfeb9a566ea055eeeefa0b2-_ttxvn-tong-bi-thu-chu-tich-nuoc-to-lam-dang-huong-tuong-niem-cac-vua-hung-8.jpg.avif.jpg',
        'https://bhd.1cdn.vn/2026/04/26/f8c727cabba1fe62ca271346baa111295dda7a-_ttxvn-tong-bi-thu-chu-tich-nuoc-to-lam-dang-huong-tuong-niem-cac-vua-hung-7.jpg.avif.jpg',
        'https://bhd.1cdn.vn/2026/04/26/c727bd6545d4697b97652387fa72de97224b-_ttxvn-tong-bi-thu-chu-tich-nuoc-to-lam-dang-huong-tuong-niem-cac-vua-hung-13.jpg.avif.jpg',
        'https://bhd.1cdn.vn/2026/04/26/c7276306829a774b07bff51c25316adcfaee-_ttxvn-tong-bi-thu-chu-tich-nuoc-to-lam-dang-huong-tuong-niem-cac-vua-hung-16.jpg.avif.jpg'
    ];
    
    console.log("Uploading individual images...");
    const mediaIds = [];
    for (const url of images) {
        try {
            const photoUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`;
            const photoRes = await axios.post(photoUrl, null, {
                params: {
                    url: url,
                    published: false,
                    access_token: FB_ACCESS_TOKEN
                }
            });
            mediaIds.push({ media_fbid: photoRes.data.id });
            console.log("Uploaded:", photoRes.data.id);
        } catch (e) {
            console.error("Upload failed for", url, e.response ? e.response.data : e.message);
        }
    }

    if (mediaIds.length > 0) {
        console.log("Creating album post...");
        const postUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`;
        const postData = {
            message: "Test Album",
            attached_media: mediaIds,
            access_token: FB_ACCESS_TOKEN
        };
        try {
            const fbResponse = await axios.post(postUrl, postData);
            console.log("Album SUCCESS:", fbResponse.data.id);
        } catch (e) {
            console.error("Album FAILED:", e.response ? JSON.stringify(e.response.data) : e.message);
        }
    }
}
testAlbum();
