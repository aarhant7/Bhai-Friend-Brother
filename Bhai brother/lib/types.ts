export type Language = 'nepali' | 'hindi' | 'urdu' | 'english' | 'bhojpuri';
export type Script = 'romanized' | 'native';
export type Theme = 'light' | 'dark';
export type VoicePreference = 'male' | 'female';
export type ProfileType = 'robot' | 'human';
export type InteractionMode = 'brother' | 'friend';

export interface UserProfile {
  uid: string;
  name: string;
  age?: number;
  caste?: string;
  language: Language;
  script: Script;
  country?: string;
  joinReason?: string;
  theme: Theme;
  voicePreference: VoicePreference;
  profileType: ProfileType;
  interactionMode: InteractionMode;
  isAdult: boolean;
  is18PlusMode?: boolean;
  photoURL?: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  lastUpdatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  userId: string;
  role: 'user' | 'model';
  content: string;
  mood?: string;
  createdAt: string;
}
