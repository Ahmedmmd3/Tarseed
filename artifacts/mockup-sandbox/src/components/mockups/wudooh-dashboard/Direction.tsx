import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  BarChart3,
  Bell,
  Book,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Copy,
  FileBadge,
  FileText,
  LayoutDashboard,
  PackageOpen,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import "./_group.css";
import "./Direction.css";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

type Module = {
  name: string;
  meta: string;
  icon: LucideIcon;
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "الرئيسية",
    items: [
      { name: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
      { name: "دليل الاستخدام", href: "/guide", icon: Book },
    ],
  },
  {
    label: "المبيعات والتشغيل",
    items: [
      { name: "نقطة البيع", href: "/pos", icon: Store },
      { name: "المبيعات والعملاء", href: "/sales", icon: ShoppingCart },
      { name: "عروض الأسعار", href: "/quotations", icon: ClipboardList },
      { name: "المخزون والمنتجات", href: "/inventory", icon: Boxes },
      { name: "أوامر الشراء", href: "/purchase-orders", icon: PackageOpen },
      { name: "المشتريات والموردون", href: "/purchases", icon: Truck },
    ],
  },
  {
    label: "المالية",
    items: [
      { name: "دليل الحسابات", href: "/accounts", icon: Book },
      { name: "القيود اليومية", href: "/journals", icon: FileText },
      { name: "الذمم والمستحقات", href: "/receivables", icon: WalletCards },
      { name: "المصاريف", href: "/expenses", icon: ReceiptText },
      { name: "التقارير المالية", href: "/reports", icon: BarChart3 },
      { name: "الفوترة الإلكترونية", href: "/e-invoicing", icon: FileBadge },
    ],
  },
  {
    label: "الإدارة",
    items: [
      { name: "الموارد البشرية", href: "/hr", icon: UsersRound },
      { name: "العمليات والمشاريع", href: "/operations", icon: BriefcaseBusiness },
      { name: "سجل العمليات", href: "/operations-log", icon: Activity },
      { name: "إدارة الفريق", href: "/team", icon: UsersRound },
    ],
  },
];

const modules: Module[] = [
  { name: "نقطة البيع", meta: "18 فاتورة اليوم", icon: Store },
  { name: "المبيعات والعملاء", meta: "42 عميل نشط", icon: ShoppingCart },
  { name: "عروض الأسعار", meta: "7 عروض معلقة", icon: ClipboardList },
  { name: "المخزون والمنتجات", meta: "3 تنبيهات مخزون", icon: Boxes },
  { name: "أوامر الشراء", meta: "3 قيد الاستلام", icon: PackageOpen },
  { name: "المشتريات والموردون", meta: "12 مورداً", icon: Truck },
  { name: "المحاسبة", meta: "186 قيداً مسجلاً", icon: ReceiptText },
  { name: "التقارير المالية", meta: "آخر تحديث اليوم", icon: BarChart3 },
  { name: "الموارد البشرية", meta: "8 أعضاء الفريق", icon: UsersRound },
  { name: "العمليات والمشاريع", meta: "4 مشاريع مفتوحة", icon: BriefcaseBusiness },
];

const chartData = [
  { day: "السبت", sales: 65, costs: 33 },
  { day: "الأحد", sales: 48, costs: 27 },
  { day: "الإثنين", sales: 73, costs: 41 },
  { day: "الثلاثاء", sales: 58, costs: 30 },
  { day: "الأربعاء", sales: 88, costs: 46 },
  { day: "الخميس", sales: 77, costs: 39 },
  { day: "الجمعة", sales: 95, costs: 51 },
];

const expenses = [
  ["إيجار الفرع الرئيسي", "5100", 18_500],
  ["رواتب ومزايا الموظفين", "5200", 12_750],
  ["مشتريات تشغيلية", "5300", 6_840],
];

const dues = [
  ["شركة روابي للتوريد", "24 أغسطس", "9,200 ر.س", "دفع", "is-due"],
  ["مؤسسة النخبة", "27 أغسطس", "6,750 ر.س", "تحصيل", "is-pending"],
  ["متجر ألوان", "01 سبتمبر", "4,320 ر.س", "تحصيل", "is-pending"],
];

const activity = [
  { title: "فاتورة بيع #1048", detail: "نقطة البيع · قبل 8 دقائق", amount: "+ 1,280 ر.س", tone: "up" },
  { title: "سداد مورد · شركة المدى", detail: "القيود اليومية · قبل 34 دقيقة", amount: "− 2,800 ر.س", tone: "down" },
  { title: "عرض سعر جديد #284", detail: "المبيعات والعملاء · قبل ساعة", amount: "6,450 ر.س", tone: "neutral" },
  { title: "استلام أمر شراء #PO-178", detail: "المخزون والمنتجات · قبل ساعتين", amount: "اكتمل", tone: "done" },
];

function money(value: number) {
  return `${new Intl.NumberFormat("ar-SA").format(value)} ر.س`;
}

export function Direction() {
  const [activeNav, setActiveNav] = useState("/dashboard");
  const [alertVisible, setAlertVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const [summaryReady, setSummaryReady] = useState(false);
  const [range, setRange] = useState("هذا الأسبوع");

  const copySummary = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="direction-shell min-h-screen">
      <div className="direction-layout">
        <aside className="direction-rail" aria-label="التنقل الرئيسي">
          <div className="direction-brand">
            <div className="direction-mark" aria-label="علامة ترصيد">ت</div>
            <div>
              <p className="direction-brand-name">ترصيد</p>
              <p className="direction-brand-caption">نظام تشغيل منشأتك</p>
            </div>
          </div>

          <div className="direction-workspace">
            <p className="direction-workspace-label">مساحة العمل الحالية</p>
            <div className="direction-workspace-row">
              <div className="direction-workspace-avatar">ن</div>
              <div>
                <p className="direction-workspace-name">متجر النخبة</p>
                <p className="direction-workspace-meta">أحمد العتيبي · المالك</p>
              </div>
              <ChevronDown size={14} color="#789ab1" style={{ marginRight: "auto" }} />
            </div>
          </div>

          <nav className="direction-nav">
            {navGroups.map((group) => (
              <div className="direction-nav-group" key={group.label}>
                <p className="direction-nav-heading">{group.label}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.href;
                  return (
                    <button
                      className={`direction-nav-item ${isActive ? "is-active" : ""}`}
                      key={item.href}
                      type="button"
                      onClick={() => setActiveNav(item.href)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon />
                      <span>{item.name}</span>
                      {isActive && <ChevronLeft className="direction-nav-chevron" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="direction-rail-footer">
            <img src="/__mockup/images/logo-mark.png" alt="علامة ترصيد" />
            <div className="direction-rail-footer-text">بياناتك مرتبة.<br />قراراتك أوضح.</div>
          </div>
        </aside>

        <main className="direction-main">
          <header className="direction-topbar">
            <p className="direction-breadcrumb">
              <span>الرئيسية</span>
              <ChevronLeft size={12} />
              <strong>{activeNav === "/dashboard" ? "لوحة التحكم" : "معاينة الوحدة"}</strong>
            </p>
            <div className="direction-top-actions">
              <button className="direction-icon-button" type="button" aria-label="البحث">
                <Search size={16} />
              </button>
              <button className="direction-icon-button" type="button" aria-label="التنبيهات">
                <Bell size={16} />
                <span className="direction-notification-dot" />
              </button>
              <div className="direction-user-chip">
                <div className="direction-avatar">أ</div>
                <div>
                  <p className="direction-user-name">أحمد العتيبي</p>
                  <p className="direction-user-role">مالك المنشأة</p>
                </div>
              </div>
            </div>
          </header>

          <div className="direction-content">
            <div className="direction-intro">
              <div>
                <p className="direction-eyebrow">الأربعاء، 21 أغسطس 2024</p>
                <h1 className="direction-title">صباح الخير، أحمد</h1>
                <p className="direction-intro-copy">هذه صورة منشأتك اليوم — كل رقم يقودك إلى خطوة أوضح.</p>
              </div>
              <div className="direction-intro-actions">
                <button className="direction-date-control" type="button" onClick={() => setRange(range === "هذا الأسبوع" ? "هذا الشهر" : "هذا الأسبوع")}>
                  <CalendarDays size={14} />
                  {range}
                  <ChevronDown size={13} />
                </button>
                <button className="direction-outline-button" type="button" onClick={() => setActiveNav("/reports")}>
                  <BarChart3 size={14} />
                  عرض التقارير
                </button>
                <button className="direction-primary-button" type="button" onClick={() => setActiveNav("/pos")}>
                  <Store size={14} />
                  فتح نقطة البيع
                </button>
              </div>
            </div>

            {alertVisible ? (
              <div className="direction-alert" role="alert">
                <div className="direction-alert-copy">
                  <span className="direction-alert-icon"><AlertTriangle size={15} /></span>
                  <div>
                    <h2>تنبيه يحتاج مراجعتك</h2>
                    <p>لديك أمران للشراء تجاوزا تاريخ التسليم المتوقع وما زالا بانتظار الاستلام.</p>
                  </div>
                </div>
                <button className="direction-alert-close" type="button" aria-label="إخفاء التنبيه" onClick={() => setAlertVisible(false)}>
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="direction-empty-alert">
                <button type="button" onClick={() => setAlertVisible(true)}>إظهار تنبيه أوامر الشراء</button>
              </div>
            )}

            <section aria-labelledby="overview-heading">
              <div className="direction-section-heading">
                <div>
                  <h2 id="overview-heading">نظرة عامة</h2>
                  <p>مؤشرات الأداء المالي والتشغيلي خلال {range}</p>
                </div>
                <button className="direction-section-link" type="button" onClick={() => setActiveNav("/reports")}>تفاصيل المؤشرات <ArrowLeft size={12} style={{ verticalAlign: "-2px" }} /></button>
              </div>
              <div className="direction-kpi-grid">
                <Kpi icon={WalletCards} label="صافي الربح" value="67,250" suffix="ر.س" trend="+ 12.4%" note="مقارنة بالأسبوع السابق" />
                <Kpi icon={ArrowUpLeft} label="إجمالي الإيرادات" value="98,500" suffix="ر.س" trend="+ 8.2%" note="من 186 معاملة مسجلة" />
                <Kpi icon={ArrowDownLeft} label="الذمم المدينة" value="17,300" suffix="ر.س" trend="4 مستحقات" note="مبالغ مستحقة من العملاء" trendTone="down" />
                <Kpi icon={RefreshCw} label="الذمم الدائنة" value="8,600" suffix="ر.س" trend="3 مستحقات" note="مبالغ مستحقة للموردين" trendTone="down" />
              </div>
            </section>

            <div className="direction-analytics-grid">
              <section className="direction-panel" aria-labelledby="sales-chart-heading">
                <PanelHeading title="حركة الإيرادات والمصروفات" subtitle={`الأسبوع الحالي · ${range}`} trailing={<div className="direction-chart-legend"><span><i className="direction-legend-dot is-sales" />الإيرادات</span><span><i className="direction-legend-dot is-cost" />المصروفات</span></div>} />
                <div className="direction-chart">
                  <div className="direction-chart-axis"><span>100k</span><span>75k</span><span>50k</span><span>25k</span><span>0</span></div>
                  <div className="direction-chart-plot">
                    {chartData.map((item, index) => (
                      <div className="direction-bar-group" key={item.day}>
                        <div className="direction-bar" style={{ height: `${item.costs}%`, animationDelay: `${index * 45}ms` }} />
                        <div className="direction-bar is-sales" style={{ height: `${item.sales}%`, animationDelay: `${index * 45 + 30}ms` }}>
                          <span className="direction-bar-label">{item.day}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="direction-chart-summary">
                  <div><strong className="direction-chart-summary-value">98,500 ر.س</strong><span className="direction-chart-summary-label">إجمالي الإيرادات</span></div>
                  <div><strong className="direction-chart-summary-value">31,250 ر.س</strong><span className="direction-chart-summary-label">إجمالي المصروفات</span></div>
                  <div><strong className="direction-chart-summary-value direction-trend-up">+ 12.4%</strong><span className="direction-chart-summary-label">نمو صافٍ</span></div>
                </div>
              </section>

              <section className="direction-panel" aria-labelledby="expense-chart-heading">
                <PanelHeading title="توزيع المصروفات" subtitle="حسب الحساب خلال هذا الشهر" trailing={<button className="direction-section-link" type="button" onClick={() => setActiveNav("/expenses")}>عرض الكل</button>} />
                <div className="direction-donut-row">
                  <div className="direction-donut">
                    <div className="direction-donut-center"><strong>41,340</strong><span>إجمالي المصروفات</span></div>
                  </div>
                  <div className="direction-donut-list">
                    <div className="direction-donut-item"><span>تشغيلية</span><strong>47%</strong></div>
                    <div className="direction-donut-item"><span>رواتب ومزايا</span><strong>28%</strong></div>
                    <div className="direction-donut-item"><span>مشتريات</span><strong>14%</strong></div>
                    <div className="direction-donut-item"><span>أخرى</span><strong>11%</strong></div>
                  </div>
                </div>
                <div className="direction-receivable">
                  <div><div className="direction-receivable-label">نسبة التحصيل هذا الشهر</div><div className="direction-receivable-value">68% <small>من الذمم</small></div></div>
                  <div className="direction-progress" aria-label="نسبة التحصيل 68%"><span /></div>
                </div>
              </section>
            </div>

            <div className="direction-lower-grid">
              <section className="direction-panel" aria-labelledby="activity-heading">
                <PanelHeading title="آخر النشاطات" subtitle="ما حدث في منشأتك مؤخراً" trailing={<button className="direction-section-link" type="button" onClick={() => setActiveNav("/operations-log")}>سجل العمليات</button>} />
                <table className="direction-table">
                  <thead><tr><th>النشاط</th><th>القسم</th><th>القيمة</th></tr></thead>
                  <tbody>
                    {activity.map((item) => (
                      <tr key={item.title}>
                        <td><strong>{item.title}</strong><br /><span>{item.detail}</span></td>
                        <td><span className={`direction-status ${item.tone === "down" ? "is-due" : item.tone === "neutral" ? "is-pending" : ""}`}>{item.tone === "done" ? "مكتمل" : item.tone === "down" ? "مصروف" : item.tone === "neutral" ? "جديد" : "مبيعات"}</span></td>
                        <td className="direction-amount">{item.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="direction-panel" aria-labelledby="dues-heading">
                <PanelHeading title="المستحقات القريبة" subtitle="تحصيل ودفع خلال الأيام القادمة" trailing={<button className="direction-section-link" type="button" onClick={() => setActiveNav("/receivables")}>إدارة الذمم</button>} />
                <table className="direction-table">
                  <thead><tr><th>الطرف</th><th>الاستحقاق</th><th>المبلغ</th></tr></thead>
                  <tbody>
                    {dues.map(([party, date, amount, type, tone]) => (
                      <tr key={party}>
                        <td><strong>{party}</strong><br /><span>{type}</span></td>
                        <td><span className={`direction-status ${tone}`}>{date}</span></td>
                        <td className="direction-amount">{amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <section aria-labelledby="modules-heading">
              <div className="direction-section-heading">
                <div><h2 id="modules-heading">الوحدات الرئيسية</h2><p>كل ما تحتاجه لإدارة المبيعات والمخزون والمالية والفريق.</p></div>
                <button className="direction-section-link" type="button" onClick={() => setActiveNav("/guide")}>دليل الاستخدام <ArrowLeft size={12} style={{ verticalAlign: "-2px" }} /></button>
              </div>
              <div className="direction-module-grid">
                {modules.map((module) => <ModuleCard key={module.name} module={module} onOpen={() => setActiveNav(module.name)} />)}
              </div>
            </section>

            <section className="direction-ai" aria-labelledby="ai-heading">
              <div className="direction-ai-copy">
                <span className="direction-ai-icon"><Sparkles size={17} /></span>
                <div>
                  <h2 id="ai-heading">ملخصك الأسبوعي</h2>
                  <p>{summaryReady ? "تم تحديث الملخص: ارتفعت المبيعات هذا الأسبوع بنسبة 12٪، وتحسن تحصيل الذمم. راجع أوامر الشراء المتأخرة وتابع العملاء المستحقين قبل نهاية الأسبوع." : "ارتفعت المبيعات هذا الأسبوع بنسبة 12٪، مع تحسن ملحوظ في تحصيل الذمم. ننصح بمراجعة أوامر الشراء المتأخرة ومتابعة العملاء المستحقين."}</p>
                </div>
              </div>
              <div className="direction-ai-action">
                <button className={`direction-primary-button ${summaryReady ? "is-done" : ""}`} type="button" onClick={() => setSummaryReady(true)}>
                  {summaryReady ? <Check size={14} /> : <Sparkles size={14} />}
                  {summaryReady ? "تم تحديث الملخص" : "توليد الملخص الآن"}
                </button>
                <button className="direction-section-link" type="button" onClick={copySummary} style={{ display: "block", margin: "7px auto 0" }}>
                  {copied ? <><Check size={12} style={{ verticalAlign: "-2px" }} /> تم النسخ</> : <><Copy size={12} style={{ verticalAlign: "-2px" }} /> نسخ الملخص</>}
                </button>
              </div>
            </section>

            <section aria-labelledby="expense-list-heading">
              <div className="direction-section-heading">
                <div><h2 id="expense-list-heading">المصاريف والحسابات</h2><p>الحسابات الأعلى قيمة في سجلك الحالي.</p></div>
                <button className="direction-section-link" type="button" onClick={() => setActiveNav("/expenses")}>فتح المصاريف <ArrowLeft size={12} style={{ verticalAlign: "-2px" }} /></button>
              </div>
              <div className="direction-panel">
                <table className="direction-table">
                  <thead><tr><th>الحساب</th><th>رقم الحساب</th><th>القيمة</th></tr></thead>
                  <tbody>
                    {expenses.map(([name, code, amount]) => (
                      <tr key={code}><td><strong>{name}</strong></td><td>{code}</td><td className="direction-amount">{money(Number(amount))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, suffix, trend, note, trendTone = "up" }: { icon: LucideIcon; label: string; value: string; suffix: string; trend: string; note: string; trendTone?: "up" | "down" }) {
  return (
    <article className="direction-kpi">
      <div className="direction-kpi-top"><span className="direction-kpi-label">{label}</span><span className="direction-kpi-icon"><Icon size={15} /></span></div>
      <p className="direction-kpi-value">{value}<small>{suffix}</small></p>
      <div className="direction-kpi-bottom"><span className={trendTone === "up" ? "direction-trend-up" : "direction-trend-down"}>{trend}</span><span>{note}</span></div>
    </article>
  );
}

function PanelHeading({ title, subtitle, trailing }: { title: string; subtitle: string; trailing?: ReactNode }) {
  return (
    <div className="direction-panel-heading">
      <div><h3>{title}</h3><p>{subtitle}</p></div>
      {trailing}
    </div>
  );
}

function ModuleCard({ module, onOpen }: { module: Module; onOpen: () => void }) {
  const Icon = module.icon;
  return (
    <button className="direction-module" type="button" onClick={onOpen} aria-label={`فتح ${module.name}`}>
      <span className="direction-module-icon"><Icon size={16} /></span>
      <span><span className="direction-module-title">{module.name}</span><span className="direction-module-meta">{module.meta}</span></span>
    </button>
  );
}