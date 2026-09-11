import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.join(__dirname, '../public/images/overlays');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const overlays = [
  {
    id: 's0',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; direction: rtl; background: transparent;">
        <h1 style="font-size: 72px; font-weight: 900; color: white; margin-bottom: 40px; font-family: 'Cairo', sans-serif;">المحاسبة معقدة؟</h1>
        <div style="background-color: #2563eb; color: white; padding: 16px 40px; border-radius: 9999px; font-size: 48px; font-weight: 800; font-family: 'Cairo', sans-serif;">ليس بعد اليوم!</div>
      </div>
    `
  },
  {
    id: 's1',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; direction: rtl;">
        <div style="margin-top: 15vh; text-align: center;">
          <h2 style="font-size: 72px; font-weight: 900; color: white; margin-bottom: 20px; font-family: 'Cairo', sans-serif;">ترصيد</h2>
          <p style="font-size: 48px; font-weight: 700; color: #a5f3fc; font-family: 'Cairo', sans-serif;">إدارة أسهل لنمو أسرع</p>
        </div>
        <div style="position: absolute; bottom: 15vh; right: 10vw; background-color: rgba(37,99,235,0.8); border: 2px solid rgba(96,165,250,0.5); color: white; padding: 16px 32px; border-radius: 20px; font-size: 32px; font-weight: 700; font-family: 'Cairo', sans-serif;">لوحة تحكم متكاملة</div>
        <div style="position: absolute; top: 35vh; left: 10vw; background-color: rgba(8,145,178,0.8); border: 2px solid rgba(34,211,238,0.5); color: white; padding: 16px 32px; border-radius: 20px; font-size: 32px; font-weight: 700; font-family: 'Cairo', sans-serif;">رؤية واضحة</div>
      </div>
    `
  },
  {
    id: 's2',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; direction: rtl; background: transparent;">
        <h2 style="font-size: 80px; font-weight: 900; color: white; font-family: 'Cairo', sans-serif; text-align: center; line-height: 1.4;">
          اسأل.. <br/> <span style="color: #a5f3fc;">وترصيد يُجيب</span>
        </h2>
      </div>
    `
  },
  {
    id: 's3',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; direction: rtl; background: transparent;">
        <div style="margin-top: 10vh; text-align: center;">
          <h2 style="font-size: 64px; font-weight: 900; color: white; margin-bottom: 20px; font-family: 'Cairo', sans-serif;">مساعدك المالي الذكي</h2>
          <p style="font-size: 40px; font-weight: 700; color: #a5f3fc; font-family: 'Cairo', sans-serif;">قيود يومية بضغطة زر</p>
        </div>
        <div style="position: absolute; bottom: 10vh; background-color: white; color: #1e3a8a; padding: 20px 48px; border-radius: 9999px; font-size: 40px; font-weight: 800; font-family: 'Cairo', sans-serif; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">بدون أخطاء بشرية!</div>
      </div>
    `
  },
  {
    id: 's4',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; direction: rtl; background: transparent;">
        <div style="margin-top: 10vh; text-align: center;">
          <h2 style="font-size: 64px; font-weight: 900; color: white; margin-bottom: 20px; line-height: 1.4; font-family: 'Cairo', sans-serif;">
            فواتير وتقارير<br/>
            <span style="color: #67e8f9;">في ثوانٍ</span>
          </h2>
        </div>
      </div>
    `
  },
  {
    id: 's5',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; direction: rtl; background: transparent;">
        <h2 style="font-size: 56px; font-weight: 900; color: #1e3a8a; margin-bottom: 40px; font-family: 'Cairo', sans-serif;">أسهل. أوضح. أسرع.</h2>
        <div style="background-color: #2563eb; color: white; padding: 24px 64px; border-radius: 9999px; font-size: 40px; font-weight: 800; margin-bottom: 15vh; font-family: 'Cairo', sans-serif; box-shadow: 0 20px 40px rgba(37,99,235,0.4);">ابدأ مجاناً الآن</div>
      </div>
    `
  }
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1920 }
  });

  for (const item of overlays) {
    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 0;
            width: 1080px;
            height: 1920px;
            background: transparent;
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        ${item.html}
      </body>
      </html>
    `;
    await page.setContent(content, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${outDir}/${item.id}.png`, omitBackground: true });
    console.log(`Generated ${item.id}.png`);
  }
  
  await browser.close();
})();
