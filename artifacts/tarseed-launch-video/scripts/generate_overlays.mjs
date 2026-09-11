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
      <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; direction: rtl;">
        <div style="text-align: center; font-family: 'Cairo', sans-serif; color: white;">
          <h1 style="font-size: 60px; font-weight: 800; margin-bottom: 20px; text-shadow: 2px 2px 10px rgba(255,0,0,0.5);">هل المحاسبة معقدة فعلًا…</h1>
          <h2 style="font-size: 48px; font-weight: 700; color: #fca5a5; text-shadow: 2px 2px 10px rgba(255,0,0,0.5);">ولا إحنا مصعّبينها؟</h2>
        </div>
      </div>
    `
  },
  {
    id: 's1_0',
    html: `
      <div style="position: absolute; top: 10vh; width: 100%; display: flex; justify-content: center; direction: rtl;">
        <div style="background-color: #450a0a; color: white; padding: 16px 40px; border-radius: 9999px; font-size: 36px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 2px solid #ef4444; box-shadow: 0 10px 25px rgba(239,68,68,0.5);">
          قوائم كثيرة… وخطوات أكثر
        </div>
      </div>
    `
  },
  {
    id: 's1_1',
    html: `
      <div style="position: absolute; top: 10vh; width: 100%; display: flex; justify-content: center; direction: rtl;">
        <div style="background-color: #450a0a; color: white; padding: 16px 40px; border-radius: 9999px; font-size: 36px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 2px solid #ef4444; box-shadow: 0 10px 25px rgba(239,68,68,0.5);">
          أرقام كثيرة بدون وضوح
        </div>
      </div>
    `
  },
  {
    id: 's1_2',
    html: `
      <div style="position: absolute; top: 10vh; width: 100%; display: flex; justify-content: center; direction: rtl;">
        <div style="background-color: #450a0a; color: white; padding: 16px 40px; border-radius: 9999px; font-size: 36px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 2px solid #ef4444; box-shadow: 0 10px 25px rgba(239,68,68,0.5);">
          تقارير معقدة يصعب فهمها
        </div>
      </div>
    `
  },
  {
    id: 's1_3',
    html: `
      <div style="position: absolute; top: 10vh; width: 100%; display: flex; justify-content: center; direction: rtl;">
        <div style="background-color: #450a0a; color: white; padding: 16px 40px; border-radius: 9999px; font-size: 36px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 2px solid #ef4444; box-shadow: 0 10px 25px rgba(239,68,68,0.5);">
          عملية البيع تأخذ وقتاً
        </div>
      </div>
    `
  },
  {
    id: 's1_4',
    html: `
      <div style="position: absolute; top: 10vh; width: 100%; display: flex; justify-content: center; direction: rtl;">
        <div style="background-color: #450a0a; color: white; padding: 16px 40px; border-radius: 9999px; font-size: 36px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 2px solid #ef4444; box-shadow: 0 10px 25px rgba(239,68,68,0.5);">
          الازدحام مستمر حتى على الجوال
        </div>
      </div>
    `
  },
  {
    id: 's1b',
    html: `
      <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; direction: rtl;">
        <h1 style="font-size: 72px; font-weight: 900; color: white; font-family: 'Cairo', sans-serif;">قررنا نغيّر الطريقة</h1>
      </div>
    `
  },
  {
    id: 's2_top',
    html: `
      <div style="position: absolute; top: 8vh; width: 100%; text-align: center; direction: rtl; display: flex; flex-direction: column; align-items: center;">
        <div style="font-size: 56px; font-weight: 800; color: white; margin-bottom: 8px; font-family: 'Cairo', sans-serif; text-shadow: 0 4px 15px rgba(0,0,0,0.5);">المحاسبة أصبحت ذكية</div>
        <div style="font-size: 32px; font-weight: 600; color: #22d3ee; font-family: 'Cairo', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.5);">اطلب من مساعدك الذكي ما تريد</div>
      </div>
    `
  },
  {
    id: 's2_0',
    html: `
      <div style="position: absolute; bottom: 15vh; right: 10vw; direction: rtl;">
        <div style="background: linear-gradient(135deg, #0e7490, #0369a1); color: white; padding: 16px 40px; border-radius: 20px; font-size: 32px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 1px solid #67e8f9; box-shadow: 0 15px 30px rgba(8,145,178,0.4);">
          كل أرقامك في نظرة واحدة
        </div>
      </div>
    `
  },
  {
    id: 's2_1',
    html: `
      <div style="position: absolute; bottom: 15vh; left: 10vw; direction: rtl;">
        <div style="background: linear-gradient(135deg, #0e7490, #0369a1); color: white; padding: 16px 40px; border-radius: 20px; font-size: 32px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 1px solid #67e8f9; box-shadow: 0 15px 30px rgba(8,145,178,0.4);">
          اسأل مساعدك المالي
        </div>
      </div>
    `
  },
  {
    id: 's2_2',
    html: `
      <div style="position: absolute; bottom: 15vh; right: 10vw; direction: rtl;">
        <div style="background: linear-gradient(135deg, #0e7490, #0369a1); color: white; padding: 16px 40px; border-radius: 20px; font-size: 32px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 1px solid #67e8f9; box-shadow: 0 15px 30px rgba(8,145,178,0.4);">
          حوّل سؤالك إلى قيد متوازن
        </div>
      </div>
    `
  },
  {
    id: 's3_top',
    html: `
      <div style="position: absolute; top: 8vh; width: 100%; text-align: center; direction: rtl; display: flex; flex-direction: column; align-items: center;">
        <div style="font-size: 56px; font-weight: 800; color: white; margin-bottom: 8px; font-family: 'Cairo', sans-serif; text-shadow: 0 4px 15px rgba(0,0,0,0.5);">كل شيء مترابط</div>
      </div>
    `
  },
  {
    id: 's3_0',
    html: `
      <div style="position: absolute; bottom: 15vh; right: 10vw; direction: rtl;">
        <div style="background: linear-gradient(135deg, #0e7490, #0369a1); color: white; padding: 16px 40px; border-radius: 20px; font-size: 32px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 1px solid #67e8f9; box-shadow: 0 15px 30px rgba(8,145,178,0.4);">
          بع أسرع واحسب الضريبة تلقائياً
        </div>
      </div>
    `
  },
  {
    id: 's3_1',
    html: `
      <div style="position: absolute; bottom: 15vh; left: 10vw; direction: rtl;">
        <div style="background: linear-gradient(135deg, #0e7490, #0369a1); color: white; padding: 16px 40px; border-radius: 20px; font-size: 32px; font-family: 'Cairo', sans-serif; font-weight: 700; border: 1px solid #67e8f9; box-shadow: 0 15px 30px rgba(8,145,178,0.4);">
          تقارير مالية واضحة لحظياً
        </div>
      </div>
    `
  },
  {
    id: 's4_bottom',
    html: `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; direction: rtl; margin-top: 350px;">
        <div style="font-size: 48px; font-weight: 800; color: white; font-family: 'Cairo', sans-serif; text-shadow: 0 4px 15px rgba(0,0,0,0.5);">
          المحاسبة بطريقة أوضح
        </div>
      </div>
    `
  },
  {
    id: 's4_glows',
    html: `
      <div style="position: absolute; inset: 0; overflow: hidden; z-index: -1;">
        <div style="position: absolute; top: 25%; left: 25%; width: 50vw; height: 50vw; background-color: rgba(37,99,235,0.4); border-radius: 50%; filter: blur(80px);"></div>
        <div style="position: absolute; bottom: 25%; right: 25%; width: 60vw; height: 60vw; background-color: rgba(34,211,238,0.3); border-radius: 50%; filter: blur(80px);"></div>
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
    // Wait a moment for font rendering
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${item.id}.png`, omitBackground: true });
    console.log(`Generated ${item.id}.png`);
  }
  
  await browser.close();
})();