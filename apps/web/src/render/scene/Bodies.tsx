import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Color, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3, type Texture } from 'three'
import { type BodyEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { ATMOSPHERE, ATMOSPHERE_COLOR, BODY_SEGMENTS, CITY_LIGHTS, CORONA, MOON_DECOR } from '../config'
import { starWorldShrink, worldShrink } from '../worldShrink'
import { nearestStar, starTintColor } from '../starLight'
import { atmosphereGeometry, planetGeometry, starGeometry } from '../geometry/bodies'
import { coronaGeometry } from '../geometry/corona'
import {
  crossNeonTubesGeometry,
  crossPortalPanelsGeometry,
  crossStationGeometry,
  stationGeometry,
} from '../geometry/props'
import { stationGlbGeometry, stationGlbMaterial } from '../geometry/stationGlb'
import {
  planetMaterial,
  planetTexturedMaterial,
  starMaterial,
  stationMaterial,
} from '../materials/materials'
import {
  crossBodyMaterial,
  crossNeonLampMaterial,
  crossPortalMaterial,
  syncCrossPortalSky,
  tickCrossPortal,
} from '../materials/crossPortal'
import { createAtmosphereMaterial } from '../materials/atmosphere'
import { createCityLightsMaterial } from '../materials/cityLights'
import { createCoronaMaterial } from '../materials/starCorona'
import { createStarSurfaceMaterial, loadStarSurface } from '../materials/starSurface'
import { loadRockTexture, rockTextureOf } from '../materials/rockTextures'
import { loadPlanetTexture, pickVariant, planetLook } from '../sky/planets'
import { MoonSwarm } from './Moons'

/**
 * Крупные тела: звезда, планеты, станция. Их немного и они почти неподвижны,
 * поэтому инстансинг тут не нужен — обычные меши.
 *
 * Плавающее начало координат сдвигает мир, поэтому позиции читаются каждый кадр.
 * Свет живёт в Lighting: у него своя причина меняться.
 *
 * Вращение берётся как `spin * world.time`, а не накапливается сложением за кадр:
 * накопленный угол зависит от частоты кадров, ползёт после паузы и не совпадёт
 * с тем, что насчитает сервер. Тот же приём, что и с фиксированным шагом физики.
 */

const _spinQuat = new Quaternion()
const _tiltQuat = new Quaternion()
/** Разворот короны-билборда к камере со СТАБИЛЬНЫМ верхом (чтобы узор не крутило креном). */
const _billboard = new Matrix4()
const _worldUp = /* @__PURE__ */ new Vector3(0, 1, 0)

/**
 * Ось симметрии геометрии в покое: у сферы (тела) это полюс. У GLB-станций — их «верх» (Meshy),
 * то есть та же ось Y. Продольная ось (`0,0,1`) была нужна процедурному кориолису — его больше нет.
 */
const REST_POLE = new Vector3(0, 1, 0)

/**
 * Ставит тело на место и поворачивает его на угол, однозначно заданный временем.
 *
 * Поворотов ДВА, и порядок важен. `spinAxis` — это не только ось, вокруг которой
 * тело крутится, но и та, на которую обязана лечь ось симметрии геометрии (`rest`).
 * Повернуть лишь вокруг `spinAxis`, оставив полюс сферы смотреть в Y, значит
 * заставить полюс описывать конус: планета не вращалась бы, а кувыркалась, и
 * наклон оси читался бы как болтанка. Сначала кладём полюс на ось, потом крутим
 * вокруг неё — тогда полюс неподвижен, каким он в природе и бывает.
 */
function place(node: Object3D, body: BodyEntity, time: number, rest: Vector3): void {
  node.position.copy(body.pos)
  _tiltQuat.setFromUnitVectors(rest, body.spinAxis)
  _spinQuat.setFromAxisAngle(body.spinAxis, body.spin * time)
  node.quaternion.copy(_spinQuat).multiply(_tiltQuat)
}

const _toStar = new Vector3()
const _airTint = new Color()
const _lightsTint = new Color()

function Planet({ body }: { body: BodyEntity }) {
  const ref = useRef<Mesh>(null)
  const airRef = useRef<Mesh>(null)
  const lightsRef = useRef<Mesh>(null)
  const session = useSession()

  const look = planetLook(body.surface)
  const seed = body.id * 7919
  // Луна получает грубую сферу: с расстояния, на котором её видно, шестьдесят
  // меридианов не отличить от ста шестидесяти, а у гиганта их шесть штук.
  const segments = BODY_SEGMENTS[body.kind]
  const geometry = useMemo(() => planetGeometry(look, seed, segments), [look, seed, segments])

  // Текстура приходит поздно или не приходит вовсе. Одна перерисовка React
  // на планету за всю игру — не игровой кадр, здесь это допустимо.
  //
  // КРУПНАЯ ЛУНА кроется снимком КАМНЯ, а не планетной картой: спутник — это камень,
  // только большой, и материки с облаками на нём читались как ошибка. Картинка та же,
  // что у астероидов, и выбирается по id — то же тело, то же лицо.
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(
    () => body.kind === 'moon'
      ? loadRockTexture(rockTextureOf(body.id), setTexture)
      : loadPlanetTexture(look, pickVariant(look, seed), setTexture),
    [body.kind, body.id, look, seed],
  )

  const material = texture ? planetTexturedMaterial(texture) : planetMaterial()

  // Воздух есть не у всех: у голой скалы его и не должно быть. Решают ДАННЫЕ.
  const airColor = ATMOSPHERE_COLOR[look]

  /**
   * Толщина своя у каждого мира, но выводится из его номера, а не из броска кости:
   * планета, у которой атмосфера пухнет и опадает при каждом входе в систему,
   * выглядит поломкой. Тот же приём, что у вращения: не хранить, а вычислять.
   */
  const airScale = useMemo(() => {
    const wobble = Math.sin(body.id * 12.9898) // −1…1, но не случайно: детерминировано
    return 1 + (ATMOSPHERE.SCALE - 1) * (1 + wobble * ATMOSPHERE.SCALE_SPREAD)
  }, [body.id])
  const airMaterial = useMemo(
    () => (airColor === null ? null : createAtmosphereMaterial(airColor)),
    [airColor],
  )
  useEffect(() => () => airMaterial?.dispose(), [airMaterial])

  // Города — там, где есть кому в них жить. Решают ДАННЫЕ, а не тип поверхности:
  // обитаемым однажды станет и ледяной мир, и рендер об этом даже не узнает.
  const lightsMaterial = useMemo(
    () => (body.population > 0 ? createCityLightsMaterial(body.population) : null),
    [body.population],
  )
  useEffect(() => () => lightsMaterial?.dispose(), [lightsMaterial])

  useFrame(() => {
    // С галактикой планета исчезает сразу (не тает до ×50k).
    const shrink = worldShrink(session.world.player.state.scale)
    const on = shrink > 0

    if (ref.current) {
      ref.current.visible = on
      place(ref.current, body, session.world.time, REST_POLE)
      ref.current.scale.setScalar(body.radius * shrink)
    }

    /**
     * Оболочка огней вращается ВМЕСТЕ с планетой: сетка городов считается в её
     * связанных осях. Оболочка воздуха — нет: она гладкая, и вращать в ней нечего.
     */
    if (lightsRef.current) {
      lightsRef.current.visible = on
      place(lightsRef.current, body, session.world.time, REST_POLE)
      lightsRef.current.scale.setScalar(body.radius * CITY_LIGHTS.SCALE * shrink)
    }

    const air = airRef.current
    // Позиция — из тела, свет — из звезды. Плавающее начало координат двигает
    // и то и другое.
    if (air) {
      air.visible = on
      air.position.copy(body.pos)
      air.scale.setScalar(body.radius * airScale * shrink)
    }

    if (!airMaterial && !lightsMaterial) return

    // Ближайшая к ПЛАНЕТЕ — у двойных систем терминатор от «своего» солнца.
    const star = nearestStar(session.world, body.pos)
    if (!star) return
    _toStar.copy(star.pos).sub(body.pos).normalize()
    if (airMaterial) {
      airMaterial.uniforms.uLight!.value.copy(_toStar)
      const base = (airMaterial.userData.baseColor as number) ?? 0x6fb4ff
      starTintColor(base, star.color, ATMOSPHERE.STAR_TINT, _airTint)
      airMaterial.uniforms.uColor!.value.copy(_airTint)
    }
    if (lightsMaterial) {
      lightsMaterial.uniforms.uLight!.value.copy(_toStar)
      const base = (lightsMaterial.userData.baseColor as number) ?? CITY_LIGHTS.COLOR
      starTintColor(base, star.color, CITY_LIGHTS.STAR_TINT, _lightsTint)
      lightsMaterial.uniforms.uColor!.value.copy(_lightsTint)
    }
  })

  return (
    <>
      <mesh ref={ref} geometry={geometry} material={material} scale={body.radius} frustumCulled={false} />
      {lightsMaterial && (
        <mesh
          ref={lightsRef}
          geometry={atmosphereGeometry()}
          material={lightsMaterial}
          scale={body.radius * CITY_LIGHTS.SCALE}
          frustumCulled={false}
        />
      )}
      {airMaterial && (
        <mesh
          ref={airRef}
          geometry={atmosphereGeometry()}
          material={airMaterial}
          scale={body.radius * airScale}
          frustumCulled={false}
        />
      )}
    </>
  )
}

/**
 * Звезда и её корона. Корона — билборд: свечение не имеет поверхности,
 * его нельзя смоделировать мешем. Сфера светится сама, освещать её нечем.
 */
function Star({ body }: { body: BodyEntity }) {
  const ref = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)
  const session = useSession()

  // Корона — свой процедурный материал на звезду (цвет от класса, `uTime` двигает сцена).
  // Живёт в видеопамяти, поэтому при смене системы освобождаем явно (ниже), как поверхность.
  const material = useMemo(
    () => createCoronaMaterial(body.color),
    [body.color],
  )
  useEffect(() => () => material.dispose(), [material])
  const glowSize = body.radius * CORONA.SCALE

  // Карта поверхности класса. Грузится лениво по цвету звезды; пока её нет (или у
  // класса карты не бывает — T/N/чёрная дыра) — диск остаётся на плоском цвете.
  const [surface, setSurface] = useState<Texture | null>(null)
  useEffect(() => {
    setSurface(null)
    loadStarSurface(body.color, setSurface)
  }, [body.color])
  const surfaceMaterial = useMemo(
    () => (surface ? createStarSurfaceMaterial(surface) : null),
    [surface],
  )
  // Материал звезды — свой; карту класса шарит кэш starSurface (галактический LOD) —
  // dispose текстуры здесь убил бы общий ресурс.
  useEffect(() => () => {
    surfaceMaterial?.dispose()
  }, [surfaceMaterial])

  useFrame((state) => {
    // К границе — starWorldShrink (догон к ×STAR_INFLATE); дальше точка слоя.
    const shrink = starWorldShrink(session.world.player.state.scale)
    const on = shrink > 0
    if (ref.current) {
      ref.current.visible = on
      ref.current.position.copy(body.pos)
      ref.current.scale.setScalar(body.radius * shrink)
    }
    if (glowRef.current) {
      glowRef.current.visible = on
      glowRef.current.position.copy(body.pos)
      // Плоскость короны РАЗВОРАЧИВАЕМ лицом к камере вручную — это billboard: у свечения
      // нет поверхности, оно всегда смотрит на зрителя. Но НЕ копируем кватернион камеры
      // целиком (тогда её крен катал бы узор короны каруселью): строим разворот к камере
      // со СТАБИЛЬНЫМ мировым верхом. lookAt(camera, star, up) даёт ось Z = star→camera —
      // ровно нормаль плоскости к зрителю, а верх остаётся мировым: протуберанцы не крутит.
      _billboard.lookAt(state.camera.position, body.pos, _worldUp)
      glowRef.current.quaternion.setFromRotationMatrix(_billboard)
      glowRef.current.scale.set(glowSize * shrink, glowSize * shrink, 1)

      // КРОМКА КОРОНЫ ЗАВИСИТ ОТ ДИСТАНЦИИ. Билборд плоский, а силуэт ШАРА растёт с
      // приближением быстрее плоского (экранный радиус = asin(R/d), не R/d). Со статической
      // кромкой вблизи шар «раздувается» и наползает на корону. Экранный силуэт ложится на
      // билборд как долю 2/(SCALE·√(1−(R/d)²)) — вдали это наши 2/SCALE, вблизи кромка
      // раздвигается ровно вслед за шаром. Зажата, чтобы у самой поверхности не схлопнуться.
      const camDist = state.camera.position.distanceTo(body.pos)
      const rOverD = Math.min(0.985, (body.radius * shrink) / Math.max(camDist, 1e-3))
      const edge = (2 * 0.975) / (CORONA.SCALE * Math.sqrt(1 - rOverD * rOverD))
      material.uniforms.uDiskFrac!.value = Math.min(edge, 0.96)
    }
    // Фаза абсолютна для мира, а не является возрастом экземпляра материала. WorldVisuals
    // можно размонтировать/смонтировать при handoff — та же звезда обязана продолжить ровно
    // тот кадр плазмы, который был виден внутри кольца, а не стартовать с uTime=0.
    const visualTime = session.world.time
    material.uniforms.uTime!.value = visualTime
    if (surfaceMaterial) surfaceMaterial.uniforms.uTime!.value = visualTime
  })

  return (
    <>
      <mesh
        ref={ref}
        geometry={starGeometry()}
        material={surfaceMaterial ?? starMaterial(body.color)}
        scale={body.radius}
        frustumCulled={false}
      />
      {/* Плоскость-билборд в центре звезды: диск сам закрывает середину ореола, остаётся
          кольцо вокруг него — ровно то, чем корона и является. Разворот к камере — в useFrame. */}
      <mesh
        ref={glowRef}
        geometry={coronaGeometry()}
        material={material}
        scale={[glowSize, glowSize, 1]}
        renderOrder={2}
        frustumCulled={false}
      />
    </>
  )
}

function Station({ body }: { body: BodyEntity }) {
  const ref = useRef<Mesh>(null)
  const session = useSession()

  // Облик — одна из пяти GLB-моделей; какая, решает домен по сиду системы (`stationModel`),
  // потому у всех клиентов станция одинакова. Модель грузится асинхронно: до готовности
  // отдаётся процедурная заглушка, а как меш доедет — подменяем по ИДЕНТИЧНОСТИ объекта.
  const model = body.stationModel ?? 0
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const g = stationGlbGeometry(model)
    if (g && mesh.geometry !== g) mesh.geometry = g
    const m = stationGlbMaterial(model)
    if (m && mesh.material !== m) mesh.material = m
    // Ось симметрии GLB-станции — её «верх» (Meshy: Y), НЕ продольная Z кориолиса. Кладём Y на
    // ось спина (domain spinAxis) и крутим вокруг неё — иначе ось модели гоняется по кругу (кувырок).
    place(mesh, body, session.world.time, REST_POLE)
    const shrink = worldShrink(session.world.player.state.scale)
    mesh.visible = shrink > 0
    mesh.scale.setScalar(body.radius * shrink)
  })

  return <mesh ref={ref} geometry={stationGeometry()} material={stationMaterial()} scale={body.radius} />
}

/**
 * Кресты: чёрный корпус, в окнах-масках — jpg-скайбокс (свой loadSky), рёбра — неон.
 * Не вращается — монумент; place на группу.
 */
function CrossStation({ body }: { body: BodyEntity }) {
  const groupRef = useRef<Group>(null)
  const session = useSession()
  const portalMaterial = useMemo(crossPortalMaterial, [])
  const neonMaterial = useMemo(crossNeonLampMaterial, [])

  useEffect(() => () => {
    const sky = portalMaterial.uniforms.uSkyMap!.value as Texture | null
    sky?.dispose()
    portalMaterial.dispose()
    neonMaterial.dispose()
  }, [portalMaterial, neonMaterial])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    place(group, body, session.world.time, REST_POLE)
    const shrink = worldShrink(session.world.player.state.scale)
    group.visible = shrink > 0
    group.scale.setScalar(body.radius * shrink)
    syncCrossPortalSky(portalMaterial, session.world.galaxySeed)
    tickCrossPortal(neonMaterial, session.world.time)
  })

  return (
    <group ref={groupRef} scale={body.radius} frustumCulled={false}>
      <mesh
        geometry={crossStationGeometry()}
        material={crossBodyMaterial()}
        frustumCulled={false}
      />
      <mesh
        geometry={crossPortalPanelsGeometry()}
        material={portalMaterial}
        frustumCulled={false}
      />
      <mesh
        geometry={crossNeonTubesGeometry()}
        material={neonMaterial}
        frustumCulled={false}
        renderOrder={1}
      />
    </group>
  )
}

/**
 * Мелкая луна — декорация, и рисуется роем инстансов. Крупная — уже мир: Ганимед
 * больше Меркурия, и складки с картой поверхности он заслужил наравне с планетами.
 * Решает РАЗМЕР, а не вид тела: порог — единственное, что их разделяет.
 */
const isDecor = (body: BodyEntity): boolean => body.kind === 'moon' && body.radius < MOON_DECOR.BIG_RADIUS

export function Bodies() {
  const session = useSession()
  const bodies = session.world.bodies

  // Свита пересчитывается на монтировании: прыжок пересобирает сцену целиком.
  const swarm = useMemo(() => bodies.filter(isDecor), [bodies])

  return (
    <>
      {bodies.map((body) => {
        if (isDecor(body)) return null
        switch (body.kind) {
          case 'star':
            return <Star key={body.id} body={body} />
          case 'blackhole':
            return null // рисует отдельный слой BlackHole
          // Крупная луна рисуется тем же компонентом, что и планета, и это не лень: она
          // и ЕСТЬ маленькая скалистая планета. Ни воздуха, ни огней у неё не будет — не
          // из-за отдельной ветки, а потому что у голой скалы нет цвета атмосферы, а у
          // ноля жителей — городов.
          case 'planet':
          case 'moon':
            return <Planet key={body.id} body={body} />
          case 'station':
            // Крест-храм — свой компонент (живой шейдер + лучи); прочие — общий Station.
            return body.stationStyle === 'cross'
              ? <CrossStation key={body.id} body={body} />
              : <Station key={body.id} body={body} />
        }
      })}
      <MoonSwarm moons={swarm} />
    </>
  )
}
