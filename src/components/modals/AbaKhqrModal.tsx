import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import {
  X,
  CheckCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Clock,
  Smartphone,
} from 'lucide-react-native';
import {
  centralPaymentClient,
  PaymentSessionResponse,
  PaymentStatusResponse,
} from '../../services/payment/centralPaymentService';
import { authService, SubscriptionInfo } from '../../services/api/authService';

interface AbaKhqrModalProps {
  visible: boolean;
  onClose: () => void;
  planCode: string;
  planName: string;
  amount: number;
  userId: string;
  onPaymentSuccess: (subscription: SubscriptionInfo) => void;
}

export const AbaKhqrModal: React.FC<AbaKhqrModalProps> = ({
  visible,
  onClose,
  planCode,
  planName,
  amount,
  userId,
  onPaymentSuccess,
}) => {
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Generating ABA KHQR Code...');
  const [session, setSession] = useState<PaymentSessionResponse | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED'>('PENDING');
  const [secondsRemaining, setSecondsRemaining] = useState(300); // 5 minutes default (matches Central Payment settings)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollCancelledRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      pollCancelledRef.current = true;
      setSession(null);
      setPaymentStatus('PENDING');
      setErrorMessage(null);
      return;
    }

    pollCancelledRef.current = false;
    setLoadingMessage('Generating ABA KHQR Code...');
    initPayment();

    const loadTimer = setTimeout(() => {
      setLoadingMessage('Connecting to secure payment gateway...\n(Server waking up, almost ready)');
    }, 4000);

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setPaymentStatus('EXPIRED');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(loadTimer);
      clearInterval(timer);
      pollCancelledRef.current = true;
    };
  }, [visible, planCode, amount, userId]);

  const initPayment = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      // 1. Initiate payment session with 3SAJ Central Payment Gateway
      const paymentData = await centralPaymentClient.createPayment({
        amount,
        customerReference: userId || 'app_user',
        currency: 'USD',
        planCode,
        planTitle: planName,
      });

      // Synchronize exact expiration with Central Payment's expires_at (defaults to 5 minutes / 300s)
      let expireSeconds = 300;
      if (paymentData.expires_at) {
        try {
          const expireTime = new Date(paymentData.expires_at).getTime();
          const now = Date.now();
          const diff = Math.round((expireTime - now) / 1000);
          if (diff > 10 && diff < 86400) {
            expireSeconds = diff;
          }
        } catch (e) {
          console.warn('Failed parsing paymentData.expires_at:', e);
        }
      }

      setSecondsRemaining(expireSeconds);
      setSession(paymentData);
      setLoading(false);

      // 2. Start polling for status matching the authoritative Central Payment expiration
      startPolling(paymentData.payment_id, expireSeconds);
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Failed to generate ABA KHQR invoice.');
    }
  };

  const startPolling = async (paymentId: string, maxSeconds: number = 300) => {
    try {
      await centralPaymentClient.pollPaymentStatus(
        paymentId,
        async (status: PaymentStatusResponse) => {
          if (pollCancelledRef.current) return;

          if (status.status === 'PAID') {
            setPaymentStatus('PAID');
            pollCancelledRef.current = true;

            // Verify with backend to activate subscription in Neon DB
            try {
              const verifyRes = await authService.verifySubscriptionPayment(paymentId, planCode);
              const activeSub = verifyRes.subscription;
              // Automatically return back to the app after 1.5 seconds
              setTimeout(() => {
                if (activeSub) {
                  onPaymentSuccess(activeSub);
                }
                onClose();
              }, 1500);
            } catch (e) {
              console.warn('Subscription activation verification error:', e);
              setTimeout(() => {
                onClose();
              }, 1500);
            }
          } else if (['FAILED', 'EXPIRED'].includes(status.status)) {
            setPaymentStatus(status.status as any);
            pollCancelledRef.current = true;
          }
        },
        maxSeconds,
        2500
      );
    } catch (e) {
      if (!pollCancelledRef.current) {
        console.warn('Polling ended:', e);
      }
    }
  };

  const handleOpenAbaApp = async () => {
    if (!session?.abapay_deeplink) return;
    const opened = await centralPaymentClient.openABAMobileApp(session.abapay_deeplink);
    if (!opened) {
      Alert.alert(
        'ABA Mobile App',
        'ABA Mobile Bank app could not be opened automatically. Please scan the QR code using your ABA Mobile app.'
      );
    }
  };

  const formatCountdown = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const qrImageUri = session?.qr_image
    ? session.qr_image.startsWith('data:')
      ? session.qr_image
      : `data:image/png;base64,${session.qr_image}`
    : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={styles.abaBadge}>
                <Text style={styles.abaBadgeText}>ABA PayWay</Text>
              </View>
              <Text style={styles.title}>Scan to Pay</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#005F73" />
              <Text style={[styles.loadingText, { textAlign: 'center', lineHeight: 20 }]}>{loadingMessage}</Text>
            </View>
          ) : errorMessage ? (
            <View style={styles.centerContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={initPayment}>
                <RefreshCw size={16} color="#FFF" style={{ marginRight: 6 }} />
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : paymentStatus === 'PAID' ? (
            <View style={styles.centerContainer}>
              <CheckCircle size={64} color="#10B981" />
              <Text style={styles.paidTitle}>Payment Successful!</Text>
              <Text style={styles.paidSubtext}>
                Your {planName} subscription is now active for 30 days!
              </Text>
              <Text style={{ color: '#38BDF8', fontSize: 13, marginTop: 12, fontWeight: '600' }}>
                Returning to app...
              </Text>
            </View>
          ) : paymentStatus === 'EXPIRED' ? (
            <View style={styles.centerContainer}>
              <Clock size={64} color="#EF4444" />
              <Text style={styles.paidTitle}>Invoice Expired</Text>
              <Text style={styles.paidSubtext}>
                This payment session has expired. Tap below to generate a new ABA KHQR code.
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={initPayment}>
                <RefreshCw size={16} color="#FFF" style={{ marginRight: 6 }} />
                <Text style={styles.retryBtnText}>Generate New QR</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              style={{ maxHeight: 520 }}
              contentContainerStyle={{ paddingBottom: 10 }}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={true}
            >
              {/* Plan & Amount Summary */}
              <View style={styles.amountCard}>
                <View>
                  <Text style={styles.planNameText}>{planName} Subscription</Text>
                  <Text style={styles.durationText}>30 Days Access</Text>
                </View>
                <Text style={styles.amountText}>${amount.toFixed(2)} USD</Text>
              </View>

              {/* Dynamic KHQR Display */}
              <View style={styles.qrContainer}>
                {qrImageUri ? (
                  <Image source={{ uri: qrImageUri }} style={styles.qrImage} resizeMode="contain" />
                ) : (
                  <View style={styles.qrFallback}>
                    <Text style={styles.qrFallbackText}>KHQR Image Generating...</Text>
                  </View>
                )}
                <View style={styles.khqrFooter}>
                  <Text style={styles.khqrBrand}>KHQR</Text>
                  <Text style={styles.khqrSub}>Bakong & ABA Mobile Accepted</Text>
                </View>
              </View>

              {/* Countdown & Status */}
              <View style={styles.countdownRow}>
                <Clock size={14} color="#E02424" />
                <Text style={styles.countdownText}>
                  Valid for: {formatCountdown(secondsRemaining)}
                </Text>
                <View style={styles.liveIndicator}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.liveText}>Awaiting payment...</Text>
                </View>
              </View>

              {/* ABA Mobile Deeplink Action */}
              {session?.abapay_deeplink && (
                <TouchableOpacity style={styles.abaDeeplinkBtn} onPress={handleOpenAbaApp}>
                  <Smartphone size={18} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.abaDeeplinkText}>Pay with ABA Mobile</Text>
                  <ExternalLink size={16} color="#FFF" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              )}

              <Text style={styles.hintText}>
                Open your ABA Mobile App, tap KHQR, and scan the QR code above.
              </Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  abaBadge: {
    backgroundColor: '#005F73',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  abaBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  closeBtn: {
    padding: 6,
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  loadingText: {
    marginTop: 14,
    color: '#94A3B8',
    fontSize: 14,
  },
  errorText: {
    color: '#F87171',
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 16,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#005F73',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
  paidTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#10B981',
    marginTop: 16,
  },
  paidSubtext: {
    color: '#94A3B8',
    textAlign: 'center',
    fontSize: 13,
    marginTop: 6,
    marginBottom: 20,
  },
  doneBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  doneBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },
  content: {
    alignItems: 'center',
  },
  amountCard: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  planNameText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  durationText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  amountText: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '800',
  },
  qrContainer: {
    width: 230,
    height: 250,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  qrImage: {
    width: 200,
    height: 200,
  },
  qrFallback: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrFallbackText: {
    color: '#475569',
    fontSize: 12,
  },
  khqrFooter: {
    alignItems: 'center',
    marginTop: 4,
  },
  khqrBrand: {
    color: '#E02424',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 2,
  },
  khqrSub: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '600',
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 14,
    paddingHorizontal: 4,
  },
  countdownText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
    marginRight: 6,
  },
  liveText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  abaDeeplinkBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#005F73',
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 14,
  },
  abaDeeplinkText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },
  hintText: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
  },
});
