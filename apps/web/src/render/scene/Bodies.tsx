import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Matrix4, Mesh, Quaternion, Vector3, type Texture } from 'three'
import { clamp, type BodyEntity, type PlanetType } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { ATMOSPHERE, ATMOSPHERE_COLOR, BODY_FADE, BODY_SEGMENTS, CITY_LIGHTS, CORONA, GIANT_RENDER_CAP, MOON_DECOR } from '../config'
import { atmosphereGeometry, planetGeometry, starGeometry, type PlanetLook } from '../geometry/bodies'
import { coronaGeometry } from '../geometry/corona'
import { crossRaysGeometry, crossStationGeometry, stationGeometry } from '../geometry/props'
import { crossGlbGeometry, stationGlbGeometry, stationGlbMaterial } from '../geometry/stationGlb'
import { createDivineCrossMaterial } from '../materials/divineCross'
import {
  crossRayMaterial,
  planetMaterial,
  planetTexturedMaterial,
  starMaterial,
  stationMaterial,
} from '../materials/materials'
import { createAtmosphereMaterial } from '../materials/atmosphere'
import { createCityLightsMaterial } from '../materials/cityLights'
import { createCoronaMaterial } from '../materials/starCorona'
import { createStarSurfaceMaterial, loadStarSurface } from '../materials/starSurface'
import { loadPlanetTexture, pickVariant } from '../sky/planets'
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

/**
 * Что за мир — говорит домен (`body.surface`), во что его красить — знает рендер.
 * Ровно один словарь; новый тип планеты не требует ни единого `if` в сцене.
 */
const LOOK_BY_SURFACE: Record<PlanetType, PlanetLook> = {
  'Скалистая': 'rocky',
  'Ледяная': 'ice',
  'Газовый гигант': 'gas',
  'Океаническая': 'ocean',
  'Земного типа': 'terra',
}

function lookFor(body: BodyEntity): PlanetLook {
  // `noUncheckedIndexedAccess` не верит даже полному Record — и правильно делает:
  // тип поверхности приходит из домена и однажды может там появиться новый.
  return (body.surface && LOOK_BY_SURFACE[body.surface]) || 'rocky'
}

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
function place(mesh: Mesh, body: BodyEntity, time: number, rest: Vector3): void {
  mesh.position.copy(body.pos)
  _tiltQuat.setFromUnitVectors(rest, body.spinAxis)
  _spinQuat.setFromAxisAngle(body.spinAxis, body.spin * time)
  mesh.quaternion.copy(_spinQuat).multiply(_tiltQuat)
}

const _toStar = new Vector3()

/**
 * За потолком отвода камеры (`GIANT_RENDER_CAP`) мир ЗАМИРАЕТ: борт и камера дальше не
 * растут, поэтому реальные тела перестают отъезжать и повисли бы в кадре огромными. Домножаем
 * их размер на cap/рост — на звёздном масштабе планеты и светило съёживаются, будто уплыли
 * вдаль. Но сжатая в пиксель звезда всё равно СВЕТИТ яркой точкой, поэтому к BODY_FADE.END
 * размер догашивается в ноль (меш схлопывается в точку и пропадает) — система освобождает
 * кадр под галактику ещё до её проявления.
 */
function worldShrink(scale: number): number {
  if (scale <= GIANT_RENDER_CAP) return 1
  const recede = GIANT_RENDER_CAP / scale
  const fade = 1 - clamp((scale - BODY_FADE.START) / (BODY_FADE.END - BODY_FADE.START), 0, 1)
  return recede * fade
}

function Planet({ body }: { body: BodyEntity }) {
  const ref = useRef<Mesh>(null)
  const airRef = useRef<Mesh>(null)
  const lightsRef = useRef<Mesh>(null)
  const session = useSession()

  const look = lookFor(body)
  const seed = body.id * 7919
  // Луна получает грубую сферу: с расстояния, на котором её видно, шестьдесят
  // меридианов не отличить от ста шестидесяти, а у гиганта их шесть штук.
  const segments = BODY_SEGMENTS[body.kind]
  const geometry = useMemo(() => planetGeometry(look, seed, segments), [look, seed, segments])

  // Текстура приходит поздно или не приходит вовсе. Одна перерисовка React
  // на планету за всю игру — не игровой кадр, здесь это допустимо.
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => loadPlanetTexture(look, pickVariant(look, seed), setTexture), [look, seed])

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
    // Размер жмётся к точке за потолком камеры: гигантский борт «отъезжает» от системы.
    const shrink = worldShrink(session.world.player.state.scale)

    if (ref.current) {
      place(ref.current, body, session.world.time, REST_POLE)
      ref.current.scale.setScalar(body.radius * shrink)
    }

    /**
     * Оболочка огней вращается ВМЕСТЕ с планетой: сетка городов считается в её
     * связанных осях. Оболочка воздуха — нет: она гладкая, и вращать в ней нечего.
     */
    if (lightsRef.current) {
      place(lightsRef.current, body, session.world.time, REST_POLE)
      lightsRef.current.scale.setScalar(body.radius * CITY_LIGHTS.SCALE * shrink)
    }

    const air = airRef.current
    // Позиция — из тела, свет — из звезды. Плавающее начало координат двигает
    // и то и другое.
    if (air) {
      air.position.copy(body.pos)
      air.scale.setScalar(body.radius * airScale * shrink)
    }

    if (!airMaterial && !lightsMaterial) return

    const star = session.world.bodies.find((b) => b.kind === 'star')
    if (!star) return
    _toStar.copy(star.pos).sub(body.pos).normalize()
    airMaterial?.uniforms.uLight!.value.copy(_toStar)
    lightsMaterial?.uniforms.uLight!.value.copy(_toStar)
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
  // GPU-ресурсы освобождаем явно: смена системы размонтирует звезду, а текстура и
  // шейдер живут в видеопамяти и сами не уйдут. Иначе каждый прыжок — утечка карты.
  useEffect(() => () => {
    surface?.dispose()
    surfaceMaterial?.dispose()
  }, [surface, surfaceMaterial])

  useFrame((state, dt) => {
    // Светило тоже съёживается за потолком: на галактическом масштабе оно становится
    // одной из точек галактики, а не висит огромным диском поверх звёздного поля.
    const shrink = worldShrink(session.world.player.state.scale)
    if (ref.current) {
      ref.current.position.copy(body.pos)
      ref.current.scale.setScalar(body.radius * shrink)
    }
    if (glowRef.current) {
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
    // Плазма кипит и вращается в шейдерах — двигаем только время. Реальное (не мировое):
    // это косметика, шаг симуляции ей не нужен, а под паузой звезда пусть живёт.
    material.uniforms.uTime!.value += dt
    if (surfaceMaterial) surfaceMaterial.uniforms.uTime!.value += dt
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
    mesh.scale.setScalar(body.radius * worldShrink(session.world.player.state.scale))
  })

  return <mesh ref={ref} geometry={stationGeometry()} material={stationMaterial()} scale={body.radius} />
}

/**
 * Крест-храм. Тело креста рисуется божественным шейдером (силуэт «плывёт» как в кривом
 * зеркале, кромки раскаляются добела-в-золото), а из шести концов бьют аддитивные лучи.
 * `uTime` двигает варп и свечение; вращение и место — как у станции.
 */
function CrossStation({ body }: { body: BodyEntity }) {
  const ref = useRef<Mesh>(null)
  const session = useSession()
  const material = useMemo(() => createDivineCrossMaterial(), [])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    // Меш Креста грузится асинхронно — подменяем заглушку по идентичности. Материал НЕ трогаем:
    // облик ему даёт божественный шейдер, а не текстуры модели.
    const g = crossGlbGeometry()
    if (g && mesh.geometry !== g) mesh.geometry = g
    // Крест — монумент: он НЕ вращается (domain даёт ему spin 0), потому ось симметрии здесь
    // роли не играет и `place` просто ставит его на место.
    place(mesh, body, session.world.time, REST_POLE)
    mesh.scale.setScalar(body.radius * worldShrink(session.world.player.state.scale))
    material.uniforms.uTime!.value += dt
  })

  return (
    <mesh ref={ref} geometry={crossStationGeometry()} material={material} scale={body.radius}>
      {/* Лучи — отдельная аддитивная сетка внутри той же матрицы креста: крутятся с ним. */}
      <mesh geometry={crossRaysGeometry()} material={crossRayMaterial()} renderOrder={2} />
    </mesh>
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
        if (body.kind === 'star') return <Star key={body.id} body={body} />
        if (body.kind === 'blackhole') return null
        // Крупная луна рисуется тем же компонентом, что и планета, и это не лень:
        // она и ЕСТЬ маленькая скалистая планета. Ни воздуха, ни огней у неё не
        // будет — не потому, что для луны написана отдельная ветка, а потому, что
        // у голой скалы нет цвета атмосферы, а у ноля жителей — городов.
        if (body.kind === 'planet' || body.kind === 'moon') return <Planet key={body.id} body={body} />
        // Крест-храм — свой компонент (живой шейдер + лучи); прочие станции — общий Station.
        if (body.stationStyle === 'cross') return <CrossStation key={body.id} body={body} />
        return <Station key={body.id} body={body} />
      })}
      <MoonSwarm moons={swarm} />
    </>
  )
}
