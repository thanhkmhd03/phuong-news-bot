const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://baohaiphong.vn/hai-phong-bo-sung-69-cong-trinh-du-an-thu-hoi-dat-nam-2026-541045.html').then(res => {
    const $ = cheerio.load(res.data);
    console.log("Title:", $('h1').text());
    
    // Check main article body
    const articleBody = $('.detail-content').length ? $('.detail-content') : $('.noidung').length ? $('.noidung') : $('.c-news-detail');
    console.log("Article Body HTML length:", articleBody.html() ? articleBody.html().length : 0);
    
    console.log("Images in .c-news-detail:", $('.c-news-detail').find('img').length);
    console.log("Images in .b-maincontent:", $('.b-maincontent').find('img').length);
    console.log("Images in .detail-content:", $('.detail-content').find('img').length);
    
    $('.c-news-detail').find('img').each((i, el) => {
        console.log("IMG src:", $(el).attr('src'));
    });
});
