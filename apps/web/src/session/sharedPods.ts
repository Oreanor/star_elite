import { Vector3 } from 'three'
import {
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
} from 'firebase/database'
import {
  SALVAGE,
  dropNetPod,
  rehydrateCargoItem,
  revokeScoop,
  serializeCargoItem,
  spawnNetPod,
  type CargoPodEntity,
  type SavedCargoItem,
  type World,
} from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb, serverNow } from './net/firebase'
import { trafficKey } from './net/trafficNet'

/**
 * ОБЩИЕ КОНТЕЙНЕРЫ. Что выбросил ты — видит друг, и подобрать его может он; что выпало из
 * сбитого бота — видят все. Забирает ПЕРВЫЙ: подбор — транзакция, помечающая контейнер своим.
 *
 * Позы не гоняем: контейнер дрейфует прямо, и место у всех считается одинаково из точки,
 * скорости и момента выброса по часам сервера. Узел — `traffic/{система}/pods/{ключ}`.
 *
 * Подбор ОПТИМИСТИЧЕН: домен кладёт предмет в трюм сразу (иначе подбор ощущался бы с
 * задержкой пинга) и оставляет заявку (`world.podClaims`). Сеть подтверждает или нет; кто не
 * успел — предмет уходит из трюма обратно (`revokeScoop`).
 */

interface PodNode {
  i: SavedCargoItem
  /** Абсолютная точка и скорость в момент выброса. */
  p: number[]
  v: number[]
  /** Момент выброса по часам сервера, мс. */
  t: number
  by: string
  /** Кто забрал. Есть — контейнера больше нет ни у кого. */
  taken?: string
}

const _pos = new Vector3()
const _vel = new Vector3()

export class SharedPods {
  private key: string | null = null
  private me: string | null = null
  private unsub: (() => void)[] = []
  /** Пришедшие из сети, ещё не материализованные: материализуем в кадре, не в колбэке. */
  private incoming: { id: string; node: PodNode }[] = []
  private gone: string[] = []
  /** Объявленные мной: ключ → контейнер. По ним видно, что контейнер истёк у меня. */
  private mine = new Map<string, CargoPodEntity>()

  tick(world: World): void {
    if (!rtdb || !currentUserId()) {
      world.podClaims.length = 0
      return
    }
    const key = trafficKey(world.galaxySeed, world.systemIndex)
    if (key !== this.key) this.attach(key)
    const base = `traffic/${key}/pods`
    const o = world.originOffset

    // 1) Новые свои контейнеры — объявить.
    for (const pod of world.pods) {
      if (!pod.alive || pod.netId) continue
      const node = push(ref(rtdb, base))
      pod.netId = node.key!
      this.mine.set(pod.netId, pod)
      void set(node, {
        i: serializeCargoItem(pod.item),
        p: [pod.pos.x + o.x, pod.pos.y + o.y, pod.pos.z + o.z],
        v: [pod.vel.x, pod.vel.y, pod.vel.z],
        t: serverTimestamp(),
        by: this.me,
      }).catch(() => {})
    }

    // 2) Чужие пришли — в мир, с поправкой на прошедшее с выброса время.
    for (const { id, node } of this.incoming) {
      if (world.pods.some((p) => p.netId === id)) continue
      const item = rehydrateCargoItem(node.i)
      if (!item || node.p.length < 3 || node.v.length < 3) continue
      const age = Math.max(0, (serverNow() - node.t) / 1000)
      _vel.set(node.v[0]!, node.v[1]!, node.v[2]!)
      _pos.set(node.p[0]! - o.x, node.p[1]! - o.y, node.p[2]! - o.z).addScaledVector(_vel, age)
      spawnNetPod(world, id, item, _pos, _vel, age)
    }
    this.incoming.length = 0

    // 3) Забранные/истёкшие у других — убрать здесь.
    for (const id of this.gone) {
      dropNetPod(world, id)
      this.mine.delete(id)
    }
    this.gone.length = 0

    // 4) Мои подборы — подтвердить у сервера; кто не успел — вернуть предмет.
    for (const claim of world.podClaims) {
      const node = ref(rtdb, `${base}/${claim.netId}`)
      const me = this.me!
      this.mine.delete(claim.netId)
      void runTransaction(node, (cur: PodNode | null) => {
        if (cur == null) return cur
        if (cur.taken) return undefined
        return { ...cur, taken: me }
      })
        .then((res) => {
          const v = res.snapshot.val() as PodNode | null
          if (res.committed && v?.taken === me) {
            void remove(node).catch(() => {})
            return
          }
          // Сервер ОТВЕТИЛ: контейнер уже чей-то — предмет уходит. Только так: при ошибке сети
          // или правил (catch ниже) предмет остаётся — отнять его без ответа сервера нельзя.
          if (v?.taken && v.taken !== me) revokeScoop(world, claim.shipId, claim.item)
        })
        .catch(() => {})
    }
    world.podClaims.length = 0

    // 5) Мой контейнер истёк у меня (не подобран) — снять узел, чтобы не висел у других.
    for (const [id, pod] of [...this.mine]) {
      if (pod.alive && world.pods.includes(pod)) continue
      this.mine.delete(id)
      void remove(ref(rtdb, `${base}/${id}`)).catch(() => {})
    }
  }

  detach(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    this.key = null
    this.incoming.length = 0
    this.gone.length = 0
    this.mine.clear()
  }

  private attach(key: string): void {
    this.detach()
    this.key = key
    this.me = currentUserId()
    if (!rtdb) return
    const node = ref(rtdb, `traffic/${key}/pods`)
    const db = rtdb
    const snap = (id: string) => ref(db, `traffic/${key}/pods/${id}`)
    const accept = (id: string | null, v: PodNode | null): void => {
      if (!id || !v || v.by === this.me) return
      // Выбросивший отключился, а узел остался: срок вышел — убирает любой, кто увидел.
      if (typeof v.t === 'number' && serverNow() - v.t > SALVAGE.POD_LIFETIME * 1000) {
        void remove(snap(id)).catch(() => {})
        return
      }
      if (v.taken) this.gone.push(id)
      else if (Array.isArray(v.p) && Array.isArray(v.v) && typeof v.t === 'number') this.incoming.push({ id, node: v })
    }
    this.unsub.push(
      onChildAdded(node, (snap) => accept(snap.key, snap.val() as PodNode | null)),
      onChildChanged(node, (snap) => {
        const v = snap.val() as PodNode | null
        if (snap.key && v?.taken && v.taken !== this.me) this.gone.push(snap.key)
      }),
      onChildRemoved(node, (snap) => {
        if (snap.key) this.gone.push(snap.key)
      }),
    )
  }
}

export const sharedPods = new SharedPods()
