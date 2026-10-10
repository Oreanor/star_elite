import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useWheelZoom } from './useWheelZoom'
import { MapFrame, MapRow } from './MapFrame'
import {
  Vector3,
} from 'three'
import {
  GALAXY,
  galaxyName,
  galaxyShape,
  applyDelta,
  generateGalaxy,
  isInhabited,
  jumpBlock,
  jumpDistance,
  stationSeat,
  stationsOf,
  systemDefFor,
  type StarSystem,
} from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { useOnlinePlayers } from '../../session/net/presence'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { properName } from '../i18n/dataNames'
import { CONTACT_MAP, ContactLabels, ContactStars, PLAYER_MAP, PlayerLabels, PlayerStars, contactSystemsOf, playerSystemsOf } from './GalaxyPeople'
import { JumpSphere, OrbitCamera, Route, StarLabel, Stars, YouAreHere, YouLabel, formatStarSize, positionOf } from './GalaxyScene'
import { SystemPopup, formatRange } from './SystemPopup'

const _origin = /* @__PURE__ */ new Vector3()
const _screen = new Vector3()

/**
 * Карта галактики.
 *
 * 2500 звёзд — одно облако точек, то есть один вызов отрисовки. Узкое место
 * тут никогда не GPU: телефон нарисует и сто тысяч точек. Узкое место — ПОДПИСИ,
 * поэтому имя показывается ровно одно, под курсором.
 *
 * Мир под картой стоит: она отпускает курсор, а пауза в этой игре и есть
 * отпущенный курсор.
 *
 * Своё полотно, а не игровое: у карты собственная камера, собственный масштаб
 * (световые годы, а не метры) и собственное вращение. Мешать их с полётной
 * сценой значило бы тащить в неё логарифмический буфер глубины и плавающее начало.
 */

interface Picked {
  system: StarSystem
  distance: number
  blocked: ReturnType<typeof jumpBlock>
}

/**
 * Булавка карточки: держит плашку выбранной системы У ЕЁ ЗВЕЗДЫ. Позицию пишет кадр
 * прямо в стиль — как подписи имён рядом. React в этом не участвует: карта вращается
 * драгом, и пересобирать дерево ради движения плашки было бы самоубийством для частоты.
 *
 * У правого края плашка перекидывается влево, а по вертикали зажимается в поле: карточка
 * высокая (в ней схема выхода), и у нижней звезды она иначе уезжала бы за край.
 */
/** Прижать координату к полю с отступом. `limit` уже с вычтенным размером карточки. */
function clampTo(value: number, limit: number): number {
  return Math.max(4, Math.min(limit - 4, value))
}

/**
 * Куда игрок ОТТАЩИЛ карточку. `null` — она сама держится у своей звезды.
 *
 * Оттащил — значит она мешала смотреть, и возвращать её к звезде при каждом повороте
 * карты было бы издевательством: с этого момента плашка стоит там, куда положили, пока
 * не выберешь другую систему. Живёт в ref: позицию пишет кадр, React в этом не участвует.
 */
export interface CardDrag {
  pinned: { x: number; y: number } | null
}

/**
 * Взять карточку и потащить. Ручка — вся плашка, кроме её органов управления: тянуть
 * за кнопку «выйти сюда» игрок не станет, а вот промахнуться по ней, начав тащить, — легко.
 *
 * Ведём по `pointermove` на окне с захватом указателя: карточка узкая, курсор на быстром
 * рывке уходит за её край, и без захвата перетаскивание рвалось бы на полпути.
 */
function beginCardDrag(e: React.PointerEvent, el: HTMLDivElement | null, drag: CardDrag): void {
  if (!el || e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return

  const field = el.offsetParent as HTMLElement | null
  if (!field) return
  const fieldBox = field.getBoundingClientRect()
  const cardBox = el.getBoundingClientRect()
  // Хват за ту же точку, за которую взяли: иначе плашка прыгает углом под курсор.
  const grabX = e.clientX - cardBox.left
  const grabY = e.clientY - cardBox.top

  const move = (ev: PointerEvent): void => {
    drag.pinned = { x: ev.clientX - fieldBox.left - grabX, y: ev.clientY - fieldBox.top - grabY }
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  // Карта под плашкой не должна поехать следом: драг поля начинается с того же жеста.
  e.stopPropagation()
}

function CardPin({
  at,
  box,
  drag,
}: {
  at: Vector3 | null
  box: React.RefObject<HTMLDivElement | null>
  drag: React.RefObject<CardDrag>
}) {
  const { camera, size } = useThree()

  useFrame(() => {
    const el = box.current
    if (!el) return
    if (!at) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      return
    }

    const w = el.offsetWidth
    const h = el.offsetHeight

    // Оттащили — плашка стоит где положили и за звездой больше не бегает. Зажим по полю
    // тот же: перетащить её за обрез рамки нельзя, иначе она снова окажется срезанной.
    const pinned = drag.current.pinned
    if (pinned) {
      el.style.opacity = '1'
      el.style.pointerEvents = 'auto'
      el.style.transform = `translate(${Math.round(clampTo(pinned.x, size.width - w))}px, ${Math.round(clampTo(pinned.y, size.height - h))}px)`
      return
    }

    _screen.copy(at).project(camera)
    if (_screen.z > 1) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      return
    }

    const x = (_screen.x * 0.5 + 0.5) * size.width
    const y = (-_screen.y * 0.5 + 0.5) * size.height
    // Зажимаем В ПОЛЕ по обеим осям. Раньше по горизонтали был только переброс влево у
    // правого края — и у звезды слева карточка вылезала за правый обрез поля, а рамка карты
    // режет всё лишнее (`overflow-hidden`). Теперь край поля держит её с любой стороны.
    const left = clampTo(x > size.width * 0.55 ? x - w - 12 : x + 12, size.width - w)
    const top = clampTo(y - h / 2, size.height - h)
    el.style.opacity = '1'
    el.style.pointerEvents = 'auto'
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  })

  return null
}

/**
 * В КОМНАТЕ вселенной карта галактики — та же самая, не урезанная копия. Здесь стояла
 * подмена на самодельный `BushMap` (звёздное поле да имя), и это было лишним: зерно
 * галактики у мира то же, поиск, фильтры и разбор системы работают как обычно. Разница
 * ровно одна и живёт не тут: прыжок из комнаты запрещён (см. `App`, клавиша H).
 */
export function GalaxyMap(props: { onClose: () => void; embedded?: boolean }) {
  return <GalaxyMapImpl {...props} />
}

function GalaxyMapImpl({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  useLang()
  const session = useSession()
  const world = session.world

  // 2500 систем строятся за миллисекунды, но не каждый кадр: зерно задаёт всё, а правки
  // бога (дельта) ложатся поверх — карта их отражает, пересобираясь на смену galaxyEpoch.
  const systems = useMemo(
    () => applyDelta(generateGalaxy(world.galaxySeed), world.galaxyDelta),
    [world.galaxySeed, world.galaxyEpoch, world.galaxyDelta],
  )
  // Имя и форма выводятся из того же зерна: галактика не хранится нигде.
  const galaxy = useMemo(
    () => ({ name: galaxyName(world.galaxySeed), shape: galaxyShape(world.galaxySeed) }),
    [world.galaxySeed],
  )

  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [hovered, setHovered] = useState<number | null>(null)
  // Выбор берётся из МИРА и туда же пишется: намеченная у причала цель обязана
  // пережить закрытие карты и отчаливание — прыгать-то можно только отчалив.
  const [selected, setSelected] = useState<number | null>(world.jumpTargetIndex)

  // Фильтр по характеру системы: всё / со станциями (разумная раса колонизовала) /
  // с примитивной жизнью (фауна, без причала) / пустые (нет обитаемых миров). Отсеянные
  // звёзды гаснут и перестают ловить курсор — глаз не спорит с сотнями лишних точек.
  const [filter, setFilter] = useState<'all' | 'stations' | 'primitive' | 'empty'>('all')
  // Показывать ли метки знакомых и живых игроков. По умолчанию да — но их можно убрать.
  const [showContacts, setShowContacts] = useState(true)
  // Поиск по имени системы / её планеты / причала. Совпадение подсвечиваем и наводим камеру.
  const [query, setQuery] = useState('')

  // Категория системы: станция (раса колонизовала) → примитивная жизнь (фауна, без
  // причала) → пусто (нет обитаемых миров). Правило то же, что в генерации: причал
  // строят только играбельные расы, у одной фауны его не бывает.
  const category = useMemo(
    () =>
      systems.map((s): 'stations' | 'primitive' | 'empty' =>
        stationsOf(s).length > 0 ? 'stations' : isInhabited(s) ? 'primitive' : 'empty',
      ),
    [systems],
  )
  const visible = useMemo(
    () => systems.map((_, i) => filter === 'all' || category[i] === filter),
    [systems, filter, category],
  )
  const search = query.trim().toLowerCase()
  const searchIndex = useMemo(() => {
    if (search.length < 2) return null
    const hit = (name: string) => properName(name).toLowerCase().includes(search)
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i]!
      if (hit(s.name)) return i
      if (s.planets.some((p) => hit(p.name) || (p.station != null && hit(p.station.name)))) return i
    }
    return null
  }, [search, systems])

  /**
   * Список звёзд для левой колонки: то же, что видно на поле (фильтр) и что нашёл поиск,
   * ближние первыми. Обрезан двумя сотнями — колонка не читальный зал на 2500 строк, а
   * длинный список всё равно разбирают поиском.
   */
  const listed = useMemo(() => {
    const hit = (name: string) => properName(name).toLowerCase().includes(search)
    const out: { index: number; name: string; distance: number }[] = []
    for (let i = 0; i < systems.length; i++) {
      if (!visible[i]) continue
      const s = systems[i]!
      if (
        search.length >= 2 &&
        !hit(s.name) &&
        !s.planets.some((p) => hit(p.name) || (p.station != null && hit(p.station.name)))
      )
        continue
      out.push({ index: i, name: s.name, distance: jumpDistance(world, i) })
    }
    out.sort((a, b) => a.distance - b.distance)
    return out.slice(0, 200)
  }, [systems, visible, search, world.systemIndex, world.galaxySeed])

  const chooseSystem = (index: number) => {
    setSelected(index)
    // Затаргетились: выбор переживёт закрытие карты и отчаливание. Точку выхода по
    // умолчанию ставим на причал системы (место станции), если он там есть.
    // Это и есть «цель гиперпрыжка»: HUD метит звезду, H прыгает, когда можно.
    world.jumpTargetIndex = index
    const seat = stationSeat(systemDefFor(index, world.galaxySeed))
    world.jumpArrivalPlanet = seat >= 0 ? seat : null
    bump()
  }
  const control = useRef({ yaw: 0.6, pitch: 0.5, distance: GALAXY.RADIUS_LY * 2.6, target: new Vector3() })
  const dragging = useRef(false)
  const label = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  /** Куда оттащили карточку. Пишет драг, читает кадр — React в этом не участвует. */
  const cardDrag = useRef<CardDrag>({ pinned: null })
  // Выбрал другую звезду — плашка возвращается к ней. Оттащенное место принадлежало
  // прежней системе, и держать новую карточку там значило бы отвязать её от карты вовсе.
  useEffect(() => {
    cardDrag.current.pinned = null
  }, [selected])
  const you = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  // Метки знакомых: где живые контакты по системам. Div'ы подписей собираем в карту по
  // индексу системы — их позицию каждый кадр двигает `ContactLabels`, а не React.
  const contactSystems = contactSystemsOf(world, systems)
  const contactBoxes = useRef<Map<number, HTMLDivElement>>(new Map())
  // Онлайн-игроки по системам (из presence) — розовые метки рядом с метками знакомых.
  const peers = useOnlinePlayers()
  const playerSystems = playerSystemsOf(peers, systems)
  const playerBoxes = useRef<Map<number, HTMLDivElement>>(new Map())

  // Зум колесом/щипком — только карта. Нативный слушатель гасит браузерный зум.
  useWheelZoom(viewport, (deltaY) => {
    const d = control.current.distance * (1 + Math.sign(deltaY) * 0.12)
    control.current.distance = Math.max(GALAXY.RADIUS_LY * 0.12, Math.min(GALAXY.RADIUS_LY * 5, d))
  })

  // Камера плавно наезжает на найденную поиском систему; без поиска висит над центром.
  const searchPos = searchIndex != null ? positionOf(systems[searchIndex]!) : null
  control.current.target = searchPos ?? _origin

  const here = positionOf(systems[world.systemIndex]!)
  // Наведён курсор → он; иначе найденное поиском; иначе выбранная цель прыжка.
  const marked = hovered ?? searchIndex ?? selected
  const picked: Picked | null =
    marked != null && systems[marked]
      ? {
          system: systems[marked]!,
          distance: jumpDistance(world, marked),
          blocked: jumpBlock(world, marked),
        }
      : null

  // Встроенной в консоль клавишами заведует сама консоль — второго слушателя не вешаем.
  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  const content = (
    <MapFrame
      title={properName(galaxy.name).toUpperCase()}
      aside={
        <>
          {/* Поиск, фильтры и список звёзд — в колонке, как у остальных карт. Раньше они
              висели плашкой поверх поля: пульт закрывал те самые звёзды, среди которых
              искали, а колонка справа при этом пустовала. */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('map.search')}
            className="w-full shrink-0 rounded border bg-black/40 px-3 py-1.5 text-xs tracking-widest outline-none placeholder:opacity-40"
            style={{
              borderColor: search.length >= 2 && searchIndex == null ? UI.WARN : 'rgba(124,196,255,0.35)',
              color: UI.PRIMARY,
            }}
          />

          <div className="flex shrink-0 flex-wrap gap-1">
            {(['all', 'stations', 'primitive', 'empty'] as const).map((f) => {
              const on = filter === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className="cursor-pointer border px-2 py-1 text-[11px] tracking-widest transition-colors"
                  style={{
                    borderColor: on ? UI.PRIMARY : UI.DIM,
                    backgroundColor: on ? UI.PRIMARY : 'transparent',
                    color: on ? '#000' : UI.DIM,
                  }}
                >
                  {t(`map.filter.${f}` as 'map.filter.all')}
                </button>
              )
            })}
          </div>

          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11px] tracking-widest" style={{ color: UI.DIM }}>
            <input
              type="checkbox"
              checked={showContacts}
              onChange={(e) => setShowContacts(e.target.checked)}
              className="cursor-pointer accent-[#7fd6ff]"
            />
            {t('map.showContacts')}
          </label>

          {search.length >= 2 && searchIndex == null && (
            <span className="shrink-0 text-[11px] tracking-widest" style={{ color: UI.WARN }}>{t('map.searchNone')}</span>
          )}

          {/* Список звёзд: наведение зажигает точку на поле, клик выбирает цель прыжка —
              ровно то же, что клик по самой точке. */}
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {listed.map((s) => (
              <li key={s.index}>
                <MapRow
                  kind=""
                  name={properName(s.name).toUpperCase()}
                  meta={`${s.distance.toFixed(1)} ${t('unit.ly')}`}
                  color={UI.PRIMARY}
                  active={s.index === selected}
                  hover={s.index === hovered}
                  onHover={(on) => setHovered((h) => (on ? s.index : h === s.index ? null : h))}
                  onClick={() => chooseSystem(s.index)}
                />
              </li>
            ))}
          </ul>
        </>
      }
    >
      <div
        ref={viewport}
        // `select-none` здесь не косметика: без него драг по полю ВЫДЕЛЯЕТ текст подписей, а
        // выделение тянет за собой автопрокрутку панели — карта крутится, а консоль едет.
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
        onPointerMove={(e) => {
          if (!dragging.current) return
          control.current.yaw -= e.movementX * 0.005
          // Не даём перевернуться через полюс: карта — не кабина.
          control.current.pitch = Math.max(-1.4, Math.min(1.4, control.current.pitch + e.movementY * 0.005))
        }}
      >
        <Canvas
          camera={{ fov: 45, near: 0.1, far: 4000 }}
          // Полотно прозрачно: фон рисует панель, а не рендерер. Иначе чёрный
          // прямоугольник вырезал бы дыру в подсвеченном стекле.
          gl={{ antialias: true, alpha: true }}
        >
          <OrbitCamera control={control.current} />
          <Stars
            systems={systems}
            hovered={hovered}
            selected={selected}
            highlight={searchIndex}
            visible={visible}
            onHover={setHovered}
            onSelect={chooseSystem}
          />
          <JumpSphere at={here} charge={world.player.jumpCharge} max={world.player.spec.jumpRange} />
          <YouAreHere at={here} />
          <YouLabel at={here} box={you} />
          {showContacts && (
            <>
              <ContactStars systems={contactSystems} />
              <ContactLabels systems={contactSystems} boxes={contactBoxes} />
              <PlayerStars systems={playerSystems} />
              <PlayerLabels systems={playerSystems} boxes={playerBoxes} />
            </>
          )}
          <Route from={here} to={picked ? positionOf(picked.system) : null} />
          <StarLabel at={picked ? positionOf(picked.system) : null} box={label} />
          {/* Плашка выбранной системы едет за своей звездой — её место считает кадр. */}
          <CardPin at={selected != null && systems[selected] ? positionOf(systems[selected]!) : null} box={card} drag={cardDrag} />
        </Canvas>

        {/* Подпись «ВЫ» и имя под курсором живут всегда: их двигает кадр, а не React. */}
        <div
          ref={you}
          className="pointer-events-none absolute left-0 top-0 text-[11px] font-bold tracking-widest opacity-0"
          style={{ color: UI.PRIMARY, willChange: 'transform' }}
        >
          {t('map.you')}
        </div>
        <div
          ref={label}
          className="pointer-events-none absolute left-0 top-0 text-sm leading-tight opacity-0"
          style={{ willChange: 'transform' }}
        >
          <div className="tracking-widest">{picked ? properName(picked.system.name).toUpperCase() : ''}</div>
          <div style={{ color: UI.DIM }}>{picked ? formatRange(picked.distance) : ''}</div>
          <div style={{ color: UI.DIM }}>
            {picked
              ? `${picked.system.star.class} · ${formatStarSize(picked.system.star.radius)}`
              : ''}
          </div>
        </div>

        {/* Подписи знакомых — по одной на систему с живым контактом. Позицию каждой
            двигает кадр (`ContactLabels`), поэтому тут только текст и сбор ссылок.
            Скрыты вместе с метками, когда галочка знакомых снята. */}
        {showContacts && contactSystems.map((s) => (
          <div
            key={s.index}
            ref={(el) => {
              if (el) contactBoxes.current.set(s.index, el)
              else contactBoxes.current.delete(s.index)
            }}
            className="pointer-events-none absolute left-0 top-0 text-[11px] tracking-widest opacity-0"
            style={{ color: CONTACT_MAP, willChange: 'transform' }}
          >
            {s.names.map((n) => properName(n)).join(', ').toUpperCase()}
          </div>
        ))}

        {/* Подписи имён онлайн-игроков — по одной на систему, где кто-то есть. Позицию
            двигает кадр (`PlayerLabels`); имена — как есть (это подписи людей, не собственные
            имена систем), поэтому без `properName`-транслита. */}
        {showContacts && playerSystems.map((s) => (
          <div
            key={s.index}
            ref={(el) => {
              if (el) playerBoxes.current.set(s.index, el)
              else playerBoxes.current.delete(s.index)
            }}
            className="pointer-events-none absolute left-0 top-0 text-[11px] font-bold tracking-widest opacity-0"
            style={{ color: PLAYER_MAP, willChange: 'transform' }}
          >
            {s.names.join(', ').toUpperCase()}
          </div>
        ))}

        {/* Выбранная система — плашка У СВОЕЙ ЗВЕЗДЫ, поверх поля (позицию двигает
            `CardPin` в кадре). Не часть вёрстки: колонку слева заняли поиск, фильтры и
            список, а появление карточки ничего не должно двигать. */}
        {/* Высота ограничена полем карты, а лишнее прокручивается внутри: карточка с полной
            схемой выхода выше поля, и без этого её низ уходил под обрез рамки (та с
            `overflow-hidden`) — читать было нечего. */}
        {selected != null && systems[selected] && (
          <div
            ref={card}
            className="absolute left-0 top-0 z-30 flex max-h-full w-96 max-w-[80%] cursor-grab flex-col overflow-y-auto overscroll-contain opacity-0 active:cursor-grabbing"
            style={{ willChange: 'transform' }}
            onPointerDown={(e) => beginCardDrag(e, card.current, cardDrag.current)}
          >
            <SystemPopup
              key={selected}
              inline
              system={systems[selected]!}
              world={world}
              index={selected}
              docked={world.docked}
              onArrival={(planet) => {
                world.jumpArrivalPlanet = planet
                bump()
              }}
              onClose={() => {
                setSelected(null)
                world.jumpTargetIndex = null
                world.jumpArrivalPlanet = null
                bump()
              }}
            />
          </div>
        )}
      </div>
    </MapFrame>
  )

  // Встроена в консоль: рамку и фон даёт стеклянная панель, карте — заполнить её.
  if (embedded) return content

  return (
    <div
      // Та же голограмма над консолью, что и у карты системы: обе карты — один
      // прибор, и рамка у них обязана быть одна. Полотно звёзд прозрачно, поэтому
      // диск галактики лежит прямо на подсвеченном стекле панели.
      className="absolute inset-0 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))' }}
    >
      <div
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] items-stretch gap-6 overflow-hidden rounded-2xl border p-6 font-mono"
        style={{
          color: UI.PRIMARY,
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))',
          boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
        }}
      >
        {content}
      </div>
    </div>
  )
}
