import { useState } from 'react'
import { signIn, signUp } from '../../app/net/account'
import { t, useLang } from '../i18n'

/**
 * Экран входа/регистрации — гейт перед игрой в онлайн-режиме. Обычная HTML-форма с
 * `autocomplete`, чтобы менеджер паролей браузера предлагал сохранить и подставить
 * логин: своего хранилища кредов у нас нет. Аутентификацию считает Supabase Auth,
 * экран лишь собирает почту и пароль и показывает отказ.
 *
 * `onDone` не зовём руками при успехе: вход меняет сессию Supabase, а на неё подписан
 * `onAuthChange` в оболочке — она сама уберёт гейт. Так один источник правды о входе.
 */
export function AuthScreen() {
  useLang() // подписка: смена языка перерисует экран
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const register = mode === 'register'

  const submit = async () => {
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = register ? await signUp(email.trim(), password) : await signIn(email.trim(), password)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    // Успех входа снимет гейт сам (подписка на сессию). При регистрации сессии может
    // ещё не быть (требуется подтверждение почты) — тогда покажем подсказку.
    if (register) setNotice(t('auth.confirm'))
  }

  return (
    <div
      className="absolute inset-0 overflow-y-auto bg-black bg-cover bg-center font-mono text-[#7fd6ff]"
      style={{ backgroundImage: 'url(/bg.webp)' }}
    >
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative flex min-h-full items-center justify-center px-4 py-8">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex w-full max-w-[26rem] flex-col gap-5 rounded-2xl border p-8 backdrop-blur-md"
          style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(20,44,74,0.42)' }}
        >
          <h1 className="text-center text-lg tracking-[0.4em]">{t(register ? 'auth.register' : 'auth.login')}</h1>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-[0.3em] text-[#3f7391]">{t('auth.email')}</span>
            <input
              autoFocus
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border bg-transparent px-3 py-2 text-sm tracking-widest outline-none"
              style={{ borderColor: '#3f7391', color: '#7fd6ff' }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-[0.3em] text-[#3f7391]">{t('auth.password')}</span>
            <input
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border bg-transparent px-3 py-2 text-sm tracking-widest outline-none"
              style={{ borderColor: '#3f7391', color: '#7fd6ff' }}
            />
          </label>

          {error && (
            <div className="text-xs tracking-wide" style={{ color: '#ff6a4a' }}>
              {error}
            </div>
          )}
          {notice && (
            <div className="text-xs tracking-wide" style={{ color: '#7fd6ff' }}>
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="mt-1 self-center border border-[#7fd6ff] bg-[#142c4a]/[0.38] px-10 py-3 text-base tracking-[0.3em]
                       text-[#7fd6ff] transition-colors hover:bg-[#7fd6ff] hover:text-black
                       disabled:cursor-not-allowed disabled:border-[#3f7391] disabled:bg-transparent disabled:text-[#3f7391]"
          >
            {busy ? t('auth.wait') : t(register ? 'auth.create' : 'auth.enter')}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(register ? 'login' : 'register')
              setError(null)
              setNotice(null)
            }}
            className="cursor-pointer text-center text-xs tracking-widest text-[#3f7391] hover:text-[#7fd6ff]"
          >
            {t(register ? 'auth.toLogin' : 'auth.toRegister')}
          </button>
        </form>
      </div>
    </div>
  )
}
