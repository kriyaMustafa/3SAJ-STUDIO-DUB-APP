import { useState, useCallback } from 'react';
import { SubtitleSegment } from '../types/project';

export function useVideoSync(segments: SubtitleSegment[]) {
  const [currentPositionMs, setCurrentPositionMs] = useState(0);
  const [activeSegment, setActiveSegment] = useState<SubtitleSegment | null>(null);

  const onPlaybackStatusUpdate = useCallback(
    (status: any) => {
      if (!status.isLoaded) return;

      const pos = status.positionMillis || 0;
      setCurrentPositionMs(pos);

      // Find segment matching current timestamp
      const found = segments.find(
        (s) => pos >= s.startTime && pos <= s.endTime
      );

      if (found) {
        if (!activeSegment || activeSegment.id !== found.id) {
          setActiveSegment(found);
        }
      } else {
        if (activeSegment) {
          setActiveSegment(null);
        }
      }
    },
    [segments, activeSegment]
  );

  return {
    currentPositionMs,
    activeSegment,
    onPlaybackStatusUpdate,
  };
}
