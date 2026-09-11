import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  BarChart3,
  Bell,
  Boxes,
  ChevronLeft,
  ClipboardList,
  FileText,
  LayoutDashboard,
  PackageOpen,
  ReceiptText,
  ShoppingCart,
  Store,
  UsersRound,
  WalletCards,
} from "lucide-react";
import "./_group.css";

const navigation = [
  ["لوحة التحكم", LayoutDashboard, true],
  ["نقطة البيع", Store, false],
  ["المبيعات والعملاء", ShoppingCart, false],
  ["المخزون والمنتجات", Boxes, false],
  ["القيود اليومية", FileText, false],
  ["إدارة الفريق", UsersRound, false],
] as const;

const modules = [
  ["نقطة البيع", "سجّل مبيعاتك وفواتيرك بسرعة", Store, "teal"],
  ["المبيعات والعملاء", "تابع الفواتير وحركة البيع اليومية", ShoppingCart, "blue"],
  ["المخزون والمنتجات", "راقب الأرصدة وحركات المستودعات", Boxes, "violet"],
  ["المحاسبة والتقارير", "أرقام واضحة وقرارات مترابطة", ReceiptText, "indigo"],
] as const;

const chart = [55, 42, 68, 52, 82, 63, 90];

export function Dashboard() {
  return (
    <div className="ts-dashboard" dir="rtl">
      <style>{`
        .ts-dashboard{--ink:#10253f;--muted:#73879a;--line:#dce8ee;--teal:#16b7b0;display:grid;grid-template-columns:minmax(0,1fr) 222px;height:100vh;min-height:600px;overflow:hidden;background:#f5f9fb;color:var(--ink);font-family:"Cairo",sans-serif;line-height:1.35}
        .ts-dashboard *{box-sizing:border-box}.ts-rail{grid-column:2;grid-row:1;display:flex;min-width:0;flex-direction:column;color:#f3fbff;background:radial-gradient(circle at 25% 2%,rgba(37,96,145,.3),transparent 30%),linear-gradient(165deg,#09254a,#071a35 57%,#06152c)}
        .ts-brand{display:flex;align-items:center;gap:10px;padding:25px 20px;border-bottom:1px solid #cfeef51f}.ts-mark{display:grid;width:38px;height:38px;place-items:center;border-radius:11px;color:#063451;background:linear-gradient(145deg,#60dfed,#11b7b3);font-size:23px;font-weight:800}.ts-brand strong,.ts-brand small,.ts-workspace small,.ts-workspace strong,.ts-workspace em{display:block}.ts-brand strong{font-size:16px}.ts-brand small{margin-top:2px;color:#8aa9bf;font-size:9px}
        .ts-workspace{margin:18px 14px 12px;padding:12px 11px;border:1px solid #bae2ef24;border-radius:11px;background:#ffffff0e}.ts-workspace small{margin-bottom:7px;color:#73dedb;font-size:9px}.ts-workspace strong{font-size:11px}.ts-workspace strong span{display:inline-grid;width:22px;height:22px;margin-left:5px;place-items:center;border-radius:50%;color:#d6ffff;background:#175477}.ts-workspace em{margin-top:3px;color:#7d9ab0;font-size:9px;font-style:normal}
        .ts-nav{flex:1;padding:12px 12px}.ts-nav>small{display:block;margin:0 10px 9px;color:#6e8da7;font-size:9px}.ts-nav-item{display:flex;align-items:center;gap:9px;min-height:39px;margin-bottom:4px;padding:7px 10px;border-radius:8px;color:#b3c9d8;font-size:10px;font-weight:600}.ts-nav-item svg{width:16px;height:16px;color:#7094ad}.ts-nav-item svg:last-child{margin-right:auto;width:13px}.ts-nav-item.active{color:#042d4e;background:linear-gradient(90deg,#52dad7,#45cbd9)}.ts-nav-item.active svg{color:#063c5a}.ts-rail-note{padding:17px 20px 21px;border-top:1px solid #cfeef51c;color:#7895a9;font-size:9px;line-height:1.8}
        .ts-main{grid-column:1;grid-row:1;min-width:0}.ts-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:69px;padding:0 29px;border-bottom:1px solid var(--line);background:#fff}.ts-breadcrumb{display:flex;align-items:center;gap:6px;color:#8191a5;font-size:10px}.ts-breadcrumb svg{width:12px;height:12px}.ts-breadcrumb strong{color:var(--ink)}.ts-actions{display:flex;align-items:center;gap:9px;color:#73879a;font-size:10px}.ts-actions>span{position:relative;display:grid;width:31px;height:31px;place-items:center;border:1px solid var(--line);border-radius:7px;background:#fff}.ts-actions svg{width:15px;height:15px}.ts-actions .dot:after{position:absolute;top:4px;right:4px;width:5px;height:5px;border:1px solid #fff;border-radius:50%;background:#ef6d65;content:""}.ts-avatar{display:grid;width:31px;height:31px;place-items:center;border-radius:50%;color:#087b83;background:#d4f3ef;font-weight:800}
        .ts-content{padding:25px 29px;overflow:hidden}.ts-intro{display:flex;align-items:end;justify-content:space-between;margin-bottom:18px}.ts-intro small{color:#8191a5;font-size:10px}.ts-intro h1{margin:4px 0 2px;font-size:25px;line-height:1.35}.ts-intro p{margin:0;color:#73879a;font-size:11px}.ts-pos{display:flex;align-items:center;gap:7px;padding:10px 14px;border:0;border-radius:8px;color:#fff;background:#0d47d9;font-family:inherit;font-size:10px;font-weight:700}.ts-pos svg{width:14px;height:14px}
        .ts-alert{display:flex;align-items:center;gap:10px;margin-bottom:18px;padding:10px 13px;border:1px solid #f5d99a;border-radius:9px;background:#fff9e9}.ts-alert>span{display:grid;width:28px;height:28px;place-items:center;border-radius:7px;color:#b16e0a;background:#ffefc4}.ts-alert svg{width:15px}.ts-alert strong,.ts-alert small{display:block}.ts-alert strong{font-size:10px;color:#69480f}.ts-alert small{margin-top:2px;color:#9a7738;font-size:9px}
        .ts-section-title{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}.ts-section-title strong{font-size:14px}.ts-section-title small{color:#8a9aa9;font-size:9px}.ts-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}.ts-kpi{padding:13px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;box-shadow:0 4px 15px #153a5710}.ts-kpi-head{display:flex;align-items:center;justify-content:space-between;color:#73879a;font-size:9px}.ts-kpi-head span{display:grid;width:27px;height:27px;place-items:center;border-radius:7px}.ts-kpi-head svg{width:15px;height:15px}.ts-kpi strong{display:block;margin-top:8px;color:var(--ink);font-size:18px;letter-spacing:-.3px}.ts-kpi strong em{margin-right:4px;color:#8394a3;font-size:9px;font-style:normal}.ts-kpi p{margin:4px 0 0;color:#2c9c72;font-size:9px}.ts-kpi p small{color:#a0acb8;font-size:8px}.tone-teal{color:#0d948d;background:#e0f8f3}.tone-blue{color:#1664c0;background:#e6f1ff}.tone-orange{color:#bd7412;background:#fff1d7}.tone-purple{color:#6356ad;background:#eeeafe}
        .ts-bottom{display:grid;grid-template-columns:1.32fr .9fr;gap:12px;margin-top:15px}.ts-panel{padding:15px;border:1px solid var(--line);border-radius:10px;background:#fff;box-shadow:0 4px 15px #153a5709}.ts-panel-heading{display:flex;align-items:flex-start;justify-content:space-between}.ts-panel-heading strong,.ts-panel-heading small{display:block}.ts-panel-heading strong{font-size:11px}.ts-panel-heading small{margin-top:3px;color:#8a9aa9;font-size:8px}.ts-panel-heading>svg{width:16px;height:16px;color:#62819a}.ts-chart{display:flex;align-items:flex-end;justify-content:space-around;gap:9px;height:90px;margin-top:13px;padding:5px 9px 17px;border-bottom:1px solid #dce8ec;background:repeating-linear-gradient(to top,transparent 0,transparent 27px,#edf3f5 28px,transparent 29px)}.ts-col{display:flex;align-items:flex-end;justify-content:center;gap:3px;width:100%;height:100%;position:relative}.ts-col i,.ts-col b{display:block;width:8px;min-height:4px;border-radius:4px 4px 2px 2px;background:#b9dbe2}.ts-col b{background:linear-gradient(#38d0c6,#14aead)}.ts-col small{position:absolute;bottom:-15px;color:#8d9cab;font-size:8px}.ts-total{display:flex;align-items:center;gap:10px;margin-top:8px;color:#8595a5;font-size:8px}.ts-total strong{color:var(--ink);font-size:11px}.ts-total strong:last-child{margin-right:auto;color:#2c9c72}
        .ts-finance{display:flex;flex-direction:column}.ts-movement{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid #edf2f4}.ts-movement:last-child{border-bottom:0}.ts-movement span{display:flex;align-items:center;gap:7px;color:#647a8d;font-size:9px}.ts-movement i{display:grid;width:23px;height:23px;place-items:center;border-radius:6px}.ts-movement svg{width:13px;height:13px}.ts-movement strong{font-size:10px}.up{color:#168a6b;background:#dcf5ea}.down{color:#c1712b;background:#fff0d9}.ts-modules{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:15px}.ts-module{padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:#fff}.ts-module i{display:grid;width:27px;height:27px;place-items:center;border-radius:7px}.ts-module svg{width:14px;height:14px}.ts-module strong{display:block;margin-top:8px;font-size:10px}.ts-module small{display:block;margin-top:3px;color:#8191a5;font-size:8px}
      `}</style>
      <aside className="ts-rail">
        <div className="ts-brand"><span className="ts-mark">ت</span><span><strong>ترصيد</strong><small>نظام تشغيل منشأتك</small></span></div>
        <div className="ts-workspace"><small>مساحة العمل الحالية</small><strong><span>ن</span> متجر النخبة</strong><em>سارة الحربي · المالكة</em></div>
        <nav className="ts-nav" aria-label="أقسام لوحة التحكم"><small>الرئيسية</small>{navigation.map(([label, Icon, active]) => <div className={`ts-nav-item${active ? " active" : ""}`} key={label}><Icon /><span>{label}</span>{active && <ChevronLeft />}</div>)}</nav>
        <div className="ts-rail-note">بياناتك مرتبة.<br />قراراتك أوضح.</div>
      </aside>
      <main className="ts-main">
        <header className="ts-topbar"><div className="ts-breadcrumb">الرئيسية <ChevronLeft /> <strong>لوحة التحكم</strong></div><div className="ts-actions"><span><BarChart3 /></span><span className="dot"><Bell /></span><strong>سارة الحربي</strong><i className="ts-avatar">س</i></div></header>
        <div className="ts-content">
          <div className="ts-intro"><div><small>الأربعاء، 21 أغسطس 2024</small><h1>صباح الخير، سارة</h1><p>هذه صورة منشأتك اليوم — كل رقم يقودك إلى خطوة أوضح.</p></div><button className="ts-pos" type="button">فتح نقطة البيع <Store /></button></div>
          <div className="ts-alert"><span><PackageOpen /></span><div><strong>تنبيه يحتاج مراجعتك</strong><small>لديك أمران للشراء بانتظار الاستلام.</small></div></div>
          <div className="ts-section-title"><strong>نظرة عامة</strong><small>مؤشرات الأداء المالي والتشغيلي خلال هذا الأسبوع</small></div>
          <div className="ts-kpis">
            <Metric label="صافي الربح" value="67,250" trend="+ 12.4%" icon={WalletCards} tone="teal" />
            <Metric label="إجمالي الإيرادات" value="98,500" trend="+ 8.2%" icon={ArrowUpLeft} tone="blue" />
            <Metric label="الذمم المدينة" value="17,300" trend="4 مستحقات" icon={ArrowDownLeft} tone="orange" />
            <Metric label="الذمم الدائنة" value="8,600" trend="3 مستحقات" icon={ReceiptText} tone="purple" />
          </div>
          <div className="ts-bottom">
            <section className="ts-panel"><div className="ts-panel-heading"><div><strong>حركة الإيرادات والمصروفات</strong><small>الأسبوع الحالي</small></div><BarChart3 /></div><div className="ts-chart">{chart.map((height, index) => <div className="ts-col" key={index}><i style={{ height: `${Math.max(22, height - 28)}%` }} /><b style={{ height: `${height}%` }} /><small>{["س", "ح", "ن", "ث", "ر", "خ", "ج"][index]}</small></div>)}</div><div className="ts-total"><strong>98,500 ر.س</strong><span>إجمالي الإيرادات</span><strong>+ 12.4%</strong></div></section>
            <section className="ts-panel ts-finance"><div className="ts-panel-heading"><div><strong>الحركة المالية</strong><small>ملخص هذا الأسبوع</small></div><WalletCards /></div><div className="ts-movement"><span><i className="up"><ArrowUpLeft /></i>إيرادات المبيعات</span><strong>+ 98,500 ر.س</strong></div><div className="ts-movement"><span><i className="down"><ArrowDownLeft /></i>المصروفات</span><strong>− 31,250 ر.س</strong></div><div className="ts-movement"><span><i className="up"><ArrowUpLeft /></i>صافي الحركة</span><strong>+ 67,250 ر.س</strong></div></section>
          </div>
          <div className="ts-modules">{modules.map(([label, description, Icon, tone]) => <div className="ts-module" key={label}><i className={`tone-${tone}`}><Icon /></i><strong>{label}</strong><small>{description}</small></div>)}</div>
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, trend, icon: Icon, tone }: { label: string; value: string; trend: string; icon: typeof WalletCards; tone: string }) {
  return <article className="ts-kpi"><div className="ts-kpi-head"><small>{label}</small><span className={`tone-${tone}`}><Icon /></span></div><strong>{value}<em>ر.س</em></strong><p>{trend} <small>مقارنة بالأسبوع السابق</small></p></article>;
}