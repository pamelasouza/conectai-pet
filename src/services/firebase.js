import { initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();
const ai = getAI(app, { backend: new GoogleAIBackend() });
const petVisionModel = getGenerativeModel(ai, {
  model: 'gemini-3.7-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.2,
    maxOutputTokens: 400,
  },
});

async function analyzePetImage(base64, mimeType) {
  const result = await petVisionModel.generateContent([
    `Analise a foto de um pet e retorne somente JSON válido com exatamente estas chaves:
{
  "name": "",
  "species": "cachorro|gato|outro",
  "breed": "",
  "color": "",
  "notes": ""
}
Não invente o nome do animal. Use name vazio quando não for possível saber. Em breed, use uma raça provável ou "sem raça definida". Descreva apenas características visíveis em color e notes. A resposta deve ser JSON puro, sem markdown.`,
    { inlineData: { data: base64, mimeType } },
  ]);
  return JSON.parse(result.response.text());
}

export {
  auth,
  analyzePetImage,
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  db,
  deleteDoc,
  doc,
  getDocs,
  googleProvider,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  storage,
  getDownloadURL,
  ref,
  uploadBytes,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
};
