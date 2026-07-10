/**
 * Ввод. Мышь работает как виртуальная РУЧКА, а не как курсор: в pointer lock
 * копим дельты, зажимаем в единичный круг — и это отклонение ЕСТЬ команда
 * угловой скорости. Так летают все мышиные симуляторы.
 *
 * Модуль ничего не знает про игру: он лишь публикует состояние устройств.
 * Превращение его в ShipControls — дело PlayerController в слое приложения.
 */

export interface InputState {
  /** Отклонение ручки в единичном круге. x>0 вправо, y>0 вверх. */
  stickX: number
  stickY: number
  firing: boolean
  /**
   * Правая кнопка: временный газ. Держишь — тяга ползёт вверх, отпустил — съезжает
   * обратно к выставленной W/S. Это НЕ форсаж (тот множит тягу) и не W (та двигает
   * саму рукоять): рука возвращает сектор газа на место, как только её отпускают.
   */
  throttleUp: boolean
  /** Захвачен ли курсор. СПРАШИВАЕТСЯ у браузера, а не хранится копией. */
  readonly pointerLocked: boolean
}

let lockTarget: HTMLCanvasElement | null = null

/**
 * Пауза в этой игре — отпущенный курсор, поэтому `pointerLocked` решает, шагает
 * ли мир. Хранить его копией в поле опасно: обновляется она ровно одним событием
 * `pointerlockchange`, а браузер снимает захват и молча — при потере фокуса окна,
 * при переходе в полноэкранный режим, при переключении вкладки. Разошлась копия
 * с истиной — и мир встал навсегда: `requestLock()` видит, что элемент уже
 * захвачен, ничего не делает, события нет, копию починить нечем.
 *
 * Поэтому единственный источник правды — сам браузер. Геттер бесплатен.
 */
export const input: InputState = {
  stickX: 0,
  stickY: 0,
  firing: false,
  throttleUp: false,
  get pointerLocked(): boolean {
    return lockTarget !== null && document.pointerLockElement === lockTarget
  },
}

/** Пикселей мыши на полное отклонение ручки. Меньше — острее. */
const SENSITIVITY = 420

const held = new Set<string>()
const pressedThisFrame = new Set<string>()

export function isHeld(code: string): boolean {
  return held.has(code)
}

/** Однократное нажатие: читается и гасится за кадр. Для тумблеров. */
export function consumePress(code: string): boolean {
  return pressedThisFrame.delete(code)
}

export function clearPresses(): void {
  pressedThisFrame.clear()
}

export function centerStick(): void {
  input.stickX = 0
  input.stickY = 0
}

/**
 * Запросить захват курсора.
 *
 * Браузер отказывает, если после выхода из захвата прошло меньше секунды с
 * небольшим — это защита от игр, которые перехватывают Escape. Отказ прилетает
 * отклонённым промисом, и без обработки клик просто «не срабатывал» через раз.
 * Поэтому: сообщаем о неудаче честно, а вызывающий решает, что показать.
 */
export async function requestLock(): Promise<boolean> {
  if (!lockTarget || document.pointerLockElement === lockTarget) return true
  // Захват без фокуса окна — как раз тот случай, когда браузер оставляет курсор
  // прижатым к канвасу, а снять его уже нечем: событий он больше не пришлёт.
  if (!document.hasFocus()) return false
  try {
    await lockTarget.requestPointerLock()
    return true
  } catch {
    return false
  }
}

/**
 * Отпустить курсор. Зовётся отовсюду, где мир встаёт: пауза, карта, док, гибель.
 *
 * Захват — это не только события мыши. На Windows браузер на время захвата
 * ПРИЖИМАЕТ системный курсор к прямоугольнику канваса (`ClipCursor`), и снимает
 * прижатие, только когда захват честно закончился. Пережил захват уход фокуса
 * или размонтирование канваса — и курсор перестаёт доезжать до краёв экрана
 * во всём браузере, пока не переключишься в другое приложение.
 *
 * Поэтому захват снимается явно и в тех местах, где на браузер надеяться нельзя.
 */
export function releaseLock(): void {
  /**
   * Зовём БЕЗУСЛОВНО, не спрашивая `pointerLockElement`.
   *
   * Браузер снимает захват сам — при потере фокуса, при уходе элемента из DOM —
   * и `pointerLockElement` становится пустым. А прижатие курсора остаётся: оно
   * живёт в системе, и снять его нечем, кроме честного выхода из захвата.
   * Проверка «а захвачено ли» ровно в этом случае и мешала: она видела пустоту
   * и не делала ничего. Холостой вызов ничего не стоит.
   */
  document.exitPointerLock()
}

const PREVENT_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export function attachInput(canvas: HTMLCanvasElement): () => void {
  lockTarget = canvas

  /**
   * Чужой захват, переживший свой канвас.
   *
   * Гиперпрыжок пересобирает сцену, HMR — всё дерево, и захват остаётся висеть
   * на элементе, которого больше нет в DOM. Игра при этом считает себя на паузе
   * (`pointerLocked` сравнивает с НЫНЕШНИМ канвасом), а браузер продолжает
   * прижимать системный курсор к прямоугольнику покойника: мышь не доезжает до
   * краёв экрана, и по кнопкам меню не попасть.
   */
  if (document.pointerLockElement && document.pointerLockElement !== canvas) {
    document.exitPointerLock()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Escape отпускает курсор и без нас — но только если захват принадлежит
    // живому элементу. Зовём сами: это последняя кнопка, которой пилот может
    // вернуть себе мышь, и она обязана работать всегда.
    if (e.code === 'Escape') releaseLock()

    if (!held.has(e.code)) pressedThisFrame.add(e.code)
    held.add(e.code)
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.code)

  const onMouseMove = (e: MouseEvent) => {
    if (!input.pointerLocked) return
    input.stickX += e.movementX / SENSITIVITY
    input.stickY -= e.movementY / SENSITIVITY

    // Зажимаем в КРУГ, а не в квадрат: иначе по диагонали ручка отклоняется
    // сильнее, чем по оси, и корабль в углу поворачивается быстрее.
    const magnitude = Math.hypot(input.stickX, input.stickY)
    if (magnitude > 1) {
      input.stickX /= magnitude
      input.stickY /= magnitude
    }
  }

  const onMouseDown = (e: MouseEvent) => {
    if (!input.pointerLocked) {
      void requestLock()
      return
    }
    if (e.button === 0) input.firing = true
    if (e.button === 2) input.throttleUp = true
  }
  // Отпускание слушается на окне, а не на канвасе: кнопку отпускают и за его краем.
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) input.firing = false
    if (e.button === 2) input.throttleUp = false
  }

  // Захват снят — гасим зажатые клавиши: иначе тяга «залипнет» на паузе.
  const onLockChange = () => {
    const locked = document.pointerLockElement
    // Захвачен НЕ наш канвас: игра такой захват не читает, а курсор он прижимает.
    // Снимаем в том же событии, а не ждём, пока кто-нибудь заметит.
    if (locked && locked !== canvas) document.exitPointerLock()
    if (!input.pointerLocked) release()
  }

  const release = () => {
    held.clear()
    pressedThisFrame.clear()
    input.firing = false
    // Иначе временный газ «залипнет» на паузе, как залипала бы тяга с клавиши.
    input.throttleUp = false

    /**
     * Ручка тоже залипала. Отклонение копится из движений мыши и само в ноль
     * не возвращается, а под захватом курсора мышь не двигается вовсе — значит
     * после паузы, карты, стыковки или ухода фокуса корабль начинал крутиться
     * сам, стоило вернуть управление. Пилот при этом мыши не касался.
     */
    centerStick()
  }

  const onContextMenu = (e: Event) => e.preventDefault()

  /**
   * Уход фокуса и скрытие вкладки: отпускаем курсор САМИ, пока окно ещё живо.
   *
   * Браузер снимает захват при потере фокуса и без нас — но прижатие системного
   * курсора при этом снимается не всегда, и мышь по всему браузеру перестаёт
   * доезжать до краёв экрана. Отпустить захват на кадр раньше браузера — дёшево,
   * а мир и так стоит: пауза — это отпущенный курсор.
   */
  const onBlur = () => {
    release()
    releaseLock()
  }

  /**
   * Возврат на вкладку — тоже повод отпустить курсор, и это не паранойя.
   *
   * `exitPointerLock`, позванный уже СКРЫТОЙ вкладкой, браузер имеет право
   * проигнорировать: документ неактивен, менять состояние захвата ему нечем.
   * Захват при этом остаётся, а вместе с ним и прижатие системного курсора —
   * мышь не доезжает до краёв экрана во всём браузере, включая соседние вкладки.
   *
   * Первый момент, когда выход гарантированно сработает, — возвращение фокуса.
   * Игра к этому времени и так на паузе, поэтому отпустить курсор нам ничего
   * не стоит: пилот всё равно нажмёт «В ИГРУ».
   */
  const onRegainFocus = () => {
    if (document.pointerLockElement) releaseLock()
  }
  const onVisibility = () => {
    if (document.hidden) onBlur()
    else onRegainFocus()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onRegainFocus)
  window.addEventListener('pagehide', onBlur)
  window.addEventListener('mouseup', onMouseUp)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('pointerlockchange', onLockChange)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('contextmenu', onContextMenu)

  return () => {
    if (lockTarget === canvas) lockTarget = null
    // Канвас уходит из DOM (гиперпрыжок пересобирает сцену, HMR — всё дерево).
    // Захват, переживший свой элемент, снять уже некому.
    releaseLock()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onRegainFocus)
    window.removeEventListener('pagehide', onBlur)
    window.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('pointerlockchange', onLockChange)
    canvas.removeEventListener('mousemove', onMouseMove)
    canvas.removeEventListener('mousedown', onMouseDown)
    canvas.removeEventListener('contextmenu', onContextMenu)
  }
}

/**
 * Горячая перезагрузка выбрасывает этот модуль вместе с `lockTarget`, а захват
 * курсора остаётся на канвасе, которого уже нет. Снять его после этого нечем:
 * новый модуль про старый элемент не знает, и мышь до конца сеанса разработки
 * ездит в прямоугольнике покойного канваса.
 *
 * В сборке этой ветки нет — `import.meta.hot` есть только у dev-сервера.
 */
if (import.meta.hot) import.meta.hot.dispose(() => releaseLock())
