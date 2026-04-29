import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

async function scrapeImages(url, sourceName = 'Không rõ') {
    let browser = null;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        try {
            await page.waitForFunction(() => !window.location.hostname.includes('google.com'), { timeout: 15000 });
            await page.waitForTimeout(2000); 
        } catch (e) {
            console.log(">> Cảnh báo: Chờ chuyển hướng quá lâu.");
        }
        
        console.log(">> URL hiện tại sau chuyển hướng: ", page.url());

        await page.evaluate(() => {
            window.scrollBy(0, 800);
        });
        await page.waitForTimeout(1500); 

        const html = await page.content();
        const $ = cheerio.load(html);
        const images = [];
        const seenUrls = new Set();

        const wrapperSelectors = [
            '.b-maincontent', '.detail-content', '.fck_detail', '.chi-tiet', '.post-content',
            '.article-body', '.entry-content', 'article',
            '.article-detail', '.noidung', '.content-detail', '.box-content',
            '.c-news-detail', '.body-content', '.news-body',
            '#news-body', '.content-wrap', '.post-detail'
        ];
        let mainContent = null;

        for (const sel of wrapperSelectors) {
            if ($(sel).length > 0) {
                mainContent = $(sel).first();
                break;
            }
        }

        if (!mainContent) {
            console.log(">> Không tìm thấy vùng nội dung chính. Chuyển về fallback.");
            return [];
        }

        const allImgs = [];
        mainContent.find('img').each((i, el) => {
            allImgs.push($(el));
        });

        allImgs.sort((a, b) => {
            const aIsFigure = a.closest('figure').length > 0 ? 1 : 0;
            const bIsFigure = b.closest('figure').length > 0 ? 1 : 0;
            return bIsFigure - aIsFigure;
        });

        for (const el of allImgs) {
            let src = el.attr('data-src') || el.attr('src');
            if (!src) continue;

            if (src.startsWith('/')) {
                const urlObj = new URL(page.url());
                src = `${urlObj.protocol}//${urlObj.host}${src}`;
            }

            const srcLower = src.toLowerCase();

            const hasValidExtension = srcLower.includes('.jpg') || srcLower.includes('.jpeg') || srcLower.includes('.png') || srcLower.includes('.webp');

            if (!hasValidExtension && (srcLower.includes('.html') || srcLower.includes('.php'))) continue;

            const garbageKeywords = ['icon', 'logo', 'avatar', 'ads', 'bookmark', 'share', 'base64', 'svg'];
            if (garbageKeywords.some(kw => srcLower.includes(kw))) continue;

            if (seenUrls.has(src)) continue;

            const width = parseInt(el.attr('width'));
            const height = parseInt(el.attr('height'));

            if (!isNaN(width) && width < 200) continue;
            if (!isNaN(height) && height < 200) continue;

            if (!isNaN(width) && !isNaN(height) && height > 0) {
                const ratio = width / height;
                if (ratio < 0.5 || ratio > 2.5) continue;
            }

            images.push(src);
            seenUrls.add(src);

            if (images.length >= 4) break;
        }

        const finalImages = images;
        console.log(`Số ảnh quét được từ bài báo [${sourceName}]: ${finalImages.length}`);
        return finalImages;
    } catch (error) {
        console.error(`[Scraper] Lỗi khi cào ảnh từ bài báo bằng Playwright: ${error.message}`);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

scrapeImages('https://baohaiphong.vn/tong-bi-thu-chu-tich-nuoc-to-lam-dang-huong-tuong-niem-cac-vua-hung-tai-phu-tho-541517.html').then(console.log);
