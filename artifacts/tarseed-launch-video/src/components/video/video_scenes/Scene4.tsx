import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),   // UI cascades in
      setTimeout(() => setPhase(2), 1500),  // UI cascades out
      setTimeout(() => setPhase(3), 1900),  // Logo reveals
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <SceneLayout className="bg-brand-bg bg-mesh overflow-hidden relative items-center justify-center">

      {/* Decorative background glows */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-[50vw] h-[50vw] bg-brand-blue/20 rounded-full blur-[80px]"
        animate={phase >= 3 ? { scale: 1.5, opacity: 0.4 } : { scale: 1, opacity: 0.2 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
        exit={{ opacity: 0, transition: { duration: 0.5 } }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-[60vw] h-[60vw] bg-brand-cyan/10 rounded-full blur-[80px]"
        animate={phase >= 3 ? { scale: 1.2, opacity: 0.3 } : { scale: 1, opacity: 0.1 }}
        transition={{ duration: 2, ease: 'easeOut' }}
        exit={{ opacity: 0, transition: { duration: 0.5 } }}
      />

      {/* Reports UI */}
      <motion.div
        className="absolute z-10 w-[75vw] right-[5vw] top-[15vh] rounded-2xl overflow-hidden shadow-2xl border border-white/10"
        initial={{ x: '50vw', y: '-10vh', opacity: 0, rotate: 10 }}
        animate={
          phase >= 2 ? { x: '50vw', y: '-10vh', opacity: 0, rotate: 15, scale: 0.8 } :
          phase >= 1 ? { x: '0vw', y: '0vh', opacity: 0.8, rotate: 5, scale: 1 } :
          { x: '50vw', y: '-10vh', opacity: 0, rotate: 10 }
        }
        transition={{ duration: 0.8, type: 'spring', bounce: 0.2 }}
        exit={{ opacity: 0 }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/glimpses/reports.jpg`}
          className="w-full h-auto"
        />
      </motion.div>

      {/* Invoice UI */}
      <motion.div
        className="absolute z-20 w-[80vw] left-[5vw] bottom-[20vh] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,102,255,0.4)] border border-brand-cyan/30"
        initial={{ x: '-50vw', y: '20vh', opacity: 0, rotate: -15 }}
        animate={
          phase >= 2 ? { x: '-50vw', y: '20vh', opacity: 0, rotate: -20, scale: 0.8 } :
          phase >= 1 ? { x: '0vw', y: '0vh', opacity: 1, rotate: -4, scale: 1 } :
          { x: '-50vw', y: '20vh', opacity: 0, rotate: -15 }
        }
        transition={{ duration: 0.9, type: 'spring', bounce: 0.25 }}
        exit={{ opacity: 0 }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/glimpses/invoice.jpg`}
          className="w-full h-auto"
        />
      </motion.div>

      {/* Final Logo Lockup */}
      <motion.div
        className="relative z-30 flex flex-col items-center justify-center w-full"
        initial={{ scale: 0.5, opacity: 0, filter: 'blur(20px)' }}
        animate={
          phase >= 3
            ? { scale: 1, opacity: 1, filter: 'blur(0px)' }
            : { scale: 0.5, opacity: 0, filter: 'blur(20px)' }
        }
        transition={{ duration: 1, type: 'spring', bounce: 0.4 }}
        exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)', transition: { duration: 0.5 } }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/tarseed-logo-transparent.png`}
          className="w-[50vw] mb-[5vh]"
          alt="Tarseed Logo"
        />

        <div className="overflow-hidden">
          <motion.div
            initial={{ y: '100%' }}
            animate={phase >= 3 ? { y: 0 } : { y: '100%' }}
            transition={{ delay: 0.3, duration: 0.8, type: 'spring', bounce: 0.3 }}
            exit={{ opacity: 0 }}
          >
            <VideoText className="text-3xl font-bold text-white tracking-wide text-gradient">
              المحاسبة بطريقة أوضح
            </VideoText>
          </motion.div>
        </div>
      </motion.div>

    </SceneLayout>
  );
}
