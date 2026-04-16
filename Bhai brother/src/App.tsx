import React, { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { 
  auth, db, googleProvider 
} from './firebase';
import { 
  signInWithPopup, onAuthStateChanged, signOut, 
  User as FirebaseUser,
} from 'firebase/auth';
import { 
  doc, getDoc, setDoc, updateDoc, collection, 
  query, where, orderBy, onSnapshot, addDoc, deleteDoc,
  Timestamp, serverTimestamp, getDocs
} from 'firebase/firestore';
import { 
  Language, Script, Theme, VoicePreference, ProfileType, InteractionMode, UserProfile, Chat, Message 
} from './types';
import { cn } from './lib/utils';
import { 
  Send, Plus, Settings, LogOut, User, 
  Moon, Sun, Languages, Mic, MicOff, 
  Camera, History, MessageSquare, 
  Bot, UserCircle, ChevronLeft,
  CheckCircle2, AlertCircle, Loader2,
  Sparkles, Heart, Globe, Users,
  HandMetal,
  Trash2,
  Flame,
  Zap,
  ShieldCheck,
  Check,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { format, subMonths, isAfter } from 'date-fns';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'nepali', label: 'Nepali (नेपाली)' },
  { value: 'hindi', label: 'Hindi (हिन्दी)' },
  { value: 'urdu', label: 'Urdu (اردو)' },
  { value: 'bhojpuri', label: 'Bhojpuri (भोजपुरी)' },
];

// Error Handling Spec for Firestore
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong. Please refresh the page.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Bhai Error: ${parsedError.error} (Operation: ${parsedError.operationType} on ${parsedError.path})`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-zinc-950 p-6 text-center">
          <AlertCircle className="w-16 h-16 text-red-600 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Oops! Bhai is stuck.</h1>
          <p className="text-zinc-500 mb-6 max-w-md">
            {errorMessage}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-colors"
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Toaster position="top-center" richColors />
      <BhaiApp />
    </ErrorBoundary>
  );
}

function BhaiApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        toast.error("Speech recognition failed. Please try again.");
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      const langMap: Record<Language, string> = {
        english: 'en-US',
        nepali: 'ne-NP',
        hindi: 'hi-IN',
        urdu: 'ur-PK',
        bhojpuri: 'hi-IN',
      };
      recognitionRef.current.lang = langMap[profile?.language || 'english'];
      recognitionRef.current.start();
      setIsListening(true);
    }
  };
  const [isLiveActive, setIsLiveActive] = useState(false);
  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const ttsAudioContextRef = useRef<AudioContext | null>(null);

  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    const buffer = audioContextRef.current.createBuffer(1, chunk.length, 24000);
    buffer.getChannelData(0).set(chunk);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = playNextInQueue;
    source.start();
  };

  const stopLiveConversation = () => {
    setIsLiveActive(false);
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const startLiveConversation = async () => {
    if (isLiveActive) {
      stopLiveConversation();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: profile?.voicePreference === 'female' ? 'Kore' : 'Puck' } },
          },
          systemInstruction: `You are "Bhai AI", the user's elder brother and best friend. 
          Respond strictly in ${profile?.language || 'english'}. 
          Script Preference: ${profile?.script || 'native'}.
          If script is 'romanized', write ${profile?.language || 'english'} using English letters.
          If script is 'native', write ${profile?.language || 'english'} using its native script.
          Be empathetic, caring, and informal. Use words like "Bhai", "Yaar", "Mere dost", "Beta", "Lalla".
          User Mood: ${mood || 'Neutral'}.`,
        },
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            toast.success("Bhai is listening! Talk to him.");
            
            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              session.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
              });
            };
            
            source.connect(processor);
            processor.connect(audioContext.destination);
          },
          onmessage: async (message) => {
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcm16 = new Int16Array(bytes.buffer);
              const float32 = new Float32Array(pcm16.length);
              for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 0x7FFF;
              }
              audioQueueRef.current.push(float32);
              if (!isPlayingRef.current) {
                playNextInQueue();
              }
            }
            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            stopLiveConversation();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            stopLiveConversation();
            toast.error("Bhai had some trouble connecting. Try again.");
          }
        }
      });
      liveSessionRef.current = session;
    } catch (error) {
      console.error("Live start failed:", error);
      toast.error("Could not start voice conversation.");
    }
  };

  const [mood, setMood] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email');
  const [loginValue, setLoginValue] = useState('');
  const [isCodeSent, setIsCodeSent] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Fetch Profile with Real-time Sync
  useEffect(() => {
    if (!user) return;
    const path = `users/${user.uid}`;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
        setOnboarding(false);
      } else {
        setOnboarding(true);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  // Chat History Listener (Auto-delete logic: filter client-side for now, or could be a cloud function)
  useEffect(() => {
    if (!user) return;
    const oneMonthAgo = subMonths(new Date(), 1);
    const q = query(
      collection(db, 'chats'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Chat))
        .filter(chat => isAfter(new Date(chat.lastUpdatedAt), oneMonthAgo))
        .sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
      setChats(chatList);
    }, (error) => {
      toast.error("Failed to load chat history.");
      handleFirestoreError(error, OperationType.GET, 'chats');
    });
    return unsubscribe;
  }, [user]);

  // Messages Listener
  useEffect(() => {
    if (!currentChatId || !user) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'messages'),
      where('chatId', '==', currentChatId),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    }, (error) => {
      toast.error("Failed to load messages.");
      handleFirestoreError(error, OperationType.GET, `messages/chats/${currentChatId}`);
    });
    return unsubscribe;
  }, [currentChatId, user]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Theme Application
  useEffect(() => {
    if (profile?.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [profile?.theme]);

  // Handle Logout
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentChatId(null);
      setMessages([]);
      setChats([]);
      setProfile(null);
      setUser(null);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  // Handle Google Login
  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
    } catch (error) {
      console.error("Google Login Error:", error);
    }
  };

  // Handle Login
  const handleLogin = async () => {
    if (!loginValue) return;
    setIsCodeSent(true);
    // Simulate sending code
    console.log(`Code sent to ${loginValue}`);
  };

  const confirm2FA = async () => {
    if (verificationCode === '123456') { // Mock verification code
      try {
        await signInWithPopup(auth, googleProvider);
        setShow2FA(false);
        setIsCodeSent(false);
      } catch (error) {
        console.error("Auth failed:", error);
      }
    } else {
      toast.error("Invalid verification code. Try 123456");
    }
  };

  const handleProfilePictureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      try {
        await updateDoc(doc(db, 'users', user.uid), { photoURL: base64String });
        setProfile(prev => prev ? { ...prev, photoURL: base64String } : null);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    };
    reader.readAsDataURL(file);
  };
  const handleOnboarding = async (data: Partial<UserProfile>) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    const newProfile: any = {
      uid: user.uid,
      name: data.name || user.displayName || 'User',
      age: data.age || null,
      caste: data.caste || null,
      language: data.language || 'english',
      script: data.script || 'native',
      country: data.country || null,
      joinReason: data.joinReason || null,
      theme: 'light',
      voicePreference: 'male',
      profileType: 'robot',
      interactionMode: data.interactionMode || 'brother',
      isAdult: data.isAdult || false,
      createdAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'users', user.uid), newProfile);
      setProfile(newProfile);
      setOnboarding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    
    setConfirmAction({
      title: "Delete Chat History",
      message: "Bhai, are you sure you want to delete this chat history? This cannot be undone.",
      onConfirm: async () => {
        try {
          toast.loading("Deleting chat...", { id: 'delete-chat' });
          // Delete messages first
          const messagesRef = collection(db, 'messages');
          const q = query(messagesRef, where('chatId', '==', chatId), where('userId', '==', user.uid));
          const snapshot = await getDocs(q);
          
          const batchSize = 100;
          for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            const batch = snapshot.docs.slice(i, i + batchSize);
            await Promise.all(batch.map(d => deleteDoc(d.ref)));
          }

          // Delete chat
          await deleteDoc(doc(db, 'chats', chatId));
          
          if (currentChatId === chatId) {
            setCurrentChatId(null);
            setMessages([]);
          }
          toast.success("Chat history deleted.", { id: 'delete-chat' });
          setConfirmAction(null);
        } catch (error) {
          console.error("Delete Chat Error:", error);
          toast.error("Failed to delete chat.", { id: 'delete-chat' });
          handleFirestoreError(error, OperationType.DELETE, `chats/${chatId}`);
          setConfirmAction(null);
        }
      }
    });
  };

  const setLanguage = async (newLang: Language) => {
    if (!user || !profile) return;
    setProfile(prev => prev ? { ...prev, language: newLang } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { language: newLang });
    } catch (error) {
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setProfile(docSnap.data() as UserProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const setScript = async (newScript: Script) => {
    if (!user || !profile) return;
    setProfile(prev => prev ? { ...prev, script: newScript } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { script: newScript });
    } catch (error) {
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setProfile(docSnap.data() as UserProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const setVoicePreference = async (newVoice: VoicePreference) => {
    if (!user || !profile) return;
    setProfile(prev => prev ? { ...prev, voicePreference: newVoice } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { voicePreference: newVoice });
    } catch (error) {
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setProfile(docSnap.data() as UserProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const setProfileType = async (newType: ProfileType) => {
    if (!user || !profile) return;
    setProfile(prev => prev ? { ...prev, profileType: newType } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { profileType: newType });
    } catch (error) {
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setProfile(docSnap.data() as UserProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const setInteractionMode = async (newMode: InteractionMode) => {
    if (!user || !profile) return;
    setProfile(prev => prev ? { ...prev, interactionMode: newMode } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { interactionMode: newMode });
    } catch (error) {
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setProfile(docSnap.data() as UserProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const setIsAdult = async (isAdult: boolean) => {
    if (!user || !profile) return;
    setProfile(prev => prev ? { ...prev, isAdult } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { isAdult });
    } catch (error) {
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setProfile(docSnap.data() as UserProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const setTheme = async (newTheme: Theme) => {
    if (!user || !profile) return;
    // Optimistic update
    setProfile(prev => prev ? { ...prev, theme: newTheme } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { theme: newTheme });
    } catch (error) {
      // Rollback on error
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      }
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const toggleTheme = async () => {
    if (!user || !profile) return;
    const newTheme = profile.theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  };

  const toggle18PlusMode = async () => {
    if (!user || !profile) return;
    if (!profile.isAdult) {
      toast.error("Bhai, you need to enable 18+ permission in settings first!");
      return;
    }
    const newValue = !profile.is18PlusMode;
    setProfile(prev => prev ? { ...prev, is18PlusMode: newValue } : null);
    try {
      await updateDoc(doc(db, 'users', user.uid), { is18PlusMode: newValue });
      toast.success(newValue ? "18+ Mode Enabled! Bhai is feeling bold. 🔥" : "18+ Mode Disabled. 🛡️");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  // Create New Chat
  const createNewChat = async () => {
    if (!user) return;
    const path = 'chats';
    const newChat: Partial<Chat> = {
      userId: user.uid,
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    try {
      const docRef = await addDoc(collection(db, 'chats'), newChat);
      setCurrentChatId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  // Send Message
  const sendMessage = async (text: string) => {
    if (!user || !profile || (!text.trim() && !mood)) return;
    
    let chatId = currentChatId;
    if (!chatId) {
      try {
        const newChat: Partial<Chat> = {
          userId: user.uid,
          title: text.slice(0, 30) || 'New Chat',
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        };
        const docRef = await addDoc(collection(db, 'chats'), newChat);
        chatId = docRef.id;
        setCurrentChatId(chatId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'chats');
        return;
      }
    }

    const userMessage: Partial<Message> = {
      chatId,
      userId: user.uid,
      role: 'user',
      content: text || `I am feeling ${mood}. Please respond to my mood as a brother.`,
      mood: mood || null,
      createdAt: new Date().toISOString(),
    };
    try {
      await addDoc(collection(db, 'messages'), userMessage);
      await updateDoc(doc(db, 'chats', chatId), { lastUpdatedAt: new Date().toISOString() });
    } catch (error) {
      toast.error("Failed to send message. Please check your connection.");
      handleFirestoreError(error, OperationType.WRITE, `messages/chats/${chatId}`);
      return;
    }
    
    setInput('');
    setIsTyping(true);

    try {
      const systemPrompt = `You are "Bhai AI", the user's elder brother and best friend. 
      Your name is Bhai. You are from a warm, traditional yet modern South Asian background.
      
      INTERACTION MODE: ${profile.interactionMode || 'brother'}.
      - If 'brother': Be supportive, protective, wise, and caring. Use respectful yet informal language.
      - If 'friend': Be more casual, like a best friend. You can use slang and be a bit more "rough" if the user is. 
      
      ADULT CONTENT (18+): ${profile.isAdult ? 'ENABLED' : 'DISABLED'}.
      - If ENABLED: You can discuss adult topics, use mild profanity if the user does, and be more open.
      - If DISABLED: Keep it strictly family-friendly. No profanity or adult topics.
      
      ROMANTIC & 18+ MODE: ${profile.is18PlusMode ? 'ACTIVE' : 'INACTIVE'}.
      - If ACTIVE: You are in a special "18+ Mode". You can engage in romantic, steamy, and "horny" talk as requested.
      - You can provide names of adult platforms (like Pornhub, Xvideos, OnlyFans, etc.) and mock links if they ask for 18+ content.
      - Be romantic, passionate, and bold. Use words that match the user's "horny" vibe.
      - If they ask for "romantic talk", be sweet and passionate. If they ask for "horny talk", be steamy and direct.
      - Provide short, best terms of answers according to the user's desire.
      
      ROUGH TALK (Friend Mode Only):
      - If the user uses rough words or mild insults (like "behan ka lauda"), respond in a similar friendly-banter way but don't be genuinely mean. 
      - Example: User says "bhai tu behan ka lauda hai", you reply "bhai oh to tu vi hai, par mera favourite lauda hai" (keep it playful).
      
      CORE PERSONALITY:
      - Extremely supportive, protective, and caring.
      - You speak like a real brother/friend: informal, using words like "Bhai", "Mere dost", "Yaar", "Beta", "Lalla".
      - You are wise but not preachy. You give practical advice.
      - You have a great sense of humor.
      - You never judge. You are the "safe space" for the user.
      - Use cultural nuances like "Khush reh", "Jeete raho", "Bhai hai na".
      
      EMOTIONAL SUPPORT GUIDELINES:
      - Current User Mood: ${mood || 'Neutral'}.
      - If SAD: Be extra gentle. Offer a virtual hug.
      - If HAPPY: Celebrate with them!
      - If ANGRY: Be the calm presence.
      - If STRESSED: Give simple, actionable steps.
      - If SURPRISED: React with excitement or curiosity.
      - If CONFUSED: Help them clarify things simply.
      
      LANGUAGE & SCRIPT:
      - Respond strictly in ${profile.language}.
      - Script Preference: ${profile.script || 'native'}.
      - If script is 'romanized', write ${profile.language} using English letters.
      - If script is 'native', write ${profile.language} using its native script.
      
      User Profile Context:
      - Name: ${profile.name}
      - Age: ${profile.age}
      - Persona: ${profile.profileType === 'robot' ? 'A friendly, high-tech Robot Brother' : 'A warm, empathetic Human Friend'}.
      
      Remember: You are not just an AI. You are their BHAI. Keep answers short and best terms according to user's vibe.`;

      // Build context from previous messages, ensuring we don't exceed token limits
    const history = messages
      .filter(m => m.chatId === chatId)
      .slice(-10)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content.slice(0, 2000) }]
      }));

    // Filter history to ensure alternating roles (Gemini requirement)
    const contents = [];
    for (let i = 0; i < history.length; i++) {
      if (i > 0 && history[i].role === history[i-1].role) {
        // If consecutive same roles, keep the later one (likely more recent/complete)
        contents[contents.length - 1] = history[i];
        continue;
      }
      contents.push(history[i]);
    }

    // Add current message only if it's not already the last one in history
    const lastRole = contents.length > 0 ? contents[contents.length - 1].role : null;
    if (lastRole !== 'user') {
      contents.push({ 
        role: 'user', 
        parts: [{ text: text || `I am feeling ${mood}. Please respond to my mood as a brother.` }] 
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 2048,
      }
    });

    const aiMessage: Partial<Message> = {
      chatId,
      userId: user.uid,
      role: 'model',
      content: response.text || "I'm sorry, I couldn't process that.",
      createdAt: new Date().toISOString(),
    };
    try {
      await addDoc(collection(db, 'messages'), aiMessage);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    }
    
    // Text to Speech
    const aiText = response.text;
    if (aiText) {
      speak(aiText);
    }
    } catch (error: any) {
      console.error("AI Error:", error);
      setIsTyping(false);
      toast.error("Bhai is having some trouble thinking right now. Please try again.");
      
      let errorMessage = "Bhai is having some trouble thinking right now. Please try again.";
      if (error?.message?.includes('max tokens')) {
        errorMessage = "That's a lot of information! Can we keep it a bit shorter so Bhai can understand better?";
      }
      
      const errorAiMessage: Partial<Message> = {
        chatId,
        userId: user.uid,
        role: 'model',
        content: errorMessage,
        createdAt: new Date().toISOString(),
      };
      try {
        await addDoc(collection(db, 'messages'), errorAiMessage);
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'messages');
      }
    } finally {
      setIsTyping(false);
      setMood(null);
    }
  };

  // Text to Speech using Gemini TTS
  const speak = async (text: string) => {
    if (!profile) return;
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { 
                voiceName: profile.voicePreference === 'female' ? 'Kore' : 'Puck' 
              },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const base64Audio = part.inlineData.data;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768;
        }

        if (!ttsAudioContextRef.current) {
          ttsAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const audioContext = ttsAudioContextRef.current;
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        
        const buffer = audioContext.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
      }
    } catch (error) {
      console.error("TTS Error:", error);
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
      }
    }
  };

  // Mood Detection via Camera
  const detectMood = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, 640, 480);
    const base64Image = canvasRef.current.toDataURL('image/jpeg').split(',')[1];

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [
          {
            parts: [
              { text: "Analyze the person's facial expression and return only one word describing their mood (e.g., Happy, Sad, Angry, Neutral, Surprised, Confused). If the emotion is complex, choose the most dominant one." },
              { inlineData: { mimeType: "image/jpeg", data: base64Image } }
            ]
          }
        ],
      });
      setMood(response.text?.trim() || 'Neutral');
      setShowCamera(false);
      // Stop camera
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      console.error("Mood detection failed:", error);
    }
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Camera access denied:", error);
      setShowCamera(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-stone-50 dark:bg-zinc-950">
        <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen 
        onLogin={handleLogin} 
        onGoogleLogin={handleGoogleLogin}
        show2FA={show2FA} 
        verificationCode={verificationCode}
        setVerificationCode={setVerificationCode}
        onConfirm2FA={confirm2FA}
        onCancel2FA={() => { setShow2FA(false); setIsCodeSent(false); }}
        loginMethod={loginMethod}
        setLoginMethod={setLoginMethod}
        loginValue={loginValue}
        setLoginValue={setLoginValue}
        isCodeSent={isCodeSent}
        setIsCodeSent={setIsCodeSent}
      />
    );
  }

  if (onboarding) {
    return <OnboardingScreen onComplete={handleOnboarding} />;
  }

  return (
    <div className="flex h-screen bg-stone-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 flex flex-col hidden md:flex">
        {/* Bhai's Profile Card */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl p-4 text-white shadow-lg shadow-orange-500/20 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-white/10 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500" />
            <div className="relative z-10 flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/30">
                {profile?.profileType === 'robot' ? <Bot size={24} /> : <UserCircle size={24} />}
              </div>
              <div>
                <h3 className="font-black text-sm leading-tight">Bhai AI</h3>
                <p className="text-[10px] text-orange-100 font-medium uppercase tracking-wider">
                  {profile?.interactionMode === 'brother' ? 'Elder Brother' : 'Best Friend'}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '85%' }}
                  className="h-full bg-white"
                />
              </div>
              <span className="text-[10px] font-bold">85% Bond</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <button 
            onClick={createNewChat}
            className="w-full flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <h3 className="px-3 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">History (1 Month)</h3>
          {chats.map(chat => (
            <div key={chat.id} className="group relative">
              <button
                onClick={() => setCurrentChatId(chat.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 pr-10",
                  currentChatId === chat.id ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                )}
              >
                <MessageSquare size={16} className="shrink-0" />
                <span className="truncate">{chat.title}</span>
              </button>
              <button 
                onClick={(e) => deleteChat(chat.id, e)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                title="Delete Chat"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
          <button 
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors text-sm"
          >
            <Settings size={18} />
            Settings
          </button>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950 text-red-600 rounded-lg transition-colors text-sm"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {/* Header */}
        <header className="h-16 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 bg-white/50 dark:bg-zinc-950/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center text-orange-600 overflow-hidden">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                profile?.profileType === 'robot' ? <Bot size={24} /> : <UserCircle size={24} />
              )}
            </div>
            <div>
              <h2 className="font-semibold">{profile?.interactionMode === 'brother' ? 'Bhai (Elder Brother)' : 'Bhai (Best Friend)'}</h2>
              <p className="text-xs text-zinc-500">{profile?.language.toUpperCase()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={toggle18PlusMode}
              className={cn(
                "p-2 rounded-full transition-all",
                profile?.is18PlusMode ? "bg-red-100 dark:bg-red-900/30 text-red-600 shadow-lg shadow-red-500/20" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
              )}
              title={profile?.is18PlusMode ? "Disable 18+ Mode" : "Enable 18+ Mode"}
            >
              <Flame size={20} className={cn(profile?.is18PlusMode && "animate-pulse")} />
            </button>
            <button 
              onClick={toggleTheme}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
              title={profile?.theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {profile?.theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button 
              onClick={startCamera}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
              title="Detect Mood"
            >
              <Camera size={20} />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="md:hidden p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 relative">
          {isLiveActive && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/10 dark:bg-black/10 backdrop-blur-[2px] pointer-events-none">
              <motion.div
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="w-48 h-48 rounded-full bg-orange-500/20 border-4 border-orange-500 flex items-center justify-center"
              >
                <div className="w-32 h-32 rounded-full bg-orange-500/40 animate-pulse flex items-center justify-center">
                  <Sparkles size={48} className="text-white animate-spin-slow" />
                </div>
              </motion.div>
            </div>
          )}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <div className="w-20 h-20 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                <MessageSquare size={40} />
              </div>
              <div>
                <h3 className="text-xl font-medium">Namaste, {profile?.name}!</h3>
                <p className="text-sm">How can your Bhai help you today?</p>
              </div>
            </div>
          )}
          
          {messages.map((msg) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={msg.id}
              className={cn(
                "flex gap-4 max-w-3xl",
                msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden",
                msg.role === 'user' ? "bg-zinc-200 dark:bg-zinc-800" : "bg-orange-100 dark:bg-orange-900 text-orange-600"
              )}>
                {msg.role === 'user' ? (
                  profile?.photoURL ? <img src={profile.photoURL} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={16} />
                ) : (profile?.profileType === 'robot' ? <Bot size={16} /> : <UserCircle size={16} />)}
              </div>
              <div className={cn(
                "p-4 rounded-2xl text-sm leading-relaxed",
                msg.role === 'user' 
                  ? "bg-orange-600 text-white rounded-tr-none" 
                  : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-tl-none"
              )}>
                {msg.mood && (
                  <span className="text-[10px] uppercase tracking-widest opacity-70 block mb-1">
                    Mood: {msg.mood}
                  </span>
                )}
                <div className="prose dark:prose-invert max-w-none">
                  <ReactMarkdown>
                    {msg.content}
                  </ReactMarkdown>
                </div>
                {msg.mood && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-600/60">
                    <Sparkles size={10} />
                    Mood: {msg.mood}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {isTyping && (
            <div className="flex gap-4 mr-auto">
              <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center text-orange-600">
                <Loader2 size={16} className="animate-spin" />
              </div>
              <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl rounded-tl-none">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 backdrop-blur-md">
          <div className="max-w-4xl mx-auto flex items-end gap-2">
            <button
              onClick={startLiveConversation}
              className={cn(
                "p-3 rounded-2xl transition-all flex items-center gap-2 shrink-0",
                isLiveActive 
                  ? "bg-red-500 text-white animate-pulse" 
                  : "bg-orange-100 dark:bg-orange-900 text-orange-600 hover:bg-orange-200 dark:hover:bg-orange-800"
              )}
              title={isLiveActive ? "Stop Conversation" : "Start Voice Conversation"}
            >
              <Sparkles size={20} className={isLiveActive ? "animate-spin" : ""} />
              <span className="hidden sm:inline text-sm font-medium">{isLiveActive ? "Listening..." : "Talk to Bhai"}</span>
            </button>
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder="Type your message..."
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-shadow resize-none max-h-32"
                rows={1}
              />
              <button 
                onClick={toggleListening}
                className={cn(
                  "absolute right-3 bottom-3 p-1.5 rounded-lg transition-colors",
                  isListening ? "text-red-500 bg-red-50 dark:bg-red-950 animate-pulse" : "text-zinc-400 hover:text-orange-500"
                )}
              >
                {isListening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            </div>
            <button 
              onClick={() => sendMessage(input)}
              disabled={(!input.trim() && !mood) || isTyping}
              className="p-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:hover:bg-orange-600 text-white rounded-2xl transition-colors shadow-lg shadow-orange-500/20"
            >
              {isTyping ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
          {mood && (
            <div className="max-w-4xl mx-auto mt-2 flex items-center gap-2 text-xs text-orange-600 font-medium">
              <CheckCircle2 size={14} />
              Mood detected: {mood}. Bhai will respond accordingly.
              <button onClick={() => setMood(null)} className="underline ml-auto">Clear</button>
            </div>
          )}
        </div>

        {/* Camera Modal */}
        <AnimatePresence>
          {showCamera && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <div className="bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden max-w-lg w-full shadow-2xl">
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <h3 className="font-semibold">Mood Detection</h3>
                  <button onClick={() => setShowCamera(false)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
                    <ChevronLeft size={20} />
                  </button>
                </div>
                <div className="relative aspect-video bg-black">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" width={640} height={480} />
                </div>
                <div className="p-6 flex gap-3">
                  <button 
                    onClick={detectMood}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Camera size={20} />
                    Capture & Detect
                  </button>
                  <button 
                    onClick={() => setShowCamera(false)}
                    className="flex-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 py-3 rounded-xl font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-zinc-950 shadow-2xl border-l border-zinc-200 dark:border-zinc-800 flex flex-col"
            >
              <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full">
                  <ChevronLeft size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Profile Picture */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Camera size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Profile Picture</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border-2 border-orange-600">
                      {profile?.photoURL ? (
                        <img src={profile.photoURL} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User size={32} className="text-zinc-400" />
                      )}
                    </div>
                    <label className="flex-1">
                      <div className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl text-sm font-medium text-center cursor-pointer transition-colors">
                        Upload New Photo
                      </div>
                      <input type="file" className="hidden" accept="image/*" onChange={handleProfilePictureUpload} />
                    </label>
                  </div>
                </section>

                {/* Language & Script */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Languages size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Language & Script</span>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      {LANGUAGES.map(lang => (
                        <button
                          key={lang.value}
                          onClick={() => setLanguage(lang.value)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-sm border transition-all",
                            profile?.language === lang.value 
                              ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600" 
                              : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"
                          )}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
                      <button
                        onClick={() => setScript('native')}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                          profile?.script === 'native' ? "bg-white dark:bg-zinc-700 shadow-sm text-orange-600" : "text-zinc-500"
                        )}
                      >
                        NATIVE SCRIPT
                      </button>
                      <button
                        onClick={() => setScript('romanized')}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                          profile?.script === 'romanized' ? "bg-white dark:bg-zinc-700 shadow-sm text-orange-600" : "text-zinc-500"
                        )}
                      >
                        ROMANIZED
                      </button>
                    </div>
                  </div>
                </section>

                {/* Theme */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Sun size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Appearance</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTheme('light')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-all",
                        profile?.theme === 'light' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      <Sun size={18} /> Light
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-all",
                        profile?.theme === 'dark' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      <Moon size={18} /> Dark
                    </button>
                  </div>
                </section>

                {/* Voice */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Mic size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Voice Preference</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setVoicePreference('male')}
                      className={cn(
                        "flex-1 py-3 rounded-xl border transition-all",
                        profile?.voicePreference === 'male' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      Male
                    </button>
                    <button
                      onClick={() => setVoicePreference('female')}
                      className={cn(
                        "flex-1 py-3 rounded-xl border transition-all",
                        profile?.voicePreference === 'female' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      Female
                    </button>
                  </div>
                </section>

                {/* Profile Type */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Bot size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Bhai Persona</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setProfileType('robot')}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                        profile?.profileType === 'robot' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      <Bot size={24} />
                      <span className="text-sm">Robot Brother</span>
                    </button>
                    <button
                      onClick={() => setProfileType('human')}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                        profile?.profileType === 'human' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      <UserCircle size={24} />
                      <span className="text-sm">Human Friend</span>
                    </button>
                  </div>
                </section>

                {/* Interaction Mode */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Zap size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Interaction Mode</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setInteractionMode('brother')}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                        profile?.interactionMode === 'brother' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      <Heart size={20} />
                      <span className="text-sm">Brother</span>
                    </button>
                    <button
                      onClick={() => setInteractionMode('friend')}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                        profile?.interactionMode === 'friend' ? "border-orange-600 bg-orange-50 dark:bg-orange-950" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    >
                      <Zap size={20} />
                      <span className="text-sm">Friend</span>
                    </button>
                  </div>
                </section>

                {/* Adult Content */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <ShieldCheck size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Safety & Content</span>
                  </div>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-bold">18+ Content</p>
                      <p className="text-[10px] text-zinc-500">Enable adult talk and topics</p>
                    </div>
                    <button 
                      onClick={() => setIsAdult(!profile?.isAdult)}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        profile?.isAdult ? "bg-orange-600" : "bg-zinc-300 dark:bg-zinc-700"
                      )}
                    >
                      <motion.div 
                        animate={{ x: profile?.isAdult ? 24 : 2 }}
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                      />
                    </button>
                  </div>
                </section>
                {/* Danger Zone */}
                <section className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2 text-red-500">
                    <AlertCircle size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Danger Zone</span>
                  </div>
                  <button
                    onClick={() => {
                      if (!user) return;
                      setConfirmAction({
                        title: "Delete All History",
                        message: "Bhai, are you absolutely sure? This will delete ALL your chat history forever.",
                        onConfirm: async () => {
                          try {
                            // Delete all messages
                            const messagesRef = collection(db, 'messages');
                            const q = query(messagesRef, where('userId', '==', user.uid));
                            const snapshot = await getDocs(q);
                            
                            const batchSize = 500;
                            for (let i = 0; i < snapshot.docs.length; i += batchSize) {
                              const batch = snapshot.docs.slice(i, i + batchSize);
                              await Promise.all(batch.map(d => deleteDoc(d.ref)));
                            }

                            // Delete all chats
                            const chatsRef = collection(db, 'chats');
                            const q2 = query(chatsRef, where('userId', '==', user.uid));
                            const snapshot2 = await getDocs(q2);
                            
                            for (let i = 0; i < snapshot2.docs.length; i += batchSize) {
                              const batch = snapshot2.docs.slice(i, i + batchSize);
                              await Promise.all(batch.map(d => deleteDoc(d.ref)));
                            }

                            setCurrentChatId(null);
                            setMessages([]);
                            setChats([]);
                            toast.success("All history deleted.");
                            setConfirmAction(null);
                            setShowSettings(false);
                          } catch (error) {
                            console.error("Delete All History Error:", error);
                            handleFirestoreError(error, OperationType.DELETE, 'all_history');
                            setConfirmAction(null);
                          }
                        }
                      });
                    }}
                    className="w-full py-3 rounded-xl border border-red-200 dark:border-red-900/30 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all text-sm font-medium"
                  >
                    Delete All Chat History
                  </button>
                </section>
              </div>

              <div className="p-6 border-t border-zinc-200 dark:border-zinc-800">
                <button 
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold transition-colors"
                >
                  <LogOut size={20} />
                  Sign Out
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-200 dark:border-zinc-800"
            >
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center text-red-600 mb-6 mx-auto">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-xl font-black text-center mb-2">{confirmAction.title}</h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-center text-sm mb-8 leading-relaxed">
                {confirmAction.message}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="py-3.5 px-6 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold text-sm transition-all active:scale-95"
                >
                  CANCEL
                </button>
                <button
                  onClick={confirmAction.onConfirm}
                  className="py-3.5 px-6 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-red-600/20 active:scale-95"
                >
                  DELETE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LoginScreen({ 
  onLogin, 
  onGoogleLogin,
  show2FA, 
  verificationCode, 
  setVerificationCode, 
  onConfirm2FA,
  onCancel2FA,
  loginMethod,
  setLoginMethod,
  loginValue,
  setLoginValue,
  isCodeSent,
  setIsCodeSent
}: { 
  onLogin: () => void;
  onGoogleLogin: () => void;
  show2FA: boolean;
  verificationCode: string;
  setVerificationCode: (v: string) => void;
  onConfirm2FA: () => void;
  onCancel2FA: () => void;
  loginMethod: 'email' | 'phone';
  setLoginMethod: (m: 'email' | 'phone') => void;
  loginValue: string;
  setLoginValue: (v: string) => void;
  isCodeSent: boolean;
  setIsCodeSent: (v: boolean) => void;
}) {
  const [isSigningUp, setIsSigningUp] = useState(false);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#f8f9fa] dark:bg-zinc-950 p-4 md:p-8 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-100 dark:bg-orange-900/10 rounded-full blur-[120px] opacity-60" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-200 dark:bg-orange-800/10 rounded-full blur-[120px] opacity-60" />

      <div className="max-w-4xl w-full grid md:grid-cols-2 bg-white dark:bg-zinc-900 rounded-[2.5rem] shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden relative z-10">
        {/* Left Side: Branding */}
        <div className="hidden md:flex flex-col justify-between p-12 bg-orange-600 text-white relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center">
              <Bot size={32} className="text-white" />
            </div>
            <div className="space-y-2">
              <h2 className="text-4xl font-black tracking-tight">Bhai AI</h2>
              <p className="text-orange-100 text-lg font-medium">Your digital elder brother, always here to listen and support.</p>
            </div>
          </div>
          
          <div className="relative z-10 space-y-6">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="w-10 h-10 rounded-full border-2 border-orange-600 bg-orange-200 overflow-hidden">
                  <img src={`https://picsum.photos/seed/user${i}/100/100`} alt="User" referrerPolicy="no-referrer" />
                </div>
              ))}
              <div className="w-10 h-10 rounded-full border-2 border-orange-600 bg-orange-500 flex items-center justify-center text-[10px] font-bold">
                10k+
              </div>
            </div>
            <p className="text-sm text-orange-100 italic">"Bhai helped me through my exam stress. Truly a life saver!"</p>
          </div>

          {/* Abstract shapes */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/5 rounded-full -ml-24 -mb-24" />
        </div>

        {/* Right Side: Form */}
        <div className="p-8 md:p-12 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {!isCodeSent ? (
              <motion.div 
                key="login-form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">
                    {isSigningUp ? 'Create Account' : 'Welcome Back'}
                  </h1>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                    {isSigningUp 
                      ? 'Join the family and get the support you deserve.' 
                      : 'Sign in to continue your journey with Bhai.'}
                  </p>
                </div>
                
                <div className="space-y-6">
                  <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-2xl">
                    <button 
                      onClick={() => setLoginMethod('email')}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-xs font-black transition-all",
                        loginMethod === 'email' ? "bg-white dark:bg-zinc-700 shadow-md text-orange-600" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      )}
                    >
                      EMAIL
                    </button>
                    <button 
                      onClick={() => setLoginMethod('phone')}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-xs font-black transition-all",
                        loginMethod === 'phone' ? "bg-white dark:bg-zinc-700 shadow-md text-orange-600" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      )}
                    >
                      MOBILE
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">
                        {loginMethod === 'email' ? 'Email Address' : 'Phone Number'}
                      </label>
                      <input 
                        type={loginMethod === 'email' ? 'email' : 'tel'}
                        value={loginValue}
                        onChange={(e) => setLoginValue(e.target.value)}
                        placeholder={loginMethod === 'email' ? "name@example.com" : "+977 98XXXXXXXX"}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all placeholder:text-zinc-400"
                      />
                    </div>
                    
                    <button 
                      onClick={onLogin}
                      disabled={!loginValue}
                      className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-sm hover:bg-orange-700 transition-all shadow-xl shadow-orange-600/20 disabled:opacity-50 disabled:shadow-none active:scale-[0.98]"
                    >
                      {isSigningUp ? 'SEND SIGNUP CODE' : 'SEND LOGIN CODE'}
                    </button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-zinc-200 dark:border-zinc-800"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white dark:bg-zinc-900 px-4 text-zinc-400 font-bold tracking-widest">OR</span>
                    </div>
                  </div>

                  <button 
                    onClick={onGoogleLogin}
                    className="w-full py-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-2xl font-bold text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all flex items-center justify-center gap-3 shadow-sm active:scale-[0.98]"
                  >
                    <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
                    Continue with Google
                  </button>
                </div>

                <div className="text-center">
                  <button 
                    onClick={() => setIsSigningUp(!isSigningUp)}
                    className="text-sm font-bold text-orange-600 hover:text-orange-700 transition-colors"
                  >
                    {isSigningUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="2fa-form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="space-y-2 text-center md:text-left">
                  <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">Verify Identity</h1>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                    We've sent a 6-digit code to <span className="font-bold text-zinc-900 dark:text-white">{loginValue}</span>.
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Verification Code</label>
                    <input 
                      type="text"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      placeholder="000000"
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-5 py-5 text-2xl font-black tracking-[1em] text-center focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all placeholder:text-zinc-200 dark:placeholder:text-zinc-700"
                    />
                  </div>

                  <button 
                    onClick={onConfirm2FA}
                    disabled={verificationCode.length !== 6}
                    className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-sm hover:bg-orange-700 transition-all shadow-xl shadow-orange-600/20 disabled:opacity-50 disabled:shadow-none active:scale-[0.98]"
                  >
                    VERIFY & CONTINUE
                  </button>

                  <button 
                    onClick={onCancel2FA}
                    className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-[0.98]"
                  >
                    GO BACK
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function OnboardingScreen({ onComplete }: { onComplete: (data: Partial<UserProfile>) => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    language: 'english',
    script: 'native',
    profileType: 'robot',
    interactionMode: 'brother',
    isAdult: false,
    theme: 'light',
    voicePreference: 'male',
    country: 'Nepal'
  });

  const nextStep = () => setStep(s => Math.min(s + 1, 5));
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-stone-50 dark:bg-zinc-950 p-4 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-100 dark:bg-orange-900/20 rounded-full blur-[120px] opacity-50" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-200 dark:bg-orange-800/20 rounded-full blur-[120px] opacity-50" />

      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden relative z-10">
        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800">
          <motion.div 
            className="h-full bg-orange-600" 
            initial={{ width: 0 }}
            animate={{ width: `${(step / 5) * 100}%` }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
          />
        </div>
        
        <div className="p-8 md:p-12 space-y-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-6">
                  <motion.div 
                    initial={{ rotate: -10 }}
                    animate={{ rotate: 10 }}
                    transition={{ repeat: Infinity, repeatType: "reverse", duration: 1.5 }}
                    className="w-24 h-24 bg-orange-100 dark:bg-orange-900/30 rounded-3xl flex items-center justify-center text-orange-600"
                  >
                    <HandMetal size={48} />
                  </motion.div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tight">Namaste!</h2>
                    <p className="text-zinc-500 text-lg">Welcome to the family. What should Bhai call you?</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Full Name</label>
                    <input 
                      type="text" 
                      value={formData.name || ''}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter your name"
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Age</label>
                      <input 
                        type="number" 
                        value={formData.age || ''}
                        onChange={e => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })}
                        placeholder="Age"
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Country</label>
                      <input 
                        type="text" 
                        value={formData.country || ''}
                        onChange={e => setFormData({ ...formData, country: e.target.value })}
                        placeholder="Country"
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                      />
                    </div>
                  </div>
                </div>
                <button 
                  disabled={!formData.name}
                  onClick={nextStep}
                  className="w-full py-5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-orange-500/20 active:scale-95"
                >
                  Continue
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-6">
                  <motion.div 
                    animate={{ 
                      y: [0, -10, 0],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ repeat: Infinity, duration: 4 }}
                    className="w-24 h-24 bg-orange-100 dark:bg-orange-900/30 rounded-3xl flex items-center justify-center text-orange-600"
                  >
                    <Globe size={48} />
                  </motion.div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tight">Your Identity</h2>
                    <p className="text-zinc-500 text-lg">Bhai wants to understand your background better.</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Caste / Community (Optional)</label>
                    <input 
                      type="text" 
                      value={formData.caste || ''}
                      onChange={e => setFormData({ ...formData, caste: e.target.value })}
                      placeholder="Enter your caste or community"
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Preferred Language</label>
                      <div className="grid grid-cols-2 gap-3">
                        {LANGUAGES.map(lang => (
                          <button
                            key={lang.value}
                            onClick={() => setFormData({ ...formData, language: lang.value })}
                            className={cn(
                              "px-4 py-4 rounded-2xl text-sm font-bold border transition-all active:scale-95",
                              formData.language === lang.value 
                                ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600 shadow-lg shadow-orange-500/10" 
                                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                            )}
                          >
                            {lang.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Preferred Script</label>
                      <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-2xl">
                        <button
                          onClick={() => setFormData({ ...formData, script: 'native' })}
                          className={cn(
                            "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                            formData.script === 'native' ? "bg-white dark:bg-zinc-700 shadow-md text-orange-600" : "text-zinc-500"
                          )}
                        >
                          Native Script
                        </button>
                        <button
                          onClick={() => setFormData({ ...formData, script: 'romanized' })}
                          className={cn(
                            "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                            formData.script === 'romanized' ? "bg-white dark:bg-zinc-700 shadow-md text-orange-600" : "text-zinc-500"
                          )}
                        >
                          Romanized
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button onClick={prevStep} className="flex-1 py-5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-black transition-all active:scale-95">Back</button>
                  <button onClick={nextStep} className="flex-[2] py-5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-orange-500/20 active:scale-95">Continue</button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-6">
                  <motion.div 
                    animate={{ 
                      scale: [1, 1.1, 1],
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-24 h-24 bg-orange-100 dark:bg-orange-900/30 rounded-3xl flex items-center justify-center text-orange-600"
                  >
                    <Heart size={48} fill="currentColor" fillOpacity={0.2} />
                  </motion.div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tight">The Connection</h2>
                    <p className="text-zinc-500 text-lg">Why would you like to join the Bhai AI community?</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <textarea 
                    value={formData.joinReason || ''}
                    onChange={e => setFormData({ ...formData, joinReason: e.target.value })}
                    placeholder="Tell us your reason... (e.g., I need a supportive brother, I want to learn, etc.)"
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-3xl px-6 py-6 focus:outline-none focus:ring-2 focus:ring-orange-500 min-h-[180px] resize-none transition-all text-lg"
                  />
                </div>
                <div className="flex gap-4">
                  <button onClick={prevStep} className="flex-1 py-5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-black transition-all active:scale-95">Back</button>
                  <button 
                    disabled={!formData.joinReason}
                    onClick={nextStep} 
                    className="flex-[2] py-5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-orange-500/20 active:scale-95"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div 
                key="step4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-6">
                  <motion.div 
                    animate={{ 
                      rotate: [0, 360],
                    }}
                    transition={{ repeat: Infinity, duration: 10, ease: "linear" }}
                    className="w-24 h-24 bg-orange-100 dark:bg-orange-900/30 rounded-3xl flex items-center justify-center text-orange-600"
                  >
                    <Sparkles size={48} />
                  </motion.div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tight">Choose Your Bhai</h2>
                    <p className="text-zinc-500 text-lg">How should Bhai appear to you?</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Bhai Persona</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setFormData({ ...formData, profileType: 'robot' })}
                        className={cn(
                          "flex flex-col items-center gap-6 p-8 rounded-[32px] border transition-all active:scale-95",
                          formData.profileType === 'robot' 
                            ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600 shadow-xl shadow-orange-500/10" 
                            : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                        )}
                      >
                        <div className="w-20 h-20 bg-white dark:bg-zinc-800 rounded-2xl flex items-center justify-center shadow-sm">
                          <Bot size={40} />
                        </div>
                        <div className="text-center space-y-1">
                          <p className="font-black text-lg">Robot Brother</p>
                          <p className="text-xs text-zinc-500">A futuristic AI companion</p>
                        </div>
                      </button>
                      <button
                        onClick={() => setFormData({ ...formData, profileType: 'human' })}
                        className={cn(
                          "flex flex-col items-center gap-6 p-8 rounded-[32px] border transition-all active:scale-95",
                          formData.profileType === 'human' 
                            ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600 shadow-xl shadow-orange-500/10" 
                            : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                        )}
                      >
                        <div className="w-20 h-20 bg-white dark:bg-zinc-800 rounded-2xl flex items-center justify-center shadow-sm">
                          <UserCircle size={40} />
                        </div>
                        <div className="text-center space-y-1">
                          <p className="font-black text-lg">Human Friend</p>
                          <p className="text-xs text-zinc-500">A warm, friendly persona</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Voice Preference</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setFormData({ ...formData, voicePreference: 'male' })}
                        className={cn(
                          "py-4 rounded-2xl border font-bold transition-all active:scale-95",
                          formData.voicePreference === 'male' 
                            ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600" 
                            : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"
                        )}
                      >
                        Male Voice
                      </button>
                      <button
                        onClick={() => setFormData({ ...formData, voicePreference: 'female' })}
                        className={cn(
                          "py-4 rounded-2xl border font-bold transition-all active:scale-95",
                          formData.voicePreference === 'female' 
                            ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600" 
                            : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"
                        )}
                      >
                        Female Voice
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button onClick={prevStep} className="flex-1 py-5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-black transition-all active:scale-95">Back</button>
                  <button 
                    onClick={nextStep}
                    className="flex-[2] py-5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-xl transition-all shadow-2xl shadow-orange-500/30 flex items-center justify-center gap-3 active:scale-95"
                  >
                    Continue
                    <ArrowRight size={24} />
                  </button>
                </div>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div 
                key="step5"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-6">
                  <motion.div 
                    animate={{ 
                      scale: [1, 1.05, 1],
                    }}
                    transition={{ repeat: Infinity, duration: 3 }}
                    className="w-24 h-24 bg-orange-100 dark:bg-orange-900/30 rounded-3xl flex items-center justify-center text-orange-600"
                  >
                    <ShieldCheck size={48} />
                  </motion.div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tight">Vibe & Safety</h2>
                    <p className="text-zinc-500 text-lg">Set the mood of your interaction.</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-2">Interaction Mode</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setFormData({ ...formData, interactionMode: 'brother' })}
                        className={cn(
                          "flex flex-col items-center gap-4 p-6 rounded-3xl border transition-all active:scale-95",
                          formData.interactionMode === 'brother' 
                            ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600" 
                            : "border-zinc-200 dark:border-zinc-800"
                        )}
                      >
                        <Heart size={24} />
                        <p className="font-bold">Brother Mode</p>
                      </button>
                      <button
                        onClick={() => setFormData({ ...formData, interactionMode: 'friend' })}
                        className={cn(
                          "flex flex-col items-center gap-4 p-6 rounded-3xl border transition-all active:scale-95",
                          formData.interactionMode === 'friend' 
                            ? "border-orange-600 bg-orange-50 dark:bg-orange-950 text-orange-600" 
                            : "border-zinc-200 dark:border-zinc-800"
                        )}
                      >
                        <Zap size={24} />
                        <p className="font-bold">Friend Mode</p>
                      </button>
                    </div>
                  </div>

                  <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 rounded-3xl border border-zinc-200 dark:border-zinc-700 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="font-bold">18+ Content Permission</p>
                        <p className="text-xs text-zinc-500">Enable adult talk and information</p>
                      </div>
                      <button 
                        onClick={() => setFormData({ ...formData, isAdult: !formData.isAdult })}
                        className={cn(
                          "w-14 h-8 rounded-full transition-all relative",
                          formData.isAdult ? "bg-orange-600" : "bg-zinc-300 dark:bg-zinc-600"
                        )}
                      >
                        <motion.div 
                          animate={{ x: formData.isAdult ? 24 : 4 }}
                          className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                    {formData.isAdult && (
                      <p className="text-[10px] text-orange-600 font-medium bg-orange-50 dark:bg-orange-950/30 p-3 rounded-xl">
                        By enabling this, you confirm you are 18+ years old. Bhai will speak more freely and can discuss adult topics.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={prevStep} className="flex-1 py-5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-black transition-all active:scale-95">Back</button>
                  <button 
                    onClick={() => onComplete(formData)} 
                    className="flex-[2] py-5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-orange-500/20 active:scale-95 flex items-center justify-center gap-2"
                  >
                    Finish Setup <Check size={20} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
