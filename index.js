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
const rssSource = encodeURI('https://news.google.com/rss/search?q=Hải Phòng site:baochinhphu.vn OR site:baohaiphong.com.vn OR site:dangcongsan.vn OR site:nhandan.vn&hl=vi&gl=VN&ceid=VN:vi');

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

// Hàm thu thập ảnh trực tiếp từ bài báo (Web Scraping)
async function scrapeImages(url, sourceName = 'Không rõ') {
    let browser = null;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Mở trang web và đợi mạng rảnh rỗi để vượt qua redirect
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        console.log(">> URL hiện tại sau chuyển hướng: ", page.url());

        const html = await page.content();
        const $ = cheerio.load(html);
        const images = [];
        const seenUrls = new Set();

        // 1. Chỉ quét ảnh TRONG các thẻ bao bọc nội dung
        const wrapperSelectors = ['.detail-content', '.fck_detail', '.chi-tiet', '.post-content', '.article-body', '.entry-content', 'article'];
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

        // Lấy tất cả thẻ img trong vùng nội dung chính
        const allImgs = [];
        mainContent.find('img').each((i, el) => {
            allImgs.push($(el));
        });

        // 2. Ưu tiên ảnh có chú thích (nằm trong thẻ figure)
        allImgs.sort((a, b) => {
            const aIsFigure = a.closest('figure').length > 0 ? 1 : 0;
            const bIsFigure = b.closest('figure').length > 0 ? 1 : 0;
            return bIsFigure - aIsFigure; // Ưu tiên 1 trước 0 sau
        });

        for (const el of allImgs) {
            let src = el.attr('data-src') || el.attr('src');
            if (!src) continue;

            if (src.startsWith('/')) {
                const urlObj = new URL(page.url());
                src = `${urlObj.protocol}//${urlObj.host}${src}`;
            }

            const srcLower = src.toLowerCase();

            // Lọc định dạng chuẩn
            if (!srcLower.includes('.jpg') && !srcLower.includes('.jpeg') && !srcLower.includes('.png')) continue;

            // Loại bỏ các keyword rác
            const garbageKeywords = ['icon', 'logo', 'avatar', 'ads', 'bookmark', 'share', 'base64'];
            if (garbageKeywords.some(kw => srcLower.includes(kw))) continue;

            if (seenUrls.has(src)) continue;

            // Kiểm tra kích thước và tỉ lệ khung hình (nếu báo có gán sẵn thuộc tính)
            const width = parseInt(el.attr('width'));
            const height = parseInt(el.attr('height'));

            // Loại bỏ ảnh quá nhỏ
            if (!isNaN(width) && width < 200) continue;
            if (!isNaN(height) && height < 200) continue;

            if (!isNaN(width) && !isNaN(height) && height > 0) {
                const ratio = width / height;
                // Loại bỏ ảnh dị dạng (quá dài hoặc quá hẹp làm vỡ layout Album)
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
        const systemPrompt = `Bạn là Biên tập viên cao cấp của Cổng thông tin Phường Kinh Môn. Khi tóm tắt bài báo, hãy đặc biệt chú ý nếu đây là bài viết tổng hợp nhiều chỉ đạo.

YÊU CẦU VỀ NỘI DUNG:

Phải quét toàn bộ nội dung được cung cấp. Nếu bài báo có nhiều mục (tiêu đề phụ), mỗi mục quan trọng phải được nhắc tên súc tích.

KHÔNG TỰ BỊA SỐ LIỆU: Nếu trong bài không ghi rõ '10 quyết định' hay '5 văn bản' thì tuyệt đối không được viết vào.

Ưu tiên liệt kê các dự án Luật hoặc quyết định mới nhất được nhắc đến trong bài.

CẤU TRÚC BÀI ĐĂNG (Cấm dùng nhãn):

[DÒNG 1]: TIÊU ĐỀ IN HOA - Phải bao quát được nội dung tổng thể của bài.

[DÒNG 2]: Một đoạn dẫn dắt ngắn gọn về bối cảnh sự kiện.

[DÒNG 3]: Các gạch đầu dòng. Mỗi gạch đầu dòng phải là một chỉ đạo/sự kiện KHÁC NHAU từ bài báo. (Ví dụ: 🔹 Trình dự án Luật người lao động...; 🔹 Phân công chủ trì soạn thảo các dự án Luật năm 2026...).

[DÒNG 4]: Câu kết định hướng thực tế.

Hãy viết câu văn dài dặn, đầy đủ chủ vị, mang tính chất thông tấn nhà nước`;
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
