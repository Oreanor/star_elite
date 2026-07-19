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
  type Controller,
  type World,
} from '@elite/sim'
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
    if (consumePress('Tab')) {
      if (galaxyRadar().active) cycleGalaxyStar(world)
      else if (isHeld('ShiftLeft') || isHeld('ShiftRight')) cycleCelestial(world)
      else cycleContact(world)
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
      // L: отмена стыковки → отлип с поверхности → автопосадка → автостыковка.
      if (session.mode === 'autodock') setPilot(session, 'manual')
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
