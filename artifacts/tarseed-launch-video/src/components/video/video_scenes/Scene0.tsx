import { motion } from 'framer-motion';
import { SceneLayout, VideoText } from '@/lib/video/layout';

export function Scene0() {
  return (
    <SceneLayout className="bg-zinc-950 overflow-hidden relative items-center justify-center">
      {/* Glitchy red background matching Scene1 */}
      <motion.div
        className="absolute inset-0 bg-red-950/20 z-0"
        animate={{ opacity: [0.2, 0.6, 0.3, 0.8, 0.4] }}
        transition={{ duration: 0.3, repeat: Infinity, repeatType: 'mirror' }}
      />

      {/* Noise Texture */}
      <div className="absolute inset-0 pointer-events-none opacity-20 z-0" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

      <motion.div
        className="relative z-10 px-8 py-6 max-w-[80vw]"
        initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
        transition={{ duration: 0.8, type: 'spring', bounce: 0.3 }}
      >
        <VideoText className="text-5xl font-black text-white text-center leading-[1.3] drop-shadow-[0_0_20px_rgba(220,38,38,0.5)]">
          هل المحاسبة معقدة فعلًا…<br/>ولا إحنا مصعّبينها؟
        </VideoText>
      </motion.div>
    </SceneLayout>
  );
}
