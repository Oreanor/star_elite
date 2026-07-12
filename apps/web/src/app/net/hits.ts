import { onChildAdded, push, ref, remove } from 'firebase/database'
import { currentUserId } from './account'
import { rtdb } from './firebase'

/**
 * Канал ПОПАДАНИЙ игрок-в-игрока. Авторитет над своим HP — у каждого клиента: когда МОЙ болт
 * попал в чужой (кинематический) борт, я не трогаю его призрак, а кладу запись урона в его ящик
 * `hits/{uid}`; он забирает её у себя и бьёт по собственному HP. Симметрично прилетает и мне.
 * Так выстрел одного клиента честно меняет здоровье другого без общего авторитетного мира —
 * и жульничать «я не умер» бессмысленно: собственную смерть считает твой же клиент.
 *
 * Ящик РАСХОДУЕМЫЙ: приняв запись, получатель тут же её удаляет — иначе на переподключении
 * тот же урон применился бы заново. Домен об этом не знает: транспорт целиком в слое app.
 */

/** Отправить попадание игроку `targetUid`: урон уйдёт в его ящик, применит он его сам. */
export async function sendHit(targetUid: string, damage: number): Promise<void> {
  if (!rtdb) return
  const from = currentUserId()
  if (!from) return
  await push(ref(rtdb, `hits/${targetUid}`), { dmg: damage, from })
}

/**
 * Подписка на СВОЙ ящик попаданий. На каждую новую запись зовёт `cb(урон)` и тут же СТИРАЕТ её
 * (расходуемая очередь — приняли ровно один раз). Возвращает отписку. Офлайн/без сессии — no-op.
 */
export function subscribeHits(cb: (damage: number) => void): () => void {
  if (!rtdb) return () => {}
  const uid = currentUserId()
  if (!uid) return () => {}
  return onChildAdded(ref(rtdb, `hits/${uid}`), (snap) => {
    const v = snap.val() as { dmg?: number } | null
    const dmg = typeof v?.dmg === 'number' ? v.dmg : 0
    // Стираем ДО применения: запись принята ровно один раз, даже если что-то ниже бросит.
    void remove(snap.ref)
    if (dmg > 0) cb(dmg)
  })
}
