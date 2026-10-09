import { Vector3 } from 'three'
import {
  STAR_CLASSES,
  asteroidMass,
  findBody,
  navTarget,
  stanceTo,
  findWarBaseFixture,
  isVisible,
  warBaseFixtureWorldPos,
  warBaseIntegrity,
  lockedShipId,
  lockedPodId,
  lockedAsteroidId,
  lockedFixtureId,
} from '@elite/sim'
import { galaxyRadar } from '../../render/scene/galaxyRadar'
import { HUD_COLORS, bar, text } from './draw'
import { t, type Key } from '../i18n'
import { chassisName, occupationName, properName, starClassName } from '../i18n/dataNames'
import { formatStat } from '../station/format'
import { formatDistance } from './project'
import {
  PORTRAIT_GRID,
  loadSheet,
  pilotEmotion,
  portraitCell,
  portraitIndex,
  portraitSheet,
  sheetReady,
} from '../portrait'
import { drawStarBall } from './starPortrait'
import { drawPlanetBall } from './planetPortrait'
import { drawAsteroidChunk, drawPodCrate, drawStationWheel, drawWarBaseIcon } from './objectPortrait'
import { HudFrame, S, formatLy, hudGalaxyFor, navMarkerColor, radarColor, shipDistance } from './hudShared'

/**
 * Карточки целей над локатором: захваченный контакт и нав-цель — портрет, имя, дистанция,
 * полоска живучести. Меняется вместе с тем, что о цели показываем, а не с тем, где она в кадре.
 */

const _fixtureAt = new Vector3()
const _gtar = new Vector3()

/** Клетка панели цели над локатором. */
const CELL = 48

/** Подпись под клеткой: до четырёх строк мелким кеглем. Возвращает базовый шрифт на место. */
function cellCaption(ctx: CanvasRenderingContext2D, midX: number, y: number, lines: [string, string?, string?, string?]): void {
  const baseFont = ctx.font
  ctx.font = `${Math.round(6 * S)}px "Consolas", "DejaVu Sans Mono", monospace`
  text(ctx, lines[0].toUpperCase(), midX, y, HUD_COLORS.PRIMARY, 'center')
  if (lines[1]) text(ctx, lines[1].toUpperCase(), midX, y + 7 * S, HUD_COLORS.DIM, 'center')
  if (lines[2]) text(ctx, lines[2].toUpperCase(), midX, y + 14 * S, HUD_COLORS.DIM, 'center')
  if (lines[3]) text(ctx, lines[3].toUpperCase(), midX, y + 21 * S, HUD_COLORS.DIM, 'center')
  ctx.font = baseFont
}

/** Кружок-значок объекта в клетке: у крупного тела портрета нет, но цвет и форма есть. */
function cellIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const cx = x + (CELL * S) / 2
  const cy = y + (CELL * S) / 2
  const r = (CELL * S) / 2 - 8 * S
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Звезда галактики в портрете: тот же размер шара, что у планеты (рыбий глаз + плазма).
 */
function cellStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  classId: string,
  time: number,
): void {
  const cell = CELL * S
  const cx = x + cell / 2
  const cy = y + cell / 2
  drawStarBall(ctx, cx, cy, cell / 2 - 8 * S, color, classId, time)
}

/**
 * Одна клетка над локатором: текущий фокус (`targetFocus`). Новый выбор гасит старый
 * круг — в портрете ровно одна цель. Рамка = цвет значка.
 */
export function drawTargetPanels(frame: HudFrame): void {
  const { ctx, world, width, height } = frame
  const radiusX = 47 * 1.5 * S
  const radiusY = 47 * 0.75 * S
  const radarCx = width - radiusX - 12 * S
  const radarTop = height - 2 * radiusY - 12 * S
  const size = CELL * S
  const x = radarCx - size / 2
  // Чуть выше локатора: место под 3 строки подписи (занятие · отношение · корпус).
  const y = radarTop - size - 36 * S

  const cell = (
    color: string,
    lines: [string, string?, string?, string?],
    body: (x: number, y: number) => void,
    /** Состояние захваченного борта. Метки в космосе мелки и уезжают за кадр — читать
     *  «добивать или уходить» пилот должен здесь, под портретом. */
    bars?: { shield?: number; hull: number },
  ): void => {
    body(x, y)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(size), Math.round(size))
    let captionY = y + size + 2 * S
    if (bars) {
      // Порядок и цвета — как у собственных полосок слева: щит голубой сверху, корпус
      // красный под ним. Пилот не переучивается, переводя взгляд с борта на цель.
      // У кого щита нет вовсе (военная база) — рисуем только живучесть, не пустую полосу.
      if (bars.shield !== undefined) {
        bar(ctx, x, captionY, size, 2 * S, bars.shield, HUD_COLORS.PRIMARY)
        captionY += 3 * S
      }
      bar(ctx, x, captionY, size, 2 * S, bars.hull, HUD_COLORS.DANGER)
      captionY += 5 * S
    }
    cellCaption(ctx, x + size / 2, captionY, lines)
  }

  // Перебор звёзд галактики (Tab при активном слое) — не контакт и не нав системы.
  const gr = galaxyRadar()
  if (gr.active) {
    const tgt = world.jumpTargetIndex
    if (tgt == null || tgt === world.systemIndex || tgt < 0 || tgt >= gr.systemCount) return
    const sys = hudGalaxyFor(world)[tgt]
    if (!sys) return
    const color = `#${sys.star.color.toString(16).padStart(6, '0')}`
    const b = tgt * 3
    const pos = gr.positions
    let remLy = 0
    if (pos && gr.layerScale > 0) {
      _gtar.set(
        gr.anchor.x + pos[b]! * gr.layerScale,
        gr.anchor.y + pos[b + 1]! * gr.layerScale,
        gr.anchor.z + pos[b + 2]! * gr.layerScale,
      )
      remLy = shipDistance(world, _gtar) / gr.layerScale
    }
    cell(
      color,
      [properName(sys.name), starClassName(sys.star), formatLy(remLy)],
      (cx, cy) => cellStar(ctx, cx, cy, color, sys.star.class, world.time),
    )
    return
  }

  if (world.targetFocus === 'contact') {
    const ship = lockedShipId(world) == null ? null : world.ships.find((s) => s.id === lockedShipId(world))
    if (ship && ship.alive && isVisible(ship)) {
      const color = radarColor(ship, world)
      const stance = stanceTo(world, ship)
      const stanceKey = (`dialogue.stance.${stance}`) as Key
      cell(color, [
        ship.pilotName,
        `${occupationName(ship.originKind, ship.faction)} · ${t(stanceKey)}`,
        chassisName(ship.loadout.chassis.name),
        formatDistance(shipDistance(world, ship.state.pos)),
      ], (cx, cy) => {
        const sheet = loadSheet(portraitSheet(ship.persona.species, pilotEmotion(ship, world)))
        if (sheetReady(sheet)) {
          const c = sheet.naturalWidth / PORTRAIT_GRID
          const { col, row } = portraitCell(portraitIndex(ship))
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(sheet, col * c, row * c, c, c, Math.round(cx), Math.round(cy), Math.round(size), Math.round(size))
        } else {
          text(ctx, (properName(ship.name).trim().charAt(0) || '?').toUpperCase(), cx + size / 2, cy + size / 2 - 5 * S, HUD_COLORS.DIM, 'center')
        }
      }, {
        // У бога щит бесконечный — полоска и должна стоять полной: это не «цел пока»,
        // а свойство. Пилот видит, что бить бесполезно, ещё до первого выстрела.
        shield: ship.divine ? 1 : ship.spec.hull.shield > 0 ? ship.shield / ship.spec.hull.shield : 0,
        hull: ship.divine ? 1 : ship.hull / ship.spec.hull.hull,
      })
      return
    }
    const pod = lockedPodId(world) != null ? world.pods.find((p) => p.id === lockedPodId(world) && p.alive) : null
    if (pod) {
      cell(HUD_COLORS.WARN, [t('locator.kind.pod'), formatDistance(shipDistance(world, pod.pos))], (cx, cy) => {
        drawPodCrate(ctx, cx + size / 2, cy + size / 2, size, HUD_COLORS.WARN, world.time)
      })
      return
    }
    // Деталь базы — такая же цель, как борт: род, прочность и удаление в той же клетке.
    const fixture = findWarBaseFixture(world.warBases, lockedFixtureId(world))
    if (fixture) {
      warBaseFixtureWorldPos(fixture.base, fixture.fixture, world.time, _fixtureAt)
      cell(
        HUD_COLORS.STATION,
        [
          t('locator.kind.fixture'),
          properName(fixture.base.name),
          formatDistance(shipDistance(world, _fixtureAt)),
        ],
        (cx, cy) => {
          cellIcon(ctx, cx + size / 2, cy + size / 2, HUD_COLORS.STATION)
        },
      )
      return
    }
    const rock = lockedAsteroidId(world) != null
      ? world.asteroids.find((a) => a.id === lockedAsteroidId(world) && a.alive)
      : null
    if (rock) {
      cell(
        HUD_COLORS.ROCK,
        [
          t('locator.kind.asteroid'),
          formatStat('mass', asteroidMass(rock.radius)),
          formatDistance(Math.max(0, shipDistance(world, rock.pos) - rock.radius)),
        ],
        (cx, cy) => {
          drawAsteroidChunk(ctx, cx + size / 2, cy + size / 2, size, HUD_COLORS.ROCK, rock.id, world.time)
        },
      )
    }
    return
  }

  const nav = navTarget(world)
  if (!nav) return
  const kindKey = `locator.kind.${nav.kind}` as Key
  const color = navMarkerColor(nav)
  const navMass =
    nav.kind === 'asteroid' ? formatStat('mass', asteroidMass(nav.radius)) : undefined
  // Живучесть базы — доля уцелевших деталей: своей копилки прочности у неё нет, и полоска
  // показывает ровно то, что видно глазами на её боках.
  const navBase = nav.kind === 'warbase' ? world.warBases.find((b) => b.id === nav.id && b.alive) : undefined
  cell(color, [
    properName(nav.name),
    t(kindKey),
    navMass,
    formatDistance(Math.max(0, shipDistance(world, nav.pos) - nav.radius)),
  ], (cx, cy) => {
    const px = cx + size / 2
    const py = cy + size / 2
    const ballR = size / 2 - 8 * S
    switch (nav.kind) {
      case 'planet':
      case 'moon': {
        const body = findBody(world, nav.id)
        if (body) return drawPlanetBall(ctx, px, py, ballR, color, body, world.time)
        break
      }
      case 'star': {
        const body = findBody(world, nav.id)
        if (body) {
          const classId = STAR_CLASSES.find((c) => c.color === body.color)?.id ?? ''
          return drawStarBall(ctx, px, py, ballR, color, classId, world.time)
        }
        break
      }
      case 'station':
        return drawStationWheel(ctx, px, py, size, color, world.time)
      case 'warbase':
        return drawWarBaseIcon(ctx, px, py, size, color, world.time)
      case 'asteroid':
        return drawAsteroidChunk(ctx, px, py, size, color, nav.id, world.time)
    }
    cellIcon(ctx, cx, cy, color)
  }, navBase ? { hull: warBaseIntegrity(navBase) } : undefined)
}

