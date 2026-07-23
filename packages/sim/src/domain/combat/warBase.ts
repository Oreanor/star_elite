import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import type { WarBaseEntity, World } from '../world/entities'
import { spawnExplosion } from './effects'
import { spawnRockDebrisPod } from './salvage'

/** Глыбы у статуи не дрейфуют — вспышка гибели без унаследованной скорости. */
const _still = /* @__PURE__ */ new Vector3()

/** Сколько осколков сыплется с камня: крупнее — гуще. */
function debrisCount(radius: number): number {
  const span = MONOLITH.ROCK_RADIUS_MAX - MONOLITH.ROCK_RADIUS_MIN
  const t = span > 1e-6 ? (radius - MONOLITH.ROCK_RADIUS_MIN) / span : 0
  const n =
    MONOLITH.ROCK_DEBRIS_MIN +
    Math.round(Math.min(1, Math.max(0, t)) * (MONOLITH.ROCK_DEBRIS_MAX - MONOLITH.ROCK_DEBRIS_MIN))
  return n
}

/** Взорвать глыбу и оставить подбираемые осколки с массой. */
export function destroyWarBase(world: World, rock: WarBaseEntity): void {
  rock.alive = false
  spawnExplosion(world, rock.pos, _still, rock.radius * MONOLITH.ROCK_BLAST)

  const n = debrisCount(rock.radius)
  for (let i = 0; i < n; i++) {
    spawnRockDebrisPod(
      world,
      rock.pos,
      _still,
      rock.shape,
      MONOLITH.ROCK_DEBRIS_RADIUS * (0.7 + world.rng() * 0.6),
      MONOLITH.ROCK_DEBRIS_MASS,
      MONOLITH.ROCK_DEBRIS_SPEED,
    )
  }
}

/** Урон глыбе. Прочность кончилась — взрыв и осколки, а не раскол рудного пояса. */
export function damageWarBase(world: World, rock: WarBaseEntity, amount: number): void {
  if (!rock.alive) return
  rock.hull -= amount
  if (rock.hull <= 0) destroyWarBase(world, rock)
}
