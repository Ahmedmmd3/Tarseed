import { useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Menu,
  Search,
  Settings2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import "./_group.css";

type ReportTab = "trial" | "income" | "balance";

const money = (value: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(value);

const rows = [
  ["1100", "النقدية والبنوك", "23,700", "—"],
  ["1200", "الذمم المدينة", "17,300", "—"],
  ["1300", "المخزون", "24,500", "—"],
  ["2100", "الذمم الدائنة", "—", "8,600"],
  ["3100", "رأس المال", "—", "49,950"],
  ["4100", "إيرادات المبيعات", "—", "98,500"],
  ["5100", "مصروفات التشغيل", "31,250", "—"],
];

export function Reports() {
  const [tab, setTab] = useState<ReportTab>("trial");
  const [from, setFrom] = useState("2024-01-01");
  const [to, setTo] = useState("2024-12-31");

  return (
    <main className="tr-reports" dir="rtl">
      <style>{`
        .tr-reports{height:100vh;min-height:680px;display:flex;background:#f7f9fc;color:#12203a;font-family:Cairo,sans-serif;font-size:13px;overflow:hidden}
        .tr-sidebar{width:226px;flex:none;background:#0a1832;color:#d9e2f1;display:flex;flex-direction:column;padding:22px 14px 17px}
        .tr-brand{display:flex;align-items:center;gap:10px;padding:0 10px 25px}.tr-brand-mark{background:#0d47d9;color:#fff;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:23px;font-weight:800}.tr-brand strong{display:block;color:white;font-size:20px;line-height:21px}.tr-brand span{font-size:10px;color:#8c9bb3}
        .tr-workspace{height:58px;border:1px solid #233856;border-radius:9px;padding:9px 8px;display:flex;align-items:center;gap:8px;margin-bottom:25px;font-size:11px}.tr-workspace b,.tr-user b{display:block;color:#f7faff;font-size:11px}.tr-workspace small,.tr-user small{display:block;color:#8b9ab2;font-size:9px}.tr-workspace svg{margin-right:auto;color:#8998b1}.tr-avatar,.tr-user-avatar{width:31px;height:31px;display:grid;place-items:center;border-radius:50%;background:#1d65d8;color:#fff;font-weight:700}
        .tr-nav-item{height:45px;display:flex;align-items:center;gap:12px;color:#91a1ba;padding:0 13px;border-radius:8px;margin:3px 0;font-size:12px}.tr-nav-active{background:#164493;color:#fff;box-shadow:inset -3px 0 #23aaf3}.tr-sidebar-foot{margin-top:auto;color:#6680a4;text-align:center;font-size:10px;line-height:1.8}.tr-sidebar-foot span{color:#496382}
        .tr-content{flex:1;min-width:0;overflow:hidden}.tr-header{height:65px;background:#fff;border-bottom:1px solid #e8ecf3;display:flex;align-items:center;padding:0 29px;gap:15px}.tr-menu{border:0;background:none;color:#62738c}.tr-breadcrumb{color:#708097;font-size:12px}.tr-breadcrumb span{color:#c4ccd8;margin:0 7px}.tr-header-actions{margin-right:auto;display:flex;align-items:center;gap:14px}.tr-icon-button{border:0;background:none;color:#66758d;position:relative;padding:6px}.tr-notification i{width:6px;height:6px;background:#eb4f67;border:1px solid #fff;border-radius:50%;position:absolute;right:4px;top:4px}.tr-user{border-right:1px solid #e7ebf2;padding-right:15px;display:flex;align-items:center;gap:8px}.tr-user b{color:#263750}.tr-user-avatar{width:30px;height:30px;background:#e9efff;color:#1453c4}.tr-user svg{color:#8b99ac}
        .tr-page{padding:22px 29px;max-width:1200px;margin:auto}.tr-title-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.tr-title-row h1{font-size:21px;margin:0;color:#14243e;letter-spacing:-.4px}.tr-title-row p{margin:2px 0 0;color:#7b8a9f;font-size:11px}.tr-connected{font-size:10px;color:#128157;background:#ecfbf3;border:1px solid #c5eed9;border-radius:15px;padding:6px 11px}.tr-connected i{display:inline-block;width:6px;height:6px;background:#1eb779;border-radius:50%;margin-left:5px}
        .tr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.tr-kpi{background:#fff;border:1px solid #e7ebf2;border-radius:10px;padding:12px 14px;position:relative;min-height:90px;box-shadow:0 2px 5px #1f3b6108}.tr-kpi span{font-size:10px;color:#73839b;display:block;margin:0 0 5px}.tr-kpi strong{font-size:19px;color:#192942;display:block;line-height:23px}.tr-kpi strong small{font-weight:500;font-size:10px;color:#76859b}.tr-kpi em{font-style:normal;font-size:9px;color:#8391a4}.tr-kpi-icon{position:absolute;left:13px;top:14px;width:31px;height:31px;border-radius:8px;display:grid;place-items:center}.tr-kpi-icon.blue{color:#1b5ed6;background:#e8f0ff}.tr-kpi-icon.green{color:#149469;background:#e6f8f1}.tr-kpi-icon.amber{color:#ce8a18;background:#fff4de}.tr-kpi-icon.purple{color:#7456ca;background:#f0ecff}
        .tr-controls{display:flex;align-items:center;justify-content:space-between;background:#eef1f6;border:1px solid #e1e6ee;border-radius:9px;padding:5px;margin-bottom:15px}.tr-tabs{display:flex;gap:2px}.tr-tabs button{border:0;background:transparent;color:#62738a;border-radius:6px;padding:8px 13px;display:flex;align-items:center;gap:6px;font-family:inherit;font-size:11px;font-weight:600}.tr-tabs button.selected{background:#fff;color:#0d47d9;box-shadow:0 1px 4px #132d531c}.tr-date-controls{display:flex;align-items:end;gap:7px;padding-left:4px}.tr-date-controls label{color:#77869b;font-size:9px}.tr-date-controls label div{display:flex;align-items:center;gap:4px;margin-top:2px;background:#fff;border:1px solid #dbe2ec;border-radius:5px;padding:3px 6px;color:#7e8da0}.tr-date-controls input{border:0;outline:0;width:88px;font-family:inherit;font-size:10px;color:#35445d;background:transparent;direction:ltr}.tr-filter{height:28px;background:#0d47d9;color:#fff;border:0;border-radius:5px;padding:0 13px;font-family:inherit;font-size:10px}
        .tr-report-card{background:#fff;border:1px solid #e4e9f1;border-radius:10px;box-shadow:0 2px 7px #1c3e6b0a;overflow:hidden}.tr-report-heading{display:flex;justify-content:space-between;align-items:center;background:#fbfcfe;border-bottom:1px solid #e6ebf2;padding:13px 18px}.tr-report-heading h2{font-size:15px;margin:0;color:#1b2b44}.tr-report-heading p{color:#8491a3;font-size:10px;margin:3px 0 0}.tr-report-heading p b{font-family:monospace;font-weight:500;color:#65758b}.tr-export{border:1px solid #d4ddea;border-radius:6px;background:#fff;color:#45617f;padding:7px 11px;font-family:inherit;font-size:10px;display:flex;align-items:center;gap:6px}.tr-table-wrap{overflow:hidden}table{border-collapse:collapse;width:100%;font-size:11px}th{text-align:right;background:#fff;color:#677890;font-weight:700;padding:10px 18px;border-bottom:2px solid #e7ebf1}th:nth-child(n+3),td.number{text-align:left}td{padding:9px 18px;color:#30415b;border-bottom:1px solid #eef1f5}td.code{color:#8290a3;font-family:monospace;font-size:10px}td.number{font-family:monospace;color:#42536d}tr.total{background:#f4f7fa;border-top:3px double #cfd7e3}tr.total td{font-weight:800;color:#172841;border-bottom:0;padding-top:11px;padding-bottom:11px}tr.total td.number{color:#11855d}
        @media(max-width:850px){.tr-sidebar{width:65px;padding:15px 8px}.tr-brand div:not(.tr-brand-mark),.tr-workspace div,.tr-workspace svg,.tr-nav-item{font-size:0}.tr-nav-item{justify-content:center;padding:0}.tr-nav-item svg{width:19px}.tr-workspace{justify-content:center}.tr-sidebar-foot{display:none}.tr-page{padding:18px}.tr-kpis{grid-template-columns:repeat(2,1fr)}.tr-controls{flex-direction:column;align-items:stretch;gap:6px}.tr-date-controls{justify-content:flex-start}.tr-title-row{display:block}.tr-connected{display:inline-block;margin-top:8px}}
      `}</style>
      <aside className="tr-sidebar">
        <div className="tr-brand">
          <div className="tr-brand-mark">ت</div>
          <div>
            <strong>ترصيد</strong>
            <span>نظام المحاسبة</span>
          </div>
        </div>
        <div className="tr-workspace">
          <div className="tr-avatar">م</div>
          <div><b>متجر الواحة</b><small>المنشأة الرئيسية</small></div>
          <ChevronDown size={15} />
        </div>
        <nav>
          <div className="tr-nav-item"><LayoutDashboard size={18} /> لوحة التحكم</div>
          <div className="tr-nav-item"><WalletCards size={18} /> المبيعات والمشتريات</div>
          <div className="tr-nav-item"><Landmark size={18} /> الحسابات والقيود</div>
          <div className="tr-nav-item tr-nav-active"><FileSpreadsheet size={18} /> التقارير المالية</div>
          <div className="tr-nav-item"><Settings2 size={18} /> الإعدادات</div>
        </nav>
        <div className="tr-sidebar-foot">ترصيد يساعدك على فهم أرقامك<br /><span>الإصدار 2.4.0</span></div>
      </aside>

      <section className="tr-content">
        <header className="tr-header">
          <button className="tr-menu" aria-label="القائمة"><Menu size={21} /></button>
          <div className="tr-breadcrumb">التقارير <span>/</span> التقارير المالية</div>
          <div className="tr-header-actions">
            <button className="tr-icon-button"><Search size={19} /></button>
            <button className="tr-icon-button tr-notification"><Bell size={19} /><i /></button>
            <div className="tr-user"><div className="tr-user-avatar">أ</div><div><b>أحمد محمد</b><small>المدير العام</small></div><ChevronDown size={15} /></div>
          </div>
        </header>

        <div className="tr-page">
          <div className="tr-title-row">
            <div>
              <h1>القوائم والتقارير المالية</h1>
              <p>استعرض وحلل القوائم الختامية وأداء المنشأة.</p>
            </div>
            <span className="tr-connected"><i /> متصل بسجل المنشأة الموحد</span>
          </div>

          <div className="tr-kpis">
            <div className="tr-kpi"><div className="tr-kpi-icon blue"><TrendingUp size={20} /></div><span>صافي الدخل</span><strong>{money(67250)} <small>ر.س</small></strong><em>↑ 12.4% عن الفترة السابقة</em></div>
            <div className="tr-kpi"><div className="tr-kpi-icon green"><WalletCards size={20} /></div><span>إجمالي الإيرادات</span><strong>{money(98500)} <small>ر.س</small></strong><em>خلال الفترة المحددة</em></div>
            <div className="tr-kpi"><div className="tr-kpi-icon amber"><FileSpreadsheet size={20} /></div><span>الذمم المدينة</span><strong>{money(17300)} <small>ر.س</small></strong><em>المبالغ المستحقة للتحصيل</em></div>
            <div className="tr-kpi"><div className="tr-kpi-icon purple"><Landmark size={20} /></div><span>الذمم الدائنة</span><strong>{money(8600)} <small>ر.س</small></strong><em>المبالغ المستحقة السداد</em></div>
          </div>

          <div className="tr-controls">
            <div className="tr-tabs">
              <button className={tab === "trial" ? "selected" : ""} onClick={() => setTab("trial")}><FileSpreadsheet size={16} /> ميزان المراجعة</button>
              <button className={tab === "income" ? "selected" : ""} onClick={() => setTab("income")}><TrendingUp size={16} /> قائمة الدخل</button>
              <button className={tab === "balance" ? "selected" : ""} onClick={() => setTab("balance")}><Landmark size={16} /> الميزانية العمومية</button>
            </div>
            <div className="tr-date-controls">
              <label>من <div><CalendarDays size={15} /><input value={from} onChange={(e) => setFrom(e.target.value)} /></div></label>
              <label>إلى <div><CalendarDays size={15} /><input value={to} onChange={(e) => setTo(e.target.value)} /></div></label>
              <button className="tr-filter">تطبيق</button>
            </div>
          </div>

          <section className="tr-report-card">
            <div className="tr-report-heading">
              <div><h2>{tab === "trial" ? "ميزان المراجعة بالمجاميع والأرصدة" : tab === "income" ? "قائمة الدخل (الأرباح والخسائر)" : "قائمة المركز المالي (الميزانية العمومية)"}</h2><p>للفترة من <b>{from}</b> إلى <b>{to}</b></p></div>
              <button className="tr-export"><FileSpreadsheet size={16} /> تصدير التقرير</button>
            </div>
            <div className="tr-table-wrap">
              <table>
                <thead><tr><th>رقم الحساب</th><th>اسم الحساب</th><th>الجانب المدين</th><th>الجانب الدائن</th></tr></thead>
                <tbody>
                  {rows.map((row) => <tr key={row[0]}><td className="code">{row[0]}</td><td>{row[1]}</td><td className="number">{row[2]}</td><td className="number">{row[3]}</td></tr>)}
                  <tr className="total"><td colSpan={2}>الإجمالي الكلي</td><td className="number">{money(98500)} ر.س</td><td className="number">{money(98500)} ر.س</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default Reports;