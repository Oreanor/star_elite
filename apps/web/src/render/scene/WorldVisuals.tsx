import { AsteroidField } from './Asteroids'
import { Bodies } from './Bodies'
import { GalaxyLayer } from './GalaxyLayer'
import { BushLayer } from './BushLayer'
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
import { ScenicRocks } from './ScenicRocks'
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
 */
export function WorldVisuals() {
  const world = useSession().world
  // Раньше обе сцены всегда грузили Sky(0): второй World был настоящим, но его фон
  // совпадал с первым пиксель-в-пиксель и визуально «съедал» саму маску. Индекс
  // детерминирован системой, поэтому увиденное в кольце останется тем же после jump.
  const skyIndex = (Math.imul(world.systemIndex ^ world.galaxySeed, 0x9e3779b1) >>> 0) % 10
  return (
    <>
      <Sky galaxyIndex={skyIndex} />
      <Lighting />
      <Starfield />
      <GalaxyLayer />
      <BushLayer />

      <Bodies />
      <BlackHole />
      <Dyson />
      <AsteroidField />
      <Titans />
      <Platforms />
      <DockingCorridor />

      <PlayerShip />
      <WingMissiles />
      <EnemyShips />
      <Monoliths />
      <Figurines />
      <ScenicRocks />
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
    </>
  )
}
