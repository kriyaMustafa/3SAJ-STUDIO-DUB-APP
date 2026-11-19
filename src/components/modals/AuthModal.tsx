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
import {
  X,
  LogIn,
  UserPlus,
  Mail,
  Lock,
  User,
  Smartphone,
  Trash2,
  AlertTriangle,
} from 'lucide-react-native';
import { authService, UserProfile, DeviceInfo } from '../../services/api/authService';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  onAuthSuccess: (user: UserProfile) => void;
  initialTab?: 'LOGIN' | 'REGISTER';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  visible,
  onClose,
  onAuthSuccess,
  initialTab = 'LOGIN',
}) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>(initialTab);

  React.useEffect(() => {
    if (visible && initialTab) {
      setTab(initialTab);
    }
  }, [visible, initialTab]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Device limit handling
  const [deviceLimitExceeded, setDeviceLimitExceeded] = useState(false);
  const [activeDevices, setActiveDevices] = useState<DeviceInfo[]>([]);

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      setDeviceLimitExceeded(false);

      if (tab === 'REGISTER') {
        const res = await authService.register(email.trim(), password.trim(), fullName.trim());
        onAuthSuccess(res.user);
        onClose();
      } else {
        const res = await authService.login(email.trim(), password.trim());
        onAuthSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      if (err.code === 'DEVICE_LIMIT_EXCEEDED') {
        setDeviceLimitExceeded(true);
        setActiveDevices(err.active_devices || []);
        setErrorMsg('Maximum 2 devices reached. Disconnect one of your devices below to sign in on this phone:');
      } else {
        setErrorMsg(err.message || 'Authentication failed. Please check credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      setLoading(true);
      const success = await authService.revokeDevice(deviceId);
      if (success) {
        Alert.alert('Device Disconnected', 'You can now sign in on this phone.');
        setDeviceLimitExceeded(false);
        setActiveDevices([]);
        // Retry login
        await handleAuth();
      } else {
        Alert.alert('Error', 'Failed to disconnect device.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not disconnect device.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {tab === 'LOGIN' ? 'Sign In to 3SAJ Studio' : 'Create 3SAJ Account'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'LOGIN' && styles.activeTabBtn]}
              onPress={() => {
                setTab('LOGIN');
                setErrorMsg(null);
                setDeviceLimitExceeded(false);
              }}
            >
              <LogIn size={15} color={tab === 'LOGIN' ? '#38BDF8' : '#94A3B8'} style={{ marginRight: 6 }} />
              <Text style={[styles.tabText, tab === 'LOGIN' && styles.activeTabText]}>Sign In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, tab === 'REGISTER' && styles.activeTabBtn]}
              onPress={() => {
                setTab('REGISTER');
                setErrorMsg(null);
                setDeviceLimitExceeded(false);
              }}
            >
              <UserPlus size={15} color={tab === 'REGISTER' ? '#38BDF8' : '#94A3B8'} style={{ marginRight: 6 }} />
              <Text style={[styles.tabText, tab === 'REGISTER' && styles.activeTabText]}>Register</Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {tab === 'REGISTER' && (
              <View style={styles.inputRow}>
                <User size={18} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Full Name (Optional)"
                  placeholderTextColor="#64748B"
                  value={fullName}
                  onChangeText={setFullName}
                />
              </View>
            )}

            <View style={styles.inputRow}>
              <Mail size={18} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email Address"
                placeholderTextColor="#64748B"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputRow}>
              <Lock size={18} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password (min. 6 chars)"
                placeholderTextColor="#64748B"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            {errorMsg && (
              <View style={styles.errorContainer}>
                <AlertTriangle size={16} color="#F87171" style={{ marginRight: 6 }} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            {/* Device Limit Exceeded: List Active Devices */}
            {deviceLimitExceeded && activeDevices.length > 0 && (
              <View style={styles.devicesList}>
                {activeDevices.map((d) => (
                  <View key={d.device_id} style={styles.deviceItem}>
                    <Smartphone size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deviceName}>{d.device_name || 'Device'}</Text>
                      <Text style={styles.devicePlatform}>{d.platform?.toUpperCase()}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.disconnectBtn}
                      onPress={() => handleRevokeDevice(d.device_id)}
                    >
                      <Trash2 size={14} color="#EF4444" style={{ marginRight: 4 }} />
                      <Text style={styles.disconnectBtnText}>Disconnect</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.submitBtn} onPress={handleAuth} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {tab === 'LOGIN' ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  closeBtn: {
    padding: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  activeTabBtn: {
    backgroundColor: '#0F172A',
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  form: {
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#F8FAFC',
    paddingVertical: 12,
    fontSize: 14,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    color: '#F87171',
    fontSize: 12,
    flex: 1,
  },
  devicesList: {
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  deviceName: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  devicePlatform: {
    color: '#64748B',
    fontSize: 10,
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  disconnectBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  submitBtn: {
    backgroundColor: '#005F73',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
