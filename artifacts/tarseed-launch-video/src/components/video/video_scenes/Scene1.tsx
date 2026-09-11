import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <SceneLayout className="bg-zinc-950 overflow-hidden relative items-center justify-center">
      {/* Glitchy red background */}
      <motion.div
        className="absolute inset-0 bg-red-950/20 mix-blend-color-burn"
        animate={{ opacity: [0.2, 0.6, 0.3, 0.8, 0.4] }}
        transition={{ duration: 0.3, repeat: Infinity, repeatType: 'mirror' }}
      />

      {/* Legacy ERP - Base layer */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/clutter/legacy-erp.jpg`}
        className="absolute w-[160vw] max-w-none opacity-50 grayscale sepia-[0.3]"
        initial={{ scale: 1, rotate: -2, x: '-5vw', y: '0vh' }}
        animate={{ scale: 1.15, rotate: 1, x: '0vw', y: '-5vh' }}
        transition={{ duration: 3, ease: 'linear' }}
        exit={{ scale: 1.2, opacity: 0, transition: { duration: 0.3 } }}
      />

      {/* Dashboard Chaos - Pops in */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/clutter/dashboard-chaos.jpg`}
        className="absolute w-[120vw] max-w-none shadow-2xl border border-white/10 rounded-lg origin-bottom-right"
        initial={{ opacity: 0, scale: 0.8, rotate: 10, y: '30vh', x: '10vw' }}
        animate={
          phase >= 1
            ? { opacity: 0.85, scale: 1, rotate: -4, y: '10vh', x: '-5vw' }
            : { opacity: 0, scale: 0.8, rotate: 10, y: '30vh', x: '10vw' }
        }
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        exit={{ scale: 0.9, y: '20vh', opacity: 0, transition: { duration: 0.3 } }}
      />

      {/* Noise Texture */}
      <div className="absolute inset-0 pointer-events-none opacity-20" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

      <motion.div
        className="relative z-10 bg-black/70 backdrop-blur-md p-[4vmin] rounded-2xl border border-red-500/30 text-center mx-[4vw] mb-[15vh] shadow-[0_0_40px_rgba(255,0,0,0.2)]"
        initial={{ scale: 0.8, opacity: 0, y: '5vh' }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ delay: 0.5, type: 'spring', bounce: 0.4 }}
        exit={{ scale: 1.1, opacity: 0, filter: 'blur(10px)', transition: { duration: 0.3 } }}
      >
        <VideoText className="text-5xl font-bold text-white leading-tight mb-2">
          تعقيد وفوضى؟
        </VideoText>
        <VideoText className="text-3xl font-medium text-red-300">
          في أنظمتك المحاسبية
        </VideoText>
      </motion.div>
    </SceneLayout>
  );
}
