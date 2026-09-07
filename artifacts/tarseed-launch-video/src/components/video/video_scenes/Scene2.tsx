import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1000),
      setTimeout(() => setPhase(4), 1600),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const imagePaths = [
    `${import.meta.env.BASE_URL}images/server_tangle.jpg`,
    `${import.meta.env.BASE_URL}images/glowing_charts.jpg`,
    `${import.meta.env.BASE_URL}images/heavy_binders.jpg`,
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#010619] overflow-hidden"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 z-0 opacity-30">
        <motion.div 
          className="w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0066FF]/20 via-[#010619] to-[#010619]"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="relative w-full h-[60vh] flex items-center justify-center z-10 px-8">
        {/* Photorealistic Images in Rapid Sequence */}
        <motion.div
          className="absolute -ml-[20vw] mt-[10vh] w-[40vw] h-[40vw] rounded-2xl overflow-hidden shadow-2xl z-10 border border-white/10"
          initial={{ scale: 0, opacity: 0, x: -50, rotate: -15 }}
          animate={phase >= 1 ? { scale: 1, opacity: 1, x: 0, rotate: -10 } : { scale: 0, opacity: 0, x: -50, rotate: -15 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <img src={imagePaths[0]} alt="Server tangle" className="w-full h-full object-cover" />
        </motion.div>

        <motion.div
          className="absolute ml-[20vw] -mt-[15vh] w-[45vw] h-[45vw] rounded-2xl overflow-hidden shadow-2xl z-20 border border-white/10"
          initial={{ scale: 0, opacity: 0, x: 50, rotate: 20 }}
          animate={phase >= 2 ? { scale: 1, opacity: 1, x: 0, rotate: 15 } : { scale: 0, opacity: 0, x: 50, rotate: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <img src={imagePaths[1]} alt="Glowing charts" className="w-full h-full object-cover" />
        </motion.div>

        <motion.div
          className="absolute mt-[5vh] w-[55vw] h-[55vw] rounded-2xl overflow-hidden shadow-2xl z-30 border border-white/10"
          initial={{ scale: 0, opacity: 0, y: 50, rotate: 0 }}
          animate={phase >= 3 ? { scale: 1, opacity: 1, y: 0, rotate: -5 } : { scale: 0, opacity: 0, y: 50, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <img src={imagePaths[2]} alt="Heavy binders" className="w-full h-full object-cover" />
        </motion.div>
      </div>

      {/* Red error/complex overlays replaced by cinematic flicker */}
      <motion.div
        className="absolute inset-0 bg-[#00D2FF]/5 pointer-events-none z-20 mix-blend-color-dodge"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: [0, 0.3, 0] } : { opacity: 0 }}
        transition={{ duration: 0.1, repeat: 5 }}
      />

      <div className="absolute bottom-[20vh] w-full px-8 text-center z-30">
        <motion.div
          className="inline-block bg-[#010619]/80 backdrop-blur-xl px-8 py-4 rounded-3xl border border-[#0066FF]/30 shadow-2xl"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={phase >= 4 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            ولا إحنا معقدينها؟
          </h2>
        </motion.div>
      </div>
    </motion.div>
  );
}
