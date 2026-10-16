/**
 * Сумма, какую назовёт живой человек: «три тысячи» или «две с половиной», а не 3254.
 * Шаг растёт с суммой — у мелочи он мелкий, чтобы цена за тонну не слиплась в ноль.
 */
export function roundMoney(credits: number): number {
  const step = credits < 50 ? 1 : credits < 200 ? 10 : credits < 1000 ? 50 : credits < 2000 ? 100 : credits < 10_000 ? 500 : 1000
  // Вниз: называет тот, кто платит, — «три тысячи» за 3254, а не три с половиной.
  return Math.max(step, Math.floor(credits / step) * step)
}
