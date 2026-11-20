import { useState, useCallback, useRef, useEffect } from 'react';
import { SubtitleSegment } from '../types/project';

export function useVideoSync(segments: SubtitleSegment[]) {
  const segmentsRef = useRef<SubtitleSegment[]>(segments);
  const currentPositionRef = useRef(0);
  const activeSegmentRef = useRef<SubtitleSegment | null>(null);
  const [activeSegment, setActiveSegment] = useState<SubtitleSegment | null>(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const onPlaybackStatusUpdate = useCallback(
    (status: any) => {
      if (!status.isLoaded) return;

      const pos = status.positionMillis || 0;
      currentPositionRef.current = pos;

      const cur = activeSegmentRef.current;
      // Fast O(1) path: If still inside current segment's timeframe, avoid scanning array
      if (cur && pos >= cur.startTime && pos <= cur.endTime) {
        return;
      }

      // Find segment matching current timestamp from pre-loaded list
      const segs = segmentsRef.current;
      const found = segs.find(
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
    []
  );

  return {
    currentPositionMs: currentPositionRef.current,
    activeSegment,
    onPlaybackStatusUpdate,
  };
}
