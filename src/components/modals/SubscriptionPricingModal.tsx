import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {
  X,
  Check,
  Zap,
  Crown,
  Sparkles,
  ShieldCheck,
  Infinity as InfinityIcon,
} from 'lucide-react-native';
import { AbaKhqrModal } from './AbaKhqrModal';
import { SubscriptionInfo } from '../../services/api/authService';

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
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  const handleSelectPlan = (plan: PlanOption) => {
    setSelectedPlan(plan);
    setCheckoutVisible(true);
  };

  const handlePaymentSuccess = (sub: SubscriptionInfo) => {
    setCheckoutVisible(false);
    onSubscriptionUpdated(sub);
    onClose();
  };

  return (
    <>
      <Modal visible={visible && !checkoutVisible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>3SAJ Studio Plans</Text>
                <Text style={styles.subtitle}>Select a plan to unlock Khmer video dubbing & translation</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
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
                      ? `${currentSubscription.daily_minute_limit} minutes/day (${currentSubscription.days_remaining}d remaining)`
                      : `Unlimited minutes/day (${currentSubscription.days_remaining}d remaining)`}
                    {' • Choose a higher plan below to upgrade instantly.'}
                  </Text>
                </View>
              </View>
            )}

            {/* Plans List */}
            <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {PLANS_CATALOG.map((plan) => {
                const isCurrent = currentSubscription?.plan_code === plan.code;
                const currentPlan = PLANS_CATALOG.find((p) => p.code === currentSubscription?.plan_code);
                const currentPrice = currentPlan ? currentPlan.price : 0;

                let ctaText = `Choose ${plan.name} — $${plan.price}/mo`;
                if (isCurrent) {
                  ctaText = 'Current Plan (Active)';
                } else if (currentSubscription) {
                  ctaText = plan.price > currentPrice
                    ? `Upgrade to ${plan.name} — $${plan.price}/mo`
                    : `Switch to ${plan.name} — $${plan.price}/mo`;
                }

                return (
                  <View
                    key={plan.code}
                    style={[
                      styles.planCard,
                      plan.code === 'PRO' && styles.popularCard,
                      isCurrent && styles.currentPlanCard,
                    ]}
                  >
                    {plan.badge && (
                      <View style={[styles.badge, { backgroundColor: plan.badgeColor || '#38BDF8' }]}>
                        <Text style={styles.badgeText}>{plan.badge}</Text>
                      </View>
                    )}

                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={styles.planName}>{plan.name}</Text>
                        <Text style={styles.dailyQuota}>{plan.dailyDisplay}</Text>
                      </View>
                      <View style={styles.priceContainer}>
                        <Text style={styles.priceCurrency}>$</Text>
                        <Text style={styles.priceAmount}>{plan.price}</Text>
                        <Text style={styles.pricePeriod}>/mo</Text>
                      </View>
                    </View>

                    <View style={styles.featureList}>
                      {plan.features.map((feat, idx) => (
                        <View key={idx} style={styles.featureItem}>
                          <Check size={14} color="#10B981" style={{ marginRight: 6 }} />
                          <Text style={styles.featureText}>{feat}</Text>
                        </View>
                      ))}
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.subscribeBtn,
                        plan.code === 'PRO' && styles.popularBtn,
                        isCurrent && styles.activePlanBtn,
                        !isCurrent && currentSubscription && plan.price > currentPrice && styles.upgradeBtn,
                      ]}
                      disabled={isCurrent}
                      onPress={() => handleSelectPlan(plan)}
                    >
                      <Text style={[styles.subscribeBtnText, isCurrent && styles.activePlanBtnText]}>
                        {ctaText}
                      </Text>
                    </TouchableOpacity>
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
          amount={selectedPlan.price}
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
  },
  container: {
    maxHeight: '90%',
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
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
    padding: 4,
  },
  scrollArea: {
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingVertical: 16,
    gap: 14,
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
    backgroundColor: '#0284C7',
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
