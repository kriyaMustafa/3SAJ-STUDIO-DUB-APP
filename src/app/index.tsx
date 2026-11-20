import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {
  Plus,
  Settings as SettingsIcon,
  Video,
  FileText,
  Trash2,
  HardDrive,
  CheckCircle2,
  FolderOpen,
  Link2,
  Sparkles,
  Zap,
  Award,
  Crown,
  CreditCard,
  Download,
} from 'lucide-react-native';
import { useProjectStore } from '../store/useProjectStore';
import { Project } from '../types/project';
import { ImportFromUrlModal } from '../components/modals/ImportFromUrlModal';
import { SubscriptionPricingModal } from '../components/modals/SubscriptionPricingModal';
import { AuthModal } from '../components/modals/AuthModal';
import { checkAppLicense } from '../services/licenseService';
import { authService, SubscriptionInfo, UserProfile } from '../services/api/authService';
import { LicenseStatus, TIER_CONFIGS } from '../types/license';
import { videoSaveService } from '../services/videoSaveService';
import { centralPaymentClient } from '../services/payment/centralPaymentService';

export default function ProjectDashboardScreen() {
  const router = useRouter();
  const {
    projects,
    settings,
    createProject,
    deleteProject,
    cleanupProjectCache,
    selectProject,
    importFromUrlAndTranslate,
  } = useProjectStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<'LOGIN' | 'REGISTER'>('REGISTER');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [currentSub, setCurrentSub] = useState<SubscriptionInfo | null>(null);
  const [projectName, setProjectName] = useState('');
  const [videoFile, setVideoFile] = useState<{ uri: string; name: string } | null>(null);
  const [srtFile, setSrtFile] = useState<{ uri: string; name: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseStatus | null>(null);

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

  const refreshLicense = async () => {
    try {
      if (settings?.backendApiUrl) {
        authService.setBackendUrl(settings.backendApiUrl);
      }
      const token = await authService.getAccessToken();
      let profile: any = null;
      if (!token) {
        setCurrentUser(null);
        setCurrentSub(null);
      } else {
        profile = await authService.getCurrentProfile();
        if (profile) {
          setCurrentUser(profile.user);
          setCurrentSub(profile.subscription);
        } else {
          setCurrentUser(null);
          setCurrentSub(null);
        }
      }
      const lic = await checkAppLicense(profile);
      setLicenseInfo(lic);
    } catch (_) {
      setCurrentUser(null);
      setCurrentSub(null);
      const lic = await checkAppLicense();
      setLicenseInfo(lic);
    }
  };

  React.useEffect(() => {
    // Instant cache read for zero-latency screen render
    authService.getStoredUserProfile().then((cached) => {
      if (cached) setCurrentUser(cached);
    });

    refreshLicense();
    centralPaymentClient.prewarm().catch(() => {});
    // Real-time auth listener: updates dashboard immediately on sign-in or sign-out!
    const unsub = authService.onAuthStateChanged((user, sub) => {
      setCurrentUser(user);
      if (sub !== undefined) {
        setCurrentSub(sub);
      }
      if (!user) {
        setLicenseInfo(null);
      }
      refreshLicense();
    });
    return unsub;
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshLicense();
    }, [])
  );

  const handlePickVideo = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['video/mp4', 'video/*'],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setVideoFile({ uri: asset.uri, name: asset.name });
        if (!projectName) {
          setProjectName(asset.name.replace(/\.[^/.]+$/, ''));
        }
      }
    } catch (err) {
      console.warn('Error picking video:', err);
    }
  };

  const handlePickSrt = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        if (!asset.name.toLowerCase().endsWith('.srt')) {
          Alert.alert('Invalid File', 'Please select a valid .srt subtitle file.');
          return;
        }
        setSrtFile({ uri: asset.uri, name: asset.name });
      }
    } catch (err) {
      console.warn('Error picking SRT:', err);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim() || !videoFile || !srtFile) {
      Alert.alert(
        'Missing Information',
        'Please enter a project name and select both a video file and an .srt subtitle file.'
      );
      return;
    }

    setIsCreating(true);
    try {
      const newProjectId = await createProject(
        projectName.trim(),
        videoFile.uri,
        srtFile.uri
      );
      setModalVisible(false);
      setProjectName('');
      setVideoFile(null);
      setSrtFile(null);
      router.push(`/editor/${newProjectId}`);
    } catch (err: any) {
      Alert.alert('Project Creation Failed', err.message || 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenProject = async (project: Project) => {
    await selectProject(project.id);
    router.push(`/editor/${project.id}`);
  };

  const handleCleanupCache = (project: Project) => {
    Alert.alert(
      'Free Up Memory',
      `Delete temporary TTS .mp3 chunks and intermediate audio files for "${project.name}"? Final exported videos will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clean Cache',
          style: 'destructive',
          onPress: async () => {
            await cleanupProjectCache(project.id);
            Alert.alert('Cleaned', 'Temporary project cache cleared successfully.');
          },
        },
      ]
    );
  };

  const handleDeleteProject = (project: Project) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.name}" and all its workspace data?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteProject(project.id);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appTitle} numberOfLines={1}>3SAJ STUDIO</Text>
          <Text style={styles.appSubtitle} numberOfLines={1}>
            Khmer AI Donghua & Drama Dubbing
          </Text>
        </View>

        <View style={styles.headerRight}>
          {licenseInfo?.isValid && licenseInfo.license ? (
            <TouchableOpacity
              style={[
                styles.headerPlanBadge,
                { borderColor: TIER_CONFIGS[licenseInfo.license.tier]?.badgeColor || '#38BDF8' },
              ]}
              onPress={handleOpenBuyPlan}
            >
              {licenseInfo.license.tier === 'FLASH' && <Zap size={13} color="#F59E0B" />}
              {licenseInfo.license.tier === 'PRO' && <Award size={13} color="#38BDF8" />}
              {licenseInfo.license.tier === 'PRO_MAX' && <Crown size={13} color="#A855F7" />}
              {licenseInfo.license.tier === 'UNLIMITED' && <Sparkles size={13} color="#10B981" />}
              {licenseInfo.license.tier === 'PREMIUM' && <Crown size={13} color="#A855F7" />}
              <Text
                style={[
                  styles.headerPlanText,
                  { color: TIER_CONFIGS[licenseInfo.license.tier]?.badgeColor || '#38BDF8' },
                ]}
              >
                {TIER_CONFIGS[licenseInfo.license.tier]?.displayName || licenseInfo.license.tier}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.headerBuyBtn}
              onPress={handleOpenBuyPlan}
            >
              <CreditCard size={13} color="#FFF" style={{ marginRight: 4 }} />
              <Text style={styles.headerBuyBtnText}>Buy Plan</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings & API Keys"
          >
            <SettingsIcon size={20} color="#F8FAFC" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Dedicated Settings & API Keys Button (Phone accessible navigation) */}
      <TouchableOpacity
        style={styles.settingsNavCard}
        onPress={() => router.push('/settings')}
        activeOpacity={0.85}
      >
        <View style={styles.settingsNavCardLeft}>
          <View style={styles.settingsNavIconBox}>
            <SettingsIcon size={18} color="#38BDF8" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.settingsNavTitle}>Settings & API Keys</Text>
              {currentUser?.email ? (
                <View style={styles.loggedInBadge}>
                  <Text style={styles.loggedInBadgeText}>Signed In</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.settingsNavSubtitle} numberOfLines={1}>
              {currentUser?.email
                ? `${currentUser.email} • Manage Plan & Keys`
                : 'Account Sign In • Plans & Quotas • AI Models (Gemini/Claude)'}
            </Text>
          </View>
        </View>
        <View style={styles.settingsNavArrow}>
          <Text style={styles.settingsNavArrowText}>Open ⚙️</Text>
        </View>
      </TouchableOpacity>

      {/* Prominent Buy with ABA QR Banner when no active plan */}
      {(!licenseInfo?.isValid || !licenseInfo.license) && (
        <TouchableOpacity
          style={styles.subscribeBanner}
          onPress={handleOpenBuyPlan}
          activeOpacity={0.88}
        >
          <View style={styles.subscribeBannerLeft}>
            <View style={styles.subscribeIconBox}>
              <CreditCard size={20} color="#10B981" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.subscribeTitle}>Subscribe with ABA PayWay</Text>
                <View style={styles.abaBadgeSmall}>
                  <Text style={styles.abaBadgeSmallText}>KHQR</Text>
                </View>
              </View>
              <Text style={styles.subscribeSubtitle}>
                Flash ($5) • Pro ($8) • Pro Max ($10) • Unlimited ($15)
              </Text>
            </View>
          </View>
          <View style={styles.subscribeActionBtn}>
            <Text style={styles.subscribeActionText}>Buy with ABA QR</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Workspace Indicator Card */}
      <View style={styles.workspaceCard}>
        <View style={styles.workspaceHeader}>
          <FolderOpen size={16} color="#38BDF8" />
          <Text style={styles.workspaceTitle}>Active Workspace Directory</Text>
        </View>
        <Text style={styles.workspacePath} numberOfLines={1}>
          {settings.workspaceDir}
        </Text>
      </View>

      {/* URL Downloader & Auto-Translate Hero Banner */}
      <TouchableOpacity
        style={styles.urlBanner}
        onPress={() => setUrlModalVisible(true)}
        activeOpacity={0.85}
      >
        <View style={styles.urlBannerLeft}>
          <View style={styles.urlBannerIcon}>
            <Link2 size={20} color="#818CF8" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.urlBannerTitle}>Import from Video URL</Text>
              <View style={styles.autoBadge}>
                <Sparkles size={10} color="#10B981" />
                <Text style={styles.autoBadgeText}>Auto-Translate</Text>
              </View>
            </View>
            <Text style={styles.urlBannerDesc} numberOfLines={1}>
              Paste YouTube or Bilibili link • Auto-Download & Dub
            </Text>
          </View>
        </View>
        <View style={styles.urlBannerAction}>
          <Text style={styles.urlBannerActionText}>Paste Link</Text>
        </View>
      </TouchableOpacity>

      {/* Action Bar */}
      <View style={styles.actionBar}>
        <Text style={styles.sectionTitle}>
          Projects ({projects.length})
        </Text>
        <View style={styles.actionBtnGroup}>
          <TouchableOpacity
            style={styles.urlQuickBtn}
            onPress={() => setUrlModalVisible(true)}
          >
            <Link2 size={15} color="#818CF8" />
            <Text style={styles.urlQuickBtnText}>From URL</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.newProjectBtn}
            onPress={() => setModalVisible(true)}
          >
            <Plus size={16} color="#FFFFFF" />
            <Text style={styles.newProjectText}>New File</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Projects List */}
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.projectCard}
            onPress={() => handleOpenProject(item)}
            activeOpacity={0.8}
          >
            <View style={styles.projectCardTop}>
              <View style={styles.projectTitleContainer}>
                <Text style={styles.projectName}>{item.name}</Text>
                <Text style={styles.projectDate}>
                  {new Date(item.updatedAt).toLocaleDateString()} • {item.totalSegments} Segments
                </Text>
              </View>

              {item.isExported && (
                <View style={styles.exportedBadge}>
                  <CheckCircle2 size={12} color="#10B981" />
                  <Text style={styles.exportedText}>Exported</Text>
                </View>
              )}
            </View>

            {/* Metrics Chips */}
            <View style={styles.metricsRow}>
              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>Translated:</Text>
                <Text style={styles.metricValue}>
                  {item.translatedSegments} / {item.totalSegments}
                </Text>
              </View>

              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>TTS Audio:</Text>
                <Text style={styles.metricValue}>
                  {item.audioSegments} / {item.totalSegments}
                </Text>
              </View>
            </View>

            {/* Bottom Actions */}
            <View style={styles.cardBottomRow}>
              {item.isExported && item.exportPath && (
                <TouchableOpacity
                  style={styles.saveVideoBtn}
                  onPress={() => videoSaveService.promptVideoActions(item.exportPath!, item.name)}
                >
                  <Download size={14} color="#10B981" />
                  <Text style={styles.saveVideoBtnText}>Save Video</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.cleanBtn}
                onPress={() => handleCleanupCache(item)}
              >
                <HardDrive size={14} color="#F59E0B" />
                <Text style={styles.cleanBtnText}>Free Cache</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteProject(item)}
              >
                <Trash2 size={14} color="#EF4444" />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Video size={48} color="#334155" />
            <Text style={styles.emptyTitle}>No Projects Yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap "New Dubbing Project" to import a video and .srt file.
            </Text>
          </View>
        }
      />

      {/* New Project Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeaderTitle}>Create Dubbing Project</Text>

            {/* Project Name */}
            <Text style={styles.fieldLabel}>Project Name:</Text>
            <TextInput
              style={styles.textInput}
              value={projectName}
              onChangeText={setProjectName}
              placeholder="e.g. Battle Through The Heavens Ep 1"
              placeholderTextColor="#64748B"
            />

            {/* Video File Picker */}
            <Text style={styles.fieldLabel}>Source Video (.mp4):</Text>
            <TouchableOpacity
              style={[styles.filePickerBtn, videoFile && styles.filePickerSelected]}
              onPress={handlePickVideo}
            >
              <Video size={18} color={videoFile ? '#38BDF8' : '#94A3B8'} />
              <Text
                style={[styles.filePickerText, videoFile && styles.filePickerTextSelected]}
                numberOfLines={1}
              >
                {videoFile ? videoFile.name : 'Select Video File...'}
              </Text>
            </TouchableOpacity>

            {/* Subtitle File Picker */}
            <Text style={styles.fieldLabel}>Source Subtitles (.srt):</Text>
            <TouchableOpacity
              style={[styles.filePickerBtn, srtFile && styles.filePickerSelected]}
              onPress={handlePickSrt}
            >
              <FileText size={18} color={srtFile ? '#FDE047' : '#94A3B8'} />
              <Text
                style={[styles.filePickerText, srtFile && styles.filePickerTextSelected]}
                numberOfLines={1}
              >
                {srtFile ? srtFile.name : 'Select .SRT File...'}
              </Text>
            </TouchableOpacity>

            {/* Modal Actions */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalCreateBtn, isCreating && { opacity: 0.6 }]}
                onPress={handleCreateProject}
                disabled={isCreating}
              >
                {isCreating ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalCreateText}>Import & Initialize</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* URL Downloader & Auto-Translate Modal */}
      <ImportFromUrlModal
        visible={urlModalVisible}
        onClose={() => setUrlModalVisible(false)}
        onImport={importFromUrlAndTranslate}
        onRequestSubscription={handleOpenBuyPlan}
        onSuccess={(newProjectId) => {
          router.push(`/editor/${newProjectId}`);
        }}
      />

      {/* Subscription Pricing Modal (Buy with ABA PayWay KHQR) */}
      <SubscriptionPricingModal
        visible={pricingModalVisible}
        onClose={() => setPricingModalVisible(false)}
        userId={currentUser?.id || (currentUser as any)?.user_id || 'anonymous_user'}
        currentSubscription={currentSub}
        onSubscriptionUpdated={async (newSub) => {
          setCurrentSub(newSub);
          await refreshLicense();
        }}
        onRequestAuth={() => setAuthModalVisible(true)}
      />

      {/* Auth & Account Registration Modal */}
      <AuthModal
        visible={authModalVisible}
        initialTab={authInitialTab}
        onClose={() => setAuthModalVisible(false)}
        onAuthSuccess={async (user) => {
          setCurrentUser(user);
          setAuthModalVisible(false);
          await refreshLicense();
          // Automatically open subscription plan options once signed in / registered
          setPricingModalVisible(true);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  appTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerPlanBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
  },
  headerPlanText: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerBuyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#005F73',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerBuyBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  settingsNavCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  settingsNavCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  settingsNavIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsNavTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsNavSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  settingsNavArrow: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  settingsNavArrowText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  loggedInBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  loggedInBadgeText: {
    color: '#10B981',
    fontSize: 9,
    fontWeight: '700',
  },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1E36',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  subscribeBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subscribeIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
  },
  abaBadgeSmall: {
    backgroundColor: '#005F73',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  abaBadgeSmallText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
  },
  subscribeSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  subscribeActionBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  subscribeActionText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  workspaceCard: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  workspaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  workspaceTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  workspacePath: {
    color: '#E2E8F0',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  urlBanner: {
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  urlBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  urlBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  urlBannerTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  urlBannerDesc: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  autoBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
  },
  urlBannerAction: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  urlBannerActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  actionBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urlQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 5,
  },
  urlQuickBtnText: {
    color: '#818CF8',
    fontSize: 13,
    fontWeight: '600',
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  newProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4F46E5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  newProjectText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  projectCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  projectCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  projectTitleContainer: {
    flex: 1,
  },
  projectName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  projectDate: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  exportedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  exportedText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 6,
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 11,
  },
  metricValue: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
  },
  saveVideoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  saveVideoBtnText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
  },
  cleanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  cleanBtnText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  deleteBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    color: '#CBD5E1',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeaderTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filePickerSelected: {
    borderColor: '#4F46E5',
    backgroundColor: '#1E1B4B',
  },
  filePickerText: {
    color: '#94A3B8',
    fontSize: 13,
    flex: 1,
  },
  filePickerTextSelected: {
    color: '#F8FAFC',
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#334155',
  },
  modalCancelText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  modalCreateBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#10B981',
  },
  modalCreateText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
