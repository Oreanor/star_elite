import { BREAKAGE } from '../../config/weapons'
import type { Rng } from '../../core/math'
import { isArmour, isCargo, isMissile, isShield, type WeaponModule } from '../loadout'
import { withFault } from '../station/shop'
import type { ShipEntity } from '../world/entities'
import { refreshSpec } from '../world/factory'

/**
 * ПОЛОМКА снаряжения в бою (см. [[breakage-system]]). НЕ износ: не ползущий процент,
 * а редкое предотвратимое событие. Бьётся ТОЛЬКО когда щит пробит — держишь щит,
 * железо цело. Детерминировано от `world.rng` (лок-степ, как весь бой) и только у игрока:
 * боты не чинятся, бросок им ни к чему, а лишние draw'ы сбили бы общий поток случайности.
 */

/** Место установки: точка подвески или внутренний слот. Ломаем ПО МЕСТУ, а не по ссылке. */
type Location = { weapon: number } | { internal: number }

/**
 * Места, что могут СЛОМАТЬСЯ от попадания по корпусу. Исключены: ракета — расходник (её
 * не чинят), контейнер — ломать нечего (ёмкость от поломки не тает), броня — её «износ»
 * это и есть урон корпуса (чинится ремонтом корпуса, отдельной поломкой не дублируем).
 * Прочее рабочее железо — в пуле.
 *
 * Собираем МЕСТА, а не модули: `[LASER, LASER]` — один объект в двух слотах, и сломаться
 * должен КОНКРЕТНЫЙ ствол, а не оба разом. По индексу это однозначно, по ссылке — нет.
 */
function breakableLocations(ship: ShipEntity): Location[] {
  const out: Location[] = []
  ship.loadout.weapons.forEach((w, i) => {
    if (w != null && !isMissile(w)) out.push({ weapon: i })
  })
  ship.loadout.internals.forEach((m, i) => {
    if (!isCargo(m) && !isArmour(m)) out.push({ internal: i })
  })
  return out
}

/** Заменить деталь на месте её же клоном с добавленной поломкой (сток не трогаем). */
function breakAt(ship: ShipEntity, loc: Location, amount: number): void {
  if ('weapon' in loc) {
    const w = ship.loadout.weapons[loc.weapon]
    if (w) ship.loadout.weapons[loc.weapon] = withFault(w, amount) as WeaponModule
  } else {
    const m = ship.loadout.internals[loc.internal]
    if (m) ship.loadout.internals[loc.internal] = withFault(m, amount)
  }
}

/**
 * Поломка от одного попадания. Звать ПОСЛЕ `applyDamage`, только для игрока.
 * `shieldUp` — был ли щит цел ДО этого попадания:
 *   • щит держал удар → редко просаживается сам ЩИТ (единственная деталь под живым щитом);
 *   • щит пробит → низкий шанс сломать ОДНУ случайную деталь на 25–50% (невезение-инцидент).
 * Больше одной детали за попадание не ломается никогда.
 */
export function breakFromHit(ship: ShipEntity, shieldUp: boolean, rng: Rng): void {
  if (shieldUp) {
    if (rng() >= BREAKAGE.SHIELD_CHANCE) return
    const idx = ship.loadout.internals.findIndex(isShield)
    if (idx < 0) return
    breakAt(ship, { internal: idx }, BREAKAGE.SHIELD_AMOUNT)
    refreshSpec(ship)
    return
  }
  if (rng() >= BREAKAGE.HULL_HIT_CHANCE) return
  const locations = breakableLocations(ship)
  if (locations.length === 0) return
  const loc = locations[Math.floor(rng() * locations.length)]!
  const amount = BREAKAGE.MODULE_MIN + rng() * (BREAKAGE.MODULE_MAX - BREAKAGE.MODULE_MIN)
  breakAt(ship, loc, amount)
  refreshSpec(ship)
}
