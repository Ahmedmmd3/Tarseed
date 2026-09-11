import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const SCENE_DETAILS: Record<string, { title: string; filePath: string }> = {
  s0: { title: 'مقدمة', filePath: 'src/components/video/video_scenes/Scene0.tsx' },
  s1: { title: 'الأنظمة المعقدة', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
  s1b: { title: 'نغيّر الطريقة', filePath: 'src/components/video/video_scenes/Scene1b.tsx' },
  s2: { title: 'ترصيد - الذكاء الاصطناعي', filePath: 'src/components/video/video_scenes/Scene2.tsx' },
  s3: { title: 'الفواتير والتقارير', filePath: 'src/components/video/video_scenes/Scene3.tsx' },
  s4: { title: 'الخاتمة', filePath: 'src/components/video/video_scenes/Scene4.tsx' },
};

const time = (ms: number) => `${Math.floor(ms / 60000)}:${Math.floor((ms % 60000) / 1000).toString().padStart(2, '0')}`;

function Playback({ sceneKeys, activeIndex, activeDuration, activeStartTime, totalDuration, tick, paused, onJump }: {
  sceneKeys: string[]; activeIndex: number; activeDuration: number; activeStartTime: number;
  totalDuration: number; tick: number; paused: boolean; onJump: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const base = useRef(0);
  useEffect(() => { setElapsed(0); base.current = 0; }, [tick]);
  useEffect(() => {
    if (paused) return;
    const started = performance.now();
    const id = window.setInterval(() => setElapsed(base.current + performance.now() - started), 60);
    return () => { window.clearInterval(id); base.current += performance.now() - started; };
  }, [tick, paused]);
  const progress = activeDuration ? Math.min(1, elapsed / activeDuration) : 0;
  return (
    <>
      <div className="flex flex-1 items-center gap-1.5">
        {sceneKeys.map((key, index) => (
          <button key={key} onClick={() => onJump(index)} className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/20" aria-label={`المشهد ${index + 1}`}>
            <span className="absolute inset-y-0 right-0 rounded-full bg-white/90" style={{ width: `${index === activeIndex ? progress * 100 : 0}%` }} />
          </button>
        ))}
      </div>
      <span className="shrink-0 font-mono text-sm text-white/70">{activeIndex + 1}/{sceneKeys.length}</span>
      <span className="min-w-[8ch] shrink-0 font-mono text-sm text-white/80">{time(Math.min(totalDuration, activeStartTime + elapsed))} / {time(totalDuration)}</span>
    </>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const controls = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const handleJump = useCallback((index: number) => {
    controls.jumpTo(index);
    const key = controls.sceneKeys[index];
    const detail = SCENE_DETAILS[key];
    if (detail) window.parent.postMessage({ type: 'REPLIT_VIDEO_SCENE_SELECTED', payload: {
      sceneIndex: index, sceneCount: controls.sceneKeys.length, sceneTitle: detail.title, filePath: detail.filePath, lineNumber: 1,
    } }, '*');
  }, [controls]);
  useEffect(() => {
    if (!controls.paused) return;
    const animations = document.getAnimations().filter((animation) => animation.playState === 'running');
    animations.forEach((animation) => animation.pause());
    return () => animations.forEach((animation) => animation.play());
  }, [controls.paused]);
  if (!isIframed) return <VideoTemplate />;
  const visible = !collapsed || hovering;
  return (
    <div className="relative h-screen w-full">
      <VideoTemplate key={controls.mountKey} durations={controls.durations} paused={controls.paused} muted={muted} onSceneChange={controls.onSceneChange} loop={true} />
      <div className="absolute inset-x-0 bottom-0 z-50 flex h-1/4 flex-col justify-end" onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
        <div className={`flex items-center gap-3 bg-black/60 px-4 py-3 backdrop-blur-md transition ${visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
          <button onClick={controls.togglePause} className="text-white/80" aria-label={controls.paused ? 'تشغيل' : 'إيقاف'}>{controls.paused ? <Play /> : <Pause />}</button>
          <button onClick={controls.toggleLock} className={controls.locked ? 'text-cyan-300' : 'text-white/80'} aria-label="تكرار المشهد"><Repeat /></button>
          <button onClick={() => setMuted((value) => !value)} className="text-white/80" aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}>{muted ? <VolumeX /> : <Volume2 />}</button>
          <div className="h-7 w-px bg-white/20" />
          <Playback {...controls} onJump={handleJump} />
          <button onClick={() => setCollapsed((value) => !value)} className="text-white/80" aria-label="إظهار أو إخفاء الأدوات">{collapsed ? <ChevronUp /> : <ChevronDown />}</button>
        </div>
      </div>
    </div>
  );
}