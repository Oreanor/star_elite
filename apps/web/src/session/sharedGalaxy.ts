import { onChildAdded, push, ref, set } from 'firebase/database'
import { pushEdit, type GalaxyEdit, type World } from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb } from './net/firebase'

/**
 * ОБЩИЙ ЖУРНАЛ ПРАВОК ГАЛАКТИКИ. Бог перекрашивает, переименовывает, двигает и стирает звёзды;
 * это состояние ГАЛАКТИКИ, а не игрока: его видят все, кто в ней, и оно переживает
 * перезагрузку. Прежде дельта жила только в памяти клиента — правки Слова пропадали на
 * рефреше и не доходили до других.
 *
 * Узел — `galaxy/{зерно}/edits`, журнал только дописывается (как и сама дельта). Подписка
 * держится, пока то же зерно и тот же мир, — НЕ рвётся на прыжке, как у камней: правки
 * принадлежат галактике, а не системе, и переподписка переиграла бы журнал заново.
 * Свою правку домен уже наложил; её эхо из сети узнаём по ключу и не кладём второй раз.
 */

const KNOWN_OPS = new Set(['move', 'recolor', 'rename', 'remove', 'add'])

/** Запись из сети — правка, если похожа на правку; чужой мусор в дельту не пускаем. */
function asEdit(raw: unknown): GalaxyEdit | null {
  if (typeof raw !== 'object' || raw === null) return null
  const op = (raw as { op?: unknown }).op
  return typeof op === 'string' && KNOWN_OPS.has(op) ? (raw as GalaxyEdit) : null
}

class SharedGalaxy {
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
    if (world !== this.world || world.galaxySeed !== this.seed) this.attach(world)

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
  }

  private attach(world: World): void {
    this.unsub?.()
    this.world = world
    this.seed = world.galaxySeed
    this.applied.clear()
    this.incoming.length = 0
    if (!rtdb) return
    this.unsub = onChildAdded(ref(rtdb, `galaxy/${world.galaxySeed}/edits`), (snap) => {
      const edit = asEdit(snap.val())
      if (snap.key && edit) this.incoming.push({ key: snap.key, edit })
    })
  }
}

export const sharedGalaxy = new SharedGalaxy()
