import { onDisconnect, onValue, ref, remove, set } from 'firebase/database'
import type { World } from '@elite/sim'
import { currentUserId } from './account'
import { rtdb } from './firebase'

/**
 * Быстрый канал позы — «где именно летит рядом». Это ВТОРОЙ presence, не путать с
 * `presence.ts` («кто где вообще по галактике», раз в 2 с): тот кормит список В СЕТИ и
 * метки карт, а этот — рендер чужого борта в мире и точку на радаре. Развод по назначению
 * и частоте: медленный presence гейтит быстрый (подписываешься на позу лишь тех, кто в
 * ТВОЕЙ системе).
 *
 * Поза АБСОЛЮТНАЯ (`state.pos + originOffset`): плавающее начало у каждого своё, а сумма —
 * общий кадр, и борта сходятся. Скорость шлём для экстраполяции между пакетами (при ~12 Гц
 * между ними ~80 мс — без предсказания борт дёргался бы). Канал живёт в узле СИСТЕМЫ
 * (`poses/{systemIndex}`), чтобы подписка тянула только соседей, а не всю галактику.
 *
 * Домен об этом не знает: транспорт целиком в слое app. Здесь — только сырые снапшоты;
 * интерполяция и материализация в `ShipEntity` — выше (`RemoteController`).
 */

/** Сырой снапшот чужого борта из канала. Ключи коротки: пакет уходит ~12 раз в секунду. */
export interface PoseSnapshot {
  uid: string
  /** Абсолютная позиция в системе (state.pos + originOffset), м. */
  x: number
  y: number
  z: number
  /** Ориентация. */
  qx: number
  qy: number
  qz: number
  qw: number
  /** Скорость в мировом кадре, м/с — для экстраполяции между пакетами. */
  vx: number
  vy: number
  vz: number
  /** Масштаб борта (миелофон): чужой видит тебя гигантом, если ты вырос. По умолчанию 1. */
  s: number
}

/** То, что клиент публикует о себе; uid добавляется на приёме из ключа узла. */
export type PoseUpdate = Omit<PoseSnapshot, 'uid'>

/** Собрать свою позу из мира: абсолютная позиция, ориентация, скорость. */
export function selfPose(world: World): PoseUpdate {
  const { pos, quat, vel } = world.player.state
  const off = world.originOffset
  return {
    x: pos.x + off.x,
    y: pos.y + off.y,
    z: pos.z + off.z,
    qx: quat.x,
    qy: quat.y,
    qz: quat.z,
    qw: quat.w,
    vx: vel.x,
    vy: vel.y,
    vz: vel.z,
    s: world.player.state.scale,
  }
}

/**
 * Путь последнего опубликованного узла. Прыжок меняет systemIndex, и старый узел в
 * `poses/{прежняя}` надо снять руками — иначе он висел бы там до `onDisconnect`, и в старой
 * системе тебя ещё «видели» бы призраком. Модульная переменная: публикатор один на клиента.
 */
let lastPath: string | null = null

/**
 * Транслировать свою позу в узел текущей системы. Зовётся из петли ~12–15 Гц. Сменил
 * систему — прежний узел стирается, `onDisconnect` вешается на новый (отвалилась вкладка —
 * метка исчезнет у соседей сама).
 */
export async function publishPose(systemIndex: number, pose: PoseUpdate): Promise<void> {
  if (!rtdb) return
  const uid = currentUserId()
  if (!uid) return
  const path = `poses/${systemIndex}/${uid}`
  const isNew = lastPath !== path
  // Сменил систему — стереть прежний узел, иначе в старой останешься призраком до onDisconnect.
  if (lastPath && isNew) await remove(ref(rtdb, lastPath))
  lastPath = path
  const node = ref(rtdb, path)
  // onDisconnect вешаем ОДИН раз на путь, а не на каждый пакет (~15 Гц): отвалилась
  // вкладка — узел исчезнет у соседей сам.
  if (isNew) void onDisconnect(node).remove()
  await set(node, pose)
}

/** Снять свою позу сейчас (выход/размонтирование/прыжок), не дожидаясь `onDisconnect`. */
export async function clearPose(): Promise<void> {
  if (!rtdb || !lastPath) return
  const path = lastPath
  lastPath = null
  await remove(ref(rtdb, path))
}

/**
 * Подписка на позы всех в системе `systemIndex`, КРОМЕ себя. Возвращает отписку. Прыгнул —
 * вызывающий переподписывается на новый индекс (старая отписка снимает прежний слушатель).
 */
export function subscribePoses(systemIndex: number, cb: (snaps: PoseSnapshot[]) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  return onValue(ref(rtdb, `poses/${systemIndex}`), (snap) => {
    const val = (snap.val() ?? {}) as Record<string, Partial<PoseSnapshot>>
    const list: PoseSnapshot[] = []
    for (const [uid, p] of Object.entries(val)) {
      if (uid === me || typeof p?.x !== 'number') continue
      list.push({
        uid,
        x: p.x,
        y: p.y ?? 0,
        z: p.z ?? 0,
        qx: p.qx ?? 0,
        qy: p.qy ?? 0,
        qz: p.qz ?? 0,
        qw: p.qw ?? 1,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
        vz: p.vz ?? 0,
        s: p.s ?? 1,
      })
    }
    cb(list)
  })
}
