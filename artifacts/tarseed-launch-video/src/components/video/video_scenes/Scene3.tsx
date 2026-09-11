import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // Dashboard in
      setTimeout(() => setPhase(2), 1200),  // AI Chat in
      setTimeout(() => setPhase(3), 2800),  // AI Journal in
      setTimeout(() => setPhase(4), 4200),  // Start exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <SceneLayout className="bg-brand-bg bg-mesh overflow-hidden relative items-center justify-start pt-[15vh]">

      {/* Intro flash dissolving */}
      <motion.div
        className="absolute inset-0 z-50 bg-white pointer-events-none"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />

      <motion.div
        className="relative z-20 text-center mb-[4vh]"
        initial={{ y: '-5vh', opacity: 0 }}
        animate={phase >= 4 ? { y: '-8vh', opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.8, type: 'spring', bounce: 0.3 }}
        exit={{ y: '-8vh', opacity: 0, transition: { duration: 0.4 } }}
      >
        <VideoText className="text-5xl font-extrabold text-white mb-3 tracking-tight">
          المحاسبة أصبحت ذكية
        </VideoText>
        <VideoText className="text-2xl font-medium text-brand-cyan">
          اطلب من مساعدك الذكي ما تريد
        </VideoText>
      </motion.div>

      {/* Layer 1: Clean Dashboard */}
      <motion.div
        className="absolute bottom-0 w-[140vw] flex justify-center perspective-[1000px] z-0"
        initial={{ y: '50vh', opacity: 0, rotateX: 20 }}
        animate={
          phase >= 4 ? { y: '60vh', opacity: 0, rotateX: 25, scale: 0.9 } :
          phase >= 1 ? { y: '20vh', opacity: 0.4, rotateX: 10, scale: 1 } :
          { y: '50vh', opacity: 0, rotateX: 20 }
        }
        transition={{ duration: 1.2, type: 'spring', bounce: 0.2 }}
        exit={{ y: '60vh', opacity: 0, transition: { duration: 0.5 } }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/glimpses/dashboard.jpg`}
          className="w-full max-w-none rounded-t-3xl shadow-[0_-20px_60px_rgba(0,102,255,0.3)] border-t border-brand-blue/30"
          alt="Tarseed Dashboard"
        />
      </motion.div>

      {/* Layer 2: AI Chat */}
      <motion.div
        className="absolute z-10 w-[85vw] left-[7.5vw] shadow-2xl rounded-2xl overflow-hidden border border-brand-blue/40"
        initial={{ y: '60vh', opacity: 0, scale: 0.9 }}
        animate={
          phase >= 4 ? { y: '100vh', opacity: 0, scale: 0.8 } :
          phase >= 3 ? { y: '35vh', opacity: 0.9, scale: 0.95, x: '5vw' } :
          phase >= 2 ? { y: '30vh', opacity: 1, scale: 1, x: '0vw' } :
          { y: '60vh', opacity: 0, scale: 0.9 }
        }
        transition={{ duration: 0.8, type: 'spring', bounce: 0.25 }}
        exit={{ y: '100vh', opacity: 0, scale: 0.8, transition: { duration: 0.5 } }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/glimpses/ai-chat.jpg`}
          className="w-full h-auto"
          alt="AI Chat"
        />
        {/* Glow effect behind chat */}
        <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(0,210,255,0.2)] pointer-events-none" />
      </motion.div>

      {/* Layer 3: AI Journal (The result) */}
      <motion.div
        className="absolute z-20 w-[90vw] right-[5vw] shadow-[0_30px_80px_rgba(0,102,255,0.5)] rounded-2xl overflow-hidden border border-brand-cyan/50"
        initial={{ y: '70vh', opacity: 0, scale: 0.8, rotate: 5 }}
        animate={
          phase >= 4 ? { y: '120vh', opacity: 0, scale: 0.7, rotate: 10 } :
          phase >= 3 ? { y: '45vh', opacity: 1, scale: 1, rotate: -2 } :
          { y: '70vh', opacity: 0, scale: 0.8, rotate: 5 }
        }
        transition={{ duration: 0.9, type: 'spring', bounce: 0.3 }}
        exit={{ y: '120vh', opacity: 0, scale: 0.7, rotate: 10, transition: { duration: 0.5 } }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/glimpses/ai-journal.jpg`}
          className="w-full h-auto"
          alt="AI Journal"
        />
        {/* Magic glow */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-tr from-brand-blue/0 via-brand-cyan/20 to-transparent pointer-events-none"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.div>

    </SceneLayout>
  );
}
