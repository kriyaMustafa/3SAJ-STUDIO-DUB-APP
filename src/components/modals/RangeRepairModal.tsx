import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Wrench, X, RefreshCw, Mic, Edit3 } from 'lucide-react-native';
import { Gender, AgeTone } from '../../types/project';

interface RangeRepairModalProps {
  visible: boolean;
  onClose: () => void;
  maxSegmentId: number;
  onReTranslate: (fromId: number, toId: number) => Promise<void>;
  onReTts: (
    fromId: number,
    toId: number,
    overrideGender?: Gender,
    overrideTone?: AgeTone
  ) => Promise<void>;
  onManualEdit: (fromId: number, toId: number, text: string) => Promise<void>;
}

export const RangeRepairModal: React.FC<RangeRepairModalProps> = ({
  visible,
  onClose,
  maxSegmentId,
  onReTranslate,
  onReTts,
  onManualEdit,
}) => {
  const [fromId, setFromId] = useState('1');
  const [toId, setToId] = useState(String(Math.min(10, maxSegmentId)));
  const [selectedAction, setSelectedAction] = useState<
    'retranslate' | 're_tts' | 'manual'
  >('re_tts');
  const [overrideGender, setOverrideGender] = useState<Gender | 'NONE'>('NONE');
  const [overrideTone, setOverrideTone] = useState<AgeTone | 'NONE'>('NONE');
  const [manualText, setManualText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleExecute = async () => {
    const from = parseInt(fromId, 10);
    const to = parseInt(toId, 10);

    if (isNaN(from) || isNaN(to) || from > to) {
      alert('Invalid ID range. Please ensure From ID is less than or equal to To ID.');
      return;
    }

    setIsProcessing(true);
    try {
      if (selectedAction === 'retranslate') {
        await onReTranslate(from, to);
      } else if (selectedAction === 're_tts') {
        await onReTts(
          from,
          to,
          overrideGender === 'NONE' ? undefined : overrideGender,
          overrideTone === 'NONE' ? undefined : overrideTone
        );
      } else if (selectedAction === 'manual') {
        await onManualEdit(from, to, manualText);
      }
      onClose();
    } catch (err: any) {
      alert(`Repair error: ${err.message}`);
    } finally {
      setIsProcessing(false);
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
            <View style={styles.headerTitleRow}>
              <Wrench size={20} color="#F59E0B" />
              <Text style={styles.headerTitle}>Targeted Range Repair</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* ID Range Selection */}
          <View style={styles.rangeRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>From ID</Text>
              <TextInput
                style={styles.input}
                value={fromId}
                onChangeText={setFromId}
                keyboardType="numeric"
                placeholder="1"
                placeholderTextColor="#64748B"
              />
            </View>
            <Text style={styles.toArrow}>➔</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>To ID</Text>
              <TextInput
                style={styles.input}
                value={toId}
                onChangeText={setToId}
                keyboardType="numeric"
                placeholder={String(maxSegmentId)}
                placeholderTextColor="#64748B"
              />
            </View>
          </View>

          {/* Action Tabs */}
          <View style={styles.actionTabs}>
            <TouchableOpacity
              style={[
                styles.tabBtn,
                selectedAction === 're_tts' && styles.tabBtnActive,
              ]}
              onPress={() => setSelectedAction('re_tts')}
            >
              <Mic size={16} color={selectedAction === 're_tts' ? '#FFFFFF' : '#94A3B8'} />
              <Text
                style={[
                  styles.tabText,
                  selectedAction === 're_tts' && styles.tabTextActive,
                ]}
              >
                Re-TTS
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabBtn,
                selectedAction === 'retranslate' && styles.tabBtnActive,
              ]}
              onPress={() => setSelectedAction('retranslate')}
            >
              <RefreshCw
                size={16}
                color={selectedAction === 'retranslate' ? '#FFFFFF' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.tabText,
                  selectedAction === 'retranslate' && styles.tabTextActive,
                ]}
              >
                Re-Translate
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabBtn,
                selectedAction === 'manual' && styles.tabBtnActive,
              ]}
              onPress={() => setSelectedAction('manual')}
            >
              <Edit3
                size={16}
                color={selectedAction === 'manual' ? '#FFFFFF' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.tabText,
                  selectedAction === 'manual' && styles.tabTextActive,
                ]}
              >
                Manual Edit
              </Text>
            </TouchableOpacity>
          </View>

          {/* Conditional Options for Re-TTS */}
          {selectedAction === 're_tts' && (
            <View style={styles.optionsBox}>
              <Text style={styles.optionSectionTitle}>Voice & Tone Overrides (Optional):</Text>

              <View style={styles.optionRow}>
                <Text style={styles.optionLabel}>Voice Gender:</Text>
                <View style={styles.chipsRow}>
                  {(['NONE', 'M', 'F'] as const).map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.chip,
                        overrideGender === g && styles.chipActive,
                      ]}
                      onPress={() => setOverrideGender(g)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          overrideGender === g && styles.chipTextActive,
                        ]}
                      >
                        {g === 'NONE' ? 'Keep Current' : g === 'M' ? 'Male (Piseth)' : 'Female (Sreymom)'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.optionRow}>
                <Text style={styles.optionLabel}>Tone Preset:</Text>
                <View style={styles.chipsRow}>
                  {(['NONE', 'ADULT', 'OLD', 'KID'] as const).map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.chip,
                        overrideTone === t && styles.chipActive,
                      ]}
                      onPress={() => setOverrideTone(t)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          overrideTone === t && styles.chipTextActive,
                        ]}
                      >
                        {t === 'NONE'
                          ? 'Keep'
                          : t === 'OLD'
                          ? 'Old (-18Hz)'
                          : t === 'KID'
                          ? 'Kid (+30Hz)'
                          : 'Adult'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* Conditional Input for Manual Edit */}
          {selectedAction === 'manual' && (
            <View style={styles.optionsBox}>
              <Text style={styles.optionSectionTitle}>New Khmer Subtitle Text:</Text>
              <TextInput
                style={styles.manualInput}
                value={manualText}
                onChangeText={setManualText}
                placeholder="Enter new Khmer text for this ID range..."
                placeholderTextColor="#64748B"
                multiline
              />
            </View>
          )}

          {/* Execute Button */}
          <TouchableOpacity
            style={[styles.executeBtn, isProcessing && styles.executeBtnDisabled]}
            onPress={handleExecute}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.executeText}>
                Apply to Segments {fromId} - {toId}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  toArrow: {
    color: '#64748B',
    fontSize: 18,
    marginHorizontal: 12,
    marginTop: 16,
  },
  actionTabs: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: '#4F46E5',
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  optionsBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  optionSectionTitle: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  optionRow: {
    marginBottom: 10,
  },
  optionLabel: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  chipActive: {
    backgroundColor: '#6366F1',
    borderColor: '#818CF8',
  },
  chipText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  manualInput: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#334155',
  },
  executeBtn: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  executeBtnDisabled: {
    opacity: 0.6,
  },
  executeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
