import { motion } from 'framer-motion';
import { VideoText } from '@/lib/video/layout';

export function ProblemCaption({ text, className = '' }: { text: string; className?: string }) {
  return (
    <motion.div
      className={`absolute z-50 flex flex-col items-center shadow-2xl ${className}`}
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="bg-red-950/90 backdrop-blur-md px-5 py-2 rounded-lg border border-red-500/50 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
        <VideoText className="text-xl font-bold text-white tracking-wide">
          {text}
        </VideoText>
      </div>
    </motion.div>
  );
}
