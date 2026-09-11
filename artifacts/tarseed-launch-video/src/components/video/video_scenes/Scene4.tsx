import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';

export function Scene4() {
  return (
    <SceneLayout className="bg-brand-bg bg-mesh overflow-hidden relative items-center justify-center">
      {/* Decorative background glows */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-[50vw] h-[50vw] bg-brand-blue/20 rounded-full blur-[80px]"
        initial={{ scale: 1, opacity: 0.2 }}
        animate={{ scale: 1.5, opacity: 0.4 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
        exit={{ opacity: 0, transition: { duration: 0.5 } }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-[60vw] h-[60vw] bg-brand-cyan/10 rounded-full blur-[80px]"
        initial={{ scale: 1, opacity: 0.1 }}
        animate={{ scale: 1.2, opacity: 0.3 }}
        transition={{ duration: 2, ease: 'easeOut' }}
        exit={{ opacity: 0, transition: { duration: 0.5 } }}
      />

      {/* Final Logo Lockup */}
      <motion.div
        className="relative z-30 flex flex-col items-center justify-center w-full"
        initial={{ scale: 0.8, opacity: 0, filter: 'blur(10px)' }}
        animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 1, type: 'spring', bounce: 0.4 }}
        exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)', transition: { duration: 0.5 } }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/tarseed-logo-transparent.png`}
          className="w-[60vw] max-w-[300px] mb-8"
          alt="Tarseed Logo"
        />

        <div className="overflow-hidden">
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            transition={{ delay: 0.4, duration: 0.8, type: 'spring', bounce: 0.3 }}
            exit={{ opacity: 0 }}
          >
            <VideoText className="text-3xl font-bold text-white tracking-wide text-gradient">
              المحاسبة بطريقة أوضح
            </VideoText>
          </motion.div>
        </div>
      </motion.div>
    </SceneLayout>
  );
}
