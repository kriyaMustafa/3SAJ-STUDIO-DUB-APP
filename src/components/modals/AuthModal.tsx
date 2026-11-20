import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import {
  X,
  ShieldCheck,
  Zap,
  Smartphone,
  Trash2,
  AlertTriangle,
  Copy,
  ChevronDown,
  ChevronUp,
  LogIn,
  Mail,
  Lock,
} from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { authService, UserProfile, DeviceInfo } from '../../services/api/authService';

const GOOGLE_WEB_CLIENT_ID = '76120676265-nh7sstgffij29s3qukarj5eil28rbfj0.apps.googleusercontent.com';
const ANDROID_PACKAGE_NAME = 'com.saj.studio.dubbing';
const ANDROID_DEBUG_SHA1 = '5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25';

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
  const [devErrorDetails, setDevErrorDetails] = useState(false);

  // Email / Password fallback state
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  // Device limit handling (max 2 active phones)
  const [deviceLimitExceeded, setDeviceLimitExceeded] = useState(false);
  const [activeDevices, setActiveDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    if (visible) {
      setErrorMsg(null);
      setDevErrorDetails(false);
      setDeviceLimitExceeded(false);
    }
  }, [visible]);

  const handleCopySha1 = async () => {
    try {
      await Clipboard.setStringAsync(ANDROID_DEBUG_SHA1);
      Alert.alert('SHA-1 Copied!', `SHA-1 key copied to clipboard:\n${ANDROID_DEBUG_SHA1}`);
    } catch {
      Alert.alert('SHA-1 Key', ANDROID_DEBUG_SHA1);
    }
  };

  const handleCopyPackageName = async () => {
    try {
      await Clipboard.setStringAsync(ANDROID_PACKAGE_NAME);
      Alert.alert('Package Name Copied!', ANDROID_PACKAGE_NAME);
    } catch {
      Alert.alert('Package Name', ANDROID_PACKAGE_NAME);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      setDevErrorDetails(false);
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

      const isDevError =
        err.code === '10' ||
        err.code === 10 ||
        (err.message && err.message.includes('DEVELOPER_ERROR'));

      if (isDevError) {
        setDevErrorDetails(true);
        setErrorMsg('DEVELOPER_ERROR: Android OAuth Client ID is missing in Google Cloud Console. Add the SHA-1 below to fix it.');
        return;
      }

      setErrorMsg(err.message || 'Google authentication failed. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    try {
      setEmailLoading(true);
      setErrorMsg(null);
      const res = await authService.login(email.trim(), password.trim());
      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Email login failed. Please check your credentials.');
    } finally {
      setEmailLoading(false);
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
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
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
                <AlertTriangle size={16} color="#F87171" style={{ marginRight: 6, marginTop: 2 }} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            {/* Google Developer Error Diagnostic Panel */}
            {devErrorDetails && (
              <View style={styles.diagnosticCard}>
                <Text style={styles.diagTitle}>Required in Google Cloud Console:</Text>
                <Text style={styles.diagDesc}>
                  Go to console.cloud.google.com &gt; Credentials &gt; Create "OAuth client ID" &gt; Android:
                </Text>

                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>Package Name:</Text>
                  <Text style={styles.diagValue}>{ANDROID_PACKAGE_NAME}</Text>
                  <TouchableOpacity onPress={handleCopyPackageName} style={styles.copyBtn}>
                    <Copy size={13} color="#38BDF8" />
                    <Text style={styles.copyBtnText}>Copy</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>SHA-1 Fingerprint:</Text>
                  <Text style={styles.diagValue} numberOfLines={2}>
                    {ANDROID_DEBUG_SHA1}
                  </Text>
                  <TouchableOpacity onPress={handleCopySha1} style={styles.copyBtn}>
                    <Copy size={13} color="#38BDF8" />
                    <Text style={styles.copyBtnText}>Copy</Text>
                  </TouchableOpacity>
                </View>
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

            {/* Email Fallback Toggle */}
            <TouchableOpacity
              style={styles.toggleEmailBtn}
              onPress={() => setShowEmailLogin(!showEmailLogin)}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleEmailText}>
                {showEmailLogin ? 'Hide Email Sign In' : 'Or Sign In with Email & Password'}
              </Text>
              {showEmailLogin ? <ChevronUp size={14} color="#94A3B8" /> : <ChevronDown size={14} color="#94A3B8" />}
            </TouchableOpacity>

            {/* Email / Password Form (Fallback) */}
            {showEmailLogin && (
              <View style={styles.emailForm}>
                <View style={styles.inputContainer}>
                  <Mail size={16} color="#94A3B8" style={{ marginRight: 10 }} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Email address"
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Lock size={16} color="#94A3B8" style={{ marginRight: 10 }} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Password"
                    placeholderTextColor="#64748B"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                  />
                </View>

                <TouchableOpacity
                  style={[styles.emailSubmitBtn, emailLoading && { opacity: 0.7 }]}
                  onPress={handleEmailSignIn}
                  disabled={emailLoading}
                >
                  {emailLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <LogIn size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.emailSubmitText}>Sign In with Email</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.footerNote}>
              By signing in, your subscription and daily quotas are safely linked to your account.
            </Text>
          </ScrollView>
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
  scrollContent: {
    paddingBottom: 4,
  },
  diagnosticCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  diagTitle: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '700',
  },
  diagDesc: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
  },
  diagRow: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 4,
  },
  diagLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diagValue: {
    color: '#F8FAFC',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 4,
    marginTop: 2,
  },
  copyBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  toggleEmailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 8,
    gap: 6,
  },
  toggleEmailText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  emailForm: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  textInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13,
    paddingVertical: 8,
  },
  emailSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 2,
  },
  emailSubmitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
