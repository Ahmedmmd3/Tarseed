import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { FileText, Database, BarChart3, PieChart, LineChart } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1200),
      setTimeout(() => setPhase(4), 1800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const items = [
    { Icon: FileText, color: 'text-blue-500' },
    { Icon: Database, color: 'text-purple-500' },
    { Icon: BarChart3, color: 'text-emerald-500' },
    { Icon: PieChart, color: 'text-amber-500' },
    { Icon: LineChart, color: 'text-rose-500' },
    { Icon: FileText, color: 'text-cyan-500' },
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#050B20] overflow-hidden"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 z-0 opacity-20">
        {/* Rapidly flashing numbers and grid */}
        <motion.div 
          className="w-full h-full flex flex-wrap content-start gap-4 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {Array.from({ length: 40 }).map((_, i) => (
            <motion.div
              key={i}
              className="w-16 h-4 bg-muted/20 rounded-sm"
              animate={{
                opacity: [0.2, 0.8, 0.2],
                width: ['4rem', '6rem', '3rem', '5rem'],
              }}
              transition={{
                duration: 0.5 + Math.random() * 1.5,
                repeat: Infinity,
                repeatType: 'reverse',
                delay: Math.random() * 0.5,
              }}
            />
          ))}
        </motion.div>
      </div>

      <div className="relative w-full h-[60vh] flex flex-wrap justify-center content-center gap-6 z-10 px-8">
        {items.map((item, i) => (
          <motion.div
            key={i}
            className="bg-card/80 backdrop-blur-md p-5 rounded-2xl border border-border shadow-xl flex items-center justify-center"
            initial={{ scale: 0, opacity: 0, rotateX: 90 }}
            animate={phase >= 1 ? { 
              scale: 1, 
              opacity: 1, 
              rotateX: 0,
              y: [0, -10, 0],
            } : { scale: 0, opacity: 0, rotateX: 90 }}
            transition={{ 
              type: 'spring', 
              stiffness: 400, 
              damping: 25, 
              delay: i * 0.08,
              y: {
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.2
              }
            }}
          >
            <item.Icon className={`w-12 h-12 ${item.color}`} />
          </motion.div>
        ))}
      </div>

      {/* Red error/complex overlays */}
      <motion.div
        className="absolute inset-0 border-[10px] border-destructive/20 pointer-events-none z-20"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: [0, 1, 0.5, 0.8, 0] } : { opacity: 0 }}
        transition={{ duration: 2, times: [0, 0.1, 0.3, 0.5, 1], repeat: Infinity }}
      />

      <div className="absolute bottom-[20vh] w-full px-8 text-center z-30">
        <motion.div
          className="inline-block bg-background/80 backdrop-blur-xl px-8 py-4 rounded-3xl border border-border/50 shadow-2xl"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
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