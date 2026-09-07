import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#010619] overflow-hidden"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background elegant gradient */}
      <motion.div
        className="absolute inset-0 opacity-50"
        style={{
          background: 'radial-gradient(circle at center, rgba(0, 102, 255, 0.15) 0%, rgba(1, 6, 25, 1) 100%)'
        }}
        initial={{ scale: 1.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.5 }}
        transition={{ duration: 3, ease: 'easeOut' }}
      />
      
      {/* Highlight behind logo */}
      <motion.div
        className="absolute w-[80vw] h-[80vw] bg-[#00D2FF]/10 blur-[80px] rounded-full top-[20%]"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
        transition={{ duration: 2, ease: 'easeOut' }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center w-full px-8">
        {/* Logo */}
        <motion.div
          className="w-[60vw] h-[40vw] relative flex items-center justify-center mb-4"
          initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
          animate={phase >= 1 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 30, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Logo asset (transparent background) */}
          <img
            src={`${import.meta.env.BASE_URL}images/tarseed-logo-transparent.png`}
            alt="Tarseed Logo"
            className="w-full h-full object-contain drop-shadow-2xl"
          />
        </motion.div>

        {/* Text */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        >
          <h2 className="text-[12vw] font-black text-white text-center tracking-tight leading-none">
            قريباً<span className="text-[#00D2FF]">...</span>
          </h2>
        </motion.div>
      </div>
    </motion.div>
  );
}
