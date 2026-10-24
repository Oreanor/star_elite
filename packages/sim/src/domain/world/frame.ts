import type { Vector3 } from 'three'
import type { World } from './entities'
import { shiftTrail } from './poseTrail'
import { shiftAIState } from '../ai/types'

/**
 * ПЕРЕНОС ОКРЕСТНОСТИ — всего, что рождается и живёт вокруг игрока: трафик (с памятью их
 * пилотов), камни, контейнеры, ракеты, болты, киты, гнёзда, следы выстрелов, вспышки, порталы.
 *
 * Один список на оба переноса мира: перецентровку плавающего начала (`maybeShiftOrigin`) и
 * езду с опорой игрока по орбите (`stepOrbits`). Прежде у каждого был свой ручной список — и
 * расходились они ровно так, как расходятся копии: в орбитальном забыли пилотов ботов (точки
 * патруля и память о цели уплывали на десятки км/с), гиперпортал ехал не той системой отсчёта.
 * НОВЫЙ СПИСОК С МЕСТОМ В МИРЕ — НОВАЯ СТРОКА ЗДЕСЬ, и оба переноса получат его разом.
 *
 * Тела, статуи двора, военные базы и статуэтки — не окрестность: у них своя система отсчёта
 * (орбита, причал, якорь), и каждый перенос решает о них сам.
 */
export function translateNeighborhood(world: World, shift: Vector3): void {
  for (const s of world.ships) {
    s.state.pos.add(shift)
    shiftTrail(s.state, shift)
    if (s.ai) shiftAIState(s.ai, shift)
  }
  for (const a of world.asteroids) {
    a.pos.add(shift)
    shiftTrail(a, shift)
  }
  for (const p of world.pods) {
    p.pos.add(shift)
    shiftTrail(p, shift)
  }
  for (const m of world.missiles) {
    m.pos.add(shift)
    shiftTrail(m, shift)
  }
  // Болты — снаряды в полёте. Перенос случается и посреди боя: без него очередь телепортируется.
  for (const b of world.bolts) {
    b.pos.add(shift)
    shiftTrail(b, shift)
  }
  // Шар разбивающего лазера — тоже снаряд окрестности.
  for (const p of world.pulses) p.pos.add(shift)
  for (const t of world.titans) {
    t.pos.add(shift)
    shiftTrail(t, shift)
  }
  for (const p of world.platforms) {
    p.pos.add(shift)
    shiftTrail(p, shift)
  }
  for (const t of world.tracers) {
    t.from.add(shift)
    t.to.add(shift)
  }
  for (const e of world.explosions) e.pos.add(shift)
  // Ударная волна сноса базы живёт секунды и в километровом масштабе — перенос её не минует.
  for (const w of world.blastwaves) w.pos.add(shift)
  // Живут доли секунды, но перенос может прийтись ровно на них — и вспышка мигнёт не там.
  for (const w of world.warps) w.pos.add(shift)
  for (const p of world.warpPortals) p.pos.add(shift)
  // Устье гиперпортала открывается перед носом игрока и обязано ехать с ним: у планеты или в
  // открытом космосе иначе кольцо уносило разностью орбитальных скоростей — сотни метров за кадр.
  for (const gate of world.jumpGates) gate.pos.add(shift)
  for (const s of world.warShards) s.pos.add(shift)
  for (const f of world.firePuffs) f.pos.add(shift)
  for (const f of world.shieldFlashes) {
    f.pos.add(shift)
    f.center.add(shift)
  }
  // `shockwaves` нет намеренно: у вспышки бомбы нет места в мире — это экранный эффект.
  // `muzzleFlashes` и `beams` держатся за стрелка и едут вместе с ним сами.
}

/** Перенести игрока (и его автобой) — смена системы отсчёта, а не ход: след едет с ним. */
export function translatePlayer(world: World, shift: Vector3): void {
  const p = world.player
  p.state.pos.add(shift)
  shiftTrail(p.state, shift)
  if (p.ai) shiftAIState(p.ai, shift)
}
