import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ShieldAlert,
  Key,
  Copy,
  CheckCircle2,
  X,
  Sparkles,
  Zap,
  Crown,
  Award,
} from 'lucide-react-native';
import { LicenseTier, LicenseDuration, TIER_CONFIGS, DURATION_DAYS_MAP } from '../../types/license';
import { generateLicenseKey, ADMIN_MASTER_PIN } from '../../services/licenseService';

interface AdminLicenseGeneratorModalProps {
  visible: boolean;
  onClose: () => void;
  onKeyGenerated?: (key: string) => void;
}

export const AdminLicenseGeneratorModal: React.FC<AdminLicenseGeneratorModalProps> = ({
  visible,
  onClose,
  onKeyGenerated,
}) => {
  const [pin, setPin] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedTier, setSelectedTier] = useState<LicenseTier>('PRO');
  const [selectedDuration, setSelectedDuration] = useState<LicenseDuration>('1_MONTH');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleVerifyPin = () => {
    if (pin.trim() === ADMIN_MASTER_PIN) {
      setIsAuthenticated(true);
      setPin('');
    } else {
      Alert.alert('Access Denied', 'Incorrect Admin Master PIN.');
    }
  };

  const handleGenerate = () => {
    const days = DURATION_DAYS_MAP[selectedDuration];
    const key = generateLicenseKey(selectedTier, days);
    setGeneratedKey(key);
    setCopied(false);
    onKeyGenerated?.(key);
  };

  const handleCopyKey = async () => {
    if (!generatedKey) return;
    await Clipboard.setStringAsync(generatedKey);
    setCopied(true);
    Alert.alert('Copied', 'License Key copied to clipboard.');
    setTimeout(() => setCopied(false), 3000);
  };

  const handleCopyCustomerMessage = async () => {
    if (!generatedKey) return;
    const tierConfig = TIER_CONFIGS[selectedTier];
    const days = DURATION_DAYS_MAP[selectedDuration];
    const message = `🎉 3SAJ Studio License Key Activated!\n` +
      `• Plan: ${tierConfig.displayName} Plan (${tierConfig.description})\n` +
      `• Duration: ${days} Days\n` +
      `• License Key: ${generatedKey}\n\n` +
      `Instructions:\n` +
      `1. Open 3SAJ Studio app on your phone\n` +
      `2. Paste the License Key into the Activation screen\n` +
      `3. Enjoy automatic AI translation and voice dubbing!`;

    await Clipboard.setStringAsync(message);
    Alert.alert('Copied Message', 'Full customer message formatted and copied to clipboard.');
  };

  const handleClose = () => {
    setIsAuthenticated(false);
    setPin('');
    setGeneratedKey(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <ShieldAlert size={20} color="#F59E0B" />
              </View>
              <View>
                <Text style={styles.title}>Admin Key Generator</Text>
                <Text style={styles.subtitle}>Generate Authentic License Keys</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {!isAuthenticated ? (
            /* PIN Protection Screen */
            <View style={styles.pinContainer}>
              <Text style={styles.pinLabel}>Enter Admin Master PIN:</Text>
              <TextInput
                style={styles.pinInput}
                value={pin}
                onChangeText={setPin}
                secureTextEntry
                placeholder="Enter PIN (Default: 3saj9999)"
                placeholderTextColor="#64748B"
                keyboardType="default"
              />
              <TouchableOpacity style={styles.actionBtn} onPress={handleVerifyPin}>
                <Key size={16} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>Unlock Generator</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Generator Controls */
            <ScrollView contentContainerStyle={styles.generatorScroll}>
              {/* Select Tier */}
              <Text style={styles.sectionLabel}>Select License Tier (Daily Limit):</Text>
              <View style={styles.optionsRow}>
                {(['FLASH', 'PRO', 'PREMIUM'] as LicenseTier[]).map((tier) => {
                  const cfg = TIER_CONFIGS[tier];
                  const isActive = selectedTier === tier;
                  return (
                    <TouchableOpacity
                      key={tier}
                      style={[styles.tierCard, isActive && styles.tierCardActive]}
                      onPress={() => setSelectedTier(tier)}
                    >
                      {tier === 'FLASH' && <Zap size={16} color={isActive ? '#F59E0B' : '#94A3B8'} />}
                      {tier === 'PRO' && <Award size={16} color={isActive ? '#38BDF8' : '#94A3B8'} />}
                      {tier === 'PREMIUM' && <Crown size={16} color={isActive ? '#A855F7' : '#94A3B8'} />}
                      <Text style={[styles.tierTitle, isActive && { color: cfg.badgeColor }]}>
                        {cfg.displayName}
                      </Text>
                      <Text style={styles.tierSub}>{cfg.dailyLimitHours}h/day</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Select Duration */}
              <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Select Duration:</Text>
              <View style={styles.durationsGrid}>
                {[
                  { id: '1_WEEK', label: '1 Week (7 Days)' },
                  { id: '1_MONTH', label: '1 Month (30 Days)' },
                  { id: '2_MONTHS', label: '2 Months (60 Days)' },
                  { id: '3_MONTHS', label: '3 Months (90 Days)' },
                ].map((dur) => {
                  const isActive = selectedDuration === dur.id;
                  return (
                    <TouchableOpacity
                      key={dur.id}
                      style={[styles.durationPill, isActive && styles.durationPillActive]}
                      onPress={() => setSelectedDuration(dur.id as LicenseDuration)}
                    >
                      <Text style={[styles.durationText, isActive && styles.durationTextActive]}>
                        {dur.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Generate Button */}
              <TouchableOpacity style={styles.generateBtn} onPress={handleGenerate}>
                <Sparkles size={18} color="#FFFFFF" />
                <Text style={styles.generateBtnText}>Generate Cryptographic Key</Text>
              </TouchableOpacity>

              {/* Display Generated Key */}
              {generatedKey && (
                <View style={styles.resultBox}>
                  <Text style={styles.resultLabel}>Generated License Key:</Text>
                  <View style={styles.keyDisplayRow}>
                    <Text style={styles.keyText} selectable>
                      {generatedKey}
                    </Text>
                  </View>

                  <View style={styles.keyActionsRow}>
                    <TouchableOpacity style={styles.copyBtn} onPress={handleCopyKey}>
                      <Copy size={14} color="#38BDF8" />
                      <Text style={styles.copyBtnText}>{copied ? 'Copied!' : 'Copy Key'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.copyMsgBtn} onPress={handleCopyCustomerMessage}>
                      <CheckCircle2 size={14} color="#10B981" />
                      <Text style={styles.copyMsgBtnText}>Copy Client Message</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  modalContent: {
    backgroundColor: '#0F172A',
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 11,
    color: '#94A3B8',
  },
  closeBtn: {
    padding: 6,
  },
  pinContainer: {
    paddingVertical: 12,
  },
  pinLabel: {
    fontSize: 13,
    color: '#CBD5E1',
    fontWeight: '600',
    marginBottom: 8,
  },
  pinInput: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  generatorScroll: {
    paddingBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '700',
    marginBottom: 8,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tierCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tierCardActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  tierTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 4,
  },
  tierSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  durationsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationPill: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1E293B',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  durationPillActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#818CF8',
  },
  durationText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  durationTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 16,
  },
  generateBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  resultBox: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#475569',
  },
  resultLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 6,
    fontWeight: '600',
  },
  keyDisplayRow: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  keyText: {
    fontSize: 13,
    color: '#38BDF8',
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  keyActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  copyBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  copyMsgBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  copyMsgBtnText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
});
