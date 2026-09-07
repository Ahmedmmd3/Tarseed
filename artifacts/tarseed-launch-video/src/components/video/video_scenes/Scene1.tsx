import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1200),
      setTimeout(() => setPhase(4), 1800),
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
      exit={{ scale: 1.1, opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background drifting elements */}
      <motion.div
        className="absolute w-[100vw] h-[100vw] rounded-full bg-[#0066FF]/20 blur-[100px]"
        animate={{ 
          x: ['-20%', '20%', '-10%'],
          y: ['-20%', '10%', '20%']
        }}
        transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
      />

      <div className="relative w-full h-[50vh] flex items-center justify-center">
        {/* Photorealistic Images in Sequence */}
        <motion.div
          className="absolute -ml-[25vw] -mt-[15vh] w-[45vw] h-[45vw] rounded-2xl overflow-hidden shadow-2xl z-10 border border-white/10"
          initial={{ scale: 0, y: 50, rotate: -15 }}
          animate={phase >= 1 ? { scale: 1, y: 0, rotate: -8 } : { scale: 0, y: 50, rotate: -15 }}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        >
          <img src={imagePaths[0]} alt="Messy receipts" className="w-full h-full object-cover" />
        </motion.div>

        <motion.div
          className="absolute ml-[25vw] -mt-[5vh] w-[45vw] h-[45vw] rounded-2xl overflow-hidden shadow-2xl z-20 border border-white/10"
          initial={{ scale: 0, y: 50, rotate: 20 }}
          animate={phase >= 2 ? { scale: 1, y: 0, rotate: 12 } : { scale: 0, y: 50, rotate: 20 }}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        >
          <img src={imagePaths[1]} alt="Calculator stress" className="w-full h-full object-cover" />
        </motion.div>

        <motion.div
          className="absolute -ml-[5vw] mt-[20vh] w-[50vw] h-[50vw] rounded-2xl overflow-hidden shadow-2xl z-30 border border-white/10"
          initial={{ scale: 0, y: 50, rotate: -10 }}
          animate={phase >= 3 ? { scale: 1, y: 0, rotate: 5 } : { scale: 0, y: 50, rotate: -10 }}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        >
          <img src={imagePaths[2]} alt="Spreadsheet maze" className="w-full h-full object-cover" />
        </motion.div>
        
        {/* Cinematic Glitch/Tension */}
        <motion.div 
          className="absolute inset-0 pointer-events-none z-40 bg-[#00D2FF]/5 mix-blend-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? [0, 0.2, 0] : 0 }}
          transition={{ duration: 0.2, repeat: 3, repeatType: "reverse" }}
        />
      </div>

      <div className="absolute bottom-[20vh] w-full px-8 text-center z-50">
        <motion.h1
          className="text-5xl md:text-6xl font-black text-white leading-tight tracking-tight drop-shadow-2xl"
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={phase >= 4 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          المحاسبة صعبة؟
        </motion.h1>
      </div>
    </motion.div>
  );
}
