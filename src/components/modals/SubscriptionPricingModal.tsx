import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  useWindowDimensions,
  Platform,
} from 'react-native';
import {
  X,
  Check,
  Zap,
  Crown,
  Sparkles,
  ShieldCheck,
  Lock,
  ArrowUpRight,
  Infinity as InfinityIcon,
} from 'lucide-react-native';
import { AbaKhqrModal } from './AbaKhqrModal';
import { SubscriptionInfo } from '../../services/api/authService';
import { centralPaymentClient } from '../../services/payment/centralPaymentService';

export interface PlanOption {
  code: 'FLASH' | 'PRO' | 'PRO_MAX' | 'UNLIMITED';
  name: string;
  price: number;
  dailyMinutes: number | null;
  dailyDisplay: string;
  badge?: string;
  badgeColor?: string;
  features: string[];
}

export const PLANS_CATALOG: PlanOption[] = [
  {
    code: 'FLASH',
    name: 'Flash',
    price: 5,
    dailyMinutes: 150,
    dailyDisplay: '150 min / day (~2.5 hrs)',
    features: [
      '150 minutes daily translation quota',
      'High-speed neural Khmer TTS voices',
      'Full auto-time-stretching & subtitle sync',
      '2 active mobile devices allowed',
    ],
  },
  {
    code: 'PRO',
    name: 'Pro',
    price: 8,
    dailyMinutes: 300,
    dailyDisplay: '300 min / day (~5 hrs)',
    badge: 'POPULAR',
    badgeColor: '#38BDF8',
    features: [
      '300 minutes daily translation quota',
      'All Flash features included',
      'Priority video stream extraction',
      'Batch glossary & repair tools',
      '2 active mobile devices allowed',
    ],
  },
  {
    code: 'PRO_MAX',
    name: 'Pro Max',
    price: 10,
    dailyMinutes: 600,
    dailyDisplay: '600 min / day (~10 hrs)',
    badge: 'HEAVY USE',
    badgeColor: '#F59E0B',
    features: [
      '600 minutes daily translation quota',
      'Multi-speaker automatic gender detection',
      'Background vocal separation & ducking',
      'Lossless stream-copy MP4 export',
      '2 active mobile devices allowed',
    ],
  },
  {
    code: 'UNLIMITED',
    name: 'Unlimited',
    price: 15,
    dailyMinutes: null,
    dailyDisplay: 'No Daily Limit (Unlimited)',
    badge: 'BEST VALUE',
    badgeColor: '#10B981',
    features: [
      'Zero daily minute limits (Fair Use)',
      'Translate unlimited videos every day',
      'Fastest processing pipeline',
      '2 active mobile devices allowed',
      'VIP priority customer support',
    ],
  },
];

interface SubscriptionPricingModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  currentSubscription?: SubscriptionInfo | null;
  onSubscriptionUpdated: (newSub: SubscriptionInfo) => void;
}

export const SubscriptionPricingModal: React.FC<SubscriptionPricingModalProps> = ({
  visible,
  onClose,
  userId,
  currentSubscription,
  onSubscriptionUpdated,
}) => {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      centralPaymentClient.prewarm().catch(() => {});
    }
  }, [visible]);

  const handleSelectPlan = (plan: PlanOption, amountToCharge: number) => {
    if (!userId || userId === 'anonymous_user') {
      Alert.alert(
        '📝 Account Registration Required',
        'Please register or sign in first to select and pay for a subscription plan.'
      );
      return;
    }
    setSelectedPlan(plan);
    setSelectedAmount(amountToCharge);
    setCheckoutVisible(true);
  };

  const handlePaymentSuccess = (sub: SubscriptionInfo) => {
    setCheckoutVisible(false);
    onSubscriptionUpdated(sub);
    onClose();
  };

  // Compute responsive bounded modal height (e.g. 88% on phones, up to 860px on tablets)
  const modalContainerHeight = Math.min(screenHeight * 0.88, 860);
  const modalContainerWidth = Math.min(screenWidth * 0.94, 680);

  return (
    <>
      <Modal
        visible={visible && !checkoutVisible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.overlay}>
          {/* Touchable backdrop so tapping outside container closes modal */}
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={onClose}
          />

          <View
            style={[
              styles.container,
              {
                height: modalContainerHeight,
                maxWidth: modalContainerWidth,
              },
            ]}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.title}>3SAJ Studio Plans</Text>
                <Text style={styles.subtitle}>Select a plan to unlock Khmer video dubbing & translation</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <X size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Active Subscription Banner if user already has an active plan */}
            {currentSubscription && (
              <View style={styles.activeSubBanner}>
                <View style={styles.activeSubBannerIcon}>
                  <Crown size={16} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activeSubBannerTitle}>
                    Current Plan: {currentSubscription.plan_name || currentSubscription.plan_code}
                  </Text>
                  <Text style={styles.activeSubBannerSub}>
                    {currentSubscription.daily_minute_limit
                      ? `${currentSubscription.daily_minute_limit} min/day (${currentSubscription.days_remaining}d remaining)`
                      : `Unlimited min/day (${currentSubscription.days_remaining}d remaining)`}
                    {' • Higher plans prorated automatically with fresh 30-day billing cycle.'}
                  </Text>
                </View>
              </View>
            )}

            {/* Plans List with guaranteed working vertical scroll */}
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
              bounces={true}
              overScrollMode="always"
              scrollEventThrottle={16}
            >
              {PLANS_CATALOG.map((plan) => {
                const currentPlan = PLANS_CATALOG.find((p) => p.code === currentSubscription?.plan_code);
                const currentPrice = currentPlan ? currentPlan.price : 0;
                const isCurrent = !!currentSubscription && currentSubscription.plan_code === plan.code;
                const isDowngrade = !!currentSubscription && !isCurrent && plan.price < currentPrice;
                const isUpgrade = !!currentSubscription && !isCurrent && plan.price > currentPrice;

                // Requirement 2: Prorated upgrade math
                // Remaining Credit = Current Plan Price * (Remaining Days / 30)
                // Upgrade Price = New Plan Price - Remaining Credit (Fresh 30-day billing cycle)
                const remainingDays = currentSubscription ? Math.min(30, Math.max(0, currentSubscription.days_remaining)) : 0;
                const remainingCredit = currentSubscription
                  ? Math.round(currentPrice * (remainingDays / 30.0) * 100) / 100
                  : 0;
                const upgradePrice = isUpgrade
                  ? Math.max(0.50, Math.round((plan.price - remainingCredit) * 100) / 100)
                  : plan.price;

                return (
                  <View
                    key={plan.code}
                    style={[
                      styles.planCard,
                      plan.code === 'PRO' && !isUpgrade && styles.popularCard,
                      isCurrent && styles.currentPlanCard,
                      isUpgrade && styles.upgradePlanCard,
                      isDowngrade && styles.downgradePlanCard,
                    ]}
                  >
                    {/* Top Badges */}
                    {isCurrent ? (
                      <View style={[styles.badge, { backgroundColor: '#10B981' }]}>
                        <Text style={[styles.badgeText, { color: '#FFFFFF' }]}>ACTIVE PLAN</Text>
                      </View>
                    ) : isDowngrade ? (
                      <View style={[styles.badge, { backgroundColor: '#475569' }]}>
                        <Text style={[styles.badgeText, { color: '#E2E8F0' }]}>DOWNGRADE LOCKED</Text>
                      </View>
                    ) : isUpgrade ? (
                      <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}>
                        <Text style={[styles.badgeText, { color: '#0F172A' }]}>
                          UPGRADE • SAVE ${remainingCredit.toFixed(2)}
                        </Text>
                      </View>
                    ) : plan.badge ? (
                      <View style={[styles.badge, { backgroundColor: plan.badgeColor || '#38BDF8' }]}>
                        <Text style={styles.badgeText}>{plan.badge}</Text>
                      </View>
                    ) : null}

                    {/* Header: Plan Name, Quota, Price */}
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.planName}>{plan.name}</Text>
                        <Text style={styles.dailyQuota}>{plan.dailyDisplay}</Text>
                      </View>

                      {/* Price Display */}
                      {isUpgrade ? (
                        <View style={styles.upgradePriceBox}>
                          <Text style={styles.strikethroughPrice}>${plan.price}</Text>
                          <View style={styles.priceContainer}>
                            <Text style={[styles.priceCurrency, { color: '#F59E0B' }]}>$</Text>
                            <Text style={[styles.priceAmount, { color: '#F59E0B' }]}>{upgradePrice.toFixed(2)}</Text>
                          </View>
                          <Text style={styles.proratedLabel}>Prorated • 30 Days</Text>
                        </View>
                      ) : (
                        <View style={styles.priceContainer}>
                          <Text style={styles.priceCurrency}>$</Text>
                          <Text style={styles.priceAmount}>{plan.price}</Text>
                          <Text style={styles.pricePeriod}>/mo</Text>
                        </View>
                      )}
                    </View>

                    {/* Upgrade Credit Note */}
                    {isUpgrade && (
                      <View style={styles.creditAppliedBanner}>
                        <Sparkles size={14} color="#F59E0B" />
                        <Text style={styles.creditAppliedText}>
                          ${remainingCredit.toFixed(2)} credit from {currentPlan?.name} ({remainingDays}d left) deducted. Resets to a fresh 30-day cycle!
                        </Text>
                      </View>
                    )}

                    {/* Downgrade Lock Explanation */}
                    {isDowngrade && (
                      <View style={styles.downgradeNoticeBanner}>
                        <Lock size={14} color="#94A3B8" />
                        <Text style={styles.downgradeNoticeText}>
                          Downgrades locked while your higher {currentPlan?.name} plan is active ({remainingDays}d left).
                        </Text>
                      </View>
                    )}

                    {/* Features List */}
                    <View style={styles.featureList}>
                      {plan.features.map((feat, idx) => (
                        <View key={idx} style={styles.featureItem}>
                          <Check size={14} color={isDowngrade ? '#64748B' : '#10B981'} style={{ marginRight: 6 }} />
                          <Text style={[styles.featureText, isDowngrade && { color: '#64748B' }]}>{feat}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Action Button */}
                    {isCurrent ? (
                      <TouchableOpacity
                        style={[styles.subscribeBtn, styles.activePlanBtn]}
                        disabled={true}
                      >
                        <Text style={[styles.subscribeBtnText, styles.activePlanBtnText]}>
                          Current Plan (Active)
                        </Text>
                      </TouchableOpacity>
                    ) : isDowngrade ? (
                      <TouchableOpacity
                        style={[styles.subscribeBtn, styles.downgradeLockedBtn]}
                        disabled={true}
                      >
                        <Lock size={15} color="#64748B" style={{ marginRight: 6 }} />
                        <Text style={styles.downgradeLockedBtnText}>
                          Locked until Expiry
                        </Text>
                      </TouchableOpacity>
                    ) : isUpgrade ? (
                      <TouchableOpacity
                        style={[styles.subscribeBtn, styles.upgradeBtn]}
                        onPress={() => handleSelectPlan(plan, upgradePrice)}
                      >
                        <ArrowUpRight size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.subscribeBtnText}>
                          Upgrade for ${upgradePrice.toFixed(2)}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.subscribeBtn,
                          plan.code === 'PRO' && styles.popularBtn,
                        ]}
                        onPress={() => handleSelectPlan(plan, plan.price)}
                      >
                        <Text style={styles.subscribeBtnText}>
                          Choose {plan.name} — ${plan.price}/mo
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}

              <View style={styles.footerNote}>
                <ShieldCheck size={14} color="#64748B" />
                <Text style={styles.footerNoteText}>
                  Instant activation via ABA KHQR. Quota resets daily at midnight Cambodia time.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ABA KHQR Checkout Modal */}
      {selectedPlan && (
        <AbaKhqrModal
          visible={checkoutVisible}
          onClose={() => setCheckoutVisible(false)}
          planCode={selectedPlan.code}
          planName={selectedPlan.name}
          amount={selectedAmount || selectedPlan.price}
          userId={userId}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  container: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  scrollArea: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 60,
    gap: 16,
  },
  planCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative',
  },
  popularCard: {
    borderColor: '#38BDF8',
    backgroundColor: '#0B1E36',
  },
  currentPlanCard: {
    borderColor: '#10B981',
  },
  upgradePlanCard: {
    borderColor: '#F59E0B',
    backgroundColor: '#181611',
  },
  downgradePlanCard: {
    borderColor: '#334155',
    opacity: 0.65,
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    color: '#0F172A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  planName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  dailyQuota: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: '600',
    marginTop: 2,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceCurrency: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94A3B8',
  },
  priceAmount: {
    fontSize: 26,
    fontWeight: '900',
    color: '#F8FAFC',
  },
  pricePeriod: {
    fontSize: 12,
    color: '#94A3B8',
  },
  upgradePriceBox: {
    alignItems: 'flex-end',
  },
  strikethroughPrice: {
    fontSize: 12,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
    fontWeight: '600',
  },
  proratedLabel: {
    fontSize: 10,
    color: '#F59E0B',
    fontWeight: '700',
    marginTop: 2,
  },
  creditAppliedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    marginBottom: 12,
  },
  creditAppliedText: {
    color: '#FCD34D',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
    lineHeight: 15,
  },
  downgradeNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(100, 116, 139, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(100, 116, 139, 0.25)',
    marginBottom: 12,
  },
  downgradeNoticeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
    lineHeight: 15,
  },
  featureList: {
    gap: 6,
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 12,
    color: '#CBD5E1',
    flex: 1,
  },
  subscribeBtn: {
    backgroundColor: '#005F73',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  popularBtn: {
    backgroundColor: '#0284C7',
  },
  activePlanBtn: {
    backgroundColor: '#064E3B',
  },
  subscribeBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  activePlanBtnText: {
    color: '#10B981',
  },
  upgradeBtn: {
    backgroundColor: '#D97706',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downgradeLockedBtn: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downgradeLockedBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
  activeSubBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  activeSubBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeSubBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  activeSubBannerSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    lineHeight: 15,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginBottom: 20,
  },
  footerNoteText: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
    flex: 1,
  },
});
