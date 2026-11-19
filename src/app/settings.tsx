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
} from 'lucide-react-native';
import { useProjectStore } from '../store/useProjectStore';
import { getApiKey, setApiKey } from '../services/secureStorage';
import { LicenseActivationModal } from '../components/modals/LicenseActivationModal';
import { AdminLicenseGeneratorModal } from '../components/modals/AdminLicenseGeneratorModal';
import { checkAppLicense, getDailyUsage } from '../services/licenseService';
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
  const [backendApiUrl, setBackendApiUrl] = useState(settings.backendApiUrl || 'http://192.168.1.X:8000');
  const [autoExport, setAutoExport] = useState(settings.autoExport);

  // License state
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageData | null>(null);
  const [licenseModalVisible, setLicenseModalVisible] = useState(false);
  const [adminModalVisible, setAdminModalVisible] = useState(false);

  const refreshLicenseInfo = async () => {
    const status = await checkAppLicense();
    setLicenseStatus(status);
    if (status.license) {
      const usage = await getDailyUsage(status.license.dailyLimitSeconds);
      setDailyUsage(usage);
    }
  };

  useEffect(() => {
    refreshLicenseInfo();
  }, []);

  useEffect(() => {
    if (settings.backendApiUrl) {
      setBackendApiUrl(settings.backendApiUrl);
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

    Alert.alert('Settings Saved', 'All preferences and secure API keys updated successfully.');
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* SECTION 0: APP LICENSE & DAILY QUOTA */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ShieldCheck size={18} color="#10B981" />
          <Text style={styles.sectionTitle}>App License & Daily Translation Quota</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Tiered subscription plan and daily video translation allowance.
        </Text>

        {licenseStatus?.isValid && licenseStatus.license ? (
          <View style={styles.licenseCard}>
            <View style={styles.licenseHeaderRow}>
              <View style={styles.tierBadge}>
                {licenseStatus.license.tier === 'FLASH' && <Zap size={14} color="#F59E0B" />}
                {licenseStatus.license.tier === 'PRO' && <Award size={14} color="#38BDF8" />}
                {licenseStatus.license.tier === 'PREMIUM' && <Crown size={14} color="#A855F7" />}
                <Text
                  style={[
                    styles.tierBadgeText,
                    { color: TIER_CONFIGS[licenseStatus.license.tier].badgeColor },
                  ]}
                >
                  {TIER_CONFIGS[licenseStatus.license.tier].displayName} Plan
                </Text>
              </View>
              <Text style={styles.licenseExpiryText}>
                {licenseStatus.daysRemaining} days left
              </Text>
            </View>

            <Text style={styles.licenseDetail}>
              • Daily Quota: {TIER_CONFIGS[licenseStatus.license.tier].dailyLimitHours} Hours / Day
            </Text>
            <Text style={styles.licenseDetail}>
              • Expires: {new Date(licenseStatus.license.expiresAt).toLocaleDateString()}
            </Text>

            {/* Daily Usage Progress Bar */}
            {dailyUsage && (
              <View style={styles.usageContainer}>
                <View style={styles.usageHeaderRow}>
                  <Text style={styles.usageTitle}>Today's Translation Used:</Text>
                  <Text style={styles.usageStats}>
                    {Math.round(dailyUsage.secondsUsed / 60)}m /{' '}
                    {Math.round(dailyUsage.dailyLimitSeconds / 60)}m ({dailyUsage.percentageUsed}%)
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
                  {Math.round(dailyUsage.secondsRemaining / 60)} minutes remaining today (Resets at midnight)
                </Text>
              </View>
            )}

            <View style={styles.licenseBtnRow}>
              <TouchableOpacity
                style={styles.licenseActionBtn}
                onPress={() => setLicenseModalVisible(true)}
              >
                <Key size={14} color="#38BDF8" />
                <Text style={styles.licenseActionBtnText}>Upgrade / Change Key</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.licenseAdminBtn}
                onPress={() => setAdminModalVisible(true)}
              >
                <Sparkles size={14} color="#F59E0B" />
                <Text style={styles.licenseAdminBtnText}>Admin Tool</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.noLicenseBox}>
            <Text style={styles.noLicenseText}>
              {licenseStatus?.message || 'No active license key found.'}
            </Text>
            <TouchableOpacity
              style={styles.activateNowBtn}
              onPress={() => setLicenseModalVisible(true)}
            >
              <Key size={16} color="#FFFFFF" />
              <Text style={styles.activateNowBtnText}>Activate License Now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* SECTION 1: SECURE API KEYS (BYOK) */}
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
          <Text style={styles.fieldLabel}>OpenAI (ChatGPT) API Key:</Text>
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
            <ExternalLink size={13} color="#34D399" />
            <Text style={[styles.linkButtonText, { color: '#34D399' }]}>👉 ចុចទីនេះដើម្បីបង្កើត OpenAI API Key</Text>
          </TouchableOpacity>
        </View>

        {/* Claude */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Anthropic Claude API Key:</Text>
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
            <ExternalLink size={13} color="#FBBF24" />
            <Text style={[styles.linkButtonText, { color: '#FBBF24' }]}>👉 ចុចទីនេះដើម្បីបង្កើត Claude API Key</Text>
          </TouchableOpacity>
        </View>

        {/* DeepSeek */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>DeepSeek API Key:</Text>
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
            <ExternalLink size={13} color="#818CF8" />
            <Text style={[styles.linkButtonText, { color: '#818CF8' }]}>👉 ចុចទីនេះដើម្បីបង្កើត DeepSeek API Key</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SECTION 2: TRANSLATION ENGINE & BATCHING */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Sliders size={18} color="#38BDF8" />
          <Text style={styles.sectionTitle}>Translation Engine Mode</Text>
        </View>

        {/* Mode Selector */}
        <View style={styles.selectorRow}>
          {[
            { id: 'byok', label: 'BYOK AI API' },
            { id: 'google_free', label: 'Free Google' },
            { id: 'manual_batch', label: 'Manual Web' },
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

        {/* Provider selection if BYOK */}
        {translationMode === 'byok' && (
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Active AI Provider:</Text>
            <View style={styles.providerGrid}>
              {[
                { id: 'gemini', label: 'Gemini Flash' },
                { id: 'openai', label: 'GPT-4o Mini' },
                { id: 'claude', label: 'Claude 3.5' },
                { id: 'deepseek', label: 'DeepSeek Chat' },
              ].map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.providerBtn, aiProvider === p.id && styles.providerBtnActive]}
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
          <Text style={styles.fieldLabel}>Segments Per Batch (Default: 200):</Text>
          <View style={styles.selectorRow}>
            {['50', '100', '200', '300', '500'].map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[
                  styles.modePill,
                  batchSize === preset && styles.modePillActive,
                ]}
                onPress={() => setBatchSize(preset)}
              >
                <Text
                  style={[
                    styles.modeText,
                    batchSize === preset && styles.modeTextActive,
                  ]}
                >
                  {preset}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.numberInput, { marginTop: 8 }]}
            value={batchSize}
            onChangeText={setBatchSize}
            keyboardType="numeric"
            placeholder="200"
            placeholderTextColor="#64748B"
          />
        </View>
      </View>

      {/* SECTION 3: VOICE DUBBING & TONE PRESETS */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Mic size={18} color="#10B981" />
          <Text style={styles.sectionTitle}>Khmer TTS Voice & Tone Presets</Text>
        </View>

        {/* Voice Mode */}
        <View style={styles.selectorRow}>
          {[
            { id: 'AUTO_DETECT', label: 'Auto (AI Tagged)' },
            { id: 'MALE_ONLY', label: 'Male (Piseth)' },
            { id: 'FEMALE_ONLY', label: 'Female (Sreymom)' },
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

        {/* Tone presets explanation card */}
        <View style={styles.presetExplCard}>
          <Text style={styles.presetTitle}>Active Tone Shifting Profiles:</Text>
          <Text style={styles.presetItem}>• Adult (Default): Pitch 0Hz, Rate +0%</Text>
          <Text style={styles.presetItem}>• Old Man / Elder: Pitch -18Hz, Rate -8%</Text>
          <Text style={styles.presetItem}>• Child / Kid: Pitch +30Hz, Rate +10%</Text>
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

      {/* SECTION 4: BGM & EXPORT */}
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

      {/* SECTION 5: BACKEND EXTRACTION SERVICE */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Globe size={18} color="#38BDF8" />
          <Text style={styles.sectionTitle}>Backend Extraction API</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Local or remote microservice for downloading videos and subtitles from URL.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Backend Extraction API URL:</Text>
          <TextInput
            style={styles.textInput}
            value={backendApiUrl}
            onChangeText={setBackendApiUrl}
            placeholder="http://192.168.1.X:8000"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helperText}>
            Points to your PC's local IP running the extraction service (e.g. http://192.168.1.50:8000). The app sends requests to /extract.
          </Text>
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAll}>
        <Save size={18} color="#FFFFFF" />
        <Text style={styles.saveBtnText}>Save All Settings & Keys</Text>
      </TouchableOpacity>

      {/* License Activation Modal (Can close from settings) */}
      <LicenseActivationModal
        visible={licenseModalVisible}
        canClose={true}
        onClose={() => setLicenseModalVisible(false)}
        onActivated={() => {
          refreshLicenseInfo();
          setLicenseModalVisible(false);
        }}
        title="Upgrade or Renew License"
        subtitle="Enter a new license key to update your tier and quota"
      />

      {/* Admin License Generator Modal */}
      <AdminLicenseGeneratorModal
        visible={adminModalVisible}
        onClose={() => setAdminModalVisible(false)}
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
    paddingBottom: 40,
    gap: 16,
  },
  section: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
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
    fontSize: 15,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 12,
  },
  fieldGroup: {
    marginTop: 10,
  },
  fieldLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  keyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  keyInput: {
    flex: 1,
    color: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  eyeBtn: {
    padding: 10,
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  modePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modePillActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#818CF8',
  },
  modeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  modeTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  providerBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#0F172A',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  providerBtnActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#7DD3FC',
  },
  providerText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  providerTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  numberInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
  },
  helperText: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
  },
  presetExplCard: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  presetTitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  presetItem: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 18,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  switchLabel: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  switchDesc: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
    paddingRight: 10,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#0B132B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  linkButtonText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  khmerGuideCard: {
    backgroundColor: '#0B132B',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E3A8A',
    marginBottom: 12,
  },
  khmerGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  khmerGuideTitle: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  khmerGuideText: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 18,
    marginBottom: 4,
  },
  boldKhmer: {
    fontWeight: '700',
    color: '#F8FAFC',
  },
  codeText: {
    color: '#F59E0B',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  khmerTipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#1E293B',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  khmerTipText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
  },
  licenseCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
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
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tierBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  licenseExpiryText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  licenseDetail: {
    fontSize: 11,
    color: '#CBD5E1',
    lineHeight: 18,
  },
  usageContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  usageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  usageTitle: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  usageStats: {
    fontSize: 11,
    color: '#38BDF8',
    fontWeight: '700',
  },
  usageBarTrack: {
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  usageBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  usageRemainingText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 6,
    textAlign: 'right',
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
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  licenseActionBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  licenseAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  licenseAdminBtnText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  noLicenseBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  noLicenseText: {
    color: '#F87171',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  activateNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 6,
  },
  activateNowBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
});
