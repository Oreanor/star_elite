import { useFrame, useThree } from '@react-three/fiber'
import { autodockController, canEngageAutodock, cycleLock, serializePlayer, stepWorld } from '@elite/sim'
import { syncControllers, useSession, type Session } from '../../app/GameContext'
import { coastController } from '../../app/control/playerController'
import { persistSave } from '../../app/save/saveStore'
import { clearPresses, consumePress, input, releaseLock } from '../../platform/input/input'

/**
 * Ведущий кадра. Монтируется ПЕРВЫМ в сцене: R3F вызывает useFrame в порядке
 * регистрации, поэтому мир успевает шагнуть до того, как остальные компоненты
 * начнут читать его состояние.
 *
 * Ничего не рисует.
 */

/**
 * Автостыковка — это подмена ОДНОЙ ссылки в карте контроллеров. Ни симуляция,
 * ни физика не знают, что за штурвалом сменился пилот: ровно ради этого
 * `Controller` и существует.
 */
function setPilot(session: Session, mode: Session['mode']): void {
  session.mode = mode
  session.controllers.set(session.world.player.id, mode === 'autodock' ? autodockController : session.pilot)

  // Допуск в створ станции выдаётся вместе с автопилотом и снимается вместе с ним.
  // Он живёт в МИРЕ, а не в сессии: по нему решает ИИ, а тот про сессию не знает.
  session.world.player.clearance = mode === 'autodock'
}

export function Simulation() {
  const session = useSession()
  const camera = useThree((state) => state.camera)

  useFrame((_, dt) => {
    const { world, controllers, intent } = session

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
      // Штурвал — коастящему контроллеру (или автопилоту стыковки, если он вёл): мышь на
      // меню, пилот не рулит. Ставим ПОСЛЕ syncControllers, чтобы пересборка не вернула ввод.
      controllers.set(world.player.id, session.mode === 'autodock' ? autodockController : coastController)
      stepWorld(world, dt, controllers)
      camera.position.add(world.originShift)
      return
    }

    // Курсор захвачен — штурвал у пилота. Мог остаться коастинг-контроллер от меню-полёта:
    // возвращаем управление (автопилот стыковки сохраняем — его ставит L, а не этот кадр).
    controllers.set(world.player.id, session.mode === 'autodock' ? autodockController : session.pilot)

    // Тумблеры читаются один раз за кадр, до шага симуляции.
    //
    // Карты (`KeyM`) здесь нет намеренно: она открывается, отпуская курсор, а мир
    // без курсора не шагает — до этой строки кадр уже не доходит. Её тумблер живёт
    // в Shell, на обычном слушателе окна.
    if (consumePress('KeyV')) session.view = session.view === 'chase' ? 'cockpit' : 'chase'
    if (consumePress('KeyR')) intent.missile = true
    if (consumePress('KeyE')) intent.ecm = true
    if (consumePress('KeyB')) intent.bomb = true
    if (consumePress('KeyX')) intent.cloak = true
    if (consumePress('KeyQ')) intent.drone = true
    // Tab перебирает борта И станции как один круг, но кладёт выбор в своё поле
    // (`lockedTargetId` / `lockedStationId`): станцию не бьют, с ней связываются (T).
    if (consumePress('Tab')) cycleLock(world)

    if (consumePress('KeyL')) {
      if (session.mode === 'autodock') setPilot(session, 'manual')
      else if (canEngageAutodock(world)) setPilot(session, 'autodock')
    }

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
  })

  return null
}
