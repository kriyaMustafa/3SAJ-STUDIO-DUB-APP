import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  X,
  ShieldCheck,
  Zap,
  Smartphone,
  Trash2,
  AlertTriangle,
} from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { authService, UserProfile, DeviceInfo } from '../../services/api/authService';

const GOOGLE_WEB_CLIENT_ID = '76120676265-nh7sstgffij29s3qukarj5eil28rbfj0.apps.googleusercontent.com';

// Configure Google Sign-In once
GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  offlineAccess: false,
});

// Authentic 4-color Google 'G' SVG Logo
const GoogleLogo = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    <Path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <Path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <Path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <Path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </Svg>
);

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
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Device limit handling (max 2 active phones)
  const [deviceLimitExceeded, setDeviceLimitExceeded] = useState(false);
  const [activeDevices, setActiveDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    if (visible) {
      setErrorMsg(null);
      setDeviceLimitExceeded(false);
    }
  }, [visible]);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      setDeviceLimitExceeded(false);

      // Verify Google Play Services are available on the Android device
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Trigger native Google Account chooser
      const signinResult = await GoogleSignin.signIn();

      // Extract idToken safely across @react-native-google-signin versions
      const idToken =
        signinResult?.data?.idToken ||
        (signinResult as any)?.idToken;

      const userProfile =
        signinResult?.data?.user ||
        (signinResult as any)?.user;

      if (!idToken) {
        throw new Error('Google Sign-In completed, but no ID token was returned.');
      }

      // Verify ID token on backend and receive JWT session
      const res = await authService.loginWithGoogleToken(idToken, {
        email: userProfile?.email,
        fullName: userProfile?.name,
        googleId: userProfile?.id,
      });

      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        // User dismissed the Google dialog, no error needed
        return;
      }
      if (err.code === statusCodes.IN_PROGRESS) {
        return;
      }
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setErrorMsg('Google Play Services is not available or needs updating on this device.');
        return;
      }
      if (err.code === 'DEVICE_LIMIT_EXCEEDED') {
        setDeviceLimitExceeded(true);
        setActiveDevices(err.active_devices || []);
        setErrorMsg('Maximum 2 devices reached. Disconnect one below to sign in on this phone:');
        return;
      }

      setErrorMsg(err.message || 'Google authentication failed. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      setLoading(true);
      const success = await authService.revokeDevice(deviceId);
      if (success) {
        Alert.alert('Device Disconnected', 'Session freed! Retrying sign in on this phone...');
        setDeviceLimitExceeded(false);
        setActiveDevices([]);
        await handleGoogleSignIn();
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
            <View>
              <Text style={styles.title}>Sign In to 3SAJ Studio</Text>
              <Text style={styles.subtitle}>Direct connection with real Google Account</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Value Highlights */}
          <View style={styles.perksContainer}>
            <View style={styles.perkRow}>
              <View style={styles.perkIconBox}>
                <Zap size={14} color="#38BDF8" />
              </View>
              <Text style={styles.perkText}>Zero registration forms or passwords to remember</Text>
            </View>
            <View style={styles.perkRow}>
              <View style={styles.perkIconBox}>
                <ShieldCheck size={14} color="#10B981" />
              </View>
              <Text style={styles.perkText}>Cryptographically verified by official Google OAuth</Text>
            </View>
            <View style={styles.perkRow}>
              <View style={styles.perkIconBox}>
                <Smartphone size={14} color="#A855F7" />
              </View>
              <Text style={styles.perkText}>Syncs subscription and translation quota on up to 2 phones</Text>
            </View>
          </View>

          {/* Error Message */}
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
                    <Text style={styles.deviceName}>{d.device_name || 'Active Phone'}</Text>
                    <Text style={styles.devicePlatform}>{d.platform?.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={() => handleRevokeDevice(d.device_id)}
                  >
                    <Trash2 size={13} color="#EF4444" style={{ marginRight: 4 }} />
                    <Text style={styles.disconnectBtnText}>Disconnect</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Continue with Google Button */}
          <TouchableOpacity
            style={[styles.googleBtn, loading && styles.googleBtnDisabled]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <>
                <View style={styles.googleIconContainer}>
                  <GoogleLogo size={20} />
                </View>
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.footerNote}>
            By signing in, your subscription and daily quotas are safely linked to your Gmail.
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0F172A',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 3,
  },
  closeBtn: {
    padding: 4,
    backgroundColor: '#1E293B',
    borderRadius: 16,
  },
  perksContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  perkIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: {
    flex: 1,
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '500',
    lineHeight: 16,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  googleBtnDisabled: {
    opacity: 0.7,
  },
  googleIconContainer: {
    width: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleBtnText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  footerNote: {
    textAlign: 'center',
    color: '#64748B',
    fontSize: 11,
    marginTop: 14,
    lineHeight: 15,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  errorText: {
    flex: 1,
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '500',
  },
  devicesList: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  deviceName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  devicePlatform: {
    color: '#94A3B8',
    fontSize: 11,
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  disconnectBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
});
