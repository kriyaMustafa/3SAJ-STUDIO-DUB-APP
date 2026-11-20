import { useState, useCallback, useRef } from 'react';
import { SubtitleSegment } from '../types/project';

export function useVideoSync(segments: SubtitleSegment[]) {
  const currentPositionRef = useRef(0);
  const activeSegmentRef = useRef<SubtitleSegment | null>(null);
  const [activeSegment, setActiveSegment] = useState<SubtitleSegment | null>(null);

  const onPlaybackStatusUpdate = useCallback(
    (status: any) => {
      if (!status.isLoaded) return;

      const pos = status.positionMillis || 0;
      currentPositionRef.current = pos;

      // Find segment matching current timestamp
      const found = segments.find(
        (s) => pos >= s.startTime && pos <= s.endTime
      );

      if (found) {
        if (!activeSegmentRef.current || activeSegmentRef.current.id !== found.id) {
          activeSegmentRef.current = found;
          setActiveSegment(found);
        }
      } else {
        if (activeSegmentRef.current) {
          activeSegmentRef.current = null;
          setActiveSegment(null);
        }
      }
    },
    [segments]
  );

  return {
    currentPositionMs: currentPositionRef.current,
    activeSegment,
    onPlaybackStatusUpdate,
  };
}
