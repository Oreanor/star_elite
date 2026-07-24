import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getDatabase, onValue, ref, type Database } from 'firebase/database'
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
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Минимум для Auth+Firestore: ключ, домен, id проекта. appId необязателен.
const configured = Boolean(config.apiKey && config.authDomain && config.projectId)

const app: FirebaseApp | null = configured ? initializeApp(config) : null
export const auth: Auth | null = app ? getAuth(app) : null
export const db: Firestore | null = app ? getFirestore(app) : null

/**
 * Realtime Database — для присутствия (кто в какой системе): низкая задержка и
 * onDisconnect (сам стирает отвалившегося). Отдельный ключ `databaseURL`: нет его —
 * presence просто выключен, а вход и сейвы (Auth+Firestore) работают как есть.
 */
export const rtdb: Database | null = app && config.databaseURL ? getDatabase(app) : null

/** Настроена ли сеть. Где ветвится «онлайн против офлайн» — спрашиваем это, а не env. */
export const online: boolean = app !== null

/**
 * Поправка к часам сервера, мс. RTDB отдаёт её в служебном узле `/.info/serverTimeOffset`
 * и держит свежей сама.
 *
 * Нужна затем, что отметки записей (`t: serverTimestamp()`) — в СЕРВЕРНЫХ миллисекундах, а
 * `Date.now()` у клиента свой и может врать на минуты. Сравнивать их напрямую нельзя: при
 * спешащих часах живой игрок выглядел бы протухшим, при отстающих — мертвец вечно свежим.
 */
let clockOffset = 0
if (rtdb) onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => { clockOffset = (snap.val() as number) ?? 0 })

/** «Сейчас» по часам СЕРВЕРА, мс. Только для сравнения с отметками записей. */
export function serverNow(): number {
  return Date.now() + clockOffset
}
