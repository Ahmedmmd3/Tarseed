import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText, MediaFrame } from '@/lib/video/layout';
import { SCENE_DURATIONS } from '../VideoTemplate';

export function Scene1() {
  const duration = SCENE_DURATIONS.s1 / 1000; // 7.5s

  return (
    <SafeFrame className="bg-[#0B1120] text-center overflow-hidden">
      <SceneLayout className="flex flex-col items-center justify-center">
        
        {/* Background stays dark blue to match scene 0, but glowing shifts */}
        <motion.div
          className="absolute inset-0 z-0 opacity-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vmin] h-[80vmin] bg-cyan-500 rounded-full blur-[120px]" />
        </motion.div>

        {/* Typography */}
        <div className="relative z-20 flex flex-col items-center mb-[6vmin] mt-[8vmin] w-full max-w-[80%]">
          <motion.div
            initial={{ opacity: 0, y: '5vmin' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-3vmin' }}
            transition={{ duration: 0.8, delay: 0.2, type: 'spring' }}
            className="mb-[2vmin]"
          >
            <VideoText as="h2" scale="heading" className="font-black text-white">
              ترصيد
            </VideoText>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: '3vmin' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-3vmin' }}
            transition={{ duration: 0.8, delay: 0.4, type: 'spring' }}
          >
            <VideoText as="p" scale="body" className="font-medium text-cyan-200">
              إدارة أسهل لنمو أسرع
            </VideoText>
          </motion.div>
        </div>

        {/* Dashboard Image Reveal */}
        <motion.div
          className="relative z-10 w-[90%] aspect-[4/3] rounded-xl shadow-2xl border border-white/10 overflow-hidden"
          initial={{ opacity: 0, y: '15vmin', rotateX: 20, scale: 0.8, perspective: 1000 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
          transition={{ duration: 1.2, delay: 0.8, type: "spring", stiffness: 60, damping: 15 }}
        >
          <MediaFrame fit="cover" position="left top" className="w-full h-full">
            <img 
              src={`${import.meta.env.BASE_URL}images/glimpses/dashboard.jpg`} 
              className="w-full h-full object-cover object-left-top" 
              alt="Dashboard" 
            />
          </MediaFrame>
          {/* Glow overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] to-transparent opacity-30" />
        </motion.div>

        {/* Floating accent elements that animate during the scene */}
        <motion.div
          className="absolute bottom-[10%] right-[5%] bg-blue-600/20 backdrop-blur-md border border-blue-400/30 text-white px-[4vmin] py-[2vmin] rounded-2xl z-30"
          initial={{ opacity: 0, x: '10vmin' }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.6, delay: 2.5, type: 'spring' }}
        >
          <VideoText as="span" scale="caption" className="font-bold">لوحة تحكم متكاملة</VideoText>
        </motion.div>

        <motion.div
          className="absolute top-[35%] left-[2%] bg-cyan-600/20 backdrop-blur-md border border-cyan-400/30 text-white px-[4vmin] py-[2vmin] rounded-2xl z-30"
          initial={{ opacity: 0, x: '-10vmin' }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.6, delay: 3.5, type: 'spring' }}
        >
          <VideoText as="span" scale="caption" className="font-bold">رؤية واضحة</VideoText>
        </motion.div>

      </SceneLayout>
    </SafeFrame>
  );
}
