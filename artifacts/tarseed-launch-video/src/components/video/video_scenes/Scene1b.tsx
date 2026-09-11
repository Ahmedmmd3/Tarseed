import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';

export function Scene1b() {
  return (
    <SceneLayout className="bg-black overflow-hidden relative items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
        transition={{ duration: 0.8, type: 'spring', bounce: 0.3 }}
      >
        <VideoText className="text-5xl font-black text-white text-center leading-tight">
          قررنا نغيّر الطريقة
        </VideoText>
      </motion.div>
    </SceneLayout>
  );
}
