import Parser from 'rss-parser';
import Groq from 'groq-sdk';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import fs from 'fs';
import { chromium } from 'playwright';

// Tải các biến môi trường từ file .env
dotenv.config();

// Khởi tạo Groq SDK
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

// Khởi tạo RSS Parser với các trường custom để bắt hình ảnh
const parser = new Parser({
    customFields: {
        item: [
            ['enclosure', 'enclosure'],
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'thumbnail'],
            ['description', 'description']
        ]
    }
});

// Nguồn RSS duy nhất từ Google News (Đã lọc các trang chính thống)
const rssSource = encodeURI('https://news.google.com/rss/search?q=Kinh Môn site:baohaiduong.vn OR site:baohaiphong.vn OR site:kinhmon.haiduong.gov.vn&hl=vi&gl=VN&ceid=VN:vi');
const HISTORY_FILE = 'history.json';

// Hàm đọc lịch sử đăng bài
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Lỗi đọc file history:', err.message);
    }
    return [];
}

// Hàm lưu lịch sử đăng bài
function saveHistory(historyArray) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyArray, null, 2), 'utf8');
    } catch (err) {
        console.error('Lỗi ghi file history:', err.message);
    }
}

// Hàm hỗ trợ trích xuất hình ảnh từ RSS
function extractImage(item) {
    if (item.enclosure && item.enclosure.url) return item.enclosure.url;
    if (item.thumbnail && item.thumbnail['$'] && item.thumbnail['$'].url) return item.thumbnail['$'].url;
    if (item.mediaContent && item.mediaContent['$'] && item.mediaContent['$'].url) return item.mediaContent['$'].url;

    // Fallback: Tìm thẻ <img> trong nội dung
    const imgRegex = /<img[^>]+src="?([^"\s]+)"?[^>]*>/;
    let match = imgRegex.exec(item.content);
    if (match && match[1]) return match[1];

    match = imgRegex.exec(item.contentSnippet);
    if (match && match[1]) return match[1];

    match = imgRegex.exec(item.description);
    if (match && match[1]) return match[1];

    return null;
}

/// Hàm thu thập ảnh trực tiếp từ bài báo (Web Scraping)
async function scrapeImages(url, sourceName = 'Không rõ') {
    let browser = null;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Mở trang web
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(">> URL hiện tại sau chuyển hướng: ", page.url());

        // [VÁ LỖI 3] - ÉP BOT CUỘN CHUỘT ĐỂ HIỆN ẢNH LAZY-LOAD
        await page.evaluate(() => {
            // Cuộn từ từ xuống khoảng giữa trang để kích hoạt toàn bộ ảnh
            window.scrollBy(0, 800);
        });
        await page.waitForTimeout(1500); // Đợi 1.5 giây cho ảnh kịp tải về

        const html = await page.content();
        const $ = cheerio.load(html);
        const images = [];
        const seenUrls = new Set();

        // [VÁ LỖI 2] - BỔ SUNG CÁC CLASS CỦA BÁO HẢI PHÒNG VÀ CÁC BÁO KHÁC
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

            // [VÁ LỖI 1] - BỔ SUNG ĐUÔI .WEBP VÀ LINK KHÔNG CÓ ĐUÔI (DẠNG API MẢNG)
            // Nếu link có chứa các từ khóa định dạng, hoặc là link base64/api không rõ đuôi nhưng hợp lệ
            const hasValidExtension = srcLower.includes('.jpg') || srcLower.includes('.jpeg') || srcLower.includes('.png') || srcLower.includes('.webp');

            // Một số báo giấu đuôi ảnh, nếu nó không chứa đuôi hợp lệ mà cũng không phải file HTML/PHP thì tạm chấp nhận
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

// Hàm chính của hệ thống
async function startAutomatedPost() {
    try {
        console.log('=== BẮT ĐẦU QUY TRÌNH ĐĂNG TIN TỰ ĐỘNG ===');

        // ==========================================
        // Yêu cầu 1 & 2: Quét tin chính thống và Lọc trùng (history.json)
        // ==========================================
        console.log('1. Đang tải bộ nhớ và quét nguồn RSS (Google News Chính thống)...');
        const history = loadHistory();
        let feed;

        try {
            feed = await parser.parseURL(rssSource);
        } catch (error) {
            console.error(`[CẢNH BÁO] Lỗi khi quét nguồn RSS:`, error.message);
            return;
        }

        const allArticles = feed.items.map(item => ({
            ...item,
            sourceName: 'Google News (Báo Chính thống)',
            pubDateParsed: new Date(item.pubDate)
        }));

        if (allArticles.length === 0) {
            console.log('Không có bài viết nào được tìm thấy từ nguồn.');
            return;
        }

        // Lọc bỏ các bài đã đăng (dựa vào link)
        const filteredArticles = allArticles.filter(article => !history.includes(article.link));

        if (filteredArticles.length === 0) {
            console.log('Tất cả tin chính thống đều đã được đăng. Chờ bản tin sau.');
            return;
        }

        // Sắp xếp theo thời gian từ mới nhất đến cũ nhất
        filteredArticles.sort((a, b) => b.pubDateParsed - a.pubDateParsed);

        // Lấy bài viết mới nhất chưa từng đăng
        const selectedArticle = filteredArticles[0];
        const selectedThumbnail = extractImage(selectedArticle);

        console.log(`>> Lấy bài từ nguồn: ${selectedArticle.sourceName}`);
        console.log(`>> Tiêu đề gốc: ${selectedArticle.title}`);
        console.log(`>> Link bài: ${selectedArticle.link}`);

        // ==========================================
        // Yêu cầu 2 (Cũ): Biên tập viên AI (Groq API)
        // ==========================================
        console.log('2. Đang gửi dữ liệu cho AI (Groq) biên tập...');
        const systemPrompt = `Bạn là Biên tập viên Thư ký tòa soạn cấp cao của Cổng thông tin Phường Kinh Môn. Khi tóm tắt bài báo, hãy đặc biệt chú ý nếu đây là bài viết tổng hợp nhiều chỉ đạo.

KỶ LUẬT THÉP (Bắt buộc tuân thủ, vi phạm sẽ bị phạt):
1. TUYỆT ĐỐI KHÔNG viết sai chính tả tiếng Việt. Rà soát cực kỳ kỹ các từ dễ sai như dấu hỏi/ngã, ch/tr, s/x, l/n.
2. Giữ vững văn phong báo chí chính thống: Khách quan, nghiêm túc. Cấm dùng từ lóng hoặc giọng điệu kể chuyện.

YÊU CẦU VỀ NỘI DUNG:
- Phải quét toàn bộ nội dung được cung cấp. Nếu bài báo có nhiều mục (tiêu đề phụ), mỗi mục quan trọng phải được nhắc tên súc tích.
- KHÔNG TỰ BỊA SỐ LIỆU: Nếu trong bài không ghi rõ '10 quyết định' hay '5 văn bản' thì tuyệt đối không được viết vào.
- Ưu tiên liệt kê các dự án Luật hoặc quyết định mới nhất được nhắc đến trong bài.

CẤU TRÚC BÀI ĐĂNG (Tuyệt đối tuân thủ thứ tự, CẤM in ra các nhãn [DÒNG 1], [DÒNG 2] vào bài viết cuối cùng):

TIÊU ĐỀ IN HOA TOÀN BỘ - Phải bao quát được nội dung tổng thể của bài một cách có sức nặng.

Một đoạn dẫn dắt ngắn gọn về bối cảnh sự kiện hoặc tinh thần cốt lõi.

Các gạch đầu dòng. Mỗi gạch đầu dòng phải là một chỉ đạo/sự kiện KHÁC NHAU từ bài báo. (Ví dụ: - Trình dự án Luật người lao động...; - Phân công chủ trì soạn thảo các dự án Luật năm 2026...).

Câu kết định hướng thực tế hoặc tinh thần triển khai trong thời gian tới.

Hãy viết câu văn dài dặn, đầy đủ chủ vị, mang tính chất thông tấn nhà nước.`;
        const userPrompt = `Tiêu đề: ${selectedArticle.title}\nTóm tắt: ${selectedArticle.contentSnippet || selectedArticle.content}`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
        });

        const aiContent = chatCompletion.choices[0].message.content.trim();
        console.log('>> AI đã biên tập xong nội dung.');

        // ==========================================
        // Yêu cầu 3 (Cũ): Cào ảnh và Đăng bài tự động
        // ==========================================
        console.log('3. Đang thu thập hình ảnh từ bài báo (Web Scraping)...');
        let articleImages = await scrapeImages(selectedArticle.link, selectedArticle.sourceName);

        // Phương án dự phòng (Fallback): Nếu cào thất bại, dùng ảnh thumbnail từ RSS
        if (articleImages.length === 0 && selectedThumbnail) {
            console.log('Không cào được ảnh chất lượng từ nội dung, chuyển sang dùng ảnh thumbnail từ RSS làm dự phòng.');
            articleImages = [selectedThumbnail];
        }

        const finalPostContent = `${aiContent}\n\nNguồn chi tiết: ${selectedArticle.link}`;

        console.log(`4. Đang đăng bài lên Facebook với ${articleImages.length} ảnh...`);

        if (articleImages.length > 1) {
            console.log(`>> Tiến hành đăng Album (Multi-image)...`);

            // Bước 2.1: Tải lên từng ảnh (published: false)
            const mediaIds = [];
            for (let i = 0; i < articleImages.length; i++) {
                try {
                    const photoUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`;
                    const photoRes = await axios.post(photoUrl, null, {
                        params: {
                            url: articleImages[i],
                            published: false,
                            access_token: FB_ACCESS_TOKEN
                        }
                    });
                    mediaIds.push({ media_fbid: photoRes.data.id });
                    console.log(`   - Tải ảnh ${i + 1}/${articleImages.length} thành công (ID: ${photoRes.data.id})`);
                } catch (imgError) {
                    console.error(`   - [LỖI] Tải ảnh ${i + 1} thất bại: ${imgError.message}`);
                }
            }

            // Bước 2.2: Gắn danh sách media_fbid vào bài viết
            if (mediaIds.length > 0) {
                const feedUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`;
                const feedRes = await axios.post(feedUrl, {
                    message: finalPostContent,
                    attached_media: mediaIds,
                    access_token: FB_ACCESS_TOKEN
                });
                console.log(`>> Đăng bài Album thành công! Facebook Post ID: ${feedRes.data.id}`);
            } else {
                throw new Error("Không thể tải lên bất kỳ ảnh nào để tạo album.");
            }

        } else if (articleImages.length === 1) {
            console.log('>> Tiến hành đăng 1 ảnh duy nhất (Fallback)...');

            // Tải buffer hình ảnh
            const imageResponse = await axios.get(articleImages[0], { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data, 'binary');

            const form = new FormData();
            form.append('message', finalPostContent);
            form.append('source', imageBuffer, {
                filename: 'thumbnail.jpg',
                contentType: imageResponse.headers['content-type'] || 'image/jpeg'
            });
            form.append('access_token', FB_ACCESS_TOKEN);

            const fbUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`;
            const fbResponse = await axios.post(fbUrl, form, {
                headers: { ...form.getHeaders() }
            });

            console.log(`>> Đăng bài 1 ảnh thành công! Facebook Post ID: ${fbResponse.data.post_id || fbResponse.data.id}`);
        } else {
            console.log('Không có hình ảnh nào để đăng.');
            const feedUrl = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`;
            const feedRes = await axios.post(feedUrl, {
                message: finalPostContent,
                access_token: FB_ACCESS_TOKEN
            });
            console.log(`>> Đăng bài Text thành công! Facebook Post ID: ${feedRes.data.id}`);
        }

        // ==========================================
        // Ghi nhận lịch sử sau khi đăng thành công
        // ==========================================
        history.push(selectedArticle.link);
        saveHistory(history);
        console.log('>> Đã lưu link bài báo vào bộ nhớ history.json để chống đăng trùng.');

        console.log('=== QUY TRÌNH KẾT THÚC THÀNH CÔNG ===');

    } catch (error) {
        console.error('=== ĐÃ XẢY RA LỖI TRONG QUÁ TRÌNH THỰC THI ===');
        if (error.response) {
            // Lỗi từ API (Groq hoặc Facebook)
            console.error('Mã lỗi:', error.response.status);
            console.error('Chi tiết:', JSON.stringify(error.response.data, null, 2));
        } else {
            // Lỗi hệ thống hoặc code
            console.error('Lỗi:', error.message);
        }
    }
}

// Gọi thẳng hàm thực thi ở cuối file
startAutomatedPost();
