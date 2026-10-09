import {
  AUTODOCK,
  STAR_HEAT,
  findStation,
  autofightActive,
  clamp,
  incomingMissile,
  landingCue,
  laserOverheated,
  pendingHail,
  scooping,
  stationRange,
} from '@elite/sim'
import { undocking, consumePendingBonVoyage } from '../../session/undockFx'
import { HUD_COLORS, line, text } from './draw'
import { t, type Key } from '../i18n'
import { properName } from '../i18n/dataNames'
import { formatDistance } from './project'
import { activeWarning, pushWarning, WARN_LIFE } from '../../session/warnings'
import { plateOf, type Plate } from './warningStyle'
import { HudFrame, MISSILE_ALERT_SECONDS, S, dockState, hudFont } from './hudShared'

/**
 * Центральные плашки-предупреждения: единый канал ситуационных и действенных сообщений
 * (уголковая рамка, мигающий текст, цвет по важности). Что сейчас важнее — решает `gatherWarnings`.
 */

// Подпись плашки масштабирования выбирается ОДИН раз на сессию удержания (иначе она
// мигала бы между вариантами каждый кадр). По умолчанию сухое «РЕКАЛИБРОВКА», и лишь
// изредка (ALICE_CHANCE) — цитата из «Алисы». `_scaleSign` помнит знак текущей сессии.
let _scaleSign = 0
let _scaleLabelKey: Key = 'hud.scalePlate'
const ALICE_CHANCE = 0.2

/**
 * Уголковая рамка плашки: четыре L-образных угла прямоугольника. Сплошная рамка
 * давила бы на кадр — уголки читаются как «важно», но не запирают вид под собой.
 */
function bracketRect(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  lineW: number,
): void {
  const arm = Math.min(w * 0.18, h * 0.5)
  const l = cx - w / 2
  const r = cx + w / 2
  const tp = cy - h / 2
  const bt = cy + h / 2
  for (const [px, py, sx, sy] of [[l, tp, 1, 1], [r, tp, -1, 1], [l, bt, 1, -1], [r, bt, -1, -1]] as const) {
    line(ctx, px, py, px + sx * arm, py, color, lineW)
    line(ctx, px, py, px, py + sy * arm, color, lineW)
  }
}

/**
 * Плашки-предупреждения — ЕДИНЫЙ канал ситуативных сообщений (см. `warnings.ts`).
 * Здесь собираются ЧИТАЕМЫЕ из мира состояния и заявляются в очередь; транзиентные
 * «нет ракет/лазера/…» приходят из ввода (`playerController`). Рисуется ОДНА самая
 * важная живая плашка по центру-верху: уголковая рамка, полупрозрачный фон в её цвет
 * (~22%) и мигающая надпись. Старые разрозненные строки-предупреждения этим и заменены.
 */
/** Собирает живую плашку-предупреждение; рисование — отдельно (`paintWarningPlate`). */
export function gatherWarnings(frame: HudFrame): Plate | null {
  const { world, autodock } = frame
  const player = world.player
  const now = world.time

  if (consumePendingBonVoyage()) pushWarning('bonVoyage', now)

  // ── Читаемые из мира состояния ──────────────────────────────────────────────
  // Температура корпуса от звезды: WARN..CRITICAL — жёлтый «ПЕРЕГРЕВ», выше — красный
  // «КРИТИЧЕСКИЙ ПЕРЕГРЕВ» (за ним корпус разрушается мгновенно — домен, см. stepStarHeat).
  const temp = player.hullHeat
  if (temp >= STAR_HEAT.CRITICAL) pushWarning('overheat', now)
  else if (temp >= STAR_HEAT.WARN) pushWarning('hullHot', now)

  if (player.hull / player.spec.hull.hull < 0.25) pushWarning('hullCritical', now)
  // Ствол в отключке перегрева: жёлтая мигающая «ПЕРЕГРЕВ ЛАЗЕРА · ОХЛАЖДЕНИЕ» все 5 секунд.
  if (laserOverheated(player, now)) pushWarning('laserHot', now)
  if (player.cruise.block === 'mass-lock') pushWarning('massLock', now)
  else if (player.cruise.block === 'proximity') pushWarning('gravityBrake', now)
  if (scooping(player)) pushWarning('refuel', now)
  // Раскрытие гиперкольца — состояние: держат H, кольцо растёт. Отпустил — плашка гаснет
  // сама, как всякий пуш без подтверждения. `repeat: 0` — не приглушать повтором.
  if (frame.portalGrowing) pushWarning('portalOpening', now, { repeat: 0 })

  // Посадка на поверхность важнее стыковки: у двора Люцифера Кориолис иначе
  // перебивал пуш глыбы. Сначала куе посадки — стыковку тогда не предлагаем.
  const land = player.landedOn ? null : landingCue(world)

  // При отчаливании это выход на орбиту, а не приглашение немедленно стыковаться назад.
  if (undocking()) {
    pushWarning('orbitExit', now, { repeat: 0 })
  // Стыковка — только в обычном размере и когда не садимся на поверхность.
  } else if (player.state.scale <= 1 && !land) {
    const station = findStation(world)
    if (station) {
      const range = stationRange(player, station)
      if (range <= AUTODOCK.ENGAGE_RANGE) {
        const st = dockState(world, station, autodock)
        if (st === 'ready') pushWarning('dockReady', now)
        else if (st === 'engaged') pushWarning('dockCorridor', now, { label: t('hud.dockCorridor', { range: formatDistance(range) }) })
        // Скорость подхода больше не отдельное предупреждение: автостыковка сама гасит
        // подлёт, так что «сбрось скорость до N» ушло — остаётся обычная подсказка.
        else pushWarning('dockHint', now, { label: t('hud.dockHint', { range: formatDistance(range) }), repeat: 0 })
      }
    }
  }

  // На поверхности — отлип. Иначе: 500…200 м подготовка, 200…100 м — нажмите L.
  if (player.landedOn) {
    pushWarning('landDetach', now, { repeat: 0 })
  } else if (land) {
    const alt = formatDistance(land.altitude)
    if (land.phase === 'prompt') {
      pushWarning('landPrompt', now, { label: t('hud.landPrompt', { alt }), repeat: 0 })
    } else {
      pushWarning('landApproach', now, { label: t('hud.landApproach', { alt }), repeat: 0 })
    }
  }

  // Удар/отскок: домен ставит `lastCrashAt` каждый кадр контакта — держим пуш, пока прёшь в твердь
  // (в т.ч. выросшим миелофоном: без урона, но «не разбивает» должно быть видно).
  // Подпись — тип и имя цели: иначе при росте в «пустоте» удар нечитаем.
  if (now - player.lastCrashAt < 0.08) {
    const hit = player.lastCrashHit
    const kindKey = hit
      ? (`locator.kind.${hit.kind}` as 'locator.kind.planet')
      : null
    const kind = kindKey ? t(kindKey).toUpperCase() : ''
    const name = hit?.name ? properName(hit.name).toUpperCase() : ''
    const label =
      hit && name
        ? t('hud.crashHit', { kind, name })
        : hit
          ? t('hud.crashHitAnon', { kind })
          : t('hud.crash')
    pushWarning('crash', now, { label, repeat: 0 })
  }

  // «Корабль потерян»: игрок не уходит в Game Over — щиты полные, красный пуш с причиной.
  if (now - player.lastLostAt < WARN_LIFE) {
    const hit = player.lastLostHit
    const kindKey = hit
      ? (`locator.kind.${hit.kind}` as 'locator.kind.planet')
      : null
    const kind = kindKey ? t(kindKey).toUpperCase() : ''
    const name = hit?.name ? properName(hit.name).toUpperCase() : ''
    const label =
      hit && name
        ? t('hud.shipLostHit', { kind, name })
        : hit
          ? t('hud.shipLostAnon', { kind })
          : t('hud.shipLost')
    pushWarning('shipLost', now, { label, repeat: 0 })
  }

  // Входящая ракета: чем ближе, тем чаще мигает; `repeat:0` держит плашку на экране,
  // пока ракета в воздухе, — это угроза жизни, а не разовая весть.
  const threat = incomingMissile(world)
  if (threat && threat.seconds <= MISSILE_ALERT_SECONDS) {
    const urgency = clamp(1 - threat.seconds / MISSILE_ALERT_SECONDS, 0, 1)
    pushWarning('missileIn', now, {
      label: t('hud.missileWarn', { seconds: threat.seconds.toFixed(1) }),
      hz: 2 + urgency * 4,
      repeat: 0,
    })
  }

  // Социальные вести — вызов по связи и гибель/уход знакомого — тем же каналом.
  const hail = pendingHail(world)
  if (hail) pushWarning('hail', now, { label: t('hud.hail', { name: properName(hail.name).toUpperCase() }) })

  const notice = world.notices[world.notices.length - 1]
  if (notice) {
    const left = notice.kind === 'player-left'
    pushWarning(left ? 'playerLeft' : 'contactLost', now, {
      label: t(left ? 'hud.playerLeft' : 'hud.contactLost', { name: properName(notice.name).toUpperCase() }),
    })
  }

  // ── Показываем самую важную живую плашку ────────────────────────────────────
  // Крейсерский разгон (удержание Z) — не транзиентная весть, а СОСТОЯНИЕ: мигает,
  // пока держишь, и гаснет в тот же миг, как отпустил (флаг `cruise.engaged`, не тающий
  // `factor`). Оттого рисуем её отдельным «синтетическим» плашко-состоянием, а не через
  // очередь `pushWarning` (та живёт WARN_LIFE и не погасла бы сразу). Реальные предупреждения
  // важнее — если есть живая плашка из очереди, показываем её, а форсаж уступает.
  const boostPlate: Plate | null = player.cruise.engaged
    ? { color: HUD_COLORS.PRIMARY, hz: 0, rank: 0, label: t('hud.boostPlate'), born: now }
    : null
  const autofightPlate: Plate | null = autofightActive(world)
    ? { color: HUD_COLORS.PRIMARY, hz: 0, rank: 0, label: t('hud.autofightPlate'), born: now }
    : null
  const autopilotPlate: Plate | null = frame.flyto
    ? { color: HUD_COLORS.PRIMARY, hz: 0, rank: 0, label: t('hud.autopilotPlate'), born: now }
    : null
  // Масштабирование миелофоном (клавиша роста) — ЖЁЛТОЕ состояние. Тот же принцип, что
  // у форсажа: пока держишь `grow`, мигает; отпустил — гаснет. Обычно сухое «РЕКАЛИБРОВКА»,
  // и лишь изредка (ALICE_CHANCE) — цитата из «Алисы»: рост — «чудесатее», сжатие — «подзорная
  // труба». Подпись выбираем РАЗ на сессию удержания (модульная память), а не каждый кадр.
  const grow = player.controls.grow
  const growSign = Math.sign(grow)
  if (growSign === 0) {
    _scaleSign = 0
  } else if (growSign !== _scaleSign) {
    _scaleSign = growSign
    _scaleLabelKey =
      Math.random() < ALICE_CHANCE ? (grow > 0 ? 'hud.growPlate' : 'hud.shrinkPlate') : 'hud.scalePlate'
  }
  const scalePlate: Plate | null =
    growSign !== 0 ? { color: HUD_COLORS.WARN, hz: 1.5, rank: 0, label: t(_scaleLabelKey), born: now } : null
  // Маскировка — тоже СОСТОЯНИЕ (пока `cloaked`), а не транзиентная весть: мигающая плашка
  // вверху, как у форсажа и рекалибровки, а не сухая строка у нижней кромки. Голубая (NAV).
  const cloakPlate: Plate | null = player.cloaked
    ? { color: HUD_COLORS.NAV, hz: 1.2, rank: 0, label: t('hud.cloak'), born: now }
    : null
  // Реальные предупреждения важнее; из состояний масштаб и маскировка (важные режимы)
  // впереди форсажа.
  // Живой сигнал одеваем в цвет и слова здесь: очередь знает только код и важность.
  const warning = activeWarning(now)
  return (warning ? plateOf(warning) : null) ?? autofightPlate ?? autopilotPlate ?? cloakPlate ?? scalePlate ?? boostPlate
}

export function paintWarningPlate(frame: HudFrame, plate: Plate): void {
  const { ctx, world, width } = frame
  const now = world.time

  const baseFont = ctx.font
  const pad = 44 * S
  // Плашка вверху по центру — места по ширине много, но не до самых краёв. Если подпись
  // (с полями) не влезает в доступную ширину, УЖИМАЕМ шрифт под неё, а не обрезаем текст.
  const maxW = width - 24 * S
  let fontPx = 15 * S
  ctx.font = hudFont(fontPx)
  let textW = ctx.measureText(plate.label).width
  if (textW + pad > maxW) {
    fontPx = Math.max(8 * S, (fontPx * (maxW - pad)) / textW)
    ctx.font = hudFont(fontPx)
    textW = ctx.measureText(plate.label).width
  }
  const font = hudFont(fontPx)
  const bw = Math.min(maxW, textW + pad)
  ctx.font = baseFont
  const bh = 30 * S
  // Вверху по центру, с тем же отступом от кромки, что у даты и счётчика кадров (~8px):
  // не вплотную к краю, но и не в глубине кадра, где перекрыло бы прицел. Плюс 20 px
  // вниз по просьбе: плашки-пуши сидят чуть ниже верхней кромки.
  const cx = width / 2
  const cy = 8 * S + bh / 2 + 20 * S

  // Полупрозрачный фон в цвет рамки: плашку видно, но мир под ней всё ещё читается.
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = plate.color
  ctx.fillRect(Math.round(cx - bw / 2), Math.round(cy - bh / 2), Math.round(bw), Math.round(bh))
  ctx.restore()

  // Рамка стоит ровно, мигает только надпись: рамка держит место, текст просит взгляд.
  bracketRect(ctx, cx, cy, bw, bh, plate.color, 3)
  const lit = plate.hz <= 0 || Math.sin(now * plate.hz * Math.PI * 2) > -0.35
  if (lit) {
    ctx.font = font
    // Центрируем по высоте под текущий кегль (baseline='top'): при ужатом шрифте не съедет.
    text(ctx, plate.label, cx, cy - fontPx / 2, plate.color, 'center')
    ctx.font = baseFont
  }
}
