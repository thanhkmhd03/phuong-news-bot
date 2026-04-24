import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

async function testScrape(url) {
    let browser = null;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.evaluate(() => { window.scrollBy(0, 800); });
        await page.waitForTimeout(1500);

        const html = await page.content();
        const $ = cheerio.load(html);
        
        const mainContent = $('.c-news-detail').first();

        mainContent.find('img').each((i, el) => {
            console.log(`\n--- IMG ${i} ---`);
            console.log('src:', $(el).attr('src'));
            console.log('data-src:', $(el).attr('data-src'));
            console.log('width:', $(el).attr('width'));
            console.log('height:', $(el).attr('height'));
            console.log('class:', $(el).attr('class'));
        });
        
    } catch (error) {
        console.error(error);
    } finally {
        if (browser) await browser.close();
    }
}

testScrape("https://baohaiphong.vn/hai-phong-bo-sung-69-cong-trinh-du-an-thu-hoi-dat-nam-2026-541045.html");
