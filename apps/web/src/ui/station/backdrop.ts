import { localSettlement, type World } from '@elite/sim'

/**
 * Общий фон «экрана» станции — и для консоли, и для окна разговора у причала, чтобы они
 * не расходились. У причала это снимок обзорной палубы (один из десяти по тех-уровню мира)
 * под затемняющим градиентом, чтобы стеклянная панель поверх читалась. В полёте станции
 * под тобой нет — тёмное стекло поверх космоса (блюр вешает вызывающий классом).
 */

/**
 * Какой из 10 снимков станции показать — по тех-уровню мира (1..15): 0 самый захолустный,
 * 9 самый технологичный. Линейно раскидываем 15 уровней на 10 картинок.
 */
function stationImage(techLevel: number): string {
  const idx = Math.max(0, Math.min(9, Math.round(((techLevel - 1) / 14) * 9)))
  return `/stations/station${idx}.webp`
}

export { stationImage }

/** CSS-`background` экрана: снимок станции у причала, тёмное стекло — в полёте. */
export function screenBackground(world: World, docked: boolean): string {
  return docked
    ? `linear-gradient(rgba(4,10,20,0.45), rgba(2,5,12,0.7)), url(${stationImage(localSettlement(world).techLevel)}) center/cover no-repeat`
    : 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))'
}

/**
 * Рецепт «стекла» панели — единый для консоли, модалок и окна разговора. Полупрозрачный
 * синий градиент, тонкая светящаяся рамка и мягкое свечение: панель лежит поверх снимка
 * станции, но остаётся читаемой. Плотность выбрана так, чтобы фон просвечивал, а текст — нет.
 */
export const GLASS_PANEL = {
  borderColor: 'rgba(124,196,255,0.3)',
  background: 'linear-gradient(150deg, rgba(28,62,100,0.82), rgba(6,16,32,0.9))',
  boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
} as const
