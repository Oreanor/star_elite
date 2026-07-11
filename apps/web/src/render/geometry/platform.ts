import type { BufferGeometry } from 'three'
import { buildGeometry, quad, symmetric, type Triangle, type Vec3 } from './build'

/**
 * Пиратская платформа-гнездо — стационарный «авианосец». Широкая плоская палуба
 * (посадочная площадка, на которой дремлет звено пиратов), приземистый несущий
 * корпус под ней, надстройка-«остров» по одному борту, пара ангарных коробок и
 * блок кормовых сопел. Гранёный, промышленный, недружелюбный: холодный серый
 * металл с редкими красно-янтарными ходовыми огнями.
 *
 * Всё строится в ЕДИНИЧНОМ масштабе (габарит порядка 1); настоящий размер задаёт
 * множитель меша (`platform.extent`). Нос смотрит в +Z, корма с соплами — в −Z,
 * ровно как у китов: рендер разворачивает −Z-нос корабля через кватернион сущности.
 *
 * Крупные грани держим крупными — палубу не дробим мелкими треугольниками:
 * коробки и призмы складывают силуэт, плоский шейдинг делает остальное.
 */

// Палитра: корпус — холодный металл трёх оттенков, силовой набор темнее.
// Акценты враждебные: тусклый красный и янтарь — ходовые огни и жар сопел.
const HULL_DARK = 0x3b414c
const HULL = 0x565d68
const HULL_LIGHT = 0x767d88
const PANEL = 0x2b3038
const RED = 0xd2372a
const AMBER = 0xffb15c

/** Прямоугольный короб от `(cx±hx, …)`. Шесть граней, обход наружу. */
function box(c: Vec3, h: Vec3, color: number): Triangle[] {
  const [x, y, z] = c
  const [hx, hy, hz] = h
  const p: Vec3[] = [
    [x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz], [x + hx, y + hy, z - hz], [x - hx, y + hy, z - hz],
    [x - hx, y - hy, z + hz], [x + hx, y - hy, z + hz], [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz],
  ]
  return [
    ...quad(p[4]!, p[5]!, p[6]!, p[7]!, color), // +z
    ...quad(p[1]!, p[0]!, p[3]!, p[2]!, color), // −z
    ...quad(p[5]!, p[1]!, p[2]!, p[6]!, color), // +x
    ...quad(p[0]!, p[4]!, p[7]!, p[3]!, color), // −x
    ...quad(p[7]!, p[6]!, p[2]!, p[3]!, color), // +y
    ...quad(p[0]!, p[1]!, p[5]!, p[4]!, color), // −y
  ]
}

/**
 * Призма вдоль оси Z: `sides`-угольная труба от z0 до z1 с торцами.
 * Ось лежит на (0,0,z); в сечении — правильный многоугольник радиуса `r`.
 */
function prism(sides: number, r: number, z0: number, z1: number, side: number, cap: number): Triangle[] {
  const ring = (z: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2
      return [Math.cos(a) * r, Math.sin(a) * r, z] as Vec3
    })
  const a = ring(z0)
  const b = ring(z1)
  const out: Triangle[] = []
  const c0: Vec3 = [0, 0, z0]
  const c1: Vec3 = [0, 0, z1]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    out.push(...quad(a[i]!, a[j]!, b[j]!, b[i]!, side))
    out.push({ a: a[j]!, b: a[i]!, c: c0, color: cap })
    out.push({ a: b[i]!, b: b[j]!, c: c1, color: cap })
  }
  return out
}

/** Сдвиг набора треугольников. Чистый перенос обход не переворачивает. */
function translate(tris: Triangle[], dx: number, dy: number, dz: number): Triangle[] {
  const m = (v: Vec3): Vec3 => [v[0] + dx, v[1] + dy, v[2] + dz]
  return tris.map((t) => ({ a: m(t.a), b: m(t.b), c: m(t.c), color: t.color }))
}

/**
 * Скошенный нос палубы: плоский ШИРОКИЙ клин от полного сечения на zBase к
 * укороченному и утончённому срезу на zTip. Не игла крейсера — притуплённый
 * авианосный форштевень: палуба сбегает вперёд и чуть сходит на нет.
 */
function deckProw(zBase: number, zTip: number, hxB: number, hxT: number, hyB: number, hyT: number, color: number): Triangle[] {
  const bl: Vec3 = [-hxB, -hyB, zBase]
  const br: Vec3 = [hxB, -hyB, zBase]
  const tr: Vec3 = [hxB, hyB, zBase]
  const tl: Vec3 = [-hxB, hyB, zBase]
  const nbl: Vec3 = [-hxT, -hyT, zTip]
  const nbr: Vec3 = [hxT, -hyT, zTip]
  const ntr: Vec3 = [hxT, hyT, zTip]
  const ntl: Vec3 = [-hxT, hyT, zTip]
  return [
    ...quad(tl, tr, ntr, ntl, color), // верхняя палуба
    ...quad(nbl, nbr, br, bl, color), // днище
    ...quad(br, tr, ntr, nbr, color), // +x борт
    ...quad(tl, bl, nbl, ntl, color), // −x борт
    ...quad(nbl, ntl, ntr, nbr, color), // передний срез
  ]
}

/**
 * Надстройка-«остров» на правом борту, ближе к корме, — как на настоящем
 * авианосце. Ступенчатая рубка с янтарной полосой мостика, мачтой и красным
 * топовым огнём. Асимметрична намеренно: остров у палубы один.
 */
function island(): Triangle[] {
  const x = 0.55
  return [
    box([x, 0.17, -0.15], [0.15, 0.12, 0.3], HULL_LIGHT),
    box([x, 0.32, -0.18], [0.1, 0.05, 0.18], HULL),
    box([x, 0.41, -0.2], [0.06, 0.04, 0.1], HULL_LIGHT),
    box([x, 0.22, 0.02], [0.13, 0.02, 0.02], AMBER), // окна мостика
    box([x, 0.52, -0.2], [0.008, 0.09, 0.008], HULL_LIGHT), // мачта
    box([x, 0.62, -0.2], [0.022, 0.022, 0.022], RED), // топовый огонь
  ].flat()
}

/** Четыре коротких сопла на корме с красным жаром. Пламя гнезда — недоброе. */
function engines(z: number): Triangle[] {
  const out: Triangle[] = []
  for (const x of [-0.36, -0.12, 0.12, 0.36]) {
    out.push(...translate(prism(6, 0.06, z - 0.09, z, PANEL, RED), x, -0.04, 0))
  }
  return out
}

/**
 * Ходовые огни по кромке палубы: чередование тусклого красного и янтарного.
 * Мелкие коробочки-огоньки на левом борту — `symmetric` даёт и правый.
 */
function runningLights(): Triangle[] {
  const out: Triangle[] = []
  const n = 6
  for (let i = 0; i < n; i++) {
    const z = -0.55 + (i / (n - 1)) * 1.15
    out.push(...box([0.86, 0.02, z], [0.012, 0.02, 0.03], i % 2 ? AMBER : RED))
  }
  return symmetric(out)
}

/** Облик 0: авианосец-гнездо. Плоская палуба, остров, ангары, кормовые сопла. */
function carrierPlatform(): Triangle[] {
  const out: Triangle[] = []
  // Плоская широкая палуба — посадочная площадка. Верхнюю грань держим цельной.
  out.push(...box([0, 0, 0], [0.85, 0.05, 0.7], HULL))
  // Притуплённый широкий нос палубы.
  out.push(...deckProw(0.7, 0.97, 0.85, 0.5, 0.05, 0.02, HULL_LIGHT))
  // Несущий корпус под палубой и киль — массивнее и темнее.
  out.push(...box([0, -0.15, -0.05], [0.62, 0.1, 0.58], HULL_DARK))
  out.push(...box([0, -0.26, -0.08], [0.3, 0.06, 0.42], PANEL))
  // Остров по правому борту.
  out.push(...island())
  // Ангарные коробки по левому борту палубы и подсвеченные ворота.
  out.push(...box([-0.5, 0.13, 0.16], [0.24, 0.08, 0.28], HULL))
  out.push(...box([-0.5, 0.12, -0.34], [0.2, 0.07, 0.2], HULL_DARK))
  out.push(...box([-0.5, 0.13, 0.45], [0.16, 0.05, 0.006], AMBER)) // щель ангарных ворот
  // Кормовой блок двигателей и сопла.
  out.push(...box([0, -0.04, -0.8], [0.55, 0.11, 0.08], HULL_DARK))
  out.push(...engines(-0.86))
  // Ходовые огни по ободу палубы.
  out.push(...runningLights())
  return out
}

const BUILDERS = [carrierPlatform]

const cache = new Map<number, BufferGeometry>()

/** Геометрия платформы данного облика. Строится один раз на облик за всю игру. */
export function platformGeometry(variant: number): BufferGeometry {
  const key = variant % BUILDERS.length
  let geometry = cache.get(key)
  if (!geometry) {
    geometry = buildGeometry(BUILDERS[key]!())
    cache.set(key, geometry)
  }
  return geometry
}
