import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Play, Square, AlertCircle, CheckCircle2, Clock } from 'lucide-react-native';
import { SubtitleSegment, Gender, AgeTone } from '../../types/project';

interface SegmentCardProps {
  segment: SubtitleSegment;
  isActive: boolean;
  isPlayingAudio: boolean;
  onPlayAudio: (audioPath: string) => void;
  onStopAudio: () => void;
  onUpdateText: (id: number, text: string) => void;
  onUpdateTags: (id: number, gender: Gender, ageTone: AgeTone) => void;
  onSeekToSegment?: (startTimeMs: number) => void;
}

const SegmentCardComponent: React.FC<SegmentCardProps> = ({
  segment,
  isActive,
  isPlayingAudio,
  onPlayAudio,
  onStopAudio,
  onUpdateText,
  onUpdateTags,
  onSeekToSegment,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localText, setLocalText] = useState(segment.translatedText);

  useEffect(() => {
    if (!isEditing) {
      setLocalText(segment.translatedText);
    }
  }, [segment.translatedText, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (localText !== segment.translatedText) {
      onUpdateText(segment.id, localText);
    }
  };

  const cycleGender = () => {
    const nextGender: Gender =
      segment.gender === 'AUTO' ? 'M' : segment.gender === 'M' ? 'F' : 'AUTO';
    onUpdateTags(segment.id, nextGender, segment.ageTone);
  };

  const cycleAgeTone = () => {
    const nextTone: AgeTone =
      segment.ageTone === 'ADULT'
        ? 'OLD'
        : segment.ageTone === 'OLD'
        ? 'KID'
        : 'ADULT';
    onUpdateTags(segment.id, segment.gender, nextTone);
  };

  const renderStatusBadge = () => {
    switch (segment.status) {
      case 'ready':
        return (
          <View style={[styles.badge, styles.badgeReady]}>
            <CheckCircle2 size={12} color="#10B981" />
            <Text style={[styles.badgeText, { color: '#10B981' }]}>Ready</Text>
          </View>
        );
      case 'translated':
        return (
          <View style={[styles.badge, styles.badgeTranslated]}>
            <Text style={[styles.badgeText, { color: '#38BDF8' }]}>Translated</Text>
          </View>
        );
      case 'error':
        return (
          <View style={[styles.badge, styles.badgeError]}>
            <AlertCircle size={12} color="#EF4444" />
            <Text style={[styles.badgeText, { color: '#EF4444' }]}>Error</Text>
          </View>
        );
      default:
        return (
          <View style={[styles.badge, styles.badgePending]}>
            <Clock size={12} color="#94A3B8" />
            <Text style={[styles.badgeText, { color: '#94A3B8' }]}>Pending</Text>
          </View>
        );
    }
  };

  return (
    <View style={[styles.card, isActive && styles.activeCard]}>
      {/* Top Header Row */}
      <View style={styles.topRow}>
        <View style={styles.idContainer}>
          <Text style={styles.idText}>#{segment.id}</Text>
          <TouchableOpacity
            onPress={() => onSeekToSegment?.(segment.startTime)}
            activeOpacity={0.7}
          >
            <Text style={styles.timeText}>
              {segment.startTimeFormatted.slice(3, 8)} -{' '}
              {segment.endTimeFormatted.slice(3, 8)}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tagsContainer}>
          {/* Gender toggle */}
          <TouchableOpacity
            style={[
              styles.tagBtn,
              segment.gender === 'M'
                ? styles.maleTag
                : segment.gender === 'F'
                ? styles.femaleTag
                : styles.autoTag,
            ]}
            onPress={cycleGender}
          >
            <Text style={styles.tagBtnText}>{segment.gender}</Text>
          </TouchableOpacity>

          {/* Age tone toggle */}
          <TouchableOpacity
            style={[
              styles.tagBtn,
              segment.ageTone === 'OLD'
                ? styles.oldTag
                : segment.ageTone === 'KID'
                ? styles.kidTag
                : styles.adultTag,
            ]}
            onPress={cycleAgeTone}
          >
            <Text style={styles.tagBtnText}>{segment.ageTone}</Text>
          </TouchableOpacity>

          {renderStatusBadge()}
        </View>
      </View>

      {/* Original Subtitle Text */}
      <Text style={styles.origText}>{segment.originalText}</Text>

      {/* Translated Khmer Text */}
      <View style={styles.transContainer}>
        <TextInput
          style={styles.transInput}
          value={isEditing ? localText : segment.translatedText}
          onChangeText={setLocalText}
          onFocus={() => {
            setIsEditing(true);
            setLocalText(segment.translatedText);
          }}
          onBlur={handleBlur}
          placeholder="Khmer translation will appear here..."
          placeholderTextColor="#64748B"
          multiline
        />

        {/* Play/Stop Audio Button */}
        {segment.audioPath && (
          <TouchableOpacity
            style={[styles.audioBtn, isPlayingAudio && styles.audioBtnPlaying]}
            onPress={() => {
              if (isPlayingAudio) onStopAudio();
              else onPlayAudio(segment.audioPath!);
            }}
          >
            {isPlayingAudio ? (
              <Square size={16} color="#FFFFFF" fill="#FFFFFF" />
            ) : (
              <Play size={16} color="#FFFFFF" fill="#FFFFFF" />
            )}
          </TouchableOpacity>
        )}
      </View>

      {segment.errorMessage && (
        <Text style={styles.errorText}>{segment.errorMessage}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  activeCard: {
    borderColor: '#6366F1',
    backgroundColor: '#1E1B4B',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  idContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  idText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F59E0B',
    marginRight: 8,
  },
  timeText: {
    fontSize: 12,
    color: '#94A3B8',
    textDecorationLine: 'underline',
  },
  tagsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  maleTag: { backgroundColor: '#2563EB' },
  femaleTag: { backgroundColor: '#DB2777' },
  autoTag: { backgroundColor: '#475569' },
  adultTag: { backgroundColor: '#0284C7' },
  oldTag: { backgroundColor: '#D97706' },
  kidTag: { backgroundColor: '#10B981' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  badgeReady: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  badgeTranslated: { backgroundColor: 'rgba(56, 189, 248, 0.15)' },
  badgePending: { backgroundColor: 'rgba(148, 163, 184, 0.15)' },
  badgeError: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  badgeText: { fontSize: 10, fontWeight: '700' },
  origText: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 6,
    fontStyle: 'italic',
  },
  transContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  transInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 14,
    minHeight: 36,
  },
  audioBtn: {
    backgroundColor: '#4F46E5',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  audioBtnPlaying: {
    backgroundColor: '#DC2626',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 11,
    marginTop: 4,
  },
});

export const SegmentCard = React.memo(SegmentCardComponent, (prev, next) => {
  return (
    prev.isActive === next.isActive &&
    prev.isPlayingAudio === next.isPlayingAudio &&
    prev.segment.id === next.segment.id &&
    prev.segment.translatedText === next.segment.translatedText &&
    prev.segment.originalText === next.segment.originalText &&
    prev.segment.gender === next.segment.gender &&
    prev.segment.ageTone === next.segment.ageTone &&
    prev.segment.status === next.segment.status &&
    prev.segment.audioPath === next.segment.audioPath &&
    prev.segment.errorMessage === next.segment.errorMessage
  );
});
