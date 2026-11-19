import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus, Audio } from 'expo-av';
import { Play, Pause, SkipBack, SkipForward, Mic, Volume2, VolumeX } from 'lucide-react-native';
import { SubtitleSegment } from '../../types/project';

interface InteractivePreviewPlayerProps {
  videoUri: string;
  activeSegment: SubtitleSegment | null;
  segments?: SubtitleSegment[];
  seekToTimeMs?: number | null;
  onPlaybackStatusUpdate: (status: AVPlaybackStatus) => void;
  onSeekTo?: (positionMs: number) => void;
  onPrevSegment?: () => void;
  onNextSegment?: () => void;
}

export const InteractivePreviewPlayer: React.FC<InteractivePreviewPlayerProps> = ({
  videoUri,
  activeSegment,
  segments = [],
  seekToTimeMs,
  onPlaybackStatusUpdate,
  onPrevSegment,
  onNextSegment,
}) => {
  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioMode, setAudioMode] = useState<'DUBBED' | 'ORIGINAL' | 'MUTED'>('DUBBED');

  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const lastPlayedIdRef = useRef<number | null>(null);
  const isAudioLoadingRef = useRef<boolean>(false);

  // Initialize Audio mode for Android & iOS speaker output
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch((err) => console.warn('[AudioMode] Failed to init audio mode:', err));
  }, []);

  const stopDubbedAudio = async () => {
    if (currentSoundRef.current) {
      const sound = currentSoundRef.current;
      currentSoundRef.current = null;
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (_) {}
    }
    lastPlayedIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopDubbedAudio();
    };
  }, []);

  // Respond to seek commands from external interactions (e.g. segment card taps)
  useEffect(() => {
    if (seekToTimeMs !== null && seekToTimeMs !== undefined && videoRef.current) {
      videoRef.current.setPositionAsync(seekToTimeMs);
      setCurrentTimeMs(seekToTimeMs);
      syncDubbedAudio(seekToTimeMs, isPlaying);
    }
  }, [seekToTimeMs]);

  const cycleAudioMode = async () => {
    await stopDubbedAudio();
    setAudioMode((prev) => {
      if (prev === 'DUBBED') return 'ORIGINAL';
      if (prev === 'ORIGINAL') return 'MUTED';
      return 'DUBBED';
    });
  };

  const togglePlayPause = async () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      await videoRef.current.pauseAsync();
      if (currentSoundRef.current) {
        try {
          await currentSoundRef.current.pauseAsync();
        } catch (_) {}
      }
    } else {
      await videoRef.current.playAsync();
      if (currentSoundRef.current && audioMode === 'DUBBED') {
        try {
          await currentSoundRef.current.playAsync();
        } catch (_) {}
      }
    }
  };

  /**
   * Precise Audio Synchronization Engine.
   * Matches the speech timeline behavior of final video export:
   * - Segments begin speaking at their exact startTime.
   * - Voice plays for its full duration without being prematurely cut off.
   * - Resumes cleanly on play/pause and resyncs if drift exceeds 150ms.
   */
  const syncDubbedAudio = async (pos: number, isVideoPlaying: boolean) => {
    if (audioMode !== 'DUBBED') {
      if (currentSoundRef.current) {
        await stopDubbedAudio();
      }
      return;
    }

    if (!isVideoPlaying) {
      if (currentSoundRef.current) {
        try {
          const st = await currentSoundRef.current.getStatusAsync();
          if (st.isLoaded && st.isPlaying) {
            await currentSoundRef.current.pauseAsync();
          }
        } catch (_) {}
      }
      return;
    }

    // Sort segments by startTime
    const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);

    // Find segment whose speech slot covers current position
    const curSeg = sorted.find((s, idx) => {
      const nextSeg = sorted[idx + 1];
      const speechDuration = s.durationMs && s.durationMs > 0 ? s.durationMs : Math.max(50, s.endTime - s.startTime);
      const maxSpeechEnd = nextSeg ? Math.min(s.startTime + speechDuration, nextSeg.startTime) : (s.startTime + speechDuration);
      return pos >= s.startTime && pos < maxSpeechEnd;
    });

    if (curSeg && curSeg.audioPath) {
      const offsetInSegment = Math.max(0, pos - curSeg.startTime);

      // Same segment audio is already loaded
      if (lastPlayedIdRef.current === curSeg.id && currentSoundRef.current) {
        try {
          const st = await currentSoundRef.current.getStatusAsync();
          if (st.isLoaded) {
            if (!st.isPlaying) {
              await currentSoundRef.current.setPositionAsync(offsetInSegment);
              await currentSoundRef.current.playAsync();
            } else {
              // Drift detection and sample-accurate correction
              const drift = Math.abs(st.positionMillis - offsetInSegment);
              if (drift > 150) {
                await currentSoundRef.current.setPositionAsync(offsetInSegment);
              }
            }
          }
        } catch (_) {}
        return;
      }

      // New segment transition
      if (isAudioLoadingRef.current) return;
      isAudioLoadingRef.current = true;

      try {
        await stopDubbedAudio();
        lastPlayedIdRef.current = curSeg.id;

        const { sound } = await Audio.Sound.createAsync(
          { uri: curSeg.audioPath },
          { shouldPlay: true, positionMillis: offsetInSegment, volume: 1.0 }
        );
        currentSoundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((st) => {
          if (st.isLoaded && st.didJustFinish) {
            lastPlayedIdRef.current = null;
          }
        });
      } catch (audioErr) {
        console.warn('[PreviewAudio] Error playing dubbed segment:', audioErr);
      } finally {
        isAudioLoadingRef.current = false;
      }
    } else {
      // Not in any active speech segment (silence gap between subtitles)
      if (lastPlayedIdRef.current !== null) {
        await stopDubbedAudio();
      }
    }
  };

  const handleStatusUpdate = async (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;

    setIsPlaying(status.isPlaying);
    const pos = status.positionMillis || 0;
    setCurrentTimeMs(pos);
    setDurationMs(status.durationMillis || 0);

    onPlaybackStatusUpdate(status);

    await syncDubbedAudio(pos, status.isPlaying);
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Video View */}
      <View style={styles.videoWrapper}>
        <Video
          ref={videoRef}
          source={{ uri: videoUri }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls={false}
          isMuted={audioMode === 'DUBBED' || audioMode === 'MUTED'}
          progressUpdateIntervalMillis={50}
          onPlaybackStatusUpdate={handleStatusUpdate}
        />

        {/* Audio Mode Badge in Top-Right Corner */}
        <TouchableOpacity
          style={styles.audioModeBadge}
          onPress={cycleAudioMode}
          activeOpacity={0.8}
        >
          {audioMode === 'DUBBED' && (
            <>
              <Mic size={13} color="#10B981" />
              <Text style={[styles.audioModeText, { color: '#10B981' }]}>Khmer Dub</Text>
            </>
          )}
          {audioMode === 'ORIGINAL' && (
            <>
              <Volume2 size={13} color="#38BDF8" />
              <Text style={[styles.audioModeText, { color: '#38BDF8' }]}>Original</Text>
            </>
          )}
          {audioMode === 'MUTED' && (
            <>
              <VolumeX size={13} color="#94A3B8" />
              <Text style={[styles.audioModeText, { color: '#94A3B8' }]}>Mute</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Subtitle Overlay */}
        {activeSegment && (
          <View style={styles.subtitleOverlay}>
            <View style={styles.subtitleBox}>
              <Text style={styles.khmerSubtitle}>
                {activeSegment.translatedText || activeSegment.originalText}
              </Text>
              {activeSegment.translatedText ? (
                <Text style={styles.originalSubtitle}>
                  {activeSegment.originalText}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </View>

      {/* Control Bar */}
      <View style={styles.controlsRow}>
        <Text style={styles.timeLabel}>{formatTime(currentTimeMs)}</Text>

        <View style={styles.buttonGroup}>
          {onPrevSegment && (
            <TouchableOpacity onPress={onPrevSegment} style={styles.navBtn}>
              <SkipBack size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={togglePlayPause} style={styles.playBtn}>
            {isPlaying ? (
              <Pause size={20} color="#FFFFFF" />
            ) : (
              <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
            )}
          </TouchableOpacity>

          {onNextSegment && (
            <TouchableOpacity onPress={onNextSegment} style={styles.navBtn}>
              <SkipForward size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.timeLabel}>{formatTime(durationMs)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  videoWrapper: {
    width: '100%',
    height: 220,
    backgroundColor: '#000000',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioModeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    zIndex: 10,
  },
  audioModeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  subtitleOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  subtitleBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    maxWidth: '90%',
  },
  khmerSubtitle: {
    color: '#FDE047',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
  },
  originalSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
    fontStyle: 'italic',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  playBtn: {
    backgroundColor: '#4F46E5',
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtn: {
    padding: 6,
  },
  timeLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
