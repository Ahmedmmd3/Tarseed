import { motion, AnimatePresence } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';
import { useEffect, useState } from 'react';
import { FeatureCaption } from './FeatureCaption';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let rafId: number;
    const updatePhase = () => {
      const audio = document.querySelector('audio');
      if (audio) {
        const t = audio.currentTime;
        const localTime = t - 20.0; // Scene3 starts at 20.0s
        let nextPhase = 0;
        if (localTime >= 2.25) nextPhase = 1;

        setPhase(prev => prev !== nextPhase ? nextPhase : prev);
      }
      rafId = requestAnimationFrame(updatePhase);
    };
    rafId = requestAnimationFrame(updatePhase);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const scenes = [
    { src: 'invoice.jpg', origin: '10% 90%', scale: 1.3 },
    { src: 'reports.jpg', origin: '50% 10%', scale: 1.3 },
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
          كل شيء مترابط
        </VideoText>
      </motion.div>

      {/* Foreground Cards */}
      {scenes.map((s, i) => {
        const isActive = phase === i;
        const isPast = phase > i;
        return (
          <motion.div
            key={`fg-${i}`}
            className="absolute z-10 w-[94vw] h-auto max-h-[65vh] mt-[10vh] overflow-hidden rounded-xl shadow-[0_20px_60px_rgba(0,102,255,0.4)] border border-brand-cyan/40 bg-black/80 flex justify-center items-center"
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={
              isActive ? { opacity: 1, scale: 1, y: 0 } :
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
              transition={{ duration: 2.25, ease: 'easeInOut' }}
            />
          </motion.div>
        );
      })}

      <AnimatePresence mode="popLayout">
        {phase === 0 && <FeatureCaption key="c1" text="بع أسرع واحسب الضريبة تلقائياً" className="bottom-[15vh] right-[10vw]" />}
        {phase === 1 && <FeatureCaption key="c2" text="تقارير مالية واضحة لحظياً" className="bottom-[15vh] left-[10vw]" />}
      </AnimatePresence>
    </SceneLayout>
  );
}
