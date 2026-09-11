import { motion } from 'framer-motion';
import { VideoText } from '@/lib/video/layout';

export function FeatureCaption({ text, className = '' }: { text: string; className?: string }) {
  return (
    <motion.div
      className={`absolute z-50 flex flex-col items-center shadow-2xl ${className}`}
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="bg-brand-blue/90 backdrop-blur-md px-6 py-3 rounded-full border border-brand-cyan/50 shadow-[0_0_30px_rgba(0,102,255,0.6)]">
        <VideoText className="text-2xl font-bold text-white tracking-wide">
          {text}
        </VideoText>
      </div>
      {/* Decorative dot/line */}
      <div className="w-1 h-8 bg-gradient-to-b from-brand-cyan to-transparent mt-1 rounded-full opacity-80" />
      <div className="w-3 h-3 bg-brand-cyan rounded-full mt-1 shadow-[0_0_10px_rgba(0,210,255,1)]" />
    </motion.div>
  );
}
