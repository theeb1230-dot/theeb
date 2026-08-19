const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = app = express();
app.use(cors()); // السماح لتطبيقك بالاتصال بالسيرفر

app.get('/api/extract', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ success: false, error: 'URL is required' });

    const startTime = Date.now();
    let browser;
    
    try {
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const rawCandidates = [];

        // التنصت على شبكة المتصفح لالتقاط روابط الفيديو
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                rawCandidates.push({
                    url,
                    type: url.includes('.m3u8') ? 'hls' : 'mp4',
                    referer: request.headers()['referer'] || targetUrl
                });
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        
        // محاولة الضغط على زر التشغيل لتوليد الفيديو
        try {
            await page.click('.vjs-big-play-button, button.play, [class*="play"]', { delay: 100 });
        } catch (e) {}
        
        // انتظار 5 ثوانٍ ليقوم الجافاسكريبت ببناء الروابط
        await new Promise(r => setTimeout(r, 5000));

        // ترتيب المرشحين
        let rankedSources = rawCandidates.map(c => {
            let score = 0;
            if (c.type === 'hls') score += 60;
            if (c.type === 'mp4') score += 45;
            if (c.url.includes('master') || c.url.includes('playlist')) score += 50;
            if (c.url.includes('1080') || c.url.includes('720')) score += 30;
            if (c.url.includes('preview') || c.url.includes('trailer')) score -= 100;
            return { ...c, score, validated: true };
        });

        rankedSources = rankedSources.filter(c => c.score > 0);
        rankedSources.sort((a, b) => b.score - a.score);

        // اختيار أفضل مصدر
        const bestSource = rankedSources[0] ? {
            url: rankedSources[0].url,
            type: rankedSources[0].type,
            quality: rankedSources[0].url.includes('1080') ? '1080p' : (rankedSources[0].url.includes('720') ? '720p' : 'Auto'),
            protocol: rankedSources[0].type === 'hls' ? 'HLS' : 'MP4',
            validated: true
        } : null;

        // إرسال النتيجة لتطبيقك
        res.json({
            success: bestSource ? true : false,
            source: bestSource,
            sources: rankedSources,
            meta: {
                duration_ms: Date.now() - startTime
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend Engine running on ${PORT}`));