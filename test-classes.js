const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://baohaiphong.vn/hai-phong-du-kien-ap-dung-thong-nhat-le-phi-truoc-ba-o-to-duoi-9-cho-muc-12-541085.html').then(res => {
    const $ = cheerio.load(res.data);
    const divs = $('div').filter((i, el) => $(el).find('p').length > 3);
    const classes = divs.map((i, el) => $(el).attr('class')).get();
    console.log("Possible main content classes:\n", classes.join('\n'));
});
