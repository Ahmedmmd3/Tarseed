import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpLeft,
  BarChart3,
  Bell,
  Boxes,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  RefreshCw,
  ShoppingCart,
  Store,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import './landing-dashboard-preview.css';

const navItems = [
  ['لوحة التحكم', LayoutDashboard, true],
  ['نقطة البيع', Store, false],
  ['المبيعات والعملاء', ShoppingCart, false],
  ['المخزون والمنتجات', Boxes, false],
  ['القيود اليومية', FileText, false],
  ['إدارة الفريق', UsersRound, false],
] as const;

const kpis = [
  { label: 'صافي الربح', value: '67,250', icon: WalletCards, trend: '+ 12.4%', tone: 'teal' },
  { label: 'إجمالي الإيرادات', value: '98,500', icon: ArrowUpLeft, trend: '+ 8.2%', tone: 'cyan' },
  { label: 'الذمم المدينة', value: '17,300', icon: ArrowDownLeft, trend: '4 مستحقات', tone: 'orange' },
  { label: 'الذمم الدائنة', value: '8,600', icon: RefreshCw, trend: '3 مستحقات', tone: 'purple' },
] as const;

export function LandingDashboardPreview() {
  return (
    <div className="landing-dashboard-preview" aria-label="معاينة لوحة تحكم ترصيد">
      <aside className="landing-dashboard-rail">
        <div className="landing-dashboard-brand">
          <span className="landing-dashboard-mark">ت</span>
          <span>
            <strong>ترصيد</strong>
            <small>نظام تشغيل منشأتك</small>
          </span>
        </div>
        <div className="landing-dashboard-workspace">
          <small>مساحة العمل الحالية</small>
          <strong><span>ن</span> متجر النخبة</strong>
          <em>أحمد العتيبي · المالك</em>
        </div>
        <nav className="landing-dashboard-nav" aria-label="أقسام لوحة التحكم">
          <small>الرئيسية</small>
          {navItems.map(([label, Icon, active]) => (
            <div key={label} className={`landing-dashboard-nav-item${active ? ' is-active' : ''}`}>
              <Icon />
              <span>{label}</span>
              {active && <ChevronLeft />}
            </div>
          ))}
        </nav>
        <div className="landing-dashboard-rail-note">بياناتك مرتبة.<br />قراراتك أوضح.</div>
      </aside>

      <main className="landing-dashboard-main">
        <header className="landing-dashboard-topbar">
          <div className="landing-dashboard-breadcrumb">الرئيسية <ChevronLeft /> <strong>لوحة التحكم</strong></div>
          <div className="landing-dashboard-top-actions">
            <span><BarChart3 /></span>
            <span className="has-dot"><Bell /></span>
            <strong>أحمد العتيبي</strong>
            <i>أ</i>
          </div>
        </header>

        <div className="landing-dashboard-content">
          <div className="landing-dashboard-intro">
            <div>
              <small>الأربعاء، 21 أغسطس 2024</small>
              <h2>صباح الخير، أحمد</h2>
              <p>هذه صورة منشأتك اليوم — كل رقم يقودك إلى خطوة أوضح.</p>
            </div>
            <button type="button">فتح نقطة البيع <Store /></button>
          </div>

          <div className="landing-dashboard-alert">
            <span><AlertTriangle /></span>
            <div><strong>تنبيه يحتاج مراجعتك</strong><small>لديك أمران للشراء بانتظار الاستلام.</small></div>
          </div>

          <div className="landing-dashboard-section-title"><strong>نظرة عامة</strong><small>مؤشرات الأداء المالي والتشغيلي خلال هذا الأسبوع</small></div>
          <div className="landing-dashboard-kpis">
            {kpis.map(({ label, value, icon: Icon, trend, tone }) => (
              <article key={label} className={`landing-dashboard-kpi is-${tone}`}>
                <div><small>{label}</small><span><Icon /></span></div>
                <strong>{value}<em>ر.س</em></strong>
                <p>{trend} <small>مقارنة بالأسبوع السابق</small></p>
              </article>
            ))}
          </div>

          <div className="landing-dashboard-panels">
            <section className="landing-dashboard-panel landing-dashboard-chart-panel">
              <div className="landing-dashboard-panel-heading"><div><strong>حركة الإيرادات والمصروفات</strong><small>الأسبوع الحالي</small></div><span><i /> الإيرادات　<b /> المصروفات</span></div>
              <div className="landing-dashboard-chart">
                {[55, 42, 68, 52, 82, 63, 90].map((height, index) => (
                  <div key={index} className="landing-dashboard-chart-column">
                    <i style={{ height: `${Math.max(22, height - 28)}%` }} />
                    <b style={{ height: `${height}%` }} />
                    <small>{['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'][index]}</small>
                  </div>
                ))}
              </div>
              <div className="landing-dashboard-chart-total"><strong>98,500 ر.س</strong><small>إجمالي الإيرادات</small><strong>+ 12.4%</strong></div>
            </section>
            <section className="landing-dashboard-panel landing-dashboard-expenses-panel">
              <div className="landing-dashboard-panel-heading"><div><strong>توزيع المصروفات</strong><small>حسب الحساب خلال هذا الشهر</small></div><BarChart3 /></div>
              <div className="landing-dashboard-donut-row">
                <div className="landing-dashboard-donut"><strong>41,340</strong><small>إجمالي المصروفات</small></div>
                <ul><li>تشغيلية <b>47%</b></li><li>رواتب ومزايا <b>28%</b></li><li>مشتريات <b>14%</b></li></ul>
              </div>
              <div className="landing-dashboard-progress"><small>نسبة التحصيل هذا الشهر</small><strong>68%</strong><span><i /></span></div>
            </section>
          </div>

          <div className="landing-dashboard-mini-panels">
            <section className="landing-dashboard-panel"><div className="landing-dashboard-panel-heading"><div><strong>آخر النشاطات</strong><small>ما حدث في منشأتك مؤخراً</small></div><ChevronLeft /></div><p>فاتورة بيع #1048 <b>+ 1,280 ر.س</b></p><p>سداد مورد · شركة المدى <b>− 2,800 ر.س</b></p></section>
            <section className="landing-dashboard-panel"><div className="landing-dashboard-panel-heading"><div><strong>المستحقات القريبة</strong><small>تحصيل ودفع خلال الأيام القادمة</small></div><ChevronLeft /></div><p>شركة روابي للتوريد <b>9,200 ر.س</b></p><p>مؤسسة النخبة <b>6,750 ر.س</b></p></section>
          </div>
        </div>
      </main>
    </div>
  );
}