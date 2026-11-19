import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Link2,
  DownloadCloud,
  Clipboard as ClipboardIcon,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react-native';
import { ImportProgress } from '../../services/urlImporterService';
import { useProjectStore } from '../../store/useProjectStore';

interface ImportFromUrlModalProps {
  visible: boolean;
  onClose: () => void;
  onImport: (url: string, onProgress: (p: ImportProgress) => void) => Promise<string>;
  onSuccess: (projectId: string) => void;
}

export const ImportFromUrlModal: React.FC<ImportFromUrlModalProps> = ({
  visible,
  onClose,
  onImport,
  onSuccess,
}) => {
  const backendApiUrl = useProjectStore((s) => s.settings.backendApiUrl);
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        setUrl(text.trim());
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  const handleSubmit = async () => {
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      Alert.alert('Missing URL', 'Please paste or enter a video URL to import.');
      return;
    }

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      Alert.alert('Invalid URL', 'URL must begin with http:// or https://');
      return;
    }

    setIsLoading(true);
    setProgress({
      stage: 'extracting',
      progress: 0.05,
      statusText: 'Connecting to extraction service...',
    });

    try {
      const projectId = await onImport(cleanUrl, (p) => {
        setProgress(p);
      });

      setIsLoading(false);
      setUrl('');
      setProgress(null);
      onClose();
      onSuccess(projectId);
    } catch (err: any) {
      setIsLoading(false);
      setProgress(null);
      Alert.alert('Import Failed', err.message || 'Could not download or import video.');
    }
  };

  const handleClose = () => {
    if (isLoading) {
      Alert.alert(
        'Download in Progress',
        'Downloading and importing is currently active. Are you sure you want to dismiss?',
        [
          { text: 'Wait', style: 'cancel' },
          {
            text: 'Dismiss',
            style: 'destructive',
            onPress: () => {
              setIsLoading(false);
              setProgress(null);
              onClose();
            },
          },
        ]
      );
      return;
    }
    setUrl('');
    setProgress(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.titleRow}>
              <View style={styles.iconCircle}>
                <Link2 size={20} color="#6366F1" />
              </View>
              <View>
                <Text style={styles.modalTitle}>Import from Video URL</Text>
                <Text style={styles.modalSubtitle}>Auto-Download & Dub Video</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} disabled={isLoading} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Supported Platforms Chips */}
          <View style={styles.platformsRow}>
            {['YouTube', 'Bilibili', 'TikTok', 'Direct MP4'].map((name) => (
              <View key={name} style={styles.platformBadge}>
                <Text style={styles.platformText}>{name}</Text>
              </View>
            ))}
          </View>

          {/* URL Input Box with Paste Button */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.urlInput}
              value={url}
              onChangeText={setUrl}
              placeholder="Paste video link here (https://...)"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              selectTextOnFocus
            />
            <TouchableOpacity
              style={styles.pasteBtn}
              onPress={handlePaste}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <ClipboardIcon size={16} color="#6366F1" />
              <Text style={styles.pasteBtnText}>Paste</Text>
            </TouchableOpacity>
          </View>

          {/* Active Backend Endpoint Indicator */}
          <View style={styles.backendNotice}>
            <Text style={styles.backendNoticeText}>
              Backend API:{' '}
              <Text
                style={{
                  color: backendApiUrl?.includes('192.168.1.X') ? '#F59E0B' : '#38BDF8',
                  fontWeight: '600',
                }}
              >
                {backendApiUrl || 'http://192.168.1.X:8000'}
              </Text>
              {backendApiUrl?.includes('192.168.1.X') ? ' ⚠️ (Set PC IP in Settings)' : ''}
            </Text>
          </View>

          {/* Download & Progress States */}
          {isLoading && progress && (
            <View style={styles.progressContainer}>
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#6366F1" style={{ marginRight: 8 }} />
                <Text style={styles.statusText} numberOfLines={2}>
                  {progress.statusText}
                </Text>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(Math.max(progress.progress * 100, 5), 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.percentageText}>
                {Math.round(progress.progress * 100)}%
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={handleClose}
              disabled={isLoading}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!url.trim() || isLoading) && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!url.trim() || isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Sparkles size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.submitBtnText}>Download & Auto-Translate</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  modalContent: {
    backgroundColor: '#0F172A',
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  platformsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  platformBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  platformText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  urlInput: {
    flex: 1,
    height: 48,
    color: '#F8FAFC',
    fontSize: 14,
  },
  backendNotice: {
    marginTop: -10,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  backendNoticeText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderRadius: 8,
    marginLeft: 8,
  },
  pasteBtnText: {
    fontSize: 12,
    color: '#818CF8',
    fontWeight: '600',
    marginLeft: 4,
  },
  progressContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#475569',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    color: '#38BDF8',
    fontWeight: '500',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 4,
  },
  percentageText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'right',
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#6366F1',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
