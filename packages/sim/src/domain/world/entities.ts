import { Quaternion, Vector3 } from 'three'
import type { PlanetType } from '../../config/galaxy'
import type { Rng } from '../../core/math'
import type { CargoHold } from '../cargo'
import type { CargoItem } from '../cargo/items'
import type { ShipControls, ShipState } from '../flight/types'
import type { Loadout, MissileModule, ShipSpec } from '../loadout'
import type { AIState } from '../ai/types'
import type { CruiseState } from '../cruise/drive'
import type { IdSource } from './ids'

export type Faction = 'player' | 'hostile' | 'neutral' | 'police'

/** Состояние одного ствола. Живёт рядом с mount'ом, но меняется в бою. */
export interface GunState {
  cooldown: number
  /** 0..1. На единице орудие блокируется до остывания. */
  heat: number
  /** Только у ракет. */
  ammo: number
}

export interface ShipEntity {
  id: number
  kind: 'ship'
  faction: Faction
  name: string

  /** Что установлено. Меняется на станции и при подборе трофеев. */
  loadout: Loadout
  /** Выведено из loadout + массы груза. Пересобирается на СОБЫТИЕ, не каждый кадр. */
  spec: ShipSpec

  state: ShipState
  controls: ShipControls

  hull: number
  shield: number
  /** Время последнего попадания: щит не восстанавливается сразу. */
  lastHitAt: number
  /** Батареи. Тратятся противоракетной системой, копятся сами. */
  energy: number
  /** Перезаряд ПРО, с. */
  ecmCooldown: number
  /** Накопитель энергетической бомбы, 0..1. Копится сам, но только поверх целого щита. */
  bombCharge: number
  /**
   * Маскировочное поле поднято. Корабль не отражает свет и не виден чужим:
   * ни локатору, ни ИИ, ни головке ракеты.
   */
  cloaked: boolean

  hold: CargoHold
  guns: GunState[]
  /** Крейсерский ход: множитель и причина, по которой он не включается. */
  cruise: CruiseState

  alive: boolean
  /** Взрыв уже показан — чтобы не повторять каждый кадр. */
  wreckAt: number | null

  /** Только у ботов. Игрок управляется PlayerController'ом из слоя приложения. */
  ai: AIState | null

  /**
   * Корабль под защитой станции: его не атакуют.
   *
   * Станция даёт коридор тому, кто идёт на стыковку, и стрельба в её створе
   * прекращается. Это правило МИРА, а не поблажка автопилоту: флаг живёт на
   * корабле, и однажды его получит не только игрок.
   */
  clearance: boolean

  /**
   * Чей это беспилотник. `null` — настоящий корабль.
   *
   * Поле нужно не физике, а бухгалтерии: аппарат не даёт очков, не оставляет
   * трофеев и считается против потолка одновременных у своего носителя.
   */
  droneOf: number | null
  /** Момент самоликвидации по `world.time`. `null` — живёт, пока не собьют. */
  dieAt: number | null
}

export interface AsteroidEntity {
  id: number
  kind: 'asteroid'
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  spin: Vector3
  radius: number
  hull: number
  /** Индекс базовой формы: астероиды делят несколько мешей ради инстансинга. */
  shape: number
  alive: boolean
}

/** Контейнер с грузом или снятым модулем. Подбирается сближением на малой скорости. */
export interface CargoPodEntity {
  id: number
  kind: 'pod'
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  spin: Vector3
  item: CargoItem
  born: number
  alive: boolean
  /** Луч тянет его в этом шаге. Эфемерно: домен ставит, рендер читает, шаг сбрасывает. */
  tractored: boolean
}

export interface MissileEntity {
  id: number
  kind: 'missile'
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  module: MissileModule
  ownerId: number
  /** null — головка потеряла цель. Обратно она её не находит: ракета ослепла. */
  targetId: number | null
  /**
   * Текущая скорость, м/с. Растёт от скорости носителя до маршевой за `boostTime`:
   * ракета сходит с пилона, зажигает двигатель и только потом уходит вперёд.
   */
  speed: number
  born: number
  alive: boolean
}

/** Крупные тела: статичны в масштабах боя, но реальны в координатах. */
export interface BodyEntity {
  id: number
  kind: 'star' | 'planet' | 'station'
  /**
   * Чем планета является: скала, лёд, океан. Домен говорит, ЧТО это за мир;
   * во что его покрасить, решает рендер. Раньше он гадал по имени — «есть ли
   * в названии римская цифра» — и новый газовый гигант потребовал бы правки
   * рендера вместо правки данных.
   */
  surface: PlanetType | null
  /**
   * Миллионы жителей. Ноль — мир необитаем.
   *
   * Домену это число нужно для рынка, а рендеру — для огней на ночной стороне.
   * Оба берут его отсюда: «обитаемость» не должна выводиться из имени, цвета или
   * наличия станции, иначе два слоя однажды разойдутся в том, кто где живёт.
   */
  population: number
  /**
   * Собственное вращение, рад/с. Знак задаёт направление: обратное вращение
   * у планет бывает, и выглядит оно правильно только если знак настоящий.
   *
   * Угол берётся как `spin * world.time`, а не накапливается по кадрам:
   * накопление зависит от частоты кадров и не переживает паузу. Вращение
   * НЕ двигает центр тела, поэтому физика о нём не знает и знать не должна.
   */
  spin: number
  /** Ось вращения в мировых осях. Наклон делает терминатор живым. */
  spinAxis: Vector3
  name: string
  pos: Vector3
  radius: number
  color: number
}

/** Мгновенный след лазера. Чисто визуальный, живёт доли секунды. */
export interface Tracer {
  from: Vector3
  to: Vector3
  born: number
  hostile: boolean
  /**
   * Идентификатор лазера, из которого стреляли. Домен НЕ знает цветов: он знает,
   * какое железо выстрелило, а красит уже рендер. Иначе палитра протекла бы в бой.
   */
  weapon: string
}

export interface Explosion {
  pos: Vector3
  vel: Vector3
  born: number
  scale: number
}

/**
 * Вспышка энергетической бомбы. Позиции у неё НЕТ: поражение мгновенно, а всё,
 * что видит пилот, — экранный эффект на пару секунд. Тела в мире она не образует,
 * ни с чем не пересекается и никого не задевает; урон уже нанесён в `fireBomb`.
 *
 * Радиус тоже не хранится — он выводится из возраста. Хранить то, что следует
 * из времени, значит однажды это рассинхронизировать.
 */
export interface Shockwave {
  born: number
  /** Доля мощности, 0..1. Слабый импульс и светит слабее — иначе вспышка врёт. */
  power: number
}

export interface World {
  time: number

  player: ShipEntity
  ships: ShipEntity[]
  asteroids: AsteroidEntity[]
  pods: CargoPodEntity[]
  missiles: MissileEntity[]
  bodies: BodyEntity[]

  tracers: Tracer[]
  explosions: Explosion[]
  shockwaves: Shockwave[]

  /** Захваченная цель боя. */
  /** Корабль стоит в доке. Мир при этом не шагает: стыковка — это остановка. */
  docked: boolean
  /**
   * Разрешена ли автоматическая стыковка. Отчаливание выпускает корабль ВНУТРИ
   * зоны причала и на скорости ниже стыковочной, поэтому без этого флага шаг мира
   * стыкует его обратно в том же кадре. Взводится снова, когда корабль покинул зону.
   */
  dockArmed: boolean
  lockedTargetId: number | null
  /** Куда летим по навигации. Мост к звёздной карте. */
  navTargetId: number | null

  /** Секунд до следующей попытки выпустить мирный корабль. Темп трафика — в секундах. */
  trafficTimer: number

  /** Сколько мир уже сдвигали. Истинная позиция = pos + originOffset. */
  originOffset: Vector3
  /**
   * Сдвиг, применённый к миру в последнем `stepWorld`. Ноль, если мир не двигали.
   * Камера обязана прибавить его к своей позиции: она живёт в мировых координатах
   * и иначе остаётся в четырёх километрах позади.
   */
  originShift: Vector3

  /** Единственный источник случайности в симуляции. Math.random() в домене запрещён. */
  rng: Rng
  /** Раздача id. Не глобальный счётчик: на сервере миров будет много. */
  ids: IdSource

  systemName: string
  /** Зерно ГАЛАКТИКИ. Все 2500 систем выводятся из него, ничего не хранится. */
  galaxySeed: number
  /** Индекс текущей системы в галактике. Он же вход генератора. */
  systemIndex: number
  /**
   * Счётчик смен системы. Растёт при каждом прыжке.
   *
   * Рендер строит меши тел и пояса один раз при монтировании; узнать, что мир
   * под ним подменили целиком, ему больше неоткуда. Это не «версия для React» —
   * это факт симуляции: миры до и после прыжка не связаны ничем, кроме корабля.
   */
  epoch: number
  credits: number
  score: number
}

