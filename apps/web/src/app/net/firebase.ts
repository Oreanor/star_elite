import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

/**
 * Firebase — единственная точка входа в сеть: Auth (аккаунты), Firestore (сейвы),
 * а позже Realtime Database (присутствие). Своего сервера у нас нет.
 *
 * ОНЛАЙН включается ТОЛЬКО когда заданы ключи проекта (`.env.local` в КОРНЕ, envDir=../../).
 * Нет ключей — `auth`/`db` === null и `online` === false: игра идёт офлайн (localStorage),
 * не падая. Так master-ветка и запуск без проекта Firebase остаются рабочими, а сеть
 * «загорается» сама, стоит вписать конфиг. Ключи Firebase публичны намеренно — доступ
 * стерегут правила безопасности (Firestore Rules), не тайна ключа.
 */
const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Минимум для Auth+Firestore: ключ, домен, id проекта. appId необязателен.
const configured = Boolean(config.apiKey && config.authDomain && config.projectId)

const app: FirebaseApp | null = configured ? initializeApp(config) : null
export const auth: Auth | null = app ? getAuth(app) : null
export const db: Firestore | null = app ? getFirestore(app) : null

/** Настроена ли сеть. Где ветвится «онлайн против офлайн» — спрашиваем это, а не env. */
export const online: boolean = app !== null
