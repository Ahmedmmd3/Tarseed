import {
  VideoCanvas,
  VideoPausedContext,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';

import { Scene0 } from './video_scenes/Scene0';
import { Scene1 } from './video_scenes/Scene1';
import { Scene1b } from './video_scenes/Scene1b';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';

export const SCENE_DURATIONS = {
  s0: 2500,
  s1: 7500,
  s1b: 2000,
  s2: 8000,
  s3: 4500,
  s4: 2500,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';

const SCENES = { s0: Scene0, s1: Scene1, s1b: Scene1b, s2: Scene2, s3: Scene3, s4: Scene4 };

const STARTS = {
  s0: 0.0,
  s1: 2.5,
  s1b: 10.0,
  s2: 12.0,
  s3: 20.0,
  s4: 24.5,
} as const;

const ASSETS = [
  'images/clutter/legacy-erp.jpg',
  'images/clutter/dashboard-chaos.jpg',
  'images/clutter/report-overload.jpg',
  'images/clutter/complex-pos.jpg',
  'images/clutter/mobile-ledger.jpg',
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
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  const baseKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENES;
  const Scene = SCENES[baseKey];

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastKey = useRef<string | null>(null);

  useEffect(() => onSceneChange?.(currentSceneKey), [currentSceneKey, onSceneChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 0.45;

    if (paused) {
      audio.pause();
      return;
    }

    if (lastKey.current !== currentSceneKey) {
      lastKey.current = currentSceneKey;
      const targetTime = STARTS[baseKey as keyof typeof STARTS] || 0.0;
      if (baseKey === 's0' || Math.abs(audio.currentTime - targetTime) > 1.5) {
        audio.currentTime = targetTime;
      }
    }

    audio.play().catch(() => {});
  }, [currentSceneKey, baseKey, muted, paused]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#010619' }} className="dark text-foreground font-sans">
        <div className="absolute opacity-0 pointer-events-none w-[1px] h-[1px] overflow-hidden z-0">
          {ASSETS.map(src => (
            <img key={src} src={`${import.meta.env.BASE_URL}${src}`} alt="" />
          ))}
        </div>
        <AnimatePresence mode="sync">
          {Scene && <Scene key={currentSceneKey} />}
        </AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/master_soundtrack.mp3`} preload="auto" muted={muted} loop={false} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
