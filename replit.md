# ترصيد — نظام الكاشير والمحاسبة

تطبيق ويب محاسبة وكاشير متكامل يعمل Offline-First. ملف HTML واحد بالكامل — لا React، لا Vue، لا Bootstrap.

## Run & Operate

- `pnpm --filter @workspace/wudooh run dev` — تشغيل التطبيق (منفذ من artifact workflow)
- لا يحتاج DATABASE_URL — يستخدم IndexedDB فقط

## Stack

- Vanilla HTML + CSS + JavaScript (ملف واحد: `artifacts/wudooh/index.html`)
- Dexie.js 3.2.4 من unpkg — wrapper لـ IndexedDB
- IndexedDB لكل البيانات
- localStorage لحفظ جلسة المستخدم
- Vite لاستضافة الملف الثابت

## Where things live

- `artifacts/wudooh/index.html` — **التطبيق كامله** (HTML + CSS + JS)
- `artifacts/wudooh/vite.config.ts` — إعدادات Vite

## Architecture decisions

- **ملف واحد فقط** — كل كود HTML وCSS وJS في index.html حسب طلب المستخدم
- **Offline-First** — يعمل بدون إنترنت باستخدام IndexedDB عبر Dexie.js
- **RTL كامل** — واجهة عربية بالكامل مع خط Tajawal
- **Multi-user** — كل مستخدم له بياناته المنفصلة في IndexedDB باستخدام userId
- **No backend** — لا server، لا قاعدة بيانات خارجية

## Product

- Auth (تسجيل + دخول)
- لوحة التحكم مع KPIs
- كاشير/POS مع ماسح باركود USB
- إدارة المنتجات والمخزون
- الفواتير (إنشاء + عرض + طباعة)
- المصاريف
- العملاء
- التقارير والإحصاءات

## User preferences

- ملف HTML واحد فقط بدون frameworks
- Dexie.js فقط من unpkg
- واجهة عربية RTL
- اللون الرئيسي: #1D9E75
