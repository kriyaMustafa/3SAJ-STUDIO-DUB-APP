import { useState, useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const playAudio = async (uri: string) => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      if (playingUri === uri && isPlaying) {
        setIsPlaying(false);
        setPlayingUri(null);
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlayingUri(uri);
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          setIsPlaying(false);
          setPlayingUri(null);
        }
      });
    } catch (err) {
      console.warn('[AudioPlayer] Error playing audio:', err);
      setIsPlaying(false);
      setPlayingUri(null);
    }
  };

  const stopAudio = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
      } catch (_) {}
      setIsPlaying(false);
      setPlayingUri(null);
    }
  };

  return {
    isPlaying,
    playingUri,
    playAudio,
    stopAudio,
  };
}
