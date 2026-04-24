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

        await page.evaluate(() => {
            window.scrollBy(0, 800);
        });
        await page.waitForTimeout(1500);

        const html = await page.content();
        const $ = cheerio.load(html);
        const images = [];
        
        const wrapperSelectors = [
            '.detail-content', '.fck_detail', '.chi-tiet', '.post-content',
            '.article-body', '.entry-content', 'article',
            '.article-detail', '.noidung', '.content-detail', '.box-content',
            '.c-news-detail', '.b-maincontent' // NEW
        ];
        
        let mainContent = null;
        for (const sel of wrapperSelectors) {
            if ($(sel).length > 0) {
                console.log(`Found content matching selector: ${sel}`);
                mainContent = $(sel).first();
                break;
            }
        }

        if (!mainContent) {
            console.log("No main content found.");
            return;
        }

        const allImgs = [];
        mainContent.find('img').each((i, el) => {
            allImgs.push($(el));
        });
        
        console.log(`Found ${allImgs.length} raw img tags.`);
        
    } catch (error) {
        console.error(error);
    } finally {
        if (browser) await browser.close();
    }
}

testScrape("https://baohaiphong.vn/hai-phong-du-kien-ap-dung-thong-nhat-le-phi-truoc-ba-o-to-duoi-9-cho-muc-12-541085.html");
