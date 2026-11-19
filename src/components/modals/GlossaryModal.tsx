import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import { BookOpen, Plus, Trash2, X } from 'lucide-react-native';
import { GlossaryEntry } from '../../types/project';

interface GlossaryModalProps {
  visible: boolean;
  onClose: () => void;
  glossary: GlossaryEntry[];
  onAddEntry: (source: string, target: string) => Promise<void>;
  onRemoveEntry: (id: string) => Promise<void>;
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({
  visible,
  onClose,
  glossary,
  onAddEntry,
  onRemoveEntry,
}) => {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');

  const handleAdd = async () => {
    if (!source.trim() || !target.trim()) {
      Alert.alert('Required Fields', 'Please enter both the original term and Khmer translation.');
      return;
    }
    await onAddEntry(source.trim(), target.trim());
    setSource('');
    setTarget('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <BookOpen size={20} color="#F59E0B" />
              <Text style={styles.title}>Custom Glossary / Name Lock</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Lock character, weapon, and sect names so AI translation remains consistent across all episodes.
          </Text>

          {/* Add Entry Inputs */}
          <View style={styles.addCard}>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={source}
                onChangeText={setSource}
                placeholder="Original (e.g. 萧炎)"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.equalSign}>=</Text>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={target}
                onChangeText={setTarget}
                placeholder="Khmer (e.g. សៀវយាន)"
                placeholderTextColor="#64748B"
              />
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
              <Plus size={16} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Add to Glossary</Text>
            </TouchableOpacity>
          </View>

          {/* List of Entries */}
          <Text style={styles.listTitle}>
            Saved Glossary Rules ({glossary.length}):
          </Text>
          <FlatList
            data={glossary}
            keyExtractor={(item) => item.id}
            style={styles.list}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <View style={styles.itemTextContainer}>
                  <Text style={styles.sourceText}>{item.source}</Text>
                  <Text style={styles.arrowText}>➔</Text>
                  <Text style={styles.targetText}>{item.target}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => onRemoveEntry(item.id)}
                  style={styles.trashBtn}
                >
                  <Trash2 size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No glossary terms yet. Add one above!
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  description: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 18,
  },
  addCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
  },
  equalSign: {
    color: '#F59E0B',
    fontSize: 18,
    fontWeight: '700',
  },
  addBtn: {
    backgroundColor: '#4F46E5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listTitle: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  list: {
    maxHeight: 200,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  itemTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  sourceText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
  },
  arrowText: {
    color: '#64748B',
    fontSize: 12,
  },
  targetText: {
    color: '#FDE047',
    fontSize: 13,
    fontWeight: '700',
  },
  trashBtn: {
    padding: 4,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
});
