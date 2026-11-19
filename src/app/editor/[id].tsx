import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Share,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Languages,
  Mic,
  Wrench,
  Copy,
  BookOpen,
  Download,
  Share2,
} from 'lucide-react-native';
import { useProjectStore } from '../../store/useProjectStore';
import { Header } from '../../components/common/Header';
import { ProgressBar } from '../../components/common/ProgressBar';
import { SegmentCard } from '../../components/common/SegmentCard';
import { InteractivePreviewPlayer } from '../../components/preview/InteractivePreviewPlayer';
import { RangeRepairModal } from '../../components/modals/RangeRepairModal';
import { BatchCopyPasteModal } from '../../components/modals/BatchCopyPasteModal';
import { GlossaryModal } from '../../components/modals/GlossaryModal';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useVideoSync } from '../../hooks/useVideoSync';
import { Gender, AgeTone } from '../../types/project';

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const {
    activeProject,
    segments,
    glossary,
    settings,
    isTranslating,
    isSynthesizing,
    isExporting,
    progress,
    selectProject,
    updateSegment,
    startTranslation,
    startTtsSynthesis,
    cancelOperation,
    applyPastedBatch,
    repairRangeTranslation,
    repairRangeTts,
    repairRangeManual,
    exportFinalVideo,
    addGlossaryItem,
    removeGlossaryItem,
    getBatchUnits,
  } = useProjectStore();

  const { isPlaying, playingUri, playAudio, stopAudio } = useAudioPlayer();
  const { activeSegment, onPlaybackStatusUpdate } = useVideoSync(segments);

  const [repairModalVisible, setRepairModalVisible] = useState(false);
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [glossaryModalVisible, setGlossaryModalVisible] = useState(false);
  const [seekTimeMs, setSeekTimeMs] = useState<number | null>(null);

  useEffect(() => {
    if (id && (!activeProject || activeProject.id !== id)) {
      selectProject(id);
    }
  }, [id, activeProject, selectProject]);

  if (!activeProject) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading Project Workspace...</Text>
      </SafeAreaView>
    );
  }

  const handleUpdateText = async (segId: number, text: string) => {
    await updateSegment(segId, { translatedText: text, status: 'translated' });
  };

  const handleUpdateTags = async (segId: number, gender: Gender, ageTone: AgeTone) => {
    await updateSegment(segId, { gender, ageTone });
  };

  const handleExport = async () => {
    Alert.alert(
      'Export Final Dubbed Video',
      'Mix Khmer TTS track with video using zero-watermark fast stream copy (-c:v copy -c:a aac)?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Render & Export',
          onPress: async () => {
            const res = await exportFinalVideo();
            if (res.success && res.path) {
              const videoPath = res.path;
              const displayPublic = (res as any).publicPath || 'Movies/3SAJ STUDIO';
              Alert.alert(
                '🎉 Export Complete!',
                `Video rendered with zero watermarks and saved to your phone's Gallery & File Manager:\n\n📁 ${displayPublic}\n\nInternal file:\n${videoPath}`,
                [
                  { text: 'Done', style: 'cancel' },
                  {
                    text: 'Share / Send',
                    onPress: async () => {
                      try {
                        await Share.share({
                          title: '3SAJ Studio Dubbed Video',
                          message: `Khmer dubbed video: ${videoPath}`,
                          url: videoPath,
                        });
                      } catch (e) {
                        console.warn('Share error:', e);
                      }
                    },
                  },
                  {
                    text: 'Open Video',
                    onPress: async () => {
                      try {
                        const canOpen = await Linking.canOpenURL(videoPath);
                        if (canOpen) {
                          await Linking.openURL(videoPath);
                        } else {
                          await Share.share({
                            title: '3SAJ Studio Dubbed Video',
                            message: videoPath,
                            url: videoPath,
                          });
                        }
                      } catch (e) {
                        console.warn('Open error:', e);
                      }
                    },
                  },
                ]
              );
            } else {
              Alert.alert('Export Failed', res.error || 'Unknown rendering error.');
            }
          },
        },
      ]
    );
  };

  const batchUnits = getBatchUnits();
  const maxSegmentId = segments.length > 0 ? segments[segments.length - 1].id : 1;

  const handlePrevSegment = () => {
    if (!segments.length) return;
    const curIdx = activeSegment ? segments.findIndex((s) => s.id === activeSegment.id) : 0;
    const targetIdx = Math.max(0, (curIdx >= 0 ? curIdx : 1) - 1);
    setSeekTimeMs(segments[targetIdx].startTime);
  };

  const handleNextSegment = () => {
    if (!segments.length) return;
    const curIdx = activeSegment ? segments.findIndex((s) => s.id === activeSegment.id) : 0;
    const targetIdx = Math.min(segments.length - 1, (curIdx >= 0 ? curIdx : -1) + 1);
    setSeekTimeMs(segments[targetIdx].startTime);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title={activeProject.name}
        subtitle={`${segments.length} Subtitle Segments`}
        onBack={() => router.back()}
        rightAction={
          <TouchableOpacity
            style={styles.exportHeaderBtn}
            onPress={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Download size={16} color="#FFFFFF" />
                <Text style={styles.exportHeaderText}>Export</Text>
              </>
            )}
          </TouchableOpacity>
        }
      />

      {/* Synchronized Video & Subtitle Preview Player */}
      <View style={styles.playerContainer}>
        <InteractivePreviewPlayer
          videoUri={activeProject.videoPath}
          activeSegment={activeSegment}
          segments={segments}
          seekToTimeMs={seekTimeMs}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          onSeekTo={(pos) => setSeekTimeMs(pos)}
          onPrevSegment={handlePrevSegment}
          onNextSegment={handleNextSegment}
        />
      </View>

      {/* Progress Bar (Visible during Translation or TTS Synthesis) */}
      {(isTranslating || isSynthesizing) && (
        <View style={styles.progressWrapper}>
          <ProgressBar
            completed={progress.completed}
            total={progress.total}
            statusText={progress.statusText}
            onCancel={cancelOperation}
          />
        </View>
      )}

      {/* Floating Action Strip */}
      <View style={styles.actionStrip}>
        <TouchableOpacity
          style={[styles.stripBtn, isTranslating && styles.stripBtnActive]}
          onPress={startTranslation}
          disabled={isTranslating}
        >
          <Languages size={16} color="#38BDF8" />
          <Text style={styles.stripBtnText}>
            {settings.translationMode === 'manual_batch' ? 'AI Translate' : 'Translate'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.stripBtn, isSynthesizing && styles.stripBtnActive]}
          onPress={startTtsSynthesis}
          disabled={isSynthesizing}
        >
          <Mic size={16} color="#10B981" />
          <Text style={styles.stripBtnText}>TTS Dub</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stripBtn}
          onPress={() => setRepairModalVisible(true)}
        >
          <Wrench size={16} color="#F59E0B" />
          <Text style={styles.stripBtnText}>Range Repair</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stripBtn}
          onPress={() => setBatchModalVisible(true)}
        >
          <Copy size={16} color="#A78BFA" />
          <Text style={styles.stripBtnText}>Batch Web</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stripBtn}
          onPress={() => setGlossaryModalVisible(true)}
        >
          <BookOpen size={16} color="#F472B6" />
          <Text style={styles.stripBtnText}>Glossary</Text>
        </TouchableOpacity>
      </View>

      {/* Subtitle Segments List */}
      <FlatList
        data={segments}
        extraData={segments}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={11}
        renderItem={({ item }) => (
          <SegmentCard
            segment={item}
            isActive={activeSegment?.id === item.id}
            isPlayingAudio={isPlaying && playingUri === item.audioPath}
            onPlayAudio={(path) => playAudio(path)}
            onStopAudio={stopAudio}
            onUpdateText={handleUpdateText}
            onUpdateTags={handleUpdateTags}
            onSeekToSegment={(ms) => setSeekTimeMs(ms)}
          />
        )}
      />

      {/* Modals */}
      <RangeRepairModal
        visible={repairModalVisible}
        onClose={() => setRepairModalVisible(false)}
        maxSegmentId={maxSegmentId}
        onReTranslate={repairRangeTranslation}
        onReTts={repairRangeTts}
        onManualEdit={repairRangeManual}
      />

      <BatchCopyPasteModal
        visible={batchModalVisible}
        onClose={() => setBatchModalVisible(false)}
        batchUnits={batchUnits}
        segments={segments}
        glossary={glossary}
        autoVoiceTagging={settings.voiceMode === 'AUTO_DETECT'}
        onApplyBatch={applyPastedBatch}
      />

      <GlossaryModal
        visible={glossaryModalVisible}
        onClose={() => setGlossaryModalVisible(false)}
        glossary={glossary}
        onAddEntry={addGlossaryItem}
        onRemoveEntry={removeGlossaryItem}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 12,
  },
  exportHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  exportHeaderText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  playerContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  progressWrapper: {
    paddingHorizontal: 12,
  },
  actionStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  stripBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  stripBtnActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  stripBtnText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
});
