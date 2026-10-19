import { TORUS } from '../config'

/**
 * Живые крутилки облика комнаты-гипертора (панель F4). Стартуют с конфига; подобранное
 * копируется кнопкой и вписывается обратно в `TORUS` — источником правды остаётся конфиг.
 * Только визуальное: на полёт, автопилот и прибытие (они в координатах S³) не влияет.
 */
export const torusTuning = {
  /** Яркость пуфов-галактик (`TORUS.PUFF_INTENSITY`). */
  puff: TORUS.PUFF_INTENSITY as number,
  /** Яркость точек рёбер (`TORUS.DOT_INTENSITY`). */
  dot: TORUS.DOT_INTENSITY as number,
  /** Яркость джетов квазаров (`TORUS.JET_INTENSITY`). */
  jet: TORUS.JET_INTENSITY as number,
  /** Раздвижка узлов (`TORUS.NODE_SPREAD`). */
  spread: TORUS.NODE_SPREAD as number,
}

/** Те же строки, что стоят в `TORUS`, — вставить в конфиг как есть. */
export function torusTuningSnippet(): string {
  const f = (n: number) => String(Math.round(n * 100) / 100)
  return [
    `  NODE_SPREAD: ${f(torusTuning.spread)},`,
    `  PUFF_INTENSITY: ${f(torusTuning.puff)},`,
    `  DOT_INTENSITY: ${f(torusTuning.dot)},`,
    `  JET_INTENSITY: ${f(torusTuning.jet)},`,
  ].join('\n')
}
