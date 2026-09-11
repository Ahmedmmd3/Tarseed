import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText } from '@/lib/video/layout';
import { SCENE_DURATIONS } from '../VideoTemplate';

export function Scene0() {
  const duration = SCENE_DURATIONS.s0 / 1000; // 2.5s

  return (
    <SafeFrame className="bg-[#0B1120] text-center text-white overflow-hidden">
      <SceneLayout className="flex flex-col items-center justify-center">
        
        {/* Background Animated Gradient / Glow */}
        <motion.div
          className="absolute inset-0 z-0 opacity-40"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.6, scale: 1.2 }}
          exit={{ opacity: 0, scale: 1.5, filter: "blur(20px)" }}
          transition={{ duration, ease: "easeOut" }}
        >
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[60vmin] h-[60vmin] bg-blue-600 rounded-full blur-[100px]" />
        </motion.div>

        {/* Grid Pattern */}
        <div 
          className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
          style={{ 
            backgroundImage: 'radial-gradient(#4b5563 1px, transparent 1px)', 
            backgroundSize: '3vmin 3vmin' 
          }} 
        />

        <div className="relative z-10 flex flex-col items-center gap-[4vmin]">
          <motion.div
            initial={{ opacity: 0, y: '5vmin', filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: '-5vmin', filter: "blur(10px)" }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <VideoText as="h1" scale="heading" className="font-black text-white">
              المحاسبة معقدة؟
            </VideoText>
          </motion.div>

          <motion.div
            className="bg-blue-600 text-white px-[6vmin] py-[2.5vmin] rounded-full font-bold"
            initial={{ opacity: 0, scale: 0.5, rotate: -5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: '3vmin' }}
            transition={{ duration: 0.6, delay: 1.2, type: 'spring', bounce: 0.5 }}
          >
            <VideoText as="span" scale="body">
              ليس بعد اليوم!
            </VideoText>
          </motion.div>
        </div>

      </SceneLayout>
    </SafeFrame>
  );
}
