import { ArrowLeft, CircleDashed, ChevronRight, Hammer } from 'lucide-react';
import { Link } from 'wouter';

export default function WorkspacePrep({ title }: { title: string }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-2xl shadow-slate-950/15" data-testid="page-workspace-prep">
      <div className="bg-gradient-to-l from-teal-500 to-[#1976F3] px-6 py-8 text-white sm:px-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-bold text-white/90 hover:text-white" data-testid="link-back-dashboard"><ChevronRight className="h-4 w-4" />لوحة التحكم</Link>
        <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 bg-white/15"><Hammer className="h-7 w-7" /></span><h1 className="mt-5 text-3xl font-black">{title}</h1><p className="mt-3 max-w-xl text-sm leading-7 text-white/90">مساحة منظمة لهذه الوحدة ضمن لوحة ترصيد الموحدة.</p></div>
          <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/25 bg-white/15 px-4 py-2 text-xs font-bold"><CircleDashed className="h-4 w-4" />يجري تجهيز مساحة العمل</span>
        </div>
      </div>
      <div className="px-6 py-8 sm:px-8"><h2 className="text-xl font-black text-slate-900">الوحدة موجودة في لوحة التحكم</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">أصبحت هذه الوحدة ظاهرة في القائمة الرئيسية ولوحة التشغيل حتى يبقى الوصول إلى كل عمليات منشأتك واضحاً. سنربط إجراءاتها وسجلاتها التشغيلية هنا دون أن تؤثر على حساباتك أو صلاحياتك الحالية.</p><Link href="/dashboard" className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-[#0D47D9] px-5 text-sm font-bold text-white transition hover:bg-[#1976F3]" data-testid="button-back-to-dashboard">العودة إلى لوحة التحكم <ArrowLeft className="h-4 w-4" /></Link></div>
    </section>
  );
}