import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText, MediaFrame } from '@/lib/video/layout';
import { SCENE_DURATIONS } from '../VideoTemplate';

export function Scene4() {
  const duration = SCENE_DURATIONS.s4 / 1000; // 4.5s

  return (
    <SafeFrame className="bg-[#0B1120] overflow-hidden">
      <SceneLayout className="flex flex-col items-center justify-center">
        
        <motion.div
          className="absolute inset-0 z-0 opacity-50"
          initial={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.5 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        >
          <div className="absolute top-0 right-0 w-[80vmin] h-[80vmin] bg-blue-600 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 left-0 w-[60vmin] h-[60vmin] bg-cyan-500 rounded-full blur-[100px]" />
        </motion.div>

        {/* Title */}
        <div className="relative z-30 w-full text-center mt-[6vmin] mb-[4vmin]">
          <motion.div
            initial={{ opacity: 0, y: '-4vmin' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-3vmin' }}
            transition={{ duration: 0.8, type: 'spring' }}
          >
            <VideoText as="h2" scale="heading" className="font-black text-white leading-tight">
              فواتير وتقارير<br/>
              <span className="text-cyan-300">في ثوانٍ</span>
            </VideoText>
          </motion.div>
        </div>

        {/* Cards container */}
        <div className="relative z-20 flex-1 w-full flex flex-col justify-center items-center gap-[4vmin]">
          
          {/* Invoice */}
          <motion.div
            className="w-[90%] rounded-2xl shadow-2xl border border-white/20 overflow-hidden"
            initial={{ opacity: 0, y: '15vmin', rotateX: 30 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, x: '-15vmin' }}
            transition={{ duration: 0.8, delay: 0.4, type: "spring", bounce: 0.3 }}
          >
            <MediaFrame fit="cover" position="center">
              <img 
                src={`${import.meta.env.BASE_URL}images/glimpses/invoice.jpg`} 
                className="w-full h-auto object-cover" 
                alt="Invoice POS" 
              />
            </MediaFrame>
          </motion.div>

          {/* Reports */}
          <motion.div
            className="w-[90%] rounded-2xl shadow-2xl border border-white/20 overflow-hidden"
            initial={{ opacity: 0, y: '15vmin', rotateX: 30 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, x: '15vmin' }}
            transition={{ duration: 0.8, delay: 0.8, type: "spring", bounce: 0.3 }}
          >
            <MediaFrame fit="cover" position="center">
              <img 
                src={`${import.meta.env.BASE_URL}images/glimpses/reports.jpg`} 
                className="w-full h-auto object-cover" 
                alt="Reports" 
              />
            </MediaFrame>
          </motion.div>

        </div>

      </SceneLayout>
    </SafeFrame>
  );
}
