import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText } from '@/lib/video/layout';
import { SCENE_DURATIONS } from '../VideoTemplate';

export function Scene2() {
  const duration = SCENE_DURATIONS.s2 / 1000; // 2.0s

  return (
    <SafeFrame className="bg-[#0B1120] text-center overflow-hidden">
      <SceneLayout className="flex flex-col items-center justify-center">
        
        {/* Dynamic wipe background */}
        <motion.div
          className="absolute inset-0 z-0 bg-blue-600"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
        />

        <div className="relative z-20 flex flex-col items-center justify-center h-full w-full">
          <motion.div
            initial={{ opacity: 0, scale: 0.5, filter: "blur(20px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 1.5, filter: "blur(20px)" }}
            transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
          >
            <VideoText as="h2" scale="display" className="font-black text-white px-[4vmin] leading-tight">
              اسأل..<br />
              <span className="text-cyan-200">وترصيد يُجيب</span>
            </VideoText>
          </motion.div>
        </div>

      </SceneLayout>
    </SafeFrame>
  );
}
