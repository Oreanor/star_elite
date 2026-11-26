import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Color, DirectionalLight, HemisphereLight, Vector3 } from 'three'
import { useSession } from '../../session/GameContext'
import { GALAXY_LAYER, LIGHT } from '../config'
import { FRONT_FX_LAYER } from '../post/frontFxPass'
import { dyingStarLight, nearestStar, tintedSunColor } from '../starLight'

/**
 * Свет сцены.
 *
 * Одной звезды мало. Камера преследования смотрит кораблю В КОРМУ — то есть
 * почти всегда в его теневую сторону, — и корабль читается чёрным силуэтом.
 * При плоском шейдинге и единственном далёком источнике грани к тому же
 * получают почти одинаковый угол и перестают играть.
 *
 * Поэтому добавлен ЗАПОЛНЯЮЩИЙ свет от камеры, смещённый вбок и вверх.
 * Физически его быть не должно; без него не видно корабля.
 *
 * Спектр ключевого — от ближайшей звезды (`starLight`): тот же выбор, что у
 * атмосферы, флейра и тинта пыли.
 */

const _sunDirection = new Vector3()
const _fillOffset = new Vector3()
const _sunColor = new Color()
const _dying = { pos: new Vector3(), color: 0 }

export function Lighting() {
  const session = useSession()
  const camera = useThree((state) => state.camera)

  const sunRef = useRef<DirectionalLight>(null)
  const fillRef = useRef<DirectionalLight>(null)
  const hemiRef = useRef<HemisphereLight>(null)

  /**
   * Свет живёт и на слое переднего плана (`FrontFxPass`). Тот рендерит ту же сцену второй раз,
   * глядя только на свой слой, — и без этого не видел бы ни одного источника. Для three это
   * смена набора света: 3 → 0 → 3 за кадр поднимает версию освещения, и КАЖДЫЙ освещённый
   * материал основного прохода заново выводит параметры и ключ программы. Замер: треть
   * времени отрисовки на ЦП уходила в `setProgram → getProgram`. Светить переднему плану
   * свет не будет (выхлоп неосвещённый) — важно лишь, чтобы набор в обоих проходах совпадал.
   */
  useLayoutEffect(() => {
    for (const light of [sunRef.current, fillRef.current, hemiRef.current]) light?.layers.enable(FRONT_FX_LAYER)
  }, [])

  useFrame(() => {
    const player = session.world.player.state.pos
    const scale = session.world.player.state.scale
    // Галактика в кадре — системной звезды нет, ключевой свет гасим (остаётся заливка).
    const galaxyOn = scale >= GALAXY_LAYER.FADE_IN_START

    const sun = sunRef.current
    const star = nearestStar(session.world, player)
    // Гибнущая звезда светит, пока идёт зрелище; ближе живой — свет её.
    const dying = dyingStarLight(session.world, player, _dying)
    const useDying = dying > 0 && (!star || _dying.pos.distanceToSquared(player) < star.pos.distanceToSquared(player))
    if (sun && (star || useDying)) {
      // Направленному свету важно только направление. Держим источник рядом
      // с игроком, чтобы дальность не имела значения, а терминатор был верен.
      _sunDirection.copy(useDying ? _dying.pos : star!.pos).sub(player).normalize()
      sun.position.copy(player).addScaledVector(_sunDirection, 1000)
      sun.target.position.copy(player)
      sun.target.updateMatrixWorld()
      // Свет наследует спектр звезды (подмешан к тёплому белому): у красного карлика
      // сцена теплеет, у голубого гиганта — холодеет. Так класс звезды виден не только
      // на диске, но и на освещении корпуса.
      tintedSunColor(useDying ? _dying.color : star!.color, _sunColor)
      sun.color.copy(_sunColor)
      sun.intensity = galaxyOn ? 0 : LIGHT.SUN_INTENSITY * (useDying ? dying : 1)
    } else if (sun) {
      // Светила нет (растворилось) — ключевой свет гаснет; остаются заливка и небо.
      sun.intensity = 0
    }

    const fill = fillRef.current
    if (fill) {
      // Со стороны камеры, но сдвинут: строго встречный свет убил бы всю гранёность.
      _fillOffset.set(-0.55, 0.75, 1).applyQuaternion(camera.quaternion).multiplyScalar(600)
      fill.position.copy(player).add(_fillOffset)
      fill.target.position.copy(player)
      fill.target.updateMatrixWorld()
    }
  })

  return (
    <>
      {/*
       * Яркости подобраны под почти белые корпуса: с ними ключевой свет пришлось
       * убавить, иначе освещённый борт выгорает в плоское белое пятно и гранёность
       * пропадает ровно так же, как пропадала от темноты.
       * Hemi занижен намеренно: ночная сторона планет должна быть темнее дня.
       */}
      <directionalLight ref={sunRef} intensity={LIGHT.SUN_INTENSITY} color={LIGHT.SUN_BASE} />
      <directionalLight ref={fillRef} intensity={LIGHT.FILL_INTENSITY} color={LIGHT.FILL_COLOR} />
      <hemisphereLight ref={hemiRef} args={[LIGHT.HEMI_SKY, LIGHT.HEMI_GROUND, LIGHT.HEMI_INTENSITY]} />
    </>
  )
}
