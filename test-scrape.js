import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

async function testScrape(url) {
    let browser = null;
    try {
        console.log("Launching browser...");
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        console.log("Navigating to: " + url);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
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
            '.detail-content', '.fck_detail', '.chi-tiet', '.post-content',
            '.article-body', '.entry-content', 'article',
            '.article-detail', '.noidung', '.content-detail', '.box-content'
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
            console.log(">> Không tìm thấy vùng nội dung chính. Các selectors đã thử: ", wrapperSelectors.join(', '));
            return;
        }

        const allImgs = [];
        mainContent.find('img').each((i, el) => {
            allImgs.push($(el));
        });
        
        console.log(`Found ${allImgs.length} raw img tags inside main content.`);

        allImgs.sort((a, b) => {
            const aIsFigure = a.closest('figure').length > 0 ? 1 : 0;
            const bIsFigure = b.closest('figure').length > 0 ? 1 : 0;
            return bIsFigure - aIsFigure;
        });

        for (const el of allImgs) {
            let src = el.attr('data-src') || el.attr('src');
            if (!src) {
                console.log("Img tag without src/data-src");
                continue;
            }

            console.log(`Analyzing image src: ${src}`);

            if (src.startsWith('/')) {
                const urlObj = new URL(page.url());
                src = `${urlObj.protocol}//${urlObj.host}${src}`;
            }

            const srcLower = src.toLowerCase();

            const hasValidExtension = srcLower.includes('.jpg') || srcLower.includes('.jpeg') || srcLower.includes('.png') || srcLower.includes('.webp');

            if (!hasValidExtension && (srcLower.includes('.html') || srcLower.includes('.php'))) {
                console.log(`Skipping - invalid extension / looks like an html/php page: ${src}`);
                continue;
            }

            const garbageKeywords = ['icon', 'logo', 'avatar', 'ads', 'bookmark', 'share', 'base64', 'svg'];
            if (garbageKeywords.some(kw => srcLower.includes(kw))) {
                console.log(`Skipping - garbage keyword: ${src}`);
                continue;
            }

            if (seenUrls.has(src)) {
                console.log(`Skipping - already seen: ${src}`);
                continue;
            }

            const width = parseInt(el.attr('width'));
            const height = parseInt(el.attr('height'));

            if (!isNaN(width) && width < 200) {
                console.log(`Skipping - width too small (${width}): ${src}`);
                continue;
            }
            if (!isNaN(height) && height < 200) {
                console.log(`Skipping - height too small (${height}): ${src}`);
                continue;
            }

            if (!isNaN(width) && !isNaN(height) && height > 0) {
                const ratio = width / height;
                if (ratio < 0.5 || ratio > 2.5) {
                    console.log(`Skipping - bad aspect ratio (${ratio}): ${src}`);
                    continue;
                }
            }

            console.log(`>>> ACCEPTED: ${src}`);
            images.push(src);
            seenUrls.add(src);
        }

        console.log(`Final accepted images: ${images.length}`);
        
    } catch (error) {
        console.error(error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

testScrape("https://baohaiphong.vn/hai-phong-du-kien-ap-dung-thong-nhat-le-phi-truoc-ba-o-to-duoi-9-cho-muc-12-541085.html");
