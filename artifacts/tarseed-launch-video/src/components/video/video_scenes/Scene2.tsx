import { motion, AnimatePresence } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';
import { useEffect, useState } from 'react';
import { FeatureCaption } from './FeatureCaption';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 2600), // AI Chat
      setTimeout(() => setPhase(2), 5200), // AI Journal
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const scenes = [
    { src: 'dashboard.jpg', origin: '15% 20%', scale: 1.4 },
    { src: 'ai-chat.jpg', origin: '50% 50%', scale: 1.1 },
    { src: 'ai-journal.jpg', origin: '50% 50%', scale: 1.1 },
  ];

  return (
    <SceneLayout className="bg-brand-bg bg-mesh overflow-hidden relative items-center justify-center">
      {/* Blurred Backgrounds */}
      {scenes.map((s, i) => (
        <motion.img
          key={`bg-${i}`}
          src={`${import.meta.env.BASE_URL}images/glimpses/${s.src}`}
          className="absolute inset-0 w-full h-full object-cover blur-[40px] z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === i ? 0.3 : 0 }}
          transition={{ duration: 0.6 }}
        />
      ))}

      <motion.div
        className="absolute top-[8vh] z-40 text-center w-full px-6"
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <VideoText className="text-4xl font-extrabold text-white mb-2 tracking-tight drop-shadow-xl">
          المحاسبة أصبحت ذكية
        </VideoText>
        <VideoText className="text-xl font-medium text-brand-cyan drop-shadow-md">
          اطلب من مساعدك الذكي ما تريد
        </VideoText>
      </motion.div>

      {/* Foreground Cards */}
      {scenes.map((s, i) => {
        const isActive = phase === i;
        const isPast = phase > i;
        return (
          <motion.div
            key={`fg-${i}`}
            className="absolute z-10 w-[94vw] h-auto max-h-[65vh] mt-[10vh] overflow-hidden rounded-xl shadow-[0_20px_60px_rgba(0,102,255,0.4)] border border-brand-cyan/40 bg-zinc-900 flex justify-center items-center"
            initial={{ opacity: 0, scale: 0.9, x: i === 0 ? -30 : i === 2 ? 30 : 0, y: i === 1 ? 30 : 0 }}
            animate={
              isActive ? { opacity: 1, scale: 1, x: 0, y: 0 } :
              isPast ? { opacity: 0, scale: 1.05, y: -30 } :
              { opacity: 0, scale: 0.9, y: 30 }
            }
            transition={{ duration: 0.7, type: 'spring', bounce: 0.2 }}
          >
            <motion.img
              src={`${import.meta.env.BASE_URL}images/glimpses/${s.src}`}
              className="w-full h-auto block"
              style={{ transformOrigin: s.origin }}
              initial={{ scale: 1 }}
              animate={isActive ? { scale: s.scale } : { scale: 1 }}
              transition={{ duration: 2.6, ease: 'easeInOut' }}
            />
          </motion.div>
        );
      })}

      <AnimatePresence mode="popLayout">
        {phase === 0 && <FeatureCaption key="c1" text="كل أرقامك في نظرة واحدة" className="bottom-[15vh] right-[10vw]" />}
        {phase === 1 && <FeatureCaption key="c2" text="اسأل مساعدك المالي" className="bottom-[15vh] left-[10vw]" />}
        {phase === 2 && <FeatureCaption key="c3" text="حوّل سؤالك إلى قيد متوازن" className="bottom-[15vh] right-[10vw]" />}
      </AnimatePresence>
    </SceneLayout>
  );
}
