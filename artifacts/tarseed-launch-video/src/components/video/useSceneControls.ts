import { useCallback, useMemo, useState } from 'react';

const REPEAT_SUFFIX_RE = /_r[12]$/;
export const stripRepeatSuffix = (key: string) => key.replace(REPEAT_SUFFIX_RE, '');

export function useSceneControls(baseDurations: Record<string, number>) {
  const sceneKeys = useMemo(() => Object.keys(baseDurations), [baseDurations]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [tick, setTick] = useState(0);
  const durations = useMemo(() => {
    if (locked) {
      const key = sceneKeys[activeIndex];
      return { [`${key}_r1`]: baseDurations[key], [`${key}_r2`]: baseDurations[key] };
    }
    const result: Record<string, number> = {};
    sceneKeys.forEach((_, index) => {
      const key = sceneKeys[(activeIndex + index) % sceneKeys.length];
      result[key] = baseDurations[key];
    });
    return result;
  }, [locked, activeIndex, sceneKeys, baseDurations]);
  const totalDuration = useMemo(() => Object.values(baseDurations).reduce((sum, ms) => sum + ms, 0), [baseDurations]);
  const activeStartTime = useMemo(() => sceneKeys.slice(0, activeIndex).reduce((sum, key) => sum + baseDurations[key], 0), [sceneKeys, activeIndex, baseDurations]);
  const onSceneChange = useCallback((rawKey: string) => {
    const index = sceneKeys.indexOf(stripRepeatSuffix(rawKey));
    if (index >= 0) setActiveIndex(index);
    setTick((value) => value + 1);
  }, [sceneKeys]);
  const jumpTo = useCallback((index: number) => {
    setActiveIndex(index); setPaused(false); setMountKey((value) => value + 1); setTick((value) => value + 1);
  }, []);
  const toggleLock = useCallback(() => {
    setLocked((value) => !value); setPaused(false); setMountKey((value) => value + 1); setTick((value) => value + 1);
  }, []);
  return {
    sceneKeys, activeIndex, locked, paused, mountKey, tick, durations,
    activeDuration: baseDurations[sceneKeys[activeIndex]] ?? 0,
    activeStartTime, totalDuration, onSceneChange, jumpTo, toggleLock,
    togglePause: useCallback(() => setPaused((value) => !value), []),
  };
}