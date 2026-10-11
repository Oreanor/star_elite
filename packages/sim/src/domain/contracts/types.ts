/**
 * ДЕЛО — то, о чём договорились с бортом из трафика. Домен хранит карточку целиком: что,
 * кому, от кого, когда, сколько и в каком состоянии; он же проверяет выполнение и платит.
 * LLM только озвучивает и распознаёт «берусь / нет» — иначе модель насочиняет наград, а без
 * детерминизма не собрать ни сеть, ни повтор (см. `docs/PLAN_contracts.md`).
 *
 * Вид дела — данные (член союза), а не ветка в шаге мира: новый вид — новый член здесь,
 * строка в таблице ролей (`offers.ts`) и обработчик проверки (`contracts.ts`).
 */
export type ContractKind = 'rescue' | 'deliver' | 'fetch' | 'escort' | 'hunt' | 'demolish'

/** Что именно предлагается — общее для оферты и дела. */
export type ContractTerms =
  /** Взять у него груз и отвезти на станцию в системе `toSystem`. Награда — за всю партию. */
  | { kind: 'deliver'; commodityId: string; units: number; toSystem: number; toSystemName: string }
  /** Привезти товар на станцию этой системы. Награда — ЗА ТОННУ, сдают частями. */
  | { kind: 'fetch'; commodityId: string; units: number }
  /** Довести его самого до станции в системе `toSystem`, прикрывая в пути. */
  | { kind: 'escort'; toSystem: number; toSystemName: string }
  /** Спасти его от нападающих прямо сейчас. */
  | { kind: 'rescue'; attackers: number[] }
  /** Убрать названных пиратов в этой системе. Награда — ЗА ГОЛОВУ. */
  | { kind: 'hunt'; heads: number }
  /** Снести пиратское гнездо в этой системе. Платят целиком — за результат. */
  | { kind: 'demolish' }

/**
 * Оферта на борту. Не согласился, борт улетел — предложение исчезло вместе с ним, и это
 * честно. Согласился — переезжает в дело (`Contract`), а борт становится знакомым.
 */
export type ContractOffer = ContractTerms & {
  /** Награда, кредиты (за тонну у `fetch`, за голову у `hunt`, иначе за всё). */
  reward: number
  /** Срок в игровых сутках; null — здесь и сейчас (дело живёт, пока ты в системе). */
  days: number | null
  /** Игрок уже слышал оферту (спросил сам или ответил на вызов). */
  revealed: boolean
}

export type ContractStatus = 'active' | 'done' | 'failed'

/** Почему дело закрыто — для журнала и вести на HUD. */
export type ContractEnd =
  | 'completed' // сделано, заплачено
  | 'partial' // сделано не всё, заплачено за сделанное
  | 'expired' // вышел срок
  | 'abandoned' // ушёл из системы, бросив дело
  | 'client-lost' // клиент погиб — платить некому, отношение не страдает
  | 'empty' // цель ушла или её убрал другой — премии нет, отношение не страдает

/** Состояние исполнения: счёт сделанного и ссылки на цели в мире. */
export type ContractProgress =
  | { kind: 'deliver' }
  | { kind: 'fetch'; delivered: number }
  | { kind: 'escort' }
  /** Номер захода в систему (`world.epoch`): ушёл — дело брошено. */
  | { kind: 'rescue'; epoch: number; clientShipId: number }
  | {
      kind: 'hunt'
      epoch: number
      targets: number[]
      resolved: number[]
      kills: number
      /** Цели рождает хозяин системы (дело взято у его бота) — ждём, пока он скажет, какие. */
      pending?: boolean
    }
  | { kind: 'demolish'; epoch: number; platformId: number; pending?: boolean }

export interface Contract {
  id: number
  terms: ContractTerms
  progress: ContractProgress
  status: ContractStatus
  end: ContractEnd | null
  /** Заказчик — запись знакомства. */
  giverId: number
  giverName: string
  /** Галактика и система, где взято дело: в чужой галактике тот же номер — чужая система. */
  galaxySeed: number
  systemIndex: number
  systemName: string
  /** Момент календаря, когда взято; срок; когда закрыто. */
  issuedAt: number
  deadline: number | null
  closedAt: number | null
  reward: number
  /** Выплачено всего, кредиты. */
  paid: number
}
