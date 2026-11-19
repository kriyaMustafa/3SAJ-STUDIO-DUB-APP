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
  Smartphone,
  Trash2,
  ShieldCheck,
  CheckCircle,
} from 'lucide-react-native';
import { authService, DeviceInfo } from '../../services/api/authService';

interface DeviceManagementModalProps {
  visible: boolean;
  onClose: () => void;
}

export const DeviceManagementModal: React.FC<DeviceManagementModalProps> = ({
  visible,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    if (visible) {
      loadDevices();
    }
  }, [visible]);

  const loadDevices = async () => {
    try {
      setLoading(true);
      const list = await authService.listDevices();
      setDevices(list);
    } catch (e: any) {
      console.warn('Failed loading devices:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (deviceId: string, deviceName: string) => {
    Alert.alert(
      'Disconnect Device',
      `Are you sure you want to log out "${deviceName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const ok = await authService.revokeDevice(deviceId);
              if (ok) {
                await loadDevices();
              } else {
                Alert.alert('Error', 'Could not disconnect device.');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed disconnecting device.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Connected Devices</Text>
              <Text style={styles.subtitle}>Maximum 2 active devices per account</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Device List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#005F73" />
            </View>
          ) : (
            <View style={styles.list}>
              {devices.map((device) => (
                <View
                  key={device.device_id}
                  style={[
                    styles.deviceCard,
                    device.is_current && styles.currentDeviceCard,
                  ]}
                >
                  <Smartphone size={22} color={device.is_current ? '#10B981' : '#38BDF8'} />
                  <View style={styles.deviceInfo}>
                    <View style={styles.nameRow}>
                      <Text style={styles.deviceName}>{device.device_name || 'Mobile Device'}</Text>
                      {device.is_current && (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>This Phone</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.deviceMeta}>
                      Platform: {device.platform?.toUpperCase()} • {device.is_active ? 'Active' : 'Revoked'}
                    </Text>
                  </View>

                  {!device.is_current && (
                    <TouchableOpacity
                      style={styles.disconnectBtn}
                      onPress={() => handleRevoke(device.device_id, device.device_name)}
                    >
                      <Trash2 size={16} color="#EF4444" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              {devices.length === 0 && (
                <Text style={styles.emptyText}>No registered devices found.</Text>
              )}

              <View style={styles.infoBox}>
                <ShieldCheck size={14} color="#64748B" />
                <Text style={styles.infoText}>
                  Your subscription is protected. Reinstalling the app or switching between your 2 devices will never lose your plan.
                </Text>
              </View>
            </View>
          )}
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
    alignItems: 'flex-start',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
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
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  list: {
    gap: 10,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  currentDeviceCard: {
    borderColor: '#10B981',
  },
  deviceInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  currentBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  currentBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
  },
  deviceMeta: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  disconnectBtn: {
    padding: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
  },
  emptyText: {
    color: '#64748B',
    textAlign: 'center',
    paddingVertical: 20,
    fontSize: 13,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 10,
    marginTop: 8,
    gap: 8,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
});
