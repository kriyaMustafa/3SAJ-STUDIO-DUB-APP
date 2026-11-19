import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { XCircle } from 'lucide-react-native';

interface ProgressBarProps {
  completed: number;
  total: number;
  statusText: string;
  onCancel?: () => void;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  completed,
  total,
  statusText,
  onCancel,
}) => {
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.statusText} numberOfLines={1}>
          {statusText || 'Processing...'}
        </Text>
        {onCancel && (
          <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
            <XCircle size={18} color="#EF4444" />
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.metricText}>
          {completed} / {total} segments
        </Text>
        <Text style={styles.percentText}>{percent}%</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 6,
    marginLeft: 8,
  },
  cancelText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  track: {
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 6,
  },
  fill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 4,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  metricText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  percentText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
});
