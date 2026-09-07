import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 1800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const imagePaths = [
    `${import.meta.env.BASE_URL}images/messy_receipts.jpg`,
    `${import.meta.env.BASE_URL}images/calculator_stress.jpg`,
    `${import.meta.env.BASE_URL}images/spreadsheet_maze.jpg`,
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#010619] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Edge-to-edge Images in sequence */}
      <div className="absolute inset-0 z-0 bg-black">
        {/* Base image */}
        <motion.img
          src={imagePaths[0]}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ scale: 1.15 }}
          animate={{ scale: 1 }}
          transition={{ duration: 5, ease: 'easeOut' }}
        />
        {/* Second image */}
        <motion.img
          src={imagePaths[1]}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 1.15 }}
          transition={{ opacity: { duration: 0.4 }, scale: { duration: 4, ease: 'easeOut' } }}
        />
        {/* Third image */}
        <motion.img
          src={imagePaths[2]}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, scale: phase >= 2 ? 1 : 1.15 }}
          transition={{ opacity: { duration: 0.4 }, scale: { duration: 4, ease: 'easeOut' } }}
        />
      </div>

      {/* Dimming overlay for text clarity */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#010619] via-[#010619]/60 to-[#010619]/20 z-10" />

      {/* Cinematic Glitch/Tension */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-20 bg-[#00D2FF]/10 mix-blend-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 2 ? [0, 0.3, 0] : 0 }}
        transition={{ duration: 0.15, repeat: 3, repeatType: "reverse" }}
      />

      <div className="absolute bottom-[20vh] w-full px-8 text-center z-30">
        <motion.h1
          className="text-5xl md:text-6xl font-black text-white leading-tight tracking-tight drop-shadow-2xl"
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={phase >= 3 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        >
          المحاسبة صعبة؟
        </motion.h1>
      </div>
    </motion.div>
  );
}
