import { motion } from 'framer-motion';
import { Calculator, FileSpreadsheet, Receipt } from 'lucide-react';
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

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-mesh overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ scale: 1.1, opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background drifting elements */}
      <motion.div
        className="absolute w-[80vw] h-[80vw] rounded-full bg-primary/10 blur-3xl"
        animate={{ 
          x: ['-20%', '20%', '-10%'],
          y: ['-20%', '10%', '20%']
        }}
        transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
      />

      <div className="relative w-full h-[50vh] flex items-center justify-center">
        {/* Floating Icons */}
        <motion.div
          className="absolute -ml-[30vw] -mt-[20vh] bg-card p-6 rounded-2xl border border-border shadow-2xl z-10"
          initial={{ scale: 0, y: 50, rotate: -20 }}
          animate={phase >= 1 ? { scale: 1, y: 0, rotate: -10 } : { scale: 0, y: 50, rotate: -20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <Receipt className="w-16 h-16 text-primary" />
        </motion.div>

        <motion.div
          className="absolute ml-[30vw] -mt-[10vh] bg-card p-6 rounded-2xl border border-border shadow-2xl z-20"
          initial={{ scale: 0, y: 50, rotate: 20 }}
          animate={phase >= 2 ? { scale: 1, y: 0, rotate: 15 } : { scale: 0, y: 50, rotate: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <Calculator className="w-16 h-16 text-secondary" />
        </motion.div>

        <motion.div
          className="absolute -ml-[10vw] mt-[20vh] bg-card p-6 rounded-2xl border border-border shadow-2xl z-30"
          initial={{ scale: 0, y: 50, rotate: -15 }}
          animate={phase >= 3 ? { scale: 1, y: 0, rotate: 5 } : { scale: 0, y: 50, rotate: -15 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <FileSpreadsheet className="w-16 h-16 text-emerald-500" />
        </motion.div>
        
        {/* Connecting lines / mess */}
        <motion.div 
          className="absolute inset-0 pointer-events-none z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? 0.3 : 0 }}
        >
           <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
             <motion.path 
                d="M 20 20 Q 50 80 80 40 T 40 80" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="0.5"
                strokeDasharray="5,5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: phase >= 3 ? 1 : 0 }}
                transition={{ duration: 1 }}
             />
           </svg>
        </motion.div>
      </div>

      <div className="absolute bottom-[20vh] w-full px-8 text-center z-40">
        <motion.h1
          className="text-5xl md:text-6xl font-black text-white leading-tight tracking-tight drop-shadow-lg"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          المحاسبة صعبة؟
        </motion.h1>
      </div>
    </motion.div>
  );
}