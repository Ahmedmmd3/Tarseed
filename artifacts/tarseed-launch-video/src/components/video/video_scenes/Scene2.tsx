import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 1700),
      setTimeout(() => setPhase(4), 2700), // The flash/zoom at the end
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <SceneLayout className="bg-zinc-950 overflow-hidden relative items-center justify-center">

      {/* Glitchy red background persists but faster */}
      <motion.div
        className="absolute inset-0 bg-red-950/30 mix-blend-color-burn"
        animate={{ opacity: [0.3, 0.8, 0.2, 0.9, 0.4] }}
        transition={{ duration: 0.15, repeat: Infinity, repeatType: 'mirror' }}
      />

      {/* Layer 1: Report Overload */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/clutter/report-overload.jpg`}
        className="absolute w-[150vw] max-w-none shadow-2xl opacity-60 grayscale sepia-[0.2]"
        initial={{ opacity: 0, scale: 1.2, rotate: -5, y: '-20vh' }}
        animate={{ opacity: 0.7, scale: 1, rotate: -2, y: '-10vh' }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        exit={{ opacity: 0 }}
      />

      {/* Layer 2: Complex POS */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/clutter/complex-pos.jpg`}
        className="absolute w-[130vw] max-w-none shadow-2xl border border-white/10"
        initial={{ opacity: 0, scale: 1.3, rotate: 15, y: '30vh', x: '15vw' }}
        animate={
          phase >= 1
            ? { opacity: 0.8, scale: 1.05, rotate: 4, y: '10vh', x: '5vw' }
            : { opacity: 0, scale: 1.3, rotate: 15, y: '30vh', x: '15vw' }
        }
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        exit={{ opacity: 0 }}
      />

      {/* Layer 3: Mobile Ledger - the final straw */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/clutter/mobile-ledger.jpg`}
        className="absolute w-[90vw] max-w-none shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/20 rounded-xl"
        initial={{ opacity: 0, scale: 1.5, rotate: -15, y: '-10vh', x: '-20vw' }}
        animate={
          phase >= 2
            ? { opacity: 0.95, scale: 1.1, rotate: -6, y: '5vh', x: '-5vw' }
            : { opacity: 0, scale: 1.5, rotate: -15, y: '-10vh', x: '-20vw' }
        }
        transition={{ type: 'spring', stiffness: 350, damping: 20 }}
        exit={{ opacity: 0 }}
      />

      {/* Noise Texture */}
      <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

      {/* Camera Shake Container for Text */}
      <motion.div
        className="relative z-10 w-full flex justify-center mt-[25vh]"
        animate={phase >= 3 ? { x: [-5, 5, -5, 5, 0], y: [-2, 2, -2, 2, 0] } : {}}
        transition={{ duration: 0.3, repeat: phase >= 3 ? Infinity : 0 }}
      >
        <motion.div
          className="bg-red-600/90 backdrop-blur-md px-[5vw] py-[3vh] rounded-xl text-center shadow-[0_0_50px_rgba(220,38,38,0.6)] border-2 border-red-400"
          initial={{ scale: 0, opacity: 0 }}
          animate={
            phase >= 3
              ? { scale: 1.1, opacity: 1 }
              : { scale: 0, opacity: 0 }
          }
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
          exit={{ opacity: 0 }}
        >
          <VideoText className="text-5xl font-black text-white leading-tight">
            توقف عن المعاناة
          </VideoText>
        </motion.div>
      </motion.div>

      {/* The Flash / Snap Transition to clean UI */}
      <motion.div
        className="absolute inset-0 z-50 bg-white"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.2 }}
        exit={{ opacity: 1 }}
      />
    </SceneLayout>
  );
}
