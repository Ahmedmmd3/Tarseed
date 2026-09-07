import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // Start glowing effect
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center bg-[#010619] overflow-hidden z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(20px)', scale: 1.2 }}
      transition={{ duration: 1, ease: 'easeInOut' }}
    >
      {/* Subtle blue ambient light from below */}
      <motion.div
        className="absolute -bottom-[30vh] w-[150vw] h-[50vh] bg-[#0066FF]/30 blur-[100px] rounded-[100%]"
        initial={{ opacity: 0, y: 50 }}
        animate={phase >= 2 ? { opacity: 0.6, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 2, ease: 'easeOut' }}
      />

      <div className="relative z-10 w-full px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10, filter: 'blur(10px)' }}
          animate={phase >= 1 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 10, filter: 'blur(10px)' }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-4xl md:text-6xl font-black text-white leading-relaxed tracking-tight drop-shadow-lg">
            قررنا نغيّر الطريقة.
          </h2>
        </motion.div>
        
        {/* Animated underline / progress line */}
        <motion.div
          className="h-1 bg-gradient-to-r from-transparent via-[#00D2FF] to-transparent mx-auto mt-6"
          initial={{ width: 0, opacity: 0 }}
          animate={phase >= 1 ? { width: '60%', opacity: 1 } : { width: 0, opacity: 0 }}
          transition={{ duration: 2, ease: 'easeInOut', delay: 0.5 }}
        />
      </div>
    </motion.div>
  );
}
