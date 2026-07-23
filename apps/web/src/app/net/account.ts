import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import type { PlayerSave } from '@elite/sim'
import { auth, db } from './firebase'

/**
 * Аккаунт и серверный сейв поверх Firebase. Аутентификацию НЕ пишем сами — это
 * Firebase Auth (email+password): хеш, TLS, сессия, обновление токена — на их стороне.
 * Сейв — документ Firestore `saves/{uid}`, поле `save` — JSON-строкой (обходит ограничения
 * Firestore на вложенные массивы и повторяет то, что уже делаем для localStorage).
 *
 * Все функции зовутся лишь в онлайн-режиме (`online === true`); тогда `auth`/`db` не null.
 * Правила Firestore — вторая линия: даже подделав запрос, чужой документ не достать.
 */

function requireAuth() {
  if (!auth) throw new Error('Firebase не настроен: сеть выключена')
  return auth
}
function requireDb() {
  if (!db) throw new Error('Firebase не настроен: сеть выключена')
  return db
}

export interface AuthResult {
  ok: boolean
  /** Человекочитаемая причина отказа (для формы). null — успех. */
  error: string | null
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    await createUserWithEmailAndPassword(requireAuth(), email, password)
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    await signInWithEmailAndPassword(requireAuth(), email, password)
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

export async function signOut(): Promise<void> {
  await fbSignOut(requireAuth())
}

/** id текущего пользователя или null. У Firebase доступ синхронный (`currentUser`). */
export function currentUserId(): string | null {
  return requireAuth().currentUser?.uid ?? null
}

/**
 * Подписка на вход/выход. Возвращает отписку. Первым событием Firebase отдаёт текущее
 * состояние (восстановленную из хранилища сессию), так что начальный uid прилетит сам.
 */
export function onAuthChange(cb: (userId: string | null) => void): () => void {
  return onAuthStateChanged(requireAuth(), (user) => cb(user?.uid ?? null))
}

/**
 * Сейв игрока с сервера — свой документ `saves/{uid}` (правила Firestore ограничат чужим).
 * Нет документа или чужой версии формата — как будто сейва нет (новичок), а не падение.
 */
export async function loadServerSave(): Promise<PlayerSave | null> {
  const uid = currentUserId()
  if (!uid) return null
  const snap = await getDoc(doc(requireDb(), 'saves', uid))
  const raw = snap.exists() ? (snap.data().save as string | undefined) : undefined
  if (!raw) return null
  try {
    const save = JSON.parse(raw) as PlayerSave
    return save && save.version === 1 ? save : null
  } catch {
    return null
  }
}

/** Записать сейв: документ `saves/{uid}` (правила проверят, что это ТЫ). save — JSON-строкой. */
export async function writeServerSave(save: PlayerSave): Promise<void> {
  const uid = currentUserId()
  if (!uid) throw new Error('Нет сессии — серверный сейв невозможен')
  await setDoc(doc(requireDb(), 'saves', uid), { save: JSON.stringify(save), updatedAt: serverTimestamp() })
}

/**
 * Стереть серверный сейв — «новая игра»: следующая загрузка увидит новичка и покажет
 * создание персонажа. Нет сессии — молча выходим (нечего стирать).
 */
export async function clearServerSave(): Promise<void> {
  const uid = currentUserId()
  if (!uid) return
  await deleteDoc(doc(requireDb(), 'saves', uid))
}
