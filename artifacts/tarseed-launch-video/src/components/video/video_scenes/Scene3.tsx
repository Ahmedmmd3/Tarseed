import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText, MediaFrame } from '@/lib/video/layout';
import { SCENE_DURATIONS } from '../VideoTemplate';

export function Scene3() {
  const duration = SCENE_DURATIONS.s3 / 1000; // 8.0s

  return (
    <SafeFrame className="bg-[#0B1120] overflow-hidden">
      <SceneLayout className="flex flex-col items-center justify-center">
        
        {/* Background stays dark blue */}
        <motion.div
          className="absolute inset-0 z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="absolute -top-1/4 -right-1/4 w-[70vmin] h-[70vmin] bg-blue-700 rounded-full blur-[100px] opacity-40" />
          <div className="absolute -bottom-1/4 -left-1/4 w-[70vmin] h-[70vmin] bg-cyan-700 rounded-full blur-[100px] opacity-30" />
        </motion.div>

        {/* Typography */}
        <div className="relative z-30 w-full text-center mt-[6vmin] mb-[4vmin]">
          <motion.div
            initial={{ opacity: 0, y: '4vmin' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-3vmin' }}
            transition={{ duration: 0.8, delay: 0.2, type: 'spring' }}
            className="mb-[2vmin]"
          >
            <VideoText as="h2" scale="heading" className="font-black text-white">
              مساعدك المالي الذكي
            </VideoText>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: '3vmin' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-3vmin' }}
            transition={{ duration: 0.8, delay: 0.4, type: 'spring' }}
          >
            <VideoText as="p" scale="body" className="font-medium text-cyan-200">
              قيود يومية بضغطة زر
            </VideoText>
          </motion.div>
        </div>

        {/* Images Stagger */}
        <div className="relative z-20 w-full flex-1 flex flex-col items-center justify-center -mt-[4vmin]">
          
          {/* AI Chat Image - slightly offset to right */}
          <motion.div
            className="absolute right-[-5%] w-[85%] rounded-2xl shadow-2xl border border-white/10 overflow-hidden transform"
            initial={{ opacity: 0, x: '10vmin', rotate: 10, scale: 0.8 }}
            animate={{ opacity: 1, x: '10%', rotate: 5, scale: 1 }}
            exit={{ opacity: 0, x: '15vmin', scale: 0.9 }}
            transition={{ duration: 1, delay: 0.8, type: "spring", stiffness: 60 }}
          >
            <MediaFrame fit="cover" position="center">
              <img 
                src={`${import.meta.env.BASE_URL}images/glimpses/ai-chat.jpg`} 
                className="w-full h-auto object-cover" 
                alt="AI Chat" 
              />
            </MediaFrame>
          </motion.div>

          {/* AI Journal Image - overlaps to left */}
          <motion.div
            className="absolute left-[-5%] w-[85%] rounded-2xl shadow-2xl border border-white/10 overflow-hidden transform"
            initial={{ opacity: 0, x: '-10vmin', rotate: -10, scale: 0.8 }}
            animate={{ opacity: 1, x: '-10%', rotate: -5, scale: 1 }}
            exit={{ opacity: 0, x: '-15vmin', scale: 0.9 }}
            transition={{ duration: 1, delay: 1.6, type: "spring", stiffness: 60 }}
          >
            <MediaFrame fit="cover" position="center">
              <img 
                src={`${import.meta.env.BASE_URL}images/glimpses/ai-journal.jpg`} 
                className="w-full h-auto object-cover" 
                alt="AI Journal" 
              />
            </MediaFrame>
          </motion.div>
        </div>

        {/* Accent badge */}
        <motion.div
          className="absolute bottom-[8vmin] bg-white text-blue-900 px-[6vmin] py-[2.5vmin] rounded-full z-40 font-bold shadow-xl"
          initial={{ opacity: 0, y: '5vmin', scale: 0.5 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: '5vmin', scale: 0.5 }}
          transition={{ duration: 0.6, delay: 2.5, type: 'spring', bounce: 0.5 }}
        >
          <VideoText as="span" scale="caption">
            بدون أخطاء بشرية!
          </VideoText>
        </motion.div>

      </SceneLayout>
    </SafeFrame>
  );
}
