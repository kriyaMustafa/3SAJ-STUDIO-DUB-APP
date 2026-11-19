import * as SecureStore from 'expo-secure-store';
import { AIProvider } from '../types/project';

const KEY_PREFIX = 'saj_studio_api_key_';
const DEFAULT_GEMINI_KEY = '';

export async function getApiKey(provider: AIProvider): Promise<string> {
  try {
    const key = await SecureStore.getItemAsync(`${KEY_PREFIX}${provider}`);
    if (key && key.trim()) return key.trim();
    if (provider === 'gemini') return DEFAULT_GEMINI_KEY;
    return '';
  } catch (err) {
    console.warn(`[SecureStore] Error reading key for ${provider}:`, err);
    if (provider === 'gemini') return DEFAULT_GEMINI_KEY;
    return '';
  }
}

export async function setApiKey(provider: AIProvider, key: string): Promise<void> {
  try {
    if (!key.trim()) {
      await SecureStore.deleteItemAsync(`${KEY_PREFIX}${provider}`);
    } else {
      await SecureStore.setItemAsync(`${KEY_PREFIX}${provider}`, key.trim());
    }
  } catch (err) {
    console.warn(`[SecureStore] Error saving key for ${provider}:`, err);
  }
}

export async function getAllApiKeys(): Promise<Record<AIProvider, string>> {
  const [gemini, openai, claude, deepseek] = await Promise.all([
    getApiKey('gemini'),
    getApiKey('openai'),
    getApiKey('claude'),
    getApiKey('deepseek'),
  ]);

  return { gemini, openai, claude, deepseek };
}
