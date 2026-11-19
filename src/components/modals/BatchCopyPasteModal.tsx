import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, ClipboardPaste, X, Check, CheckCircle2 } from 'lucide-react-native';
import { SubtitleSegment, GlossaryEntry, BatchCopyPasteUnit } from '../../types/project';
import { generateBatchPrompt } from '../../services/translation/batchCopyPaste';

interface BatchCopyPasteModalProps {
  visible: boolean;
  onClose: () => void;
  batchUnits: BatchCopyPasteUnit[];
  segments: SubtitleSegment[];
  glossary: GlossaryEntry[];
  autoVoiceTagging: boolean;
  onApplyBatch: (
    pastedText: string,
    fromId: number,
    toId: number
  ) => Promise<{ success: boolean; error?: string }>;
}

export const BatchCopyPasteModal: React.FC<BatchCopyPasteModalProps> = ({
  visible,
  onClose,
  batchUnits,
  segments,
  glossary,
  autoVoiceTagging,
  onApplyBatch,
}) => {
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(1);
  const [pastedText, setPastedText] = useState('');
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const currentUnit = batchUnits.find((b) => b.batchIndex === selectedBatchIndex) || batchUnits[0];

  const handleCopyPrompt = async () => {
    if (!currentUnit) return;

    const slice = segments.filter(
      (s) => s.id >= currentUnit.fromId && s.id <= currentUnit.toId
    );

    const prompt = generateBatchPrompt(slice, glossary, autoVoiceTagging);
    await Clipboard.setStringAsync(prompt);

    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2500);
  };

  const handlePasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setPastedText(text);
    }
  };

  const handleApply = async () => {
    if (!currentUnit || !pastedText.trim()) {
      Alert.alert('Empty Input', 'Please paste the AI translated response first.');
      return;
    }

    setIsApplying(true);
    const result = await onApplyBatch(
      pastedText,
      currentUnit.fromId,
      currentUnit.toId
    );
    setIsApplying(false);

    if (result.success) {
      Alert.alert(
        'Success',
        `Batch ${currentUnit.batchIndex} (IDs ${currentUnit.fromId}-${currentUnit.toId}) applied successfully!`
      );
      setPastedText('');
      // Automatically advance to next batch if available
      if (selectedBatchIndex < batchUnits.length) {
        setSelectedBatchIndex(selectedBatchIndex + 1);
      }
    } else {
      Alert.alert('Validation Error', result.error || 'Failed to parse batch.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Manual Batch Copy-Paste</Text>
              <Text style={styles.subtitle}>
                Translate for free via ChatGPT / Claude web chat
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Batch Selector Pills */}
          <Text style={styles.sectionLabel}>Select Batch:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.batchScroll}
            contentContainerStyle={styles.batchScrollContent}
          >
            {batchUnits.map((u) => {
              const isSelected = u.batchIndex === selectedBatchIndex;
              return (
                <TouchableOpacity
                  key={u.batchIndex}
                  style={[
                    styles.batchPill,
                    isSelected && styles.batchPillActive,
                    u.isCompleted && styles.batchPillCompleted,
                  ]}
                  onPress={() => setSelectedBatchIndex(u.batchIndex)}
                >
                  <Text
                    style={[
                      styles.batchPillText,
                      isSelected && styles.batchPillTextActive,
                    ]}
                  >
                    Batch {u.batchIndex} ({u.fromId}-{u.toId})
                  </Text>
                  {u.isCompleted && (
                    <CheckCircle2 size={12} color="#10B981" style={{ marginLeft: 4 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Action Step 1: Copy Pre-Engineered Prompt */}
          <View style={styles.stepBox}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>Step 1</Text>
              <Text style={styles.stepTitle}>
                Copy Prompt for IDs {currentUnit?.fromId} to {currentUnit?.toId}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.copyBtn, copiedSuccess && styles.copyBtnSuccess]}
              onPress={handleCopyPrompt}
            >
              {copiedSuccess ? (
                <>
                  <Check size={18} color="#FFFFFF" />
                  <Text style={styles.btnText}>Copied to Clipboard!</Text>
                </>
              ) : (
                <>
                  <Copy size={18} color="#FFFFFF" />
                  <Text style={styles.btnText}>Copy Engineered Prompt</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Action Step 2: Paste Response */}
          <View style={styles.stepBox}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>Step 2</Text>
              <Text style={styles.stepTitle}>Paste AI's Translated Output</Text>
              <TouchableOpacity
                onPress={handlePasteFromClipboard}
                style={styles.pasteClipboardBtn}
              >
                <ClipboardPaste size={14} color="#6366F1" />
                <Text style={styles.pasteClipboardText}>Paste</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.textArea}
              value={pastedText}
              onChangeText={setPastedText}
              placeholder="Paste lines here, e.g. [1][M][ADULT] សួស្តី..."
              placeholderTextColor="#64748B"
              multiline
            />
          </View>

          {/* Action Step 3: Apply */}
          <TouchableOpacity
            style={[styles.applyBtn, isApplying && styles.applyBtnDisabled]}
            onPress={handleApply}
            disabled={isApplying}
          >
            <Text style={styles.applyBtnText}>
              {isApplying
                ? 'Validating & Applying...'
                : `Apply to Batch ${currentUnit?.batchIndex} (IDs ${currentUnit?.fromId}-${currentUnit?.toId})`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  sectionLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  batchScroll: {
    maxHeight: 44,
    marginBottom: 14,
  },
  batchScrollContent: {
    gap: 8,
  },
  batchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  batchPillActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#818CF8',
  },
  batchPillCompleted: {
    borderColor: '#10B981',
  },
  batchPillText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  batchPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  stepBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  stepNumber: {
    backgroundColor: '#3B82F6',
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stepTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  pasteClipboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderRadius: 6,
  },
  pasteClipboardText: {
    color: '#818CF8',
    fontSize: 11,
    fontWeight: '700',
  },
  copyBtn: {
    backgroundColor: '#6366F1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  copyBtnSuccess: {
    backgroundColor: '#10B981',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  textArea: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    color: '#F8FAFC',
    fontSize: 13,
    minHeight: 80,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#334155',
  },
  applyBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyBtnDisabled: {
    opacity: 0.6,
  },
  applyBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
