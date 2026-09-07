import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 1700),
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Edge-to-edge Images in sequence */}
      <div className="absolute inset-0 z-0 bg-black">
        <motion.img
          src={imagePaths[0]}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ scale: 1.15 }}
          animate={{ scale: 1 }}
          transition={{ duration: 5, ease: 'easeOut' }}
        />
        <motion.img
          src={imagePaths[1]}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 1.15 }}
          transition={{ opacity: { duration: 0.4 }, scale: { duration: 4, ease: 'easeOut' } }}
        />
        <motion.img
          src={imagePaths[2]}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, scale: phase >= 2 ? 1 : 1.15 }}
          transition={{ opacity: { duration: 0.4 }, scale: { duration: 4, ease: 'easeOut' } }}
        />
      </div>

      {/* Dimming overlay for text clarity */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#010619] via-[#010619]/70 to-[#010619]/30 z-10" />

      {/* Cinematic flicker */}
      <motion.div
        className="absolute inset-0 bg-[#00D2FF]/10 pointer-events-none z-20 mix-blend-color-dodge"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: [0, 0.4, 0] } : { opacity: 0 }}
        transition={{ duration: 0.1, repeat: 4 }}
      />

      <div className="absolute bottom-[20vh] w-full px-8 text-center z-30">
        <motion.div
          className="inline-block"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight drop-shadow-2xl">
            ولا إحنا معقدينها؟
          </h2>
        </motion.div>
      </div>
    </motion.div>
  );
}
