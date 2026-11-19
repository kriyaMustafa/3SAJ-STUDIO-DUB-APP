import { Gender, AgeTone, VoiceMode, TonePresetConfig } from '../../types/project';

export const VOICE_PISETH = 'km-KH-PisethNeural'; // Male
export const VOICE_SREYMOM = 'km-KH-SreymomNeural'; // Female

export interface VoiceToneParams {
  voice: string;
  pitch: string; // e.g. "0Hz", "-18Hz", "+30Hz"
  rate: string;  // e.g. "+0%", "-8%", "+10%"
}

/**
 * Resolves the voice model and SSML prosody parameters
 * based on voiceMode, segment gender, and ageTone.
 */
export function resolveVoiceAndTone(
  voiceMode: VoiceMode,
  gender: Gender,
  ageTone: AgeTone,
  maleVoice: string = VOICE_PISETH,
  femaleVoice: string = VOICE_SREYMOM
): VoiceToneParams {
  let selectedVoice = maleVoice;

  if (voiceMode === 'FEMALE_ONLY') {
    selectedVoice = femaleVoice;
  } else if (voiceMode === 'MALE_ONLY') {
    selectedVoice = maleVoice;
  } else {
    // AUTO_DETECT mode
    selectedVoice = gender === 'F' ? femaleVoice : maleVoice;
  }

  // Calculate pitch and rate based on Age Tone Preset
  let pitch = '0Hz';
  let rate = '+0%';

  switch (ageTone) {
    case 'OLD':
      // Old Man / Elder: Pitch -15Hz to -20Hz, Rate -8%
      pitch = '-18Hz';
      rate = '-8%';
      break;
    case 'KID':
      // Child / Kid: Pitch +25Hz to +35Hz, Rate +10%
      pitch = '+30Hz';
      rate = '+10%';
      break;
    case 'ADULT':
    default:
      // Adult (Default): Pitch 0Hz, Rate +0%
      pitch = '0Hz';
      rate = '+0%';
      break;
  }

  return {
    voice: selectedVoice,
    pitch,
    rate,
  };
}

export const TONE_PRESET_CONFIGS: Record<AgeTone, TonePresetConfig> = {
  ADULT: {
    name: 'Adult (Default)',
    pitch: '0Hz',
    rate: '+0%',
    description: 'Natural baseline voice tone and tempo',
  },
  OLD: {
    name: 'Old Man / Elder',
    pitch: '-18Hz',
    rate: '-8%',
    description: 'Deep resonant pitch with measured pacing',
  },
  KID: {
    name: 'Child / Kid',
    pitch: '+30Hz',
    rate: '+10%',
    description: 'Higher playful pitch with brisk cadence',
  },
};
