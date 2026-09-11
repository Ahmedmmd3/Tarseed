import { motion, AnimatePresence } from 'framer-motion';
import { SceneLayout } from '@/lib/video/layout';
import { useEffect, useState } from 'react';
import { ProblemCaption } from './ProblemCaption';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let rafId: number;
    const updatePhase = () => {
      const audio = document.querySelector('audio');
      if (audio) {
        const t = audio.currentTime;
        const localTime = t - 2.5; // Scene1 starts at 2.5s
        let nextPhase = 0;
        if (localTime >= 6.0) nextPhase = 4;
        else if (localTime >= 4.5) nextPhase = 3;
        else if (localTime >= 3.0) nextPhase = 2;
        else if (localTime >= 1.5) nextPhase = 1;

        setPhase(prev => prev !== nextPhase ? nextPhase : prev);
      }
      rafId = requestAnimationFrame(updatePhase);
    };
    rafId = requestAnimationFrame(updatePhase);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const scenes = [
    {
      src: 'legacy-erp.jpg', origin: '20% 10%', scale: 1.6, portrait: false,
      caption: 'قوائم كثيرة… وخطوات أكثر',
      blurStyle: { top: '0%', right: '0%', width: '30%', height: '5%' }
    },
    {
      src: 'dashboard-chaos.jpg', origin: '50% 15%', scale: 1.5, portrait: false,
      caption: 'أرقام كثيرة بدون وضوح',
      blurStyle: { top: '0%', right: '0%', width: '15%', height: '7%' }
    },
    {
      src: 'report-overload.jpg', origin: '50% 50%', scale: 1.5, portrait: false,
      caption: 'تقارير معقدة يصعب فهمها',
      blurStyle: { top: '0%', right: '0%', width: '15%', height: '7%' }
    },
    {
      src: 'complex-pos.jpg', origin: '10% 80%', scale: 1.4, portrait: false,
      caption: 'عملية البيع تأخذ وقتاً',
      blurStyle: { top: '0%', right: '0%', width: '10%', height: '7%' }
    },
    {
      src: 'mobile-ledger.jpg', origin: '50% 50%', scale: 1, portrait: true,
      caption: 'الازدحام مستمر حتى على الجوال',
      blurStyle: { top: '0%', left: '0%', width: '100%', height: '10%' }
    },
  ];

  return (
    <SceneLayout className="bg-zinc-950 overflow-hidden relative items-center justify-center">
      {/* Glitchy red background */}
      <motion.div
        className="absolute inset-0 bg-red-950/20 z-0"
        animate={{ opacity: [0.2, 0.6, 0.3, 0.8, 0.4] }}
        transition={{ duration: 0.3, repeat: Infinity, repeatType: 'mirror' }}
      />

      {/* Blurred Backgrounds */}
      {scenes.map((s, i) => (
        <motion.img
          key={`bg-${i}`}
          src={`${import.meta.env.BASE_URL}images/clutter/${s.src}`}
          className="absolute inset-0 w-full h-full object-cover blur-[30px] z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === i ? 0.3 : 0 }}
          transition={{ duration: 0.4 }}
        />
      ))}

      {/* Noise Texture */}
      <div className="absolute inset-0 pointer-events-none opacity-20 z-0" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

      {/* Foreground Cards */}
      {scenes.map((s, i) => {
        const isActive = phase === i;
        const isPast = phase > i;
        return (
          <motion.div
            key={`fg-${i}`}
            className={`absolute z-10 flex justify-center items-center overflow-hidden rounded-xl shadow-[0_10px_40px_rgba(255,0,0,0.3)] border border-red-500/30 bg-zinc-900 ${s.portrait ? 'h-[75vh] w-auto max-w-[90vw]' : 'w-[94vw] h-auto max-h-[70vh]'}`}
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={
              isActive ? { opacity: 1, scale: 1, y: 0 } :
              isPast ? { opacity: 0, scale: 1.05, y: -30 } :
              { opacity: 0, scale: 0.9, y: 30 }
            }
            transition={{ duration: 0.6, type: 'spring', bounce: 0.2 }}
          >
            <motion.div
              className="relative w-full h-full"
              style={{ transformOrigin: s.origin }}
              initial={{ scale: 1 }}
              animate={isActive ? { scale: s.scale } : { scale: 1 }}
              transition={{ duration: 1.5, ease: 'easeInOut' }}
            >
              <img
                src={`${import.meta.env.BASE_URL}images/clutter/${s.src}`}
                className={`${s.portrait ? 'h-full w-auto' : 'w-full h-auto'} block`}
              />
              {/* Blur mask over fictional app name/logo */}
              <div
                className="absolute backdrop-blur-xl bg-black/20"
                style={s.blurStyle}
              />
            </motion.div>
          </motion.div>
        );
      })}

      {/* Captions */}
      <AnimatePresence mode="popLayout">
        {phase < 5 && (
          <ProblemCaption
            key={`caption-${phase}`}
            text={scenes[phase].caption}
            className="top-[10vh]"
          />
        )}
      </AnimatePresence>
    </SceneLayout>
  );
}
