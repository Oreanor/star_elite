/**
 * Перевод ДАННЫХ на один язык: товары, модули, расы, звёзды, профессии — по `id` или по
 * русскому слову-канону. Файл на язык, а не таблица со всеми языками: так грузится только
 * язык игрока (см. `loadLang`), а остальные шесть не едут в стартовый бандл.
 *
 * Файлы `data/<язык>.ts` СГЕНЕРИРОВАНЫ из канона (English + машинный перевод на остальные);
 * нет строки — вызывающий откатывается на доменный русский канон.
 */
export interface LangData {
  commodity: Record<string, string>
  commodityDesc: Record<string, string>
  figurineTitle: Record<string, string>
  module: Record<string, string>
  species: Record<string, string>
  starClass: Record<string, string>
  galaxyShape: Record<string, string>
  occupation: Record<string, string>
  occupationFaction: Record<string, string>
  profession: Record<string, string>
  place: Record<string, string>
  stationType: Record<string, string>
  /** «Пилот» — род занятий, когда ни вид, ни фракция ничего не подсказали. */
  pilot: string
  /** Профессия, когда домен её не назвал. */
  professionFallback: string
}
