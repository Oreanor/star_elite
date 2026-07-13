import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Mesh, Quaternion, Sprite, Vector3, type Texture } from 'three'
import type { BodyEntity, PlanetType } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { ATMOSPHERE, ATMOSPHERE_COLOR, BODY_SEGMENTS, CITY_LIGHTS, CORONA, MOON_DECOR } from '../config'
import { atmosphereGeometry, planetGeometry, starGeometry, type PlanetLook } from '../geometry/bodies'
import { coronaTexture } from '../geometry/corona'
import { stationGeometry } from '../geometry/props'
import {
  coronaMaterial,
  planetMaterial,
  planetTexturedMaterial,
  starMaterial,
  stationMaterial,
} from '../materials/materials'
import { createAtmosphereMaterial } from '../materials/atmosphere'
import { createCityLightsMaterial } from '../materials/cityLights'
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

/** Ось симметрии геометрии в покое: у сферы это полюс, у кориолиса — продольная. */
const REST_POLE = new Vector3(0, 1, 0)
const REST_BARREL = new Vector3(0, 0, 1)

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
    if (ref.current) place(ref.current, body, session.world.time, REST_POLE)

    /**
     * Оболочка огней вращается ВМЕСТЕ с планетой: сетка городов считается в её
     * связанных осях. Оболочка воздуха — нет: она гладкая, и вращать в ней нечего.
     */
    if (lightsRef.current) place(lightsRef.current, body, session.world.time, REST_POLE)

    const air = airRef.current
    // Позиция — из тела, свет — из звезды. Плавающее начало координат двигает
    // и то и другое.
    if (air) air.position.copy(body.pos)

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
  const glowRef = useRef<Sprite>(null)

  const texture = useMemo(coronaTexture, [])
  const material = useMemo(() => coronaMaterial(texture, body.color), [texture, body.color])
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

  useFrame((_, dt) => {
    ref.current?.position.copy(body.pos)
    glowRef.current?.position.copy(body.pos)
    // Плазма кипит и вращается в шейдере — двигаем только время. Реальное (не мировое):
    // это косметика, шаг симуляции ей не нужен, а под паузой звезда пусть живёт.
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
      {/* Спрайт стоит в центре звезды, поэтому диск сам закрывает середину ореола:
          остаётся кольцо вокруг него — ровно то, чем корона и является. */}
      <sprite ref={glowRef} material={material} scale={[glowSize, glowSize, 1]} renderOrder={2} frustumCulled={false} />
    </>
  )
}

function Station({ body }: { body: BodyEntity }) {
  const ref = useRef<Mesh>(null)
  const session = useSession()

  // Кориолис вращается вокруг продольной оси — так было в оригинале. Домен задаёт
  // ей `spinAxis = Z`, поэтому наклон здесь вырождается в тождество, а не в поворот.
  useFrame(() => {
    if (ref.current) place(ref.current, body, session.world.time, REST_BARREL)
  })

  return <mesh ref={ref} geometry={stationGeometry()} material={stationMaterial()} scale={body.radius} />
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
        // Крупная луна рисуется тем же компонентом, что и планета, и это не лень:
        // она и ЕСТЬ маленькая скалистая планета. Ни воздуха, ни огней у неё не
        // будет — не потому, что для луны написана отдельная ветка, а потому, что
        // у голой скалы нет цвета атмосферы, а у ноля жителей — городов.
        if (body.kind === 'planet' || body.kind === 'moon') return <Planet key={body.id} body={body} />
        return <Station key={body.id} body={body} />
      })}
      <MoonSwarm moons={swarm} />
    </>
  )
}
