import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus, Audio } from 'expo-av';
import { Play, Pause, SkipBack, SkipForward, Mic, Volume2, VolumeX } from 'lucide-react-native';
import { SubtitleSegment } from '../../types/project';

interface InteractivePreviewPlayerProps {
  videoUri: string;
  activeSegment: SubtitleSegment | null;
  segments?: SubtitleSegment[];
  onPlaybackStatusUpdate: (status: AVPlaybackStatus) => void;
  onSeekTo: (positionMs: number) => void;
  onPrevSegment?: () => void;
  onNextSegment?: () => void;
}

export const InteractivePreviewPlayer: React.FC<InteractivePreviewPlayerProps> = ({
  videoUri,
  activeSegment,
  segments = [],
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

  const stopDubbedAudio = async () => {
    if (currentSoundRef.current) {
      try {
        await currentSoundRef.current.stopAsync();
        await currentSoundRef.current.unloadAsync();
      } catch (_) {}
      currentSoundRef.current = null;
    }
    lastPlayedIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopDubbedAudio();
    };
  }, []);

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
      await stopDubbedAudio();
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
  };

  const handleStatusUpdate = async (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;

    setIsPlaying(status.isPlaying);
    const pos = status.positionMillis || 0;
    setCurrentTimeMs(pos);
    setDurationMs(status.durationMillis || 0);

    onPlaybackStatusUpdate(status);

    // Synchronize Khmer TTS Voice Dubbing with video timeline
    if (audioMode === 'DUBBED') {
      if (!status.isPlaying) {
        await stopDubbedAudio();
        return;
      }

      // Find current subtitle segment
      const curSeg = segments.find(
        (s) => pos >= s.startTime && pos < s.endTime
      );

      if (curSeg && curSeg.audioPath && curSeg.status === 'ready') {
        if (lastPlayedIdRef.current !== curSeg.id) {
          lastPlayedIdRef.current = curSeg.id;
          await stopDubbedAudio();

          const offsetInSegment = Math.max(0, pos - curSeg.startTime);

          try {
            const { sound } = await Audio.Sound.createAsync(
              { uri: curSeg.audioPath },
              { shouldPlay: true, positionMillis: offsetInSegment }
            );
            currentSoundRef.current = sound;
          } catch (audioErr) {
            console.warn('[PreviewAudio] Error playing dubbed segment:', audioErr);
          }
        }
      } else {
        if (lastPlayedIdRef.current !== null) {
          await stopDubbedAudio();
        }
      }
    } else {
      if (currentSoundRef.current) {
        await stopDubbedAudio();
      }
    }
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
