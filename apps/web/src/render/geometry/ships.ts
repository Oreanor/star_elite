import type { BufferGeometry } from 'three'
import { PALETTE } from '../config'
import { buildGeometry, quad, symmetric, tri, type Triangle, type Vec3 } from './build'
import { antenna, beam, bell, panel } from './parts'

/**
 * Корпуса кораблей. Нос смотрит в −Z, верх — +Y, правый борт — +X.
 *
 * Пишем только правую половину и зеркалим: силуэт тогда симметричен по построению,
 * а править надо вдвое меньше вершин. Детали, стоящие НА оси (киль, антенна),
 * зеркалить нельзя — две совпадающие грани дадут мерцание в буфере глубины.
 * Поэтому они собираются отдельно и добавляются к готовой симметричной половине.
 *
 * Размеры согласованы с физикой: сфера столкновений «Кобры» — 12 м,
 * значит корпус около 26 м в длину и 24 в размахе. Это не косметика —
 * угловой размер цели решает, возможно ли по ней попасть.
 *
 * Сложность держим в деталях, а не в кривизне: гранёный силуэт остаётся
 * читаемым издали, а расшивка, лючки и сопла работают вблизи. Полигонов
 * это стоит сотни — то есть нисколько: весь класс рисуется одним вызовом.
 */

const {
  HULL,
  HULL_DARK,
  HULL_ACCENT,
  HULL_PANEL,
  HULL_LINE,
  HULL_SHADE,
  HULL_TRIM,
  COCKPIT_GLASS,
  ENGINE,
  ENGINE_CORE,
} = PALETTE

// ─── Cobra Mk III: игрок ─────────────────────────────────────────────────────

// Нос гранёный, а не остриё: фаска ловит свет и не даёт корпусу схлопнуться в клин.
const NOSE_T: Vec3 = [0, 0.5, -14]
const NOSE_B: Vec3 = [0, -0.55, -14]
const NOSE_S: Vec3 = [0.85, -0.05, -13.2]

const CHINE: Vec3 = [2.3, -0.15, -8.4]
const TOP_F: Vec3 = [0, 1.3, -6.4]
const BOT_F: Vec3 = [0, -1.55, -6.0]

const SPINE_F: Vec3 = [0, 1.75, -1.0]
const SPINE_B: Vec3 = [0, 1.95, 6.2]
const SHOULDER: Vec3 = [3.2, 0.75, -3.0]
const HIP: Vec3 = [3.2, -1.05, -3.0]
const BOT_M: Vec3 = [0, -1.6, 0]
const BOT_B: Vec3 = [0, -1.35, 6.6]

const AFT_TOP: Vec3 = [2.6, 1.5, 9.4]
const AFT_BOT: Vec3 = [2.6, -1.2, 9.4]
const AFT_T0: Vec3 = [0, 1.9, 9.4]
const AFT_B0: Vec3 = [0, -1.3, 9.4]

// Крыло — плита с толщиной, а не бумажный лист: у него есть кромки, и они блестят.
const WT_ROOT_F: Vec3 = [3.2, 0.35, -2.6]
const WT_TIP_F: Vec3 = [11.8, 0.1, 6.3]
const WT_TIP_B: Vec3 = [10.6, 0.1, 9.4]
const WT_ROOT_B: Vec3 = [2.6, 0.4, 9.4]
const WB_ROOT_F: Vec3 = [3.2, -0.45, -2.6]
const WB_TIP_F: Vec3 = [11.8, -0.1, 6.3]
const WB_TIP_B: Vec3 = [10.6, -0.1, 9.4]
const WB_ROOT_B: Vec3 = [2.6, -0.5, 9.4]

const CAN_F: Vec3 = [0, 1.7, -5.6]
const CAN_B: Vec3 = [0, 2.0, 0.7]
const CAN_SF: Vec3 = [1.15, 1.3, -5.2]
const CAN_SB: Vec3 = [1.35, 1.6, 1.0]

const cobraHalf: Triangle[] = [
  // ─ Нос: фаска сверху, снизу и по скуле.
  tri(NOSE_T, NOSE_S, TOP_F, HULL),
  tri(TOP_F, NOSE_S, CHINE, HULL),
  tri(NOSE_B, BOT_F, NOSE_S, HULL_DARK),
  tri(NOSE_S, BOT_F, CHINE, HULL_DARK),
  tri(NOSE_T, NOSE_B, NOSE_S, HULL_ACCENT),

  // ─ Фюзеляж.
  ...quad(TOP_F, CHINE, SHOULDER, SPINE_F, HULL),
  ...quad(SPINE_F, SHOULDER, AFT_TOP, SPINE_B, HULL),
  ...quad(BOT_F, BOT_M, HIP, CHINE, HULL_DARK),
  ...quad(BOT_M, BOT_B, AFT_BOT, HIP, HULL_DARK),
  // Борт светлее днища: звезда бьёт по нему вскользь, а не с торца.
  tri(CHINE, SHOULDER, HIP, HULL_SHADE),
  ...quad(SHOULDER, HIP, AFT_BOT, AFT_TOP, HULL_SHADE),

  // ─ Расшивка и лючки. Приподняты над несущей гранью — иначе мерцают.
  ...panel([0.6, 1.55, -0.4], [2.1, 1.35, -0.4], [2.1, 1.45, 2.6], [0.6, 1.65, 2.6], HULL_PANEL, [0, 0.05, 0]),
  ...panel([0.6, 1.6, 3.2], [2.2, 1.45, 3.2], [2.2, 1.47, 3.5], [0.6, 1.62, 3.5], HULL_LINE, [0, 0.05, 0]),
  ...panel([0.6, 1.68, 5.0], [2.3, 1.5, 5.0], [2.3, 1.52, 5.3], [0.6, 1.7, 5.3], HULL_LINE, [0, 0.05, 0]),
  ...panel([3.24, 0.3, -1.4], [3.24, -0.6, -1.4], [3.24, -0.7, 2.0], [3.24, 0.25, 2.0], HULL_PANEL, [0.04, 0, 0]),
  ...panel([0.6, -1.5, 1.0], [2.4, -1.35, 1.0], [2.4, -1.33, 1.3], [0.6, -1.48, 1.3], HULL_LINE, [0, -0.05, 0]),

  // ─ Кабина: тёмное стекло с обрамлением. Единственная деталь силуэта.
  tri(CAN_F, CAN_SF, CAN_SB, COCKPIT_GLASS),
  tri(CAN_F, CAN_SB, CAN_B, COCKPIT_GLASS),
  ...panel(CAN_SF, [1.45, 1.22, -5.1], [1.65, 1.52, 1.1], CAN_SB, HULL_LINE, [0, 0.02, 0]),

  // ─ Крыло. Три кромки — передняя, задняя, законцовка — своим цветом: узкая грань
  //   без затемнения сливается с плитой, из которой торчит, и крыло теряет толщину.
  ...quad(WT_ROOT_F, WT_TIP_F, WT_TIP_B, WT_ROOT_B, HULL),
  ...quad(WB_ROOT_F, WB_ROOT_B, WB_TIP_B, WB_TIP_F, HULL_DARK),
  ...quad(WT_ROOT_F, WB_ROOT_F, WB_TIP_F, WT_TIP_F, HULL_ACCENT),
  ...quad(WT_TIP_B, WB_TIP_B, WB_ROOT_B, WT_ROOT_B, HULL_TRIM),
  ...quad(WT_TIP_F, WB_TIP_F, WB_TIP_B, WT_TIP_B, HULL_TRIM),
  // Расшивка вдоль лонжерона и лючок за ней: крыло — самая большая плоскость
  // корабля, и без членения она читается как вырезанная из картона.
  ...panel([3.8, 0.31, 1.8], [6.6, 0.23, 3.6], [6.6, 0.22, 4.2], [3.8, 0.3, 2.4], HULL_LINE, [0, 0.05, 0]),
  ...panel([3.6, 0.32, 5.2], [5.4, 0.27, 5.2], [5.4, 0.26, 7.4], [3.6, 0.31, 7.4], HULL_PANEL, [0, 0.05, 0]),
  // Гребень на крыле: один треугольник, материал двусторонний.
  tri([7.5, 0.15, 3.6], [7.5, 1.15, 5.0], [7.5, 0.15, 6.4], HULL_PANEL),

  // ─ Стволы. Орудие должно быть видно: игрок обязан понимать, откуда летит луч.
  ...beam(1.55, 2.25, -0.6, 0.1, -3.4, -1.4, HULL_DARK),
  ...beam(1.75, 2.05, -0.5, 0.0, -5.4, -3.4, HULL_ACCENT),

  // ─ Пилоны под крылом. Ракета висит на них — пусть подвеска будет видна.
  ...beam(4.9, 5.5, -0.75, -0.35, 2.9, 4.3, HULL_DARK),
  ...beam(7.7, 8.3, -0.65, -0.3, 4.5, 5.9, HULL_DARK),

  // ─ Антенна на борту.
  ...antenna(2.0, [4.6, 1.62], [5.4, 2.9], HULL_LINE),

  // ─ Кормовой срез и сопла. Срез — это торец, а не обшивка: он темнее борта.
  ...quad(AFT_TOP, AFT_BOT, AFT_B0, AFT_T0, HULL_TRIM),
  ...bell(1.45, 0.15, 9.35, 0.95, 1.15, 1.2, 8, ENGINE, ENGINE_CORE),
  ...bell(2.15, -0.85, 9.35, 0.32, 0.42, 0.7, 6, HULL_DARK, ENGINE),
]

/** Детали на оси симметрии. Зеркалить их нельзя: совпадающие грани мерцают. */
const cobraCentre: Triangle[] = [
  // Киль. Единственная деталь на оси, и единственная, что видно строго сверху —
  // ей и достаётся акцент: сверху корабль иначе читается как белое пятно.
  tri([0, 1.95, 6.0], [0, 3.3, 9.2], [0, 1.9, 9.4], HULL_ACCENT),
  // Центральное сопло.
  ...bell(0, 0.2, 9.35, 0.55, 0.7, 1.0, 8, ENGINE, ENGINE_CORE),
]

let cobraCache: BufferGeometry | null = null

/** Геометрия создаётся один раз на модуль, а не на каждый компонент. */
export function cobraGeometry(): BufferGeometry {
  cobraCache ??= buildGeometry([...symmetric(cobraHalf), ...cobraCentre])
  return cobraCache
}

/**
 * Срезы сопел в связанных осях: откуда бьёт струя и какого она радиуса.
 * Живут рядом с геометрией, которая их и породила: сдвинул сопло — сдвинул струю.
 */
export interface Nozzle {
  offset: Vec3
  radius: number
}

export const COBRA_NOZZLES: readonly Nozzle[] = [
  { offset: [0, 0.2, 10.35], radius: 0.7 },
  { offset: [-1.45, 0.15, 10.55], radius: 1.15 },
  { offset: [1.45, 0.15, 10.55], radius: 1.15 },
]

// ─── Sidewinder: пират. Компактный клин, читается издалека как «чужой». ──────

const { ENEMY_HULL, ENEMY_DARK, ENEMY_ACCENT, ENEMY_PANEL, ENEMY_LINE, ENEMY_SHADE, ENEMY_TRIM } = PALETTE

const S_NOSE_T: Vec3 = [0, 0.4, -9]
const S_NOSE_B: Vec3 = [0, -0.4, -9]
const S_NOSE_S: Vec3 = [0.7, 0, -8.4]
const S_TOP: Vec3 = [0, 1.3, 2]
const S_BOT: Vec3 = [0, -1.2, 2]
const S_SHOULDER: Vec3 = [2.4, 0.5, 0]
const S_HIP: Vec3 = [2.4, -0.7, 0]
const S_AFT_TOP: Vec3 = [2.0, 1.1, 6.5]
const S_AFT_BOT: Vec3 = [2.0, -0.9, 6.5]
const S_TOP_BACK: Vec3 = [0, 1.3, 6.5]
const S_BOT_BACK: Vec3 = [0, -1.2, 6.5]

const SWT_ROOT_F: Vec3 = [2.4, 0.15, 0]
const SWT_TIP: Vec3 = [8.9, 0.05, 5.4]
const SWT_ROOT_B: Vec3 = [2.0, 0.2, 6.5]
const SWB_ROOT_F: Vec3 = [2.4, -0.3, 0]
const SWB_TIP: Vec3 = [8.9, -0.2, 5.4]
const SWB_ROOT_B: Vec3 = [2.0, -0.35, 6.5]

const sidewinderHalf: Triangle[] = [
  // ─ Нос с фаской.
  tri(S_NOSE_T, S_NOSE_S, S_TOP, ENEMY_HULL),
  tri(S_NOSE_B, S_BOT, S_NOSE_S, ENEMY_DARK),
  tri(S_NOSE_T, S_NOSE_B, S_NOSE_S, ENEMY_ACCENT),
  tri(S_NOSE_S, S_TOP, S_SHOULDER, ENEMY_HULL),
  tri(S_NOSE_S, S_HIP, S_BOT, ENEMY_DARK),
  tri(S_NOSE_S, S_SHOULDER, S_HIP, ENEMY_ACCENT),

  // ─ Фюзеляж.
  ...quad(S_TOP, S_SHOULDER, S_AFT_TOP, S_TOP_BACK, ENEMY_HULL),
  ...quad(S_BOT, S_BOT_BACK, S_AFT_BOT, S_HIP, ENEMY_DARK),
  // Борт светлее днища — та же логика, что у «Кобры»: он освещён вскользь.
  ...quad(S_SHOULDER, S_HIP, S_AFT_BOT, S_AFT_TOP, ENEMY_SHADE),

  // ─ Расшивка и лючок.
  ...panel([0.5, 1.28, 2.6], [1.7, 1.18, 2.6], [1.7, 1.15, 4.4], [0.5, 1.25, 4.4], ENEMY_PANEL, [0, 0.05, 0]),
  ...panel([0.5, 1.24, 4.9], [1.8, 1.14, 4.9], [1.8, 1.13, 5.2], [0.5, 1.23, 5.2], ENEMY_LINE, [0, 0.05, 0]),
  ...panel([2.44, 0.4, 1.2], [2.44, -0.55, 1.2], [2.44, -0.6, 3.4], [2.44, 0.35, 3.4], ENEMY_PANEL, [0.04, 0, 0]),

  // ─ Крыло-плита. Треугольное в плане: у «Сайдвиндера» нет законцовки.
  tri(SWT_ROOT_F, SWT_TIP, SWT_ROOT_B, ENEMY_HULL),
  tri(SWB_ROOT_F, SWB_ROOT_B, SWB_TIP, ENEMY_DARK),
  ...quad(SWT_ROOT_F, SWB_ROOT_F, SWB_TIP, SWT_TIP, ENEMY_ACCENT),
  ...quad(SWT_TIP, SWB_TIP, SWB_ROOT_B, SWT_ROOT_B, ENEMY_TRIM),
  // Расшивка и лючок на крыле: у пирата плита меньше, хватает двух накладок.
  ...panel([3.2, 0.16, 2.2], [5.4, 0.12, 3.4], [5.4, 0.11, 3.8], [3.2, 0.15, 2.6], ENEMY_LINE, [0, 0.05, 0]),
  ...panel([3.0, 0.16, 4.2], [4.4, 0.13, 4.6], [4.4, 0.12, 5.4], [3.0, 0.15, 5.0], ENEMY_PANEL, [0, 0.05, 0]),

  // ─ Ствол и пилон.
  ...beam(1.25, 1.75, -0.45, 0.05, -2.6, -0.8, ENEMY_DARK),
  ...beam(3.5, 4.1, -0.55, -0.25, 1.9, 3.3, ENEMY_DARK),

  // ─ Антенна.
  ...antenna(1.2, [3.0, 1.2], [3.6, 2.2], ENEMY_LINE),

  // ─ Корма и сопло. Срез — торец, не обшивка.
  ...quad(S_AFT_TOP, S_AFT_BOT, S_BOT_BACK, S_TOP_BACK, ENEMY_TRIM),
  ...bell(1.1, 0.1, 6.45, 0.62, 0.78, 0.9, 8, ENGINE, ENGINE_CORE),
]

const sidewinderCentre: Triangle[] = [
  // Киль пирата — тоже акцент: сверху его силуэт иначе не отличить от «Кобры».
  tri([0, 1.3, 3.6], [0, 2.5, 6.3], [0, 1.28, 6.5], ENEMY_ACCENT),
]

let sidewinderCache: BufferGeometry | null = null

export function sidewinderGeometry(): BufferGeometry {
  sidewinderCache ??= buildGeometry([...symmetric(sidewinderHalf), ...sidewinderCentre])
  return sidewinderCache
}

export const SIDEWINDER_NOZZLES: readonly Nozzle[] = [
  { offset: [-1.1, 0.1, 7.35], radius: 0.78 },
  { offset: [1.1, 0.1, 7.35], radius: 0.78 },
]

// ─── Ракета ──────────────────────────────────────────────────────────────────
//
// Заведомо крупнее калибра. Настоящая ракета длиной метр-полтора на дистанции
// в километр занимает доли пикселя: игрок физически не видит, что в него летит,
// и «уворачиваться от ракет» превращается в угадывание. Восемь метров — это
// сознательная ложь ради читаемости, и она стоит дешевле, чем непонятная смерть.

const M_NOSE: Vec3 = [0, 0, -4.6]
const M_SHOULDER_R: Vec3 = [0.75, 0, -2.6]
const M_SHOULDER_T: Vec3 = [0, 0.75, -2.6]
const M_TAIL_R: Vec3 = [0.75, 0, 3.0]
const M_TAIL_T: Vec3 = [0, 0.75, 3.0]
/** Юбка сопла: срез шире корпуса, и на нём видно пламя. */
const M_SKIRT_R: Vec3 = [0.95, 0, 4.0]
const M_SKIRT_T: Vec3 = [0, 0.95, 4.0]

let missileCache: BufferGeometry | null = null

/** Четырёхгранная игла: на скорости 420 м/с деталей всё равно не разглядеть. */
export function missileGeometry(): BufferGeometry {
  if (missileCache) return missileCache

  const quarter: Triangle[] = [
    tri(M_NOSE, M_SHOULDER_R, M_SHOULDER_T, HULL),
    ...quad(M_SHOULDER_R, M_TAIL_R, M_TAIL_T, M_SHOULDER_T, PALETTE.MISSILE),
    // Полоса-опознаватель: на белом корпусе видно, что это не обломок.
    ...panel([0.76, 0, -1.6], [0, 0.76, -1.6], [0, 0.76, -0.6], [0.76, 0, -0.6], HULL_ACCENT, [0.03, 0.03, 0]),
    /**
     * Стабилизатор: без него ракета выглядит гвоздём.
     *
     * Размах 1.35 м, не 2.4: верхнее перо торчало выше пилона и протыкало крыло
     * насквозь. Ракета вдобавок стала легче на вид — крупное оперение делало
     * её похожей на самолёт, а она игла.
     */
    tri([0.62, 0, 2.0], [1.35, 0, 3.8], [0.62, 0, 3.6], HULL_LINE),
    // Раструб сопла и жерло.
    ...quad(M_TAIL_R, M_SKIRT_R, M_SKIRT_T, M_TAIL_T, HULL_DARK),
    tri(M_SKIRT_R, [0, 0, 3.8], M_SKIRT_T, ENGINE_CORE),
  ]

  // Четыре поворота вокруг оси Z дают полную иглу из одной четверти.
  const all: Triangle[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const rot = ([x, y, z]: Vec3): Vec3 => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
      z,
    ]
    all.push(...quarter.map((t) => tri(rot(t.a), rot(t.b), rot(t.c), t.color)))
  }
  missileCache = buildGeometry(all)
  return missileCache
}

/** Сопло ракеты. Радиус великоват для калибра — иначе факел не видно издали. */
export const MISSILE_NOZZLE: Nozzle = { offset: [0, 0, 4.0], radius: 1.35 }

// ─── БПЛА «Оса» ──────────────────────────────────────────────────────────────
//
// Три метра в поперечнике: на дистанции боя это несколько пикселей. Поэтому
// силуэт, а не детали — гранёное ядро, два крылышка-плиты и сопло. Расшивку
// сюда класть незачем: её не увидит никто, а полигоны сожрёт.

const D_NOSE: Vec3 = [0, 0, -3.0]
const D_TOP: Vec3 = [0, 0.55, -0.4]
const D_BOT: Vec3 = [0, -0.5, -0.2]
const D_SIDE: Vec3 = [0.75, 0.0, -0.3]
const D_TAIL_T: Vec3 = [0, 0.45, 2.0]
const D_TAIL_B: Vec3 = [0, -0.4, 2.0]
const D_TAIL_S: Vec3 = [0.6, 0.0, 2.0]

/** Крылышко-плита. Оно же радиатор: аппарат греется сильнее, чем остывает. */
const D_WING_ROOT_F: Vec3 = [0.6, 0.05, -0.2]
const D_WING_ROOT_B: Vec3 = [0.6, 0.05, 1.5]
const D_WING_TIP: Vec3 = [2.3, 0.05, 1.1]

const droneHalf: Triangle[] = [
  tri(D_NOSE, D_SIDE, D_TOP, HULL),
  tri(D_NOSE, D_BOT, D_SIDE, HULL_DARK),
  ...quad(D_TOP, D_SIDE, D_TAIL_S, D_TAIL_T, HULL_SHADE),
  ...quad(D_SIDE, D_BOT, D_TAIL_B, D_TAIL_S, HULL_DARK),

  tri(D_WING_ROOT_F, D_WING_TIP, D_WING_ROOT_B, HULL_ACCENT),
  tri(D_WING_ROOT_F, D_WING_ROOT_B, D_WING_TIP, HULL_TRIM),

  // Торец кормы: срез, а не обшивка.
  ...quad(D_TAIL_T, D_TAIL_S, D_TAIL_B, D_TAIL_B, HULL_TRIM),
]

const droneCentre: Triangle[] = [...bell(0, 0.0, 2.05, 0.28, 0.36, 0.5, 6, ENGINE, ENGINE_CORE)]

let droneCache: BufferGeometry | null = null

export function droneGeometry(): BufferGeometry {
  droneCache ??= buildGeometry([...symmetric(droneHalf), ...droneCentre])
  return droneCache
}

export const DRONE_NOZZLES: readonly Nozzle[] = [{ offset: [0, 0, 2.05], radius: 0.34 }]

// ─── Тяжёлый грузовик «Тип-9» ────────────────────────────────────────────────
//
// Не клин, а КИРПИЧ: гружёная баржа выглядит гружёной баржей. Силуэт собран из
// фаски-коробки (гранёный, но не остроносый), надстройки-рубки у носа, блока
// двигателей с батареей сопел и навесных контейнеров по бортам. Читается издалека
// как «большой и медленный», вблизи держит взгляд расшивкой и обвесом.
//
// Сфера столкновений — 34 м, значит корпус около 60 м в длину: втрое длиннее «Кобры».

/** Полупрофиль сечения (правый борт, сверху вниз): фаска-коробка ширины w. */
function freighterRing(w: number, yT: number, yB: number, c: number, z: number): Vec3[] {
  return [
    [0, yT, z],       // конёк
    [w - c, yT, z],   // плечо крыши
    [w, yT - c, z],   // верх борта
    [w, yB + c, z],   // низ борта
    [w - c, yB, z],   // скула днища
    [0, yB, z],       // киль
  ]
}

// Пять станций по длине: тупой нос → полный корпус → корма. Туша раздаётся к середине.
const F_S0 = freighterRing(5.5, 3.0, -2.6, 1.6, -30)
const F_S1 = freighterRing(11.5, 5.4, -5.0, 2.6, -20)
const F_S2 = freighterRing(14.0, 6.6, -6.2, 3.0, -4)
const F_S3 = freighterRing(13.6, 6.4, -6.2, 3.0, 20)
const F_S4 = freighterRing(12.4, 5.8, -5.6, 2.8, 28)

// Цвет по поясам: крыша светлая, борт вскользь освещён, днище тёмное.
const F_BAND = [HULL, HULL, HULL_SHADE, HULL_DARK, HULL_DARK] as const

/** Сшить две станции боковыми гранями (правый борт). Пояса красятся по F_BAND. */
function freighterSkin(a: Vec3[], b: Vec3[]): Triangle[] {
  const out: Triangle[] = []
  for (let i = 0; i < 5; i++) out.push(...quad(a[i]!, a[i + 1]!, b[i + 1]!, b[i]!, F_BAND[i]!))
  return out
}

/** Торцевая заглушка станции: веер на обе стороны от осевой линии. Полная, не зеркалим. */
function freighterCap(s: Vec3[], z: number, color: number): Triangle[] {
  const cy = (s[0]![1] + s[5]![1]) / 2
  const centre: Vec3 = [0, cy, z]
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]
  const out: Triangle[] = []
  for (let i = 0; i < 5; i++) {
    out.push(tri(centre, s[i]!, s[i + 1]!, color))
    out.push(tri(centre, mir(s[i + 1]!), mir(s[i]!), color))
  }
  return out
}

const freighterHalf: Triangle[] = [
  // ─ Обшивка корпуса: четыре пролёта между станциями.
  ...freighterSkin(F_S0, F_S1),
  ...freighterSkin(F_S1, F_S2),
  ...freighterSkin(F_S2, F_S3),
  ...freighterSkin(F_S3, F_S4),

  // ─ Навесные контейнеры по борту: грузовик тащит груз и снаружи. Три блока —
  //   их и видно как «баржа», и на них ложится расшивка. Смещены за обвод борта.
  ...beam(13.5, 16.5, 2.2, 5.0, -6, 2, HULL_TRIM),
  ...beam(13.5, 16.5, -1.4, 1.4, -6, 2, HULL_PANEL),
  ...beam(13.5, 16.5, 2.2, 5.0, 4, 12, HULL_PANEL),
  ...beam(13.5, 16.5, -1.4, 1.4, 4, 12, HULL_TRIM),
  // Крепёжная балка вдоль контейнеров: без неё они висят в воздухе.
  ...beam(12.6, 13.6, -0.4, 0.6, -7, 13, HULL_DARK),

  // ─ Расшивка на борту и на крыше.
  ...panel([4, 6.7, -2], [10, 6.6, -2], [10, 6.55, 6], [4, 6.65, 6], HULL_PANEL, [0, 0.06, 0]),
  ...panel([13.0, 3.0, -4], [13.0, -3.2, -4], [13.0, -3.4, 14], [13.0, 2.8, 14], HULL_LINE, [0.06, 0, 0]),

  // ─ Антенна на борту рубки.
  ...antenna(6.5, [-11, 6.4], [-9.5, 9.2], HULL_LINE),
]

const freighterCentre: Triangle[] = [
  // ─ Торцы: нос тупой, корма — плита под сопла.
  ...freighterCap(F_S0, -30, HULL_ACCENT),
  ...freighterCap(F_S4, 28, HULL_TRIM),

  // ─ Рубка-надстройка у носа: приподнятый блок с остеклением по фронту.
  ...beam(-4.5, 4.5, 6.4, 10.4, -22, -12, HULL),
  // Скошенный лоб рубки со «стеклом»: единственная тёмная деталь силуэта сверху.
  ...quad([-4.2, 10.2, -21.6], [4.2, 10.2, -21.6], [4.6, 8.2, -23.4], [-4.6, 8.2, -23.4], COCKPIT_GLASS),
  ...panel([-4.2, 10.25, -21], [4.2, 10.25, -21], [4.2, 10.2, -13], [-4.2, 10.2, -13], HULL_LINE, [0, 0.06, 0]),

  // ─ Дорсальный хребет-магистраль: труба вдоль спины от рубки к корме.
  ...beam(-1.2, 1.2, 6.6, 8.0, -12, 24, HULL_DARK),

  // ─ Блок двигателей: широкая тумба на корме, из неё бьёт батарея сопел.
  ...beam(-11, 11, -5.4, 5.6, 26, 31, HULL_DARK),
  ...bell(-6.5, 0, 30.8, 1.5, 2.0, 2.4, 8, ENGINE, ENGINE_CORE),
  ...bell(0, 0, 30.8, 1.7, 2.3, 2.6, 8, ENGINE, ENGINE_CORE),
  ...bell(6.5, 0, 30.8, 1.5, 2.0, 2.4, 8, ENGINE, ENGINE_CORE),
]

let freighterCache: BufferGeometry | null = null

export function freighterGeometry(): BufferGeometry {
  freighterCache ??= buildGeometry([...symmetric(freighterHalf), ...freighterCentre])
  return freighterCache
}

export const FREIGHTER_NOZZLES: readonly Nozzle[] = [
  { offset: [-6.5, 0, 33.2], radius: 2.0 },
  { offset: [0, 0, 33.2], radius: 2.3 },
  { offset: [6.5, 0, 33.2], radius: 2.0 },
]
