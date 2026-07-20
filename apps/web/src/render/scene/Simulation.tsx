import { useFrame, useThree } from '@react-three/fiber'
import {
  armAutoland,
  releaseLanding,
  autodockController,
  canEngageAutodock,
  canEngageFlyTo,
  flyToArrived,
  flyToController,
  cycleContact,
  cycleCelestial,
  retargetNearestContact,
  retargetNearestCelestial,
  findCloak,
  findMielophone,
  hasBomb,
  hasEcm,
  droneAmmo,
  isLaser,
  missileAmmo,
  serializePlayer,
  stepWorld,
  atNode,
  departTo,
  enterBush,
  leaveBush,
  monumentRoomExited,
  stepBushTravel,
  GALAXY,
  UNIVERSE,
  type Controller,
  type World,
} from '@elite/sim'
import { Vector3 } from 'three'
import { BUSH } from '../config'
import { pickBranch } from './bushView'
import { cycleGalaxyStar, galaxyRadar, retargetNearestGalaxyStar } from './galaxyRadar'
import { syncControllers, useSession, type Session } from '../../app/GameContext'
import { coastController } from '../../app/control/playerController'
import { stepCameraView } from '../../app/control/cameraView'
import { persistSave } from '../../app/save/saveStore'
import { clearPresses, consumePress, input, isHeld, releaseLock } from '../../platform/input/input'
import { gameTimeSec } from '../../app/net/worldClock'
import { pushWarning } from '../../ui/hud/warnings'

/** Миелофон «есть у игрока», если он в аукс-слоте ИЛИ лежит в трюме: дев-выдача кладёт
 *  его в ТРЮМ, а не в слот, поэтому проверка только по слоту давала ложное «прибор не
 *  установлен», пока держишь E для роста. */
function ownsMielophone(player: World['player']): boolean {
  if (findMielophone(player.loadout)) return true
  return player.hold.items.some((it) => it.kind === 'module' && it.module.kind === 'mielophone')
}

/**
 * Ведущий кадра. Приоритет -100 гарантирует шаг мира раньше постановщиков и рендера,
 * независимо от порядка монтирования React-компонентов.
 *
 * Ничего не рисует.
 */

/**
 * Автостыковка — это подмена ОДНОЙ ссылки в карте контроллеров. Ни симуляция,
 * ни физика не знают, что за штурвалом сменился пилот: ровно ради этого
 * `Controller` и существует.
 */
/**
 * Кто за штурвалом по режиму сессии. `coasting` — под открытым меню-полётом (курсор
 * отпущен): пилота нет, корабль коастит, НО автопилоты (стыковка, полёт-к-цели) ведут и
 * там — иначе, глянув карту, ты бы ронял их с полпути.
 */
function helmController(session: Session, coasting: boolean): Controller {
  if (session.mode === 'autodock') return autodockController
  if (session.mode === 'flyto') return flyToController
  // На кусте манёвров нет — газ и осмотр мышью (`bushPilot`). Но в КОМНАТЕ МОНУМЕНТА полёт
  // свободный: там пустое пространство с крестом, вокруг которого летаешь, — штурвал пилоту.
  if (session.mode === 'bush') return session.bush.inMonument ? session.pilot : session.bushPilot
  return coasting ? coastController : session.pilot
}

function setPilot(session: Session, mode: Session['mode']): void {
  session.mode = mode
  session.controllers.set(session.world.player.id, helmController(session, false))

  // Допуск в створ станции выдаётся вместе с АВТОСТЫКОВКОЙ и снимается вместе с ней.
  // Он живёт в МИРЕ, а не в сессии: по нему решает ИИ, а тот про сессию не знает.
  // Полёт-к-цели допуска не даёт — он не заходит в створ, а тормозит поодаль.
  session.world.player.clearance = mode === 'autodock'
}

/**
 * Дверь на куст — чёрная дыра. Влетел внутрь её сферы → едешь по вселенной.
 *
 * По замыслу дверь одна на галактику и стоит в ЯДРЕ; шарик у причала в Люриларе —
 * временный вход для разработки. Поэтому ищем любое тело `blackhole`, а не конкретное:
 * уедет временный — правило не поменяется.
 */
function touchedDoor(world: World): boolean {
  for (const body of world.bodies) {
    if (body.kind !== 'blackhole') continue
    if (world.player.state.pos.distanceTo(body.pos) <= body.radius) return true
  }
  return false
}

const _nose = new Vector3()
const _fwd = new Vector3()

/**
 * Вход на куст и ход по нему.
 *
 * Газ — СИГНАЛ «еду», позу на ребре задаёт рельс. В узле корабль встаёт: игрок целится
 * НОСОМ в пузырь-соседа (мышь вертит головой) и жмёт газ — едем к той ветке (`pickBranch`).
 * Смотришь мимо всех — стоишь и осматриваешься.
 *
 * Достиг корня-креста — входим в КОМНАТУ МОНУМЕНТА: свободный полёт вокруг креста, отдалился
 * — вернулся на куст (правила в домене: `monumentRoomExited`).
 */
function stepBush(session: Session, dt: number): void {
  const { world, bush, universe } = session

  if (!bush.active) {
    if (session.mode === 'bush' || !touchedDoor(world)) return
    // Дом — узел `GALAXY.HOME_NODE`: влетев в дыру своей галактики, оказываемся на её
    // месте в кусте, а не в случайной точке вселенной.
    enterBush(bush, GALAXY.HOME_NODE)
    session.monumentCross = null
    setPilot(session, 'bush')
    pushWarning('bushEnter', world.time, {
      label: universe.nodes[bush.node]?.name ?? '',
      repeat: 0,
    })
    return
  }

  // КОМНАТА МОНУМЕНТА: летаешь свободно у креста (штурвал у пилота, см. helmController).
  // Отдалился за порог — комната закрывается, снова стоишь в узле-корне на кусте.
  if (bush.inMonument) {
    const cross = session.monumentCross
    if (cross && monumentRoomExited(world.player.state.pos.distanceTo(cross))) {
      bush.inMonument = false
      session.monumentCross = null
      setPilot(session, 'bush')
    }
    return
  }

  if (atNode(bush)) {
    // Газ + взгляд: нос корабля в мировых осях против направлений на соседей.
    if (world.player.controls.throttle > 0) {
      _nose.set(0, 0, -1).applyQuaternion(world.player.state.quat)
      const pick = pickBranch(universe, bush.node, _nose.x, _nose.y, _nose.z, BUSH.BRANCH_MIN_DOT)
      if (pick >= 0) departTo(bush, universe, pick)
    }
    return
  }

  const arrived = stepBushTravel(bush, universe, world.player.controls.throttle > 0 ? 1 : 0, dt)
  if (arrived < 0) return

  if (arrived === UNIVERSE.MONUMENT_NODE) {
    // Достиг креста — открываем комнату монумента. Крест ставим перед носом; отсюда мерим
    // отдаление для выхода. Штурвал станет пилотским (helmController видит inMonument).
    bush.inMonument = true
    _fwd.set(0, 0, -1).applyQuaternion(world.player.state.quat)
    session.monumentCross = world.player.state.pos.clone().addScaledVector(_fwd, BUSH.MONUMENT_ROOM_DIST)
    setPilot(session, 'bush')
  }
  pushWarning('bushArrive', world.time, {
    label: universe.nodes[arrived]?.name ?? '',
    repeat: 0,
  })
}

export function Simulation() {
  const session = useSession()
  const camera = useThree((state) => state.camera)

  useFrame((_, dt) => {
    const { world, controllers, intent } = session
    world.calendarTime = gameTimeSec()

    /**
     * Кадр начинается с «мир стоит». Любой ранний выход ниже — гибель, док, карта,
     * меню клавиш — оставит его стоящим, и всё, что движется по реальному времени,
     * замрёт само. Один флаг, выставляемый в одном месте: искать причины паузы
     * по всему дереву компонентов значит однажды забыть одну из них.
     */
    session.running = false

    // Гибель: отпускаем курсор и останавливаем мир. Ровно один раз — дальше
    // сессия просто стоит, пока React не смонтирует новую.
    if (!world.player.alive && !session.over) {
      session.over = true
      releaseLock()
      session.onOver?.()
    }
    if (session.over) return

    // Стыковка и отчаливание — события, а не состояния кадра: сообщаем о переходе.
    if (world.docked !== session.dockedShown) {
      session.dockedShown = world.docked
      if (world.docked) {
        if (session.mode === 'autodock') setPilot(session, 'manual')
        releaseLock()
        // Автосейв — ТОЛЬКО на станции, и это единственная его точка (ТЗ): пристыковался
        // → прогресс записан. В космосе не сохраняемся. Онлайн — на сервер, офлайн — в кэш.
        persistSave(serializePlayer(world))
      }
      session.onDockChange?.(world.docked)
    }
    // Мир в доке не шагает (это внутри stepWorld); здесь просто нечего делать.
    if (world.docked) return

    /**
     * Курсор отпущен. Два случая:
     *  — ЧЕСТНАЯ ПАУЗА (титул, Escape, свёрнутая вкладка): мир замирает.
     *  — ОТКРЫТО МЕНЮ при живом фокусе (`menuFlying`): мир ЛЕТИТ ДАЛЬШЕ — можно глянуть
     *    карту «на ходу». Пилота за штурвалом нет: корабль коастит по инерции прежним
     *    курсом, без боя, слежения и роста (см. `coastController`). Свернул окно —
     *    `menuFlying` гаснет в App, и мы падаем в честную паузу выше.
     */
    if (!input.pointerLocked) {
      clearPresses()
      if (!session.menuFlying) return

      session.running = true
      syncControllers(session)
      // Штурвал — коастящему контроллеру (или автопилоту стыковки/полёта-к-цели, если он вёл):
      // мышь на меню, пилот не рулит. Ставим ПОСЛЕ syncControllers, чтобы пересборка не вернула ввод.
      controllers.set(world.player.id, helmController(session, true))
      stepWorld(world, dt, controllers)
      camera.position.add(world.originShift)
      return
    }

    // Курсор захвачен — штурвал у пилота. Мог остаться коастинг-контроллер от меню-полёта:
    // возвращаем управление (автопилоты сохраняем — их ставят L/J, а не этот кадр).
    controllers.set(world.player.id, helmController(session, false))

    // Тумблеры читаются один раз за кадр, до шага симуляции.
    //
    // Карты (`KeyM`) здесь нет намеренно: она открывается, отпуская курсор, а мир
    // без курсора не шагает — до этой строки кадр уже не доходит. Её тумблер живёт
    // в Shell, на обычном слушателе окна.
    // Пытаешься применить прибор, которого нет (или пустую обойму) — плашка объясняет,
    // почему клавиша молчит. Иначе «нажал — ничего» читается как баг, а не как «не куплено».
    // R — пилон. Тип один за раз: обычная ракета или дрон-ракета (что экипировано).
    if (consumePress('KeyR')) {
      if (missileAmmo(world.player) > 0 || droneAmmo(world.player) > 0) intent.missile = true
      else pushWarning('noRockets', world.time)
    }
    // Аукс-слот ОДИН — значит и клавиша одна: E активирует то, что в нём стоит.
    // Раньше bomb/cloak/ecm висели на B/X/E порознь, и две из трёх всегда били в
    // пустоту («прибор не установлен»). Миелофон на E работает УДЕРЖАНИЕМ (см.
    // playerController), тап-действия у него нет — поэтому если он экипирован ИЛИ лежит
    // в трюме (дев-выдача), молчим, а не выдаём ложное «не установлен».
    if (consumePress('KeyE')) {
      const l = world.player.loadout
      if (hasBomb(l)) intent.bomb = true
      else if (findCloak(l)) intent.cloak = true
      else if (hasEcm(l)) intent.ecm = true
      else if (!ownsMielophone(world.player)) pushWarning('noAux', world.time)
    }

    // Жмёшь гашетку без единого лазера на борту — то же напоминание (ракеты — своя
    // клавиша). Держание, а не тап: плашка сама не частит, её гасит кулдаун очереди.
    if (input.firing && !world.player.spec.mounts.some((m) => isLaser(m.weapon))) {
      pushWarning('noLaser', world.time)
    }
    // ДВА КРУГА листания, оба ПО УДАЛЕНИЮ (ближний первым):
    //  • Tab — КОНТАКТЫ: живые борта (персонажи) и обломки-контейнеры (останки) → захват.
    //  • Shift+Tab — НЕБЕСНЫЕ: звёзды, планеты, спутники, станции → нав-цель (станция ещё и
    //    на связь). Круги независимы: контакт и точка навигации не сбивают друг друга.
    // Когда галактика ПРОЯВИЛАСЬ (слой активен), листаются ЗВЁЗДЫ галактики (jumpTargetIndex) —
    // это единственное, что там перечислимо, поэтому берём их на любой Tab, с шифтом и без.
    // Q / Shift+Q — ближайшая из того же круга, что Tab / Shift+Tab (на галактике — звезда слоя).
    // Галактическая ветка НЕ тупиковая: улетев за сферу локатора (4–14 св.г) или оставшись
    // без соседей в дальности привода, `cycleGalaxyStar` возвращает false — и нажатие
    // достаётся обычному кругу. Иначе Tab вдали от галактики не делал ровно ничего.
    if (consumePress('Tab')) {
      if (!galaxyRadar().active || !cycleGalaxyStar(world)) {
        if (isHeld('ShiftLeft') || isHeld('ShiftRight')) cycleCelestial(world)
        else cycleContact(world)
      }
    }
    if (consumePress('KeyQ')) {
      if (galaxyRadar().active) retargetNearestGalaxyStar(world)
      else if (isHeld('ShiftLeft') || isHeld('ShiftRight')) retargetNearestCelestial(world)
      else retargetNearestContact(world)
    }

    // Пользовательский ракурс: облёт (←/→) и наезд (↑/↓), V — сброс. Чистая камера,
    // мир не трогает. Здесь, до clearPresses, чтобы тап V сработал.
    stepCameraView(dt)

    if (consumePress('KeyL')) {
      /**
       * ВРЕМЕННЫЙ ВЫХОД С КУСТА. Пока нет ни рендера, ни настоящего прибытия в галактику,
       * режим куста — ловушка: манёвры отключены, и вернуть штурвал нечем. Убрать, когда
       * появится честный выход (въезд в узел → влёт в галактику).
       */
      if (session.mode === 'bush') {
        leaveBush(session.bush)
        setPilot(session, 'manual')
      }
      // L: отмена стыковки → отлип с поверхности → автопосадка → автостыковка.
      else if (session.mode === 'autodock') setPilot(session, 'manual')
      else if (world.player.landedOn) releaseLanding(world.player, world)
      else if (armAutoland(world)) { /* автопосадка пошла — ведёт домен, штурвал вернётся сам */ }
      else if (canEngageAutodock(world)) setPilot(session, 'autodock')
    }

    // J — автопилот НА ЦЕЛЬ: контакт / нав / звезда галактики (jumpTarget). Нет цели — плашка.
    if (consumePress('KeyJ')) {
      if (session.mode === 'flyto') setPilot(session, 'manual')
      else if (canEngageFlyTo(world)) setPilot(session, 'flyto')
      else pushWarning('noTarget', world.time)
    }
    // Долетели (или цель пропала) — возвращаем штурвал: автопилот-к-цели не залипает.
    if (session.mode === 'flyto' && flyToArrived(world)) setPilot(session, 'manual')

    stepBush(session, dt)

    // Отсюда и до конца кадра мир живёт: камера может догонять, факелы — дышать.
    session.running = true

    // Торговцы могли улететь, а новые — прилететь: у каждого должен быть пилот.
    syncControllers(session)

    // Накопитель и фиксированный шаг — внутри stepWorld.
    stepWorld(world, dt, controllers)

    // Мир мог сдвинуться (плавающее начало координат). Камера живёт в мировых
    // координатах, и без этой поправки пружина преследования полсекунды тащит её
    // с четырёх километров — кадр разворачивается, и корабль влетает в него заново.
    camera.position.add(world.originShift)

    clearPresses()
  }, -100)

  return null
}
