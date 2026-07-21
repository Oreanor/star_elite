import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'
import { GALAXY } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { PIXEL_SCALE } from '../../render/config'
import { jumpPortal, portalActive } from '../../app/control/jumpPortal'
import { preparedJumpPortalWorld, syncDestCamera } from '../../render/scene/jumpPortalWorld'
import { torusThrust } from '../../app/control/torusFlight'
import { torusHomeMarker } from '../../render/scene/HypertorusLayer'
import { drawHud } from './drawHud'
import type { PortalAperture } from './aperture'

/**
 * HUD рисуется на отдельном 2D-канвасе ТОГО ЖЕ внутреннего разрешения, что и 3D,
 * и растягивается тем же множителем. Не в DOM: `transform: scale()` не пикселизует
 * вектор — браузер просто перерисовал бы текст в полном разрешении экрана.
 *
 * Общая пиксельная сетка с 3D означает, что прицел не «плавает» на полпикселя
 * относительно кораблей.
 *
 * Компонент живёт внутри <Canvas>, но ничего в сцену не добавляет: ему нужен
 * только useFrame после всех остальных, чтобы читать уже посчитанный кадр.
 */
/**
 * Описание кольца живёт один вызов drawHud, поэтому структура одна на модуль:
 * поля — ССЫЛКИ на векторы портала, копировать их незачем.
 */
const _aperture: PortalAperture = {
  pos: new Vector3(),
  quat: new Quaternion(),
  radius: 0,
  world: null,
  camera: null,
}

export function Hud() {
  const session = useSession()
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  /**
   * Канвас HUD — сосед <Canvas> в DOM, а мы живём внутри ОТДЕЛЬНОГО React-корня
   * (его создаёт R3F). Порядок эффектов между корнями не гарантирован, поэтому
   * элемент ищем лениво в кадре, а не один раз при монтировании.
   */
  const acquire = (): CanvasRenderingContext2D | null => {
    if (ctxRef.current) return ctxRef.current

    const canvas = document.getElementById('hud')
    if (!(canvas instanceof HTMLCanvasElement)) return null

    canvasRef.current = canvas
    ctxRef.current = canvas.getContext('2d')
    resize(canvas)
    return ctxRef.current
  }

  const resize = (canvas: HTMLCanvasElement) => {
    canvas.width = Math.max(1, Math.floor(size.width / PIXEL_SCALE))
    canvas.height = Math.max(1, Math.floor(size.height / PIXEL_SCALE))
    // Сглаживание портит крупный пиксель; при масштабе 1 оно ни на что не влияет.
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.imageSmoothingEnabled = false
    ctxRef.current = ctx
  }

  // Внутреннее разрешение канваса HUD совпадает с буфером 3D.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) resize(canvas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height])

  /**
   * Сглаженная частота кадров. Мгновенная `1/dt` скачет на десятки герц от кадра
   * к кадру и прочитать её невозможно; экспоненциальное среднее показывает тренд,
   * ради которого счётчик и нужен. Считается всегда, в том числе на паузе:
   * замерший счётчик выглядел бы как повисшая игра.
   */
  const fpsRef = useRef(60)

  useFrame((_, dt) => {
    // Переиспользуемая структура: в кадре не аллоцируем, а описание кольца всё равно
    // живёт ровно один вызов drawHud.
    const p = jumpPortal()
    let aperture: PortalAperture | null = null
    if (portalActive() && p.ringRadius > 0) {
      const prepared = p.destReady ? preparedJumpPortalWorld() : null
      _aperture.pos = p.ringPos
      _aperture.quat = p.ringQuat
      _aperture.radius = p.ringRadius
      _aperture.world = prepared?.world ?? null
      // Камеру второго мира двигает stencil-проход, а он идёт ПОСЛЕ этого useFrame.
      // Синхронизируем сами: иначе первый кадр открытого портала считал бы метки по
      // неинициализированной матрице. Вызов идемпотентен, проход повторит его сам.
      _aperture.camera = prepared ? syncDestCamera(camera) : null
      aperture = _aperture
    }

    const ctx = acquire()
    const canvas = canvasRef.current
    if (!ctx || !canvas) return

    if (dt > 1e-6) fpsRef.current += (1 / dt - fpsRef.current) * 0.06

    drawHud({
      ctx,
      camera,
      world: session.world,
      width: canvas.width,
      height: canvas.height,
      autodock: session.mode === 'autodock',
      flyto: session.mode === 'flyto',
      bush: session.bush.active,
      torusThrust: session.bush.active ? torusThrust() : 0,
      torusHome:
        session.bush.active && torusHomeMarker.visible
          ? { x: torusHomeMarker.x, y: torusHomeMarker.y, z: torusHomeMarker.z }
          : null,
      torusHomeName: session.universe.nodes[GALAXY.HOME_NODE]?.name ?? 'ДОМ',
      fps: fpsRef.current,
      aperture,
    })
  })

  return null
}
