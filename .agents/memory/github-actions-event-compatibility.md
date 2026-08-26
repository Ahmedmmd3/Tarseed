---
name: GitHub Actions event compatibility
description: GitHub Actions may reject webhook-like event names that are not supported as workflow triggers.
---

تحقق من أن اسم كل حدث مدعوم فعلياً في صيغة GitHub Actions قبل إضافته إلى `on`. لا تفترض أن اسم Webhook مثل `repository_ruleset` يمكن استخدامه تلقائياً كمشغّل Workflow؛ إذا رفض GitHub الملف عند بدء التشغيل، أزل الحدث غير المدعوم واستخدم الأحداث المعتمدة أو `workflow_dispatch`.

**Why:** فشل GitHub في مرحلة تحليل الملف يمنع بدء أي Job، وبالتالي لا يمكن اختبار المنطق أو ظهور annotations.

**How to apply:** عند إضافة أحداث جديدة إلى Workflow، اختبر قبول GitHub للملف أولاً، واحتفظ بمسار تشغيل يدوي للتحقق المستقل.