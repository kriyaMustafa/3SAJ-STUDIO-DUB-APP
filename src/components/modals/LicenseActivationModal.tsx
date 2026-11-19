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
  ScrollView,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ShieldCheck,
  ShieldAlert,
  Key,
  Clipboard as ClipboardIcon,
  CheckCircle2,
  X,
  Zap,
  Crown,
  Award,
  Lock,
  Sparkles,
  PhoneCall,
  Settings,
} from 'lucide-react-native';
import { LicenseData, TIER_CONFIGS } from '../../types/license';
import { activateLicense } from '../../services/licenseService';
import { AdminLicenseGeneratorModal } from './AdminLicenseGeneratorModal';

interface LicenseActivationModalProps {
  visible: boolean;
  canClose?: boolean;
  onClose?: () => void;
  onActivated: (license: LicenseData) => void;
  title?: string;
  subtitle?: string;
}

export const LicenseActivationModal: React.FC<LicenseActivationModalProps> = ({
  visible,
  canClose = false,
  onClose,
  onActivated,
  title = 'License Activation Required',
  subtitle = 'Please activate your license key to unlock 3SAJ Studio',
}) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [adminModalVisible, setAdminModalVisible] = useState(false);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        setLicenseKey(text.trim());
        setErrorMessage(null);
      }
    } catch (_) {}
  };

  const handleActivate = async () => {
    const cleanKey = licenseKey.trim().toUpperCase();
    if (!cleanKey) {
      setErrorMessage('Please enter or paste your license key.');
      return;
    }

    setIsActivating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await activateLicense(cleanKey);
      setIsActivating(false);

      if (res.success && res.license) {
        setSuccessMessage(res.message);
        setTimeout(() => {
          onActivated(res.license!);
          setLicenseKey('');
          setSuccessMessage(null);
          onClose?.();
        }, 1200);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setIsActivating(false);
      setErrorMessage(err.message || 'Activation failed. Please check key format.');
    }
  };

  const handleContactAdmin = () => {
    Alert.alert(
      'Get License Key',
      'Contact 3SAJ Studio administrator to purchase or renew your license key:\n\n' +
      '• Telegram: @sajstudio\n' +
      '• Available Plans: Flash (1h/d), Pro (3h/d), Premium (6h/d)\n' +
      '• Durations: 1 Week, 1 Month, 2 Months, 3 Months',
      [{ text: 'OK' }]
    );
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (canClose) onClose?.();
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTitleRow}>
                <View style={styles.iconCircle}>
                  <Lock size={22} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerTitle}>{title}</Text>
                  <Text style={styles.headerSubtitle}>{subtitle}</Text>
                </View>
              </View>
              {canClose && (
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <X size={20} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {/* Khmer Instructions Notice */}
              <View style={styles.khmerNotice}>
                <Text style={styles.khmerNoticeTitle}>សេចក្តីជូនដំណឹងអំពីអាជ្ញាប័ណ្ណ (License Info)</Text>
                <Text style={styles.khmerNoticeText}>
                  ដើម្បីប្រើប្រាស់កម្មវិធី 3SAJ Studio សូមបញ្ចូលលេខកូដអាជ្ញាប័ណ្ណ (License Key) ដែលទទួលបានពីរដ្ឋបាល។
                </Text>
              </View>

              {/* Plans Comparison */}
              <Text style={styles.sectionHeader}>Available Plans (Daily Translation Quota):</Text>
              <View style={styles.plansContainer}>
                {/* Flash */}
                <View style={[styles.planCard, { borderColor: '#F59E0B' }]}>
                  <View style={styles.planHeader}>
                    <Zap size={16} color="#F59E0B" />
                    <Text style={[styles.planName, { color: '#F59E0B' }]}>FLASH</Text>
                  </View>
                  <Text style={styles.planQuota}>1 Hour / Day</Text>
                  <Text style={styles.planDurations}>1w • 1m • 2m • 3m</Text>
                </View>

                {/* Pro */}
                <View style={[styles.planCard, { borderColor: '#38BDF8' }]}>
                  <View style={styles.planHeader}>
                    <Award size={16} color="#38BDF8" />
                    <Text style={[styles.planName, { color: '#38BDF8' }]}>PRO</Text>
                  </View>
                  <Text style={styles.planQuota}>3 Hours / Day</Text>
                  <Text style={styles.planDurations}>1w • 1m • 2m • 3m</Text>
                </View>

                {/* Premium */}
                <View style={[styles.planCard, { borderColor: '#A855F7' }]}>
                  <View style={styles.planHeader}>
                    <Crown size={16} color="#A855F7" />
                    <Text style={[styles.planName, { color: '#A855F7' }]}>PREMIUM</Text>
                  </View>
                  <Text style={styles.planQuota}>6 Hours / Day</Text>
                  <Text style={styles.planDurations}>1w • 1m • 2m • 3m</Text>
                </View>
              </View>

              {/* Key Input Field */}
              <Text style={styles.inputLabel}>Enter or Paste License Key:</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={licenseKey}
                  onChangeText={(val) => {
                    setLicenseKey(val);
                    setErrorMessage(null);
                  }}
                  placeholder="3SAJ-PRO-30D-XXXXX-XXXXXXXX"
                  placeholderTextColor="#64748B"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!isActivating}
                />
                <TouchableOpacity
                  style={styles.pasteBtn}
                  onPress={handlePaste}
                  disabled={isActivating}
                >
                  <ClipboardIcon size={16} color="#6366F1" />
                  <Text style={styles.pasteBtnText}>Paste</Text>
                </TouchableOpacity>
              </View>

              {/* Feedback messages */}
              {errorMessage && (
                <View style={styles.errorBox}>
                  <ShieldAlert size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              {successMessage && (
                <View style={styles.successBox}>
                  <CheckCircle2 size={14} color="#10B981" />
                  <Text style={styles.successText}>{successMessage}</Text>
                </View>
              )}

              {/* Activate Button */}
              <TouchableOpacity
                style={[styles.activateBtn, (!licenseKey.trim() || isActivating) && styles.activateBtnDisabled]}
                onPress={handleActivate}
                disabled={!licenseKey.trim() || isActivating}
              >
                {isActivating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Key size={18} color="#FFFFFF" />
                    <Text style={styles.activateBtnText}>Activate License Key</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Footer Actions: Contact Admin & Secret Admin Generator */}
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.contactBtn} onPress={handleContactAdmin}>
                  <PhoneCall size={14} color="#38BDF8" />
                  <Text style={styles.contactBtnText}>Contact Admin for Key</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.adminKeyBtn}
                  onPress={() => setAdminModalVisible(true)}
                >
                  <Sparkles size={14} color="#F59E0B" />
                  <Text style={styles.adminKeyBtnText}>Admin Tool</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Admin Generator Modal */}
      <AdminLicenseGeneratorModal
        visible={adminModalVisible}
        onClose={() => setAdminModalVisible(false)}
        onKeyGenerated={(key) => {
          setLicenseKey(key);
          setAdminModalVisible(false);
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  container: {
    backgroundColor: '#0F172A',
    width: '100%',
    maxWidth: 500,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  khmerNotice: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8',
  },
  khmerNoticeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
    marginBottom: 2,
  },
  khmerNoticeText: {
    fontSize: 11,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#CBD5E1',
    marginBottom: 8,
  },
  plansContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  planCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  planName: {
    fontSize: 12,
    fontWeight: '800',
  },
  planQuota: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
  },
  planDurations: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    height: 46,
    color: '#F8FAFC',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderRadius: 8,
    marginLeft: 8,
    gap: 4,
  },
  pasteBtnText: {
    fontSize: 11,
    color: '#818CF8',
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    flex: 1,
    color: '#F87171',
    fontSize: 11,
    lineHeight: 16,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  successText: {
    flex: 1,
    color: '#34D399',
    fontSize: 11,
    lineHeight: 16,
  },
  activateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 4,
  },
  activateBtnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.6,
  },
  activateBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  contactBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  adminKeyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 6,
  },
  adminKeyBtnText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
});
