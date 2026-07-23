import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Group } from 'three'
import { AsteroidField } from './Asteroids'
import { Bodies } from './Bodies'
import { GalaxyLayer } from './GalaxyLayer'
import { HypertorusLayer } from './HypertorusLayer'
import { Titans } from './Titans'
import { Platforms } from './Platforms'
import { DockingCorridor } from './DockingCorridor'
import { Dyson } from './Dyson'
import { BlackHole } from './BlackHole'
import {
  CargoPods,
  Explosions,
  ExplosionChunks,
  Missiles,
  MuzzleFlashes,
  StationShields,
  TractorBeam,
  Tracers,
  WarpFlashes,
} from './Effects'
import { WarpArrivalPortals } from './WarpArrivalPortals'
import { ShieldBubbles } from './ShieldBubbles'
import { Exhaust } from './Exhaust'
import { Lighting } from './Lighting'
import { Figurines } from './Figurines'
import { Monoliths } from './Monoliths'
import { RockDebris } from './RockDebris'
import { WarBases } from './WarBases'
import { Drones, EnemyShips, PlayerShip } from './Ships'
import { RemotePlayers } from './RemotePlayers'
import { RemoteJumpPortals } from './RemoteJumpPortals'
import { Sky } from './Sky'
import { Starfield } from './Starfield'
import { WingMissiles } from './WingMissiles'
import { useSession } from '../../app/GameContext'

/**
 * Полное визуальное содержимое одного World без симуляции, камеры, HUD и postprocess.
 * Основной и портальный миры обязаны собираться ОДНИМ деревом: иначе любой новый
 * материал или объект снова сделает переход между «превью» и игрой заметным.
 *
 * НА КУСТЕ система целиком ПРЯЧЕТСЯ: пузыри-галактики висят в пустоте, и старая система
 * (звезда, планеты, трафик, скайбокс) не должна проступать сквозь них и мерцать. Прячем
 * ОДНИМ переключателем видимости группы (`visible` наследуется детьми), а не по компоненту:
 * искать все меши по дереву — однажды забыть один. Снаружи остаются лишь свет, СВОЙ корабль
 * (он бусина в центре кроны) и сам слой куста.
 */
export function WorldVisuals() {
  const session = useSession()
  const world = session.world
  const worldRef = useRef<Group>(null)
  // bush.active меняется в useFrame симуляции, а не в React — переключаем видимость кадром.
  useFrame(() => {
    if (worldRef.current) worldRef.current.visible = !session.bush.active
  })
  // Раньше обе сцены всегда грузили Sky(0): второй World был настоящим, но его фон
  // совпадал с первым пиксель-в-пиксель и визуально «съедал» саму маску. Индекс
  // детерминирован системой, поэтому увиденное в кольце останется тем же после jump.
  const skyIndex = (Math.imul(world.systemIndex ^ world.galaxySeed, 0x9e3779b1) >>> 0) % 10
  return (
    <>
      <Lighting />
      <HypertorusLayer />
      <PlayerShip />

      <group ref={worldRef}>
        <Sky galaxyIndex={skyIndex} />
        <Starfield />
        <GalaxyLayer />

        <Bodies />
        <BlackHole />
        <Dyson />
        <AsteroidField />
        <Titans />
        <Platforms />
        <DockingCorridor />

        <WingMissiles />
        <EnemyShips />
        <Monoliths />
        <Figurines />
        <WarBases />
        <RockDebris />
        <Drones />
        <RemotePlayers />
        <RemoteJumpPortals />
        <CargoPods />
        <TractorBeam />
        <Missiles />

        <Exhaust />
        <Tracers />
        <MuzzleFlashes />
        <Explosions />
        <ExplosionChunks />
        <WarpFlashes />
        <WarpArrivalPortals />
        <StationShields />
        <ShieldBubbles />
      </group>
    </>
  )
}
