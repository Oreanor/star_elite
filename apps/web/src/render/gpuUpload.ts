import type { BufferAttribute, InstancedMesh } from 'three'

/**
 * Залить в видеокарту только ЗАНЯТУЮ часть динамического буфера.
 *
 * Буферы эффектов, камней и точек выделены один раз под максимум (CLAUDE.md), а занята
 * обычно малая доля. Голое `needsUpdate = true` заставляет three лить в GPU ВЕСЬ массив,
 * сколько бы из него ни рисовалось. Замер в полёте: 3.6 МБ за кадр через `bufferSubData`,
 * из них 1.75 МБ — точки дальнего пояса (4 пояса × 16 000 под запас) и по 64 КБ на каждый
 * пустой меш эффектов. Диапазон обновления ограничивает заливку первыми `count` элементами.
 *
 * `count = 0` — не льём ничего: рисовать всё равно нечего (count / drawRange = 0), а пустой
 * список диапазонов three понял бы как «весь буфер».
 */
export function uploadFirst(attribute: BufferAttribute, count: number): void {
  if (count <= 0) return
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, count * attribute.itemSize)
  attribute.needsUpdate = true
}

/**
 * Инстансы к отрисовке: число и заливка только живых матриц. `colors` — цвета инстансов
 * переписаны в этом же кадре и тоже уходят (только первые `count`).
 *
 * Пустой меш ещё и ПРЯЧЕТСЯ. three отменяет вызов с нулём инстансов лишь в самом конце —
 * после смены программы, заливки uniform'ов и настройки вершинных атрибутов. Пустых мешей
 * эффектов в мирном полёте десятки, и замер давал ~120 мкс на «вызов» при 49 настоящих
 * отрисовках: остальное было подготовкой к рисованию ничего. Невидимый объект three
 * пропускает ещё при обходе сцены. Кто прячет меш сам, делает это до заливки и выходит.
 */
export function commitInstances(mesh: InstancedMesh, count: number, colors = false): void {
  mesh.count = count
  mesh.visible = count > 0
  uploadFirst(mesh.instanceMatrix, count)
  if (colors && mesh.instanceColor) uploadFirst(mesh.instanceColor, count)
}
