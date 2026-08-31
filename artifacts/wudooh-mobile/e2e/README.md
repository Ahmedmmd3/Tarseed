# Native E2E for the stores app

هذه الاختبارات تستخدم [Maestro](https://maestro.mobile.dev/) على Android Emulator أو iOS
Simulator، وليس Playwright على الويب. وهي تختبر واجهة React Native نفسها، بما في ذلك دورة
إيقاف التطبيق وتشغيله من جديد وتخزين الجلسة في SecureStore.

## التشغيل

1. ثبّت Maestro وشغّل محاكياً مفتوحاً عليه حزمة التطبيق `com.tarseed.stores`.
2. شغّل Expo development build أو ثبّت build الاختبار، مع توجيه التطبيق إلى Fixture محلي:

   ```bash
   EXPO_PUBLIC_API_ORIGIN=http://10.0.2.2:4317
   ```

   استخدم `http://127.0.0.1:4317` مع iOS Simulator. في بيئة Replit اضبط المتغير في
   workflow الخاص بتطبيق Expo قبل تحميل الـ development build. لا تستخدم عنوان API
   الإنتاج مع هذه الاختبارات.
3. من مجلد المشروع شغّل الأمر الموحد، ومرّر العنوان نفسه كحاجز يمنع تشغيل الحزمة
   على API حقيقي:

   ```bash
   EXPO_PUBLIC_API_ORIGIN=http://10.0.2.2:4317 pnpm --filter @workspace/wudooh-mobile run test:e2e:native
   ```

   استخدم `http://127.0.0.1:4317` في الأمر عند الاختبار على iOS Simulator.

يشغّل الأمر Fixture محلياً ثم تدفقات تسجيل الدخول والتنقل واستعادة الجلسة والمزامنة دون
استدعاء Stripe أو Resend أو Twilio. ويرفض البدء إذا لم يكن عنوان API واحداً من عناوين
المحاكي المحلية. Fixture يقبل كلمة مرور اختبار ثابتة ولا يخزن أي بيانات بعد انتهاء العملية.

اختبار انقطاع الشبكة يحاكي فشل الكتابة الأولى فقط عبر Fixture محلي؛ ثم يعيد المزامنة من
زر الحالة ويتحقق من إرسال العملية نفسها مرتين (فشل أول ثم نجاح) ومن بقاء معرّف العملية
ثابتاً. هذا أكثر ثباتاً من الاعتماد على تبديل وضع الطيران في كل محاكي، مع إبقاء اختبار
دورة التطبيق والتخزين الأصلي فعلياً.

يمكن تشغيل Fixture وحده للتشخيص:

```bash
pnpm --filter @workspace/wudooh-mobile run e2e:mock
```