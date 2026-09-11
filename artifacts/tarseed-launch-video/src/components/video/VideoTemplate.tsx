import {
  VideoCanvas,
  VideoPausedContext,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';

import { Scene1 } from './video_scenes/Scene1';
import { Scene1b } from './video_scenes/Scene1b';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';

export const SCENE_DURATIONS = {
  s1: 7500,
  s1b: 2000,
  s2: 8000,
  s3: 4500,
  s4: 2500,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';

const SCENES = { s1: Scene1, s1b: Scene1b, s2: Scene2, s3: Scene3, s4: Scene4 };

const AUDIO_CONFIG = {
  s1: { track: 'stress', target: 0 },
  s1b: { track: 'thud', target: 0 },
  s2: { track: 'tarseed', target: 0 },
  s3: { track: 'tarseed', target: 8.0 },
  s4: { track: 'tarseed', target: 12.5 },
} as const;

export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange,
}: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean;
  onSceneChange?: (key: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  const baseKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENES;
  const Scene = SCENES[baseKey];

  const audioStressRef = useRef<HTMLAudioElement | null>(null);
  const audioThudRef = useRef<HTMLAudioElement | null>(null);
  const audioTarseedRef = useRef<HTMLAudioElement | null>(null);

  const lastKey = useRef<string | null>(null);

  useEffect(() => onSceneChange?.(currentSceneKey), [currentSceneKey, onSceneChange]);

  useEffect(() => {
    const config = AUDIO_CONFIG[baseKey];
    if (!config) return;

    const audios = {
      stress: audioStressRef.current,
      thud: audioThudRef.current,
      tarseed: audioTarseedRef.current,
    };

    // Pause non-active tracks
    Object.entries(audios).forEach(([key, audio]) => {
      if (!audio) return;
      if (key !== config.track) {
        audio.pause();
      }
    });

    const activeAudio = audios[config.track as keyof typeof audios];
    if (!activeAudio) return;

    activeAudio.volume = 0.45;

    if (paused) {
      activeAudio.pause();
      return;
    }

    if (lastKey.current !== currentSceneKey) {
      lastKey.current = currentSceneKey;
      if (Math.abs(activeAudio.currentTime - config.target) > 0.18) {
        activeAudio.currentTime = config.target;
      }
    }

    activeAudio.play().catch(() => {});
  }, [currentSceneKey, baseKey, muted, paused]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#010619' }} className="dark text-foreground font-sans">
        <AnimatePresence mode="sync">
          {Scene && <Scene key={currentSceneKey} />}
        </AnimatePresence>
        <audio ref={audioStressRef} src={`${import.meta.env.BASE_URL}audio/stress_drone.mp3`} preload="auto" muted={muted} />
        <audio ref={audioThudRef} src={`${import.meta.env.BASE_URL}audio/thud.mp3`} preload="auto" muted={muted} />
        <audio ref={audioTarseedRef} src={`${import.meta.env.BASE_URL}audio/tarseed_music.mp3`} preload="auto" muted={muted} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
