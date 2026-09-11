import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText } from '@/lib/video/layout';
import { SCENE_DURATIONS } from '../VideoTemplate';

export function Scene5() {
  const duration = SCENE_DURATIONS.s5 / 1000; // 2.5s

  return (
    <SafeFrame className="bg-white text-center overflow-hidden">
      <SceneLayout className="flex flex-col items-center justify-center">
        
        {/* Background flare on white */}
        <motion.div
          className="absolute inset-0 z-0 opacity-20 pointer-events-none"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.2, scale: 1 }}
          transition={{ duration: 1 }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vmin] h-[80vmin] bg-blue-500 rounded-full blur-[100px]" />
        </motion.div>

        <div className="relative z-20 flex flex-col items-center w-full">
          
          {/* Logo */}
          <motion.div
            className="w-3/4 max-w-xs mb-[8vmin]"
            initial={{ opacity: 0, scale: 0.5, rotate: -5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.8, type: 'spring', bounce: 0.5 }}
          >
            <img 
              src={`${import.meta.env.BASE_URL}images/tarseed-logo-transparent.png`} 
              className="w-full h-auto drop-shadow-lg" 
              alt="Tarseed Logo" 
            />
          </motion.div>

          {/* CTA Text */}
          <motion.div
            initial={{ opacity: 0, y: '3vmin' }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5, type: 'spring' }}
            className="mb-[4vmin]"
          >
            <VideoText as="h2" scale="heading" className="font-black text-blue-900">
              أسهل. أوضح. أسرع.
            </VideoText>
          </motion.div>

          {/* CTA Button */}
          <motion.div
            className="bg-blue-600 text-white px-[8vmin] py-[3vmin] rounded-full shadow-xl shadow-blue-600/30"
            initial={{ opacity: 0, y: '6vmin', scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.8, type: 'spring', bounce: 0.6 }}
          >
            <VideoText as="span" scale="body" className="font-bold">
              ابدأ مجاناً الآن
            </VideoText>
          </motion.div>
          
        </div>

        {/* Grid Pattern over white */}
        <div 
          className="absolute inset-0 z-0 opacity-10 pointer-events-none" 
          style={{ 
            backgroundImage: 'radial-gradient(#1e3a8a 1px, transparent 1px)', 
            backgroundSize: '3vmin 3vmin' 
          }} 
        />

      </SceneLayout>
    </SafeFrame>
  );
}
