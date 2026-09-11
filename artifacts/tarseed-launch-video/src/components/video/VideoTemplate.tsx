import {
  VideoCanvas,
  VideoPausedContext,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { Scene0 } from './video_scenes/Scene0';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS = {
  s0: 2500,
  s1: 7500,
  s2: 2000,
  s3: 8000,
  s4: 4500,
  s5: 2500,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';

const SCENES = { s0: Scene0, s1: Scene1, s2: Scene2, s3: Scene3, s4: Scene4, s5: Scene5 };

const STARTS = {
  s0: 0.0,
  s1: 2.5,
  s2: 10.0,
  s3: 12.0,
  s4: 20.0,
  s5: 24.5,
} as const;

const ASSETS = [
  'images/glimpses/dashboard.jpg',
  'images/glimpses/ai-chat.jpg',
  'images/glimpses/ai-journal.jpg',
  'images/glimpses/invoice.jpg',
  'images/glimpses/reports.jpg',
  'images/tarseed-logo-transparent.png'
];

export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = false, paused = false, muted = false, onSceneChange,
}: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean;
  onSceneChange?: (key: string) => void;
} = {}) {
  const { currentSceneKey: hookSceneKey } = useVideoPlayer({ durations, loop, paused });
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;

  const [activeSceneKey, setActiveSceneKey] = useState(hookSceneKey);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastKey = useRef<string | null>(null);

  // Sync visual scene to audio clock in export mode
  useEffect(() => {
    if (isIframed) {
      setActiveSceneKey(hookSceneKey);
      return;
    }

    let rafId: number;
    const checkAudioTime = () => {
      if (audioRef.current) {
        const t = audioRef.current.currentTime;
        let nextKey = 's0';
        if (t >= 24.5) nextKey = 's5';
        else if (t >= 20.0) nextKey = 's4';
        else if (t >= 12.0) nextKey = 's3';
        else if (t >= 10.0) nextKey = 's2';
        else if (t >= 2.5) nextKey = 's1';

        setActiveSceneKey((prev: string) => prev !== nextKey ? nextKey : prev);
      }
      rafId = requestAnimationFrame(checkAudioTime);
    };
    rafId = requestAnimationFrame(checkAudioTime);
    return () => cancelAnimationFrame(rafId);
  }, [isIframed, hookSceneKey]);

  const baseKey = activeSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENES;
  const Scene = SCENES[baseKey];

  useEffect(() => onSceneChange?.(activeSceneKey), [activeSceneKey, onSceneChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 0.45;

    if (paused) {
      audio.pause();
      return;
    }

    if (lastKey.current !== activeSceneKey) {
      lastKey.current = activeSceneKey;
      const targetTime = STARTS[baseKey as keyof typeof STARTS] || 0.0;
      if (baseKey === 's0' || Math.abs(audio.currentTime - targetTime) > 1.5) {
        audio.currentTime = targetTime;
      }
    }

    audio.play().catch(() => {});
  }, [activeSceneKey, baseKey, muted, paused]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#010619' }} className="dark text-foreground font-sans bg-mesh overflow-hidden">
        <div className="absolute opacity-0 pointer-events-none w-[1px] h-[1px] overflow-hidden z-0">
          {ASSETS.map(src => (
            <img key={src} src={`${import.meta.env.BASE_URL}${src}`} alt="" />
          ))}
        </div>
        <AnimatePresence mode="sync">
          {Scene && <Scene key={activeSceneKey} />}
        </AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/master_soundtrack.mp3`} preload="auto" muted={muted} loop={false} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
