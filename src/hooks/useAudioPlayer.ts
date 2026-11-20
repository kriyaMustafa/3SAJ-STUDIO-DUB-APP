import { useState, useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        try {
          soundRef.current.setOnPlaybackStatusUpdate(null);
        } catch (_) {}
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  const playAudio = async (uri: string) => {
    try {
      if (soundRef.current) {
        const prev = soundRef.current;
        soundRef.current = null;
        try {
          prev.setOnPlaybackStatusUpdate(null);
        } catch (_) {}
        try {
          await prev.stopAsync();
        } catch (_) {}
        try {
          await prev.unloadAsync();
        } catch (_) {}
      }

      if (playingUri === uri && isPlaying) {
        setIsPlaying(false);
        setPlayingUri(null);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      }).catch(() => {});

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, volume: 1.0 }
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
