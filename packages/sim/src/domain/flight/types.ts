import { Quaternion, Vector3 } from 'three'

/** Лётные характеристики. Данные — единственное, чем отличаются корабли. */
export interface ShipTuning {
  MASS: number // т
  THRUST: number // кН
  MAX_SPEED: number // м/с
  /** Боковая тяга маневровых, кН. Ускорение вбок = STRAFE_THRUST / масса. */
  STRAFE_THRUST: number
  /** Установившаяся угловая скорость при полном отклонении, рад/с. */
  PITCH_RATE: number
  YAW_RATE: number
  ROLL_RATE: number
  /** Угловое ускорение, рад/с². Задаёт «тяжесть» носа. */
  PITCH_ACCEL: number
  YAW_ACCEL: number
  ROLL_ACCEL: number
  /** Демпфирование при отпущенном управлении, 1/с. */
  ANG_DAMP: number
  /** Flight assist. */
  ASSIST_LATERAL_DAMP: number // 1/с
  ASSIST_SPEED_DAMP: number // 1/с
}

/**
 * Единственный вход физики. Всё нормализовано в [-1,1] — это «отклонение ручки»,
 * а не угол. И игрок, и бот заполняют ровно эту структуру: физика их не различает.
 */
export interface ShipControls {
  /** +1 — нос вверх. */
  pitch: number
  /** +1 — нос вправо. */
  yaw: number
  /** Прямой крен. Обычно 0: креном управляет автокоординация. Перебивает её, если ≠ 0. */
  roll: number
  /** Руль направления: плоский разворот без крена. */
  rudder: number
  /**
   * Тяга маневровых поперёк носа, в СВЯЗАННЫХ осях: `strafe` вправо, `strafeUp` вверх.
   * Оба в [-1,1]; длина вектора зажата единицей, иначе по диагонали тяга больше.
   *
   * Две оси, а не одна, потому что этого требует «бочка». Корабль в ней вращается
   * вокруг носа, и односная боковая тяга вращается вместе с ним — за полный оборот
   * она чертит окружность радиусом a/ω² (около трёх метров) и возвращает корабль
   * на прежнюю линию. Чтобы уйти вбок по-настоящему, надо держать тягу в
   * НЕПОДВИЖНОМ направлении, а для этого маневровые обязаны уметь толкать и вверх.
   *
   * Пока тяга приложена, лётный компьютер не гасит боковой снос: иначе он съедал бы
   * ровно тот манёвр, который ему скомандовали.
   */
  strafe: number
  strafeUp: number
  /** Доля максимальной тяги, 0..1. */
  throttle: number
  /** Множитель тяги форсажа. 1 — выключен. */
  boost: number
  /**
   * Множитель крейсерского хода, 1..CRUISE.MAX_FACTOR.
   * Для физики это просто ещё один множитель тяги и потолка скорости —
   * никакого особого режима в интеграторе нет. Всю логику разгона,
   * блокировки и торможения у планет ведёт domain/cruise.
   */
  cruise: number
  /** Ретро-тяга, 0..1. */
  retro: number
  /** Гасить снос. false => чистый ньютоновский дрейф. */
  flightAssist: boolean
}

export function createControls(): ShipControls {
  return {
    pitch: 0,
    yaw: 0,
    roll: 0,
    rudder: 0,
    strafe: 0,
    strafeUp: 0,
    throttle: 0,
    boost: 1,
    cruise: 1,
    retro: 0,
    flightAssist: true,
  }
}

/** Состояние твёрдого тела в мировых координатах. */
export interface ShipState {
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  /** Угловая скорость в СВЯЗАННЫХ осях: x — тангаж, y — рыскание, z — крен. */
  angVel: Vector3
}

export function createShipState(pos = new Vector3(), quat = new Quaternion()): ShipState {
  return {
    pos: pos.clone(),
    vel: new Vector3(),
    quat: quat.clone(),
    angVel: new Vector3(),
  }
}
