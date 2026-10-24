import { onChildAdded, onValue, push, ref, set } from 'firebase/database'
import { pushEdit, reconcileFates, type GalaxyEdit, type World } from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb } from './net/firebase'

/**
 * ОБЩИЙ ЖУРНАЛ ПРАВОК ГАЛАКТИКИ. Бог перекрашивает, переименовывает, двигает и стирает звёзды;
 * это состояние ГАЛАКТИКИ, а не игрока: его видят все, кто в ней, и оно переживает
 * перезагрузку. Прежде дельта жила только в памяти клиента — правки Слова пропадали на
 * рефреше и не доходили до других.
 *
 * Узел — `galaxy/{зерно}/edits`, журнал только дописывается (как и сама дельта). Подписка
 * держится, пока то же зерно и та же дельта, — НЕ рвётся на прыжке, как у камней: правки
 * принадлежат галактике, а не системе, и переподписка переиграла бы журнал заново.
 * Свою правку домен уже наложил; её эхо из сети узнаём по ключу и не кладём второй раз.
 */

const KNOWN_OPS = new Set(['move', 'recolor', 'rename', 'remove', 'add', 'fate'])

/** Запись из сети — правка, если похожа на правку; чужой мусор в дельту не пускаем. */
function asEdit(raw: unknown): GalaxyEdit | null {
  if (typeof raw !== 'object' || raw === null) return null
  const op = (raw as { op?: unknown }).op
  return typeof op === 'string' && KNOWN_OPS.has(op) ? (raw as GalaxyEdit) : null
}

/** Кто ждёт загрузки журнала (консоль прячет вкладку планеты, пока журнал не пришёл). */
const readyListeners = new Set<() => void>()

class SharedGalaxy {
  /**
   * Журнал галактики ЗАГРУЖЕН: все записи, что были в сети на момент подписки, уже легли на
   * дельту. До этого мир не знает, что разбито: консоль открывалась на вкладке целой планеты,
   * а через миг та пропадала. Без сети и аккаунта журнала нет — готово сразу.
   */
  private loaded = false
  /** Первый снимок пришёл; ляжет в дельту в ближайшем такте (вместе с его правками). */
  private loadedPending = false
  private world: World | null = null
  private seed: number | null = null
  private unsub: (() => void) | null = null
  /** Ключи записей журнала, уже наложенных на дельту этого мира (свои и чужие). */
  private applied = new Set<string>()
  private incoming: { key: string; edit: GalaxyEdit }[] = []

  tick(world: World): void {
    if (!rtdb || !currentUserId()) {
      // Без сети очередь некому забрать — правки живут в памяти, как раньше.
      world.galaxyEditsOut.length = 0
      return
    }
    if (world.galaxySeed !== this.seed || world.galaxyDelta !== this.world?.galaxyDelta) this.attach(world)
    // Портальный мир делит дельту с прежним: тот же журнал, подписку не рвём —
    // переподписка наложила бы все правки второй раз.
    else this.world = world

    for (const { seed, edit } of world.galaxyEditsOut) {
      const node = push(ref(rtdb, `galaxy/${seed}/edits`))
      // Ключ — ДО записи: локальное событие `child_added` придёт синхронно с записью.
      if (seed === this.seed && node.key) this.applied.add(node.key)
      void set(node, edit).catch((e) => console.warn('Правка галактики не записана:', e))
    }
    world.galaxyEditsOut.length = 0

    for (const { key, edit } of this.incoming) {
      if (this.applied.has(key)) continue
      this.applied.add(key)
      pushEdit(world.galaxyDelta, edit)
      world.galaxyEpoch++
    }
    this.incoming.length = 0
    // Судьбы тел — сразу, а не в шаге мира: консоль узнает о загрузке журнала в этом же кадре
    // и не должна успеть увидеть разбитую планету целой.
    reconcileFates(world)
    if (this.loadedPending) {
      this.loadedPending = false
      this.loaded = true
      for (const l of readyListeners) l()
    }
  }

  /** Журнал загружен (или его нет вовсе — офлайн). */
  isReady(): boolean {
    return !rtdb || !currentUserId() || this.loaded
  }

  private attach(world: World): void {
    this.unsub?.()
    this.world = world
    this.seed = world.galaxySeed
    this.applied.clear()
    this.incoming.length = 0
    const wasLoaded = this.loaded
    this.loaded = false
    this.loadedPending = false
    if (wasLoaded) for (const l of readyListeners) l()
    if (!rtdb) return
    const node = ref(rtdb, `galaxy/${world.galaxySeed}/edits`)
    const offChild = onChildAdded(node, (snap) => {
      const edit = asEdit(snap.val())
      if (snap.key && edit) this.incoming.push({ key: snap.key, edit })
    })
    // Firebase шлёт все стартовые child_added ДО первого value того же узла: value — знак, что
    // снимок журнала целиком в очереди.
    const offValue = onValue(node, () => {
      this.loadedPending = true
    }, { onlyOnce: true })
    this.unsub = () => {
      offChild()
      offValue()
    }
  }
}

export const sharedGalaxy = new SharedGalaxy()

/** Загружен ли журнал галактики — для `useSyncExternalStore`. */
export function galaxyJournalReady(): boolean {
  return sharedGalaxy.isReady()
}

export function subscribeGalaxyJournal(listener: () => void): () => void {
  readyListeners.add(listener)
  return () => readyListeners.delete(listener)
}
