import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  StyleSheet,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Key,
  Mic,
  Sliders,
  Music,
  Save,
  Eye,
  EyeOff,
  ExternalLink,
  HelpCircle,
  Sparkles,
  Globe,
  ShieldCheck,
  Zap,
  Award,
  Crown,
  Smartphone,
  User,
  LogOut,
  CreditCard,
  Clock,
  RefreshCw,
  Infinity as InfinityIcon,
} from 'lucide-react-native';
import { useProjectStore } from '../store/useProjectStore';
import { getApiKey, setApiKey } from '../services/secureStorage';
import { SubscriptionPricingModal } from '../components/modals/SubscriptionPricingModal';
import { AuthModal } from '../components/modals/AuthModal';
import { DeviceManagementModal } from '../components/modals/DeviceManagementModal';
import { checkAppLicense, getDailyUsage, removeLicense } from '../services/licenseService';
import { authService, UserProfile, SubscriptionInfo } from '../services/api/authService';
import { LicenseStatus, DailyUsageData, TIER_CONFIGS } from '../types/license';
import {
  TranslationMode,
  AIProvider,
  VoiceMode,
  BGMMode,
} from '../types/project';

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, updateSettings } = useProjectStore();

  // API Keys state
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Local settings state
  const [translationMode, setTranslationMode] = useState<TranslationMode>(settings.translationMode);
  const [aiProvider, setAiProvider] = useState<AIProvider>(settings.aiProvider);
  const [batchSize, setBatchSize] = useState(String(settings.batchSize || 200));
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(settings.voiceMode);
  const [maxConcurrent, setMaxConcurrent] = useState(String(settings.maxConcurrentTts));
  const [autoTimeStretch, setAutoTimeStretch] = useState(settings.autoTimeStretch);
  const [bgmMode, setBgmMode] = useState<BGMMode>(settings.bgmMode);
  const [demucsUrl, setDemucsUrl] = useState(settings.demucsEndpoint);
  const [backendApiUrl, setBackendApiUrl] = useState(settings.backendApiUrl || 'https://threesaj-studio-dub-app.onrender.com');
  const [testingBackend, setTestingBackend] = useState(false);

  const handleTestBackend = async () => {
    const url = (backendApiUrl || '').trim().replace(/\/+$/, '');
    if (!url) {
      Alert.alert('Backend URL', 'Please enter a Backend API URL first.');
      return;
    }
    setTestingBackend(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        Alert.alert(
          '✅ Connected Successfully',
          `Backend server is online and operational!\n\nService: ${data.service || '3SAJ Unified Backend'}\nVersion: ${data.version || '2.0.0'}\nStatus: ${data.status || 'online'}`
        );
      } else {
        Alert.alert('⚠️ Server Responded with Error', `Backend server returned HTTP ${res.status}.`);
      }
    } catch (err: any) {
      Alert.alert(
        '❌ Connection Failed',
        `Could not reach backend server at:\n${url}\n\nError: ${err.message || 'Network request failed'}\n\nPlease check your internet connection or verify your Render deployment is live.`
      );
    } finally {
      setTestingBackend(false);
    }
  };
  const [autoExport, setAutoExport] = useState(settings.autoExport);

  // User & Subscription state
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [currentSub, setCurrentSub] = useState<SubscriptionInfo | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageData | null>(null);

  // Modals state
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [devicesModalVisible, setDevicesModalVisible] = useState(false);

  const handleOpenBuyPlan = () => {
    if (!currentUser) {
      Alert.alert(
        '🔐 Sign In Required',
        'Please sign in with your Google account to subscribe to a 3SAJ Studio plan. Your subscription will be safely tied to your account across your devices.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign In with Google',
            onPress: () => {
              setAuthModalVisible(true);
            },
          },
        ]
      );
      return;
    }
    setPricingModalVisible(true);
  };

  const refreshProfileAndSubscription = async () => {
    try {
      if (settings.backendApiUrl) {
        authService.setBackendUrl(settings.backendApiUrl);
      }
      const token = await authService.getAccessToken();
      if (!token) {
        setCurrentUser(null);
        setCurrentSub(null);
      } else {
        const profileData = await authService.getCurrentProfile();
        if (profileData) {
          setCurrentUser(profileData.user);
          setCurrentSub(profileData.subscription);
        } else {
          setCurrentUser(null);
          setCurrentSub(null);
        }
      }
    } catch (e) {
      console.warn('Failed refreshing profile:', e);
      setCurrentUser(null);
      setCurrentSub(null);
    }

    const status = await checkAppLicense();
    setLicenseStatus(status);
    if (status.license) {
      const usage = await getDailyUsage(status.license.dailyLimitSeconds);
      setDailyUsage(usage);
    } else {
      setDailyUsage(null);
    }
  };

  useEffect(() => {
    refreshProfileAndSubscription();
    // Subscribe to auth state changes so UI updates immediately when signing in or signing out
    const unsub = authService.onAuthStateChanged((user, sub) => {
      setCurrentUser(user);
      if (sub !== undefined) {
        setCurrentSub(sub);
      }
      if (!user) {
        setLicenseStatus(null);
        setDailyUsage(null);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (settings.backendApiUrl) {
      setBackendApiUrl(settings.backendApiUrl);
      authService.setBackendUrl(settings.backendApiUrl);
    }
  }, [settings.backendApiUrl]);

  useEffect(() => {
    async function loadKeys() {
      const [g, o, c, d] = await Promise.all([
        getApiKey('gemini'),
        getApiKey('openai'),
        getApiKey('claude'),
        getApiKey('deepseek'),
      ]);
      setGeminiKey(g);
      setOpenaiKey(o);
      setClaudeKey(c);
      setDeepseekKey(d);
    }
    loadKeys();
  }, []);

  const toggleShowKey = (name: string) => {
    setShowKeys((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const openUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Error', `Cannot open url: ${url}`);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await authService.logout();
          await removeLicense();
          setCurrentUser(null);
          setCurrentSub(null);
          setLicenseStatus(null);
          setDailyUsage(null);
          await refreshProfileAndSubscription();
          Alert.alert('Signed Out', 'You have been successfully signed out.');
        },
      },
    ]);
  };

  const handleSaveAll = async () => {
    // 1. Save API keys securely
    await Promise.all([
      setApiKey('gemini', geminiKey),
      setApiKey('openai', openaiKey),
      setApiKey('claude', claudeKey),
      setApiKey('deepseek', deepseekKey),
    ]);

    // 2. Save settings
    await updateSettings({
      translationMode,
      aiProvider,
      batchSize: parseInt(batchSize, 10) || 200,
      voiceMode,
      maxConcurrentTts: Math.min(Math.max(1, parseInt(maxConcurrent, 10) || 5), 15),
      autoTimeStretch,
      bgmMode,
      demucsEndpoint: demucsUrl.trim(),
      backendApiUrl: backendApiUrl.trim(),
      autoExport,
    });

    authService.setBackendUrl(backendApiUrl.trim());

    Alert.alert('Settings Saved', 'All preferences, server connection, and secure API keys updated.');
    router.back();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={true}
      nestedScrollEnabled={true}
      keyboardShouldPersistTaps="handled"
      bounces={true}
      overScrollMode="always"
      scrollEventThrottle={16}
    >
      {/* SECTION 0: ACCOUNT & DEVICE MANAGEMENT */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <User size={18} color="#38BDF8" />
          <Text style={styles.sectionTitle}>3SAJ Account & Devices</Text>
        </View>

        {currentUser ? (
          <View style={styles.accountCard}>
            <View style={styles.accountHeaderRow}>
              <View>
                <Text style={styles.accountEmail}>{currentUser.email}</Text>
                {currentUser.full_name && (
                  <Text style={styles.accountName}>{currentUser.full_name}</Text>
                )}
              </View>
              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                <LogOut size={14} color="#EF4444" style={{ marginRight: 4 }} />
                <Text style={styles.logoutBtnText}>Sign Out</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.deviceManageRow}>
              <View style={styles.deviceCountBox}>
                <Smartphone size={14} color="#10B981" />
                <Text style={styles.deviceCountText}>Device limit: Max 2 phones active</Text>
              </View>
              <TouchableOpacity
                style={styles.manageDevicesBtn}
                onPress={() => setDevicesModalVisible(true)}
              >
                <Text style={styles.manageDevicesBtnText}>Manage Devices</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.loginBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.loginBannerTitle}>Sign in to your account</Text>
              <Text style={styles.loginBannerSub}>
                Sync subscriptions across your devices and protect your translation quota.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.signInBtn}
              onPress={() => setAuthModalVisible(true)}
            >
              <Text style={styles.signInBtnText}>Sign In with Google</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* SECTION 1: SUBSCRIPTION & CENTRAL ABA PAYMENT */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ShieldCheck size={18} color="#10B981" />
          <Text style={styles.sectionTitle}>Subscription & ABA PayWay</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Tiered plans with daily video translation allowance. Instant activation via ABA KHQR.
        </Text>

        {licenseStatus?.isValid && licenseStatus.license ? (
          <View style={styles.licenseCard}>
            <View style={styles.licenseHeaderRow}>
              <View style={styles.tierBadge}>
                {licenseStatus.license.tier === 'FLASH' && <Zap size={14} color="#F59E0B" />}
                {licenseStatus.license.tier === 'PRO' && <Award size={14} color="#38BDF8" />}
                {licenseStatus.license.tier === 'PRO_MAX' && <Crown size={14} color="#A855F7" />}
                {licenseStatus.license.tier === 'UNLIMITED' && <InfinityIcon size={14} color="#10B981" />}
                <Text
                  style={[
                    styles.tierBadgeText,
                    { color: TIER_CONFIGS[licenseStatus.license.tier]?.badgeColor || '#38BDF8' },
                  ]}
                >
                  {TIER_CONFIGS[licenseStatus.license.tier]?.displayName || licenseStatus.license.tier} Plan
                </Text>
              </View>
              <Text style={styles.licenseExpiryText}>
                {licenseStatus.daysRemaining} days remaining
              </Text>
            </View>

            <Text style={styles.licenseDetail}>
              • Daily Allowance:{' '}
              {licenseStatus.license.tier === 'UNLIMITED'
                ? 'Unlimited Video Minutes / Day'
                : `${TIER_CONFIGS[licenseStatus.license.tier]?.dailyLimitHours || 5} Hours / Day`}
            </Text>
            <Text style={styles.licenseDetail}>
              • Active Until: {new Date(licenseStatus.license.expiresAt).toLocaleDateString()}
            </Text>

            {/* Daily Usage Progress Bar */}
            {dailyUsage && (
              <View style={styles.usageContainer}>
                <View style={styles.usageHeaderRow}>
                  <Text style={styles.usageTitle}>Today's Video Quota:</Text>
                  <Text style={styles.usageStats}>
                    {Math.round(dailyUsage.secondsUsed / 60)}m /{' '}
                    {licenseStatus.license.tier === 'UNLIMITED'
                      ? '∞'
                      : `${Math.round(dailyUsage.dailyLimitSeconds / 60)}m`}{' '}
                    ({dailyUsage.percentageUsed}%)
                  </Text>
                </View>

                <View style={styles.usageBarTrack}>
                  <View
                    style={[
                      styles.usageBarFill,
                      {
                        width: `${Math.min(dailyUsage.percentageUsed, 100)}%`,
                        backgroundColor:
                          dailyUsage.percentageUsed >= 90
                            ? '#EF4444'
                            : dailyUsage.percentageUsed >= 70
                            ? '#F59E0B'
                            : '#10B981',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.usageRemainingText}>
                  {licenseStatus.license.tier === 'UNLIMITED'
                    ? 'Unlimited minutes enabled (Fair Use)'
                    : `${Math.round(dailyUsage.secondsRemaining / 60)} min remaining today (Resets at midnight Cambodia)`}
                </Text>
              </View>
            )}

            <View style={styles.licenseBtnRow}>
              <TouchableOpacity
                style={styles.licenseActionBtn}
                onPress={handleOpenBuyPlan}
              >
                <CreditCard size={14} color="#38BDF8" />
                <Text style={styles.licenseActionBtnText}>Upgrade / Renew Plan</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.noLicenseBox}>
            <Text style={styles.noLicenseText}>
              No active subscription found. Subscribe to Flash ($5), Pro ($8), Pro Max ($10), or Unlimited ($15).
            </Text>
            <TouchableOpacity
              style={styles.activateNowBtn}
              onPress={handleOpenBuyPlan}
            >
              <CreditCard size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.activateNowBtnText}>Choose Subscription Plan</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* SECTION 2: SECURE API KEYS (BYOK) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Key size={18} color="#F59E0B" />
          <Text style={styles.sectionTitle}>BYOK AI API Keys (Stored Securely)</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Keys are stored using device hardware keychain (expo-secure-store).
        </Text>

        {/* Khmer Help / Guide Card */}
        <View style={styles.khmerGuideCard}>
          <View style={styles.khmerGuideHeader}>
            <HelpCircle size={16} color="#38BDF8" />
            <Text style={styles.khmerGuideTitle}>ការណែនាំអំពីការយក API Key (Khmer Guide)</Text>
          </View>
          <Text style={styles.khmerGuideText}>
            • <Text style={styles.boldKhmer}>ជំហានទី១:</Text> ចុចលើតំណភ្ជាប់ពណ៌ខៀវ (👉 ចុចទីនេះ...) នៅខាងក្រោមប្រអប់នីមួយៗ ដើម្បីចូលទៅកាន់គេហទំព័រផ្លូវការ។
          </Text>
          <Text style={styles.khmerGuideText}>
            • <Text style={styles.boldKhmer}>ជំហានទី២:</Text> ចូល Login/Sign in រួចចុច <Text style={styles.codeText}>Create API Key</Text> ហើយចម្លង (Copy) Key នោះ។
          </Text>
          <Text style={styles.khmerGuideText}>
            • <Text style={styles.boldKhmer}>ជំហានទី៣:</Text> យកមក Paste ក្នុងប្រអប់ខាងក្រោម រួចចុច <Text style={styles.boldKhmer}>"Save All Settings & Keys"</Text>។
          </Text>
          <View style={styles.khmerTipBox}>
            <Sparkles size={14} color="#FBBF24" />
            <Text style={styles.khmerTipText}>
              <Text style={styles.boldKhmer}>គន្លឹះ:</Text> ប្រសិនបើមិនទាន់មាន Key ទេ អ្នកអាចជ្រើសរើសផ្នែក <Text style={{ color: '#38BDF8', fontWeight: '700' }}>"Free Google"</Text> នៅផ្នែក Translation Engine ខាងក្រោម ដើម្បីបកប្រែដោយឥតគិតថ្លៃ ១០០% ដោយមិនបាច់មាន Key!
            </Text>
          </View>
        </View>

        {/* Gemini */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Google Gemini API Key (ឥតគិតថ្លៃ / Free):</Text>
          <View style={styles.keyInputRow}>
            <TextInput
              style={styles.keyInput}
              value={geminiKey}
              onChangeText={setGeminiKey}
              secureTextEntry={!showKeys.gemini}
              placeholder="AIzaSy..."
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity onPress={() => toggleShowKey('gemini')} style={styles.eyeBtn}>
              {showKeys.gemini ? <EyeOff size={18} color="#94A3B8" /> : <Eye size={18} color="#94A3B8" />}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => openUrl('https://aistudio.google.com/app/apikey')}
          >
            <ExternalLink size={13} color="#38BDF8" />
            <Text style={styles.linkButtonText}>👉 ចុចទីនេះដើម្បីយក API Key ហ្វ្រី (Google AI Studio)</Text>
          </TouchableOpacity>
        </View>

        {/* OpenAI */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>OpenAI API Key (sk-...):</Text>
          <View style={styles.keyInputRow}>
            <TextInput
              style={styles.keyInput}
              value={openaiKey}
              onChangeText={setOpenaiKey}
              secureTextEntry={!showKeys.openai}
              placeholder="sk-..."
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity onPress={() => toggleShowKey('openai')} style={styles.eyeBtn}>
              {showKeys.openai ? <EyeOff size={18} color="#94A3B8" /> : <Eye size={18} color="#94A3B8" />}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => openUrl('https://platform.openai.com/api-keys')}
          >
            <ExternalLink size={13} color="#38BDF8" />
            <Text style={styles.linkButtonText}>👉 ចុចទីនេះដើម្បីយក OpenAI API Key</Text>
          </TouchableOpacity>
        </View>

        {/* Claude */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Anthropic Claude API Key (sk-ant-...):</Text>
          <View style={styles.keyInputRow}>
            <TextInput
              style={styles.keyInput}
              value={claudeKey}
              onChangeText={setClaudeKey}
              secureTextEntry={!showKeys.claude}
              placeholder="sk-ant-..."
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity onPress={() => toggleShowKey('claude')} style={styles.eyeBtn}>
              {showKeys.claude ? <EyeOff size={18} color="#94A3B8" /> : <Eye size={18} color="#94A3B8" />}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => openUrl('https://console.anthropic.com/settings/keys')}
          >
            <ExternalLink size={13} color="#38BDF8" />
            <Text style={styles.linkButtonText}>👉 ចុចទីនេះដើម្បីយក Claude API Key</Text>
          </TouchableOpacity>
        </View>

        {/* DeepSeek */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>DeepSeek API Key (sk-...):</Text>
          <View style={styles.keyInputRow}>
            <TextInput
              style={styles.keyInput}
              value={deepseekKey}
              onChangeText={setDeepseekKey}
              secureTextEntry={!showKeys.deepseek}
              placeholder="sk-..."
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity onPress={() => toggleShowKey('deepseek')} style={styles.eyeBtn}>
              {showKeys.deepseek ? <EyeOff size={18} color="#94A3B8" /> : <Eye size={18} color="#94A3B8" />}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => openUrl('https://platform.deepseek.com/api_keys')}
          >
            <ExternalLink size={13} color="#38BDF8" />
            <Text style={styles.linkButtonText}>👉 ចុចទីនេះដើម្បីយក DeepSeek API Key</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SECTION 3: TRANSLATION ENGINE & BATCHING */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Sliders size={18} color="#38BDF8" />
          <Text style={styles.sectionTitle}>Translation Engine</Text>
        </View>

        {/* Mode Selector */}
        <View style={styles.selectorRow}>
          {[
            { id: 'free_google', label: 'Free Google' },
            { id: 'byok', label: 'BYOK AI API' },
            { id: 'manual_batch', label: 'Manual Batch' },
          ].map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.modePill, translationMode === m.id && styles.modePillActive]}
              onPress={() => setTranslationMode(m.id as TranslationMode)}
            >
              <Text style={[styles.modeText, translationMode === m.id && styles.modeTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI Provider */}
        {translationMode === 'byok' && (
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Active AI Provider:</Text>
            <View style={styles.selectorRow}>
              {[
                { id: 'gemini', label: 'Gemini' },
                { id: 'openai', label: 'GPT-4o' },
                { id: 'claude', label: 'Claude' },
                { id: 'deepseek', label: 'DeepSeek' },
              ].map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.providerPill, aiProvider === p.id && styles.providerPillActive]}
                  onPress={() => setAiProvider(p.id as AIProvider)}
                >
                  <Text style={[styles.providerText, aiProvider === p.id && styles.providerTextActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Batch Size */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Translation Batch Size (Lines per request):</Text>
          <TextInput
            style={styles.numberInput}
            value={batchSize}
            onChangeText={setBatchSize}
            keyboardType="numeric"
          />
        </View>
      </View>

      {/* SECTION 4: VOICE OVER & TTS DUBBING */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Mic size={18} color="#10B981" />
          <Text style={styles.sectionTitle}>Khmer Voice Dubbing Engine</Text>
        </View>

        {/* Voice Mode */}
        <View style={styles.selectorRow}>
          {[
            { id: 'AUTO_DETECT', label: 'Auto (Gender/Age)' },
            { id: 'ALL_MALE', label: 'All Piseth (Male)' },
            { id: 'ALL_FEMALE', label: 'All Sreymom (Fem)' },
          ].map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[styles.modePill, voiceMode === v.id && styles.modePillActive]}
              onPress={() => setVoiceMode(v.id as VoiceMode)}
            >
              <Text style={[styles.modeText, voiceMode === v.id && styles.modeTextActive]}>
                {v.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Concurrency */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Max Concurrent TTS Requests (1 to 15):</Text>
          <TextInput
            style={styles.numberInput}
            value={maxConcurrent}
            onChangeText={setMaxConcurrent}
            keyboardType="numeric"
          />
        </View>

        {/* Auto Time-Stretch Toggle */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Auto Time-Stretch (Fit-to-Slot)</Text>
            <Text style={styles.switchDesc}>
              Clamps FFmpeg atempo (1.0x - 1.45x) so speech never overflows SRT timestamp
            </Text>
          </View>
          <Switch
            value={autoTimeStretch}
            onValueChange={setAutoTimeStretch}
            trackColor={{ false: '#334155', true: '#4F46E5' }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* SECTION 5: BGM & EXPORT */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Music size={18} color="#A78BFA" />
          <Text style={styles.sectionTitle}>Audio Mixing & Auto-Export</Text>
        </View>

        {/* BGM Mode */}
        <View style={styles.selectorRow}>
          {[
            { id: 'MUTE_ORIGINAL', label: 'Mute Original (Khmer Only)' },
            { id: 'OFF_DUCKING', label: 'Auto-Ducking 5% (Low BGM)' },
            { id: 'ON_DEMUCS', label: 'Vocal Split (Demucs)' },
          ].map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[styles.modePill, bgmMode === b.id && styles.modePillActive]}
              onPress={() => setBgmMode(b.id as BGMMode)}
            >
              <Text style={[styles.modeText, bgmMode === b.id && styles.modeTextActive]}>
                {b.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {bgmMode === 'ON_DEMUCS' && (
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Demucs FastAPI Separation Endpoint:</Text>
            <TextInput
              style={styles.textInput}
              value={demucsUrl}
              onChangeText={setDemucsUrl}
              placeholder="http://192.168.1.100:8000/api/separate"
              placeholderTextColor="#64748B"
            />
          </View>
        )}

        {/* Auto-Export */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Auto-Export to Camera Roll</Text>
            <Text style={styles.switchDesc}>
              Immediately mux with -c:v copy and save to gallery once 100% TTS finishes
            </Text>
          </View>
          <Switch
            value={autoExport}
            onValueChange={setAutoExport}
            trackColor={{ false: '#334155', true: '#10B981' }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* SECTION 6: BACKEND EXTRACTION & SERVER API */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Globe size={18} color="#38BDF8" />
          <Text style={styles.sectionTitle}>Backend Server & Video Extractor API</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Local or remote microservice for account sync, daily quotas, and downloading videos from URL.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Backend API URL:</Text>
          <TextInput
            style={styles.textInput}
            value={backendApiUrl}
            onChangeText={setBackendApiUrl}
            placeholder="https://threesaj-studio-dub-app.onrender.com"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helperText}>
            Points to your 3SAJ backend server (e.g. https://threesaj-studio-dub-app.onrender.com).
          </Text>
          <TouchableOpacity
            style={styles.testBackendBtn}
            onPress={handleTestBackend}
            disabled={testingBackend}
          >
            {testingBackend ? (
              <ActivityIndicator size="small" color="#38BDF8" />
            ) : (
              <>
                <RefreshCw size={14} color="#38BDF8" style={{ marginRight: 6 }} />
                <Text style={styles.testBackendBtnText}>Test Backend Connection</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAll}>
        <Save size={18} color="#FFFFFF" />
        <Text style={styles.saveBtnText}>Save All Settings & Keys</Text>
      </TouchableOpacity>

      {/* Modals */}
      <AuthModal
        visible={authModalVisible}
        onClose={() => setAuthModalVisible(false)}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          refreshProfileAndSubscription();
        }}
      />

      <SubscriptionPricingModal
        visible={pricingModalVisible}
        onClose={() => setPricingModalVisible(false)}
        userId={currentUser?.id || (currentUser as any)?.user_id || 'anonymous_user'}
        currentSubscription={currentSub}
        onSubscriptionUpdated={(newSub) => {
          setCurrentSub(newSub);
          refreshProfileAndSubscription();
        }}
        onRequestAuth={() => setAuthModalVisible(true)}
      />

      <DeviceManagementModal
        visible={devicesModalVisible}
        onClose={() => setDevicesModalVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    padding: 16,
    paddingBottom: 80,
    gap: 18,
  },
  section: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 14,
  },
  accountCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  accountHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  accountEmail: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  accountName: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  logoutBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  deviceManageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 10,
  },
  deviceCountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceCountText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  manageDevicesBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1E293B',
    borderRadius: 8,
  },
  manageDevicesBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  loginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  loginBannerTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  loginBannerSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  signInBtn: {
    backgroundColor: '#005F73',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  signInBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  licenseCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  licenseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tierBadgeText: {
    fontSize: 15,
    fontWeight: '800',
  },
  licenseExpiryText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  licenseDetail: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 3,
  },
  usageContainer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  usageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  usageTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  usageStats: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  usageBarTrack: {
    height: 8,
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
  },
  usageBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  usageRemainingText: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 4,
  },
  licenseBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  licenseActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  licenseActionBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  licenseAdminBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  licenseAdminBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  noLicenseBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  noLicenseText: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  activateNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#005F73',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  activateNowBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  khmerGuideCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  khmerGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  khmerGuideTitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  khmerGuideText: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 4,
  },
  boldKhmer: {
    fontWeight: '700',
    color: '#F8FAFC',
  },
  codeText: {
    color: '#F59E0B',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  khmerTipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  khmerTipText: {
    color: '#FDE68A',
    fontSize: 10,
    flex: 1,
    lineHeight: 14,
  },
  fieldGroup: {
    marginTop: 10,
  },
  fieldLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  keyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
  },
  keyInput: {
    flex: 1,
    color: '#F8FAFC',
    paddingVertical: 10,
    fontSize: 13,
  },
  eyeBtn: {
    padding: 6,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  linkButtonText: {
    color: '#38BDF8',
    fontSize: 11,
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  modePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modePillActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#0B1E36',
  },
  modeText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  modeTextActive: {
    color: '#38BDF8',
  },
  providerPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  providerPillActive: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B',
  },
  providerText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  providerTextActive: {
    color: '#10B981',
  },
  numberInput: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    width: 90,
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  helperText: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 4,
  },
  testBackendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  testBackendBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  switchLabel: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  switchDesc: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
    paddingRight: 10,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#005F73',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
