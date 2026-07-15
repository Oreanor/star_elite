import type { Disposition, Mood, Persona, Relationship, Topic } from '@elite/sim'
import type { Lang } from '../../ui/i18n/i18n'
import type { ContextDigest, NegotiationContext } from '../../ui/dialogue/facts'
import { digestLoaded, digestSummary, MAX_ACTIVE_DIGESTS, sufflerHint } from '../../ui/dialogue/facts'

/** Локализованные строки и сборщики блоков промпта переговорщика. */
export interface NegotiatorLocale {
  replyLanguage: string
  disposition: Record<Disposition, string>
  stance: Record<Relationship, string>
  mood: Record<Mood, string>
  intentBase: Record<Topic, string>
  digestLabel: Record<ContextDigest, string>
  staticNoise: readonly string[]
  level(n: number): string
  personaLines(p: Persona): string
  attitudeStamp(ctx: NegotiationContext): string
  attitudeBlock(ctx: NegotiationContext, closing?: boolean): string
  moneyBlock(ctx: NegotiationContext): string
  cargoEmpty: string
  cargoBuySell(buy: number, sell: number): string
  digestStub(digest: ContextDigest, forgotten: boolean): string
  worldsBlock(ctx: NegotiationContext): string
  marketBlock(ctx: NegotiationContext): string
  neighboursBlock(ctx: NegotiationContext): string
  historyBlock(ctx: NegotiationContext): string
  referenceDigestsBlock(ctx: NegotiationContext): string
  lookupRulesBlock(): string
  knowledgeDisclosureBlock(ctx: NegotiationContext): string
  translatorBlock(ctx: NegotiationContext): string
  stationBlock(ctx: NegotiationContext): string
  actionsCatalog(ctx: NegotiationContext): string
  channelPressureHint(): string
  overloadGoodbye(ctx: NegotiationContext): string
  stallLine(digest: ContextDigest, persona: Persona): string
  systemPrompt(ctx: NegotiationContext): string
}

function cargoLine(list: { id: string; name: string; units: number }[], empty: string): string {
  return list.length ? list.map((c) => `${c.name} [${c.id}] ×${c.units}`).join(', ') : empty
}

function intentLine(locale: Pick<NegotiatorLocale, 'intentBase'>, ctx: NegotiationContext, topic: Topic): string {
  if (topic === 'escort' && ctx.economy.escortFee != null) {
    return locale.intentBase.escort.replace('{fee}', String(ctx.economy.escortFee))
  }
  return locale.intentBase[topic]
}

function digestForgotten(ctx: NegotiationContext, digest: ContextDigest): boolean {
  return ctx.forgottenDigests.includes(digest)
}

function makeRu(): NegotiatorLocale {
  const disposition: Record<Disposition, string> = {
    brave: 'дерзкий, стоит до последнего',
    cowardly: 'трусоватый, ломается рано',
    greedy: 'жадный до добычи',
    honorable: 'честный, держит слово',
    hotheaded: 'вспыльчивый, заводится с полуслова',
    calculating: 'расчётливый, взвешивает шансы',
  }
  const stance: Record<Relationship, string> = {
    friendly: 'дружелюбно',
    neutral: 'нейтрально',
    hostile: 'враждебно',
  }
  const mood: Record<Mood, string> = {
    warm: 'тепло и дружески — ты расположен к нему',
    neutral: 'ровно, по-деловому',
    wary: 'настороженно, колко и с подозрением — он тебя задел; не верь словам',
    hostile: 'враждебно и грубо — сквозь зубы, с угрозой; НИКАКОЙ вежливости',
  }
  const intentBase: Record<Topic, string> = {
    surrender: 'surrender — сдаться: прекратить бой, сбросить груз',
    mercy: 'mercy — пощадить игрока и отпустить (ты пират, добыча — его груз)',
    escort: 'escort — наняться в сопровождение за {fee} кр (платит КОМАНДИР; transfer.credits не ставь)',
    plunder: 'plunder — подчиниться грабежу: отдать груз и оружие',
    greet: 'greet — болтовня, приветствие, ни к чему не обязывает',
  }
  const digestLabel: Record<ContextDigest, string> = {
    market: 'местные цены',
    neighbours: 'соседние системы',
    history: 'журнал встреч',
    worlds: 'планеты системы',
  }

  const level = (n: number): string => (n <= 2 ? 'низкий' : n >= 4 ? 'высокий' : 'средний')

  const locale: NegotiatorLocale = {
    replyLanguage:
      'ЯЗЫК СВЯЗИ: русский. Командир пишет по-русски — отвечай по-русски, коротко, как по радио.',
    disposition,
    stance,
    mood,
    intentBase,
    digestLabel,
    staticNoise: [
      '…кхх… связь рвётся, повтори.',
      '…рх… тебя не разобрать, одни помехи.',
      '…канал сыпется… треск… скажи ещё раз.',
    ],
    level,
    personaLines(p) {
      return [
        `нрав: ${disposition[p.disposition]}`,
        `ум ${p.intellect}/5 (${level(p.intellect)})`,
        `темперамент ${p.temperament}/5 (${level(p.temperament)})`,
        `харизма ${p.charisma}/5 (${level(p.charisma)})`,
        `воля ${p.willpower}/5 (${level(p.willpower)})`,
      ].join(', ')
    },
    attitudeStamp(ctx) {
      const bits = [`отношение ${stance[ctx.stance]}`, `тон ${ctx.mood}`]
      if (ctx.grievanceLevel > 0) bits.push(`претензия ${ctx.grievanceLevel}`)
      if (ctx.combatEnemy) bits.push('враг')
      bits.push(`счёт командира ${ctx.economy.commanderCredits} кр`)
      if (ctx.economy.escortFee != null && !ctx.economy.escortHired) bits.push(`найм ${ctx.economy.escortFee} кр`)
      return `[Расклад на эту реплику: ${bits.join(', ')}]`
    },
    attitudeBlock(ctx, closing = false) {
      const head = closing ? 'ПЕРЕД ОТВЕТОМ — ПРОВЕРЬ РАСКЛАД' : 'ОТНОШЕНИЕ К КОМАНДИРУ — ГЛАВНОЕ ПРАВИЛО'
      const grievance =
        ctx.grievanceLevel > 0
          ? `Открытая претензия (уровень ${ctx.grievanceLevel}): он тебя задел.`
          : 'Претензии сейчас нет — если он извинился, можешь говорить мягче.'
      const combat = ctx.combatEnemy ? 'Фракция: ВРАГ — ты с ним в конфликте.' : ''
      return [
        head,
        `Сейчас: ${stance[ctx.stance]}. Говори ${mood[ctx.mood]}.`,
        grievance,
        combat,
        closing
          ? 'Смотри расклад В ЭТОМ промпте. Претензия есть — не становись вежливым от одного «привет».'
          : 'Игра решает исход — держи ТЕКУЩИЙ тон из строк выше.',
      ]
        .filter(Boolean)
        .join('\n')
    },
    moneyBlock(ctx) {
      const e = ctx.economy
      const escort = e.escortHired
        ? 'Ты УЖЕ на службе у командира.'
        : e.escortFee != null
          ? `СОПРОВОЖДЕНИЕ: ${e.escortFee} кр — платит КОМАНДИР. На счёту ${e.commanderCredits} кр${e.canAffordEscort ? ' — хватит' : ' — НЕ хватит'}.`
          : 'Сопровождение сейчас не предлагаешь.'
      return [
        'ДЕНЬГИ И СДЕЛКИ',
        `Счёт КОМАНДИРА: ${e.commanderCredits} кр.`,
        escort,
        'transfer: toThem = он→тебе, toYou = ты→ему. transfer=null если сделки нет.',
        'intent=escort — игра спишет плату сама, transfer.credits не ставь.',
      ].join('\n')
    },
    cargoEmpty: 'пусто',
    cargoBuySell: (buy, sell) => `купить ${buy}, сбыть ${sell}`,
    digestStub(digest, forgotten) {
      const state = forgotten ? '[выпало из памяти разговора]' : '[сейчас не в памяти]'
      return `${digestLabel[digest].toUpperCase()}: ${state}. lookup="${digest}" или переспроси.`
    },
    worldsBlock(ctx) {
      const w = ctx.world
      if (digestLoaded(ctx, 'worlds')) {
        return [
          'ОБИТАЕМЫЕ МИРЫ:',
          w.worlds.length
            ? w.worlds.map((o) => `• ${o.name} (${o.type}): ${o.economy}, ${o.government}, ~${o.populationM} млн`).join('\n')
            : '• обитаемых нет',
        ].join('\n')
      }
      return locale.digestStub('worlds', digestForgotten(ctx, 'worlds'))
    },
    marketBlock(ctx) {
      if (digestLoaded(ctx, 'market')) {
        return [
          'МЕСТНЫЕ ЦЕНЫ:',
          ctx.localMarket.map((m) => `• ${m.name}: ${locale.cargoBuySell(m.buy, m.sell)}`).join('\n'),
        ].join('\n')
      }
      return locale.digestStub('market', digestForgotten(ctx, 'market'))
    },
    neighboursBlock(ctx) {
      if (digestLoaded(ctx, 'neighbours')) {
        return [
          'СОСЕДНИЕ СИСТЕМЫ:',
          ctx.neighbours.length
            ? ctx.neighbours.map((n) => `• ${n.name}: ${n.economy}, ~${n.ly} св.лет`).join('\n')
            : '• не осведомлён',
        ].join('\n')
      }
      return locale.digestStub('neighbours', digestForgotten(ctx, 'neighbours'))
    },
    historyBlock(ctx) {
      if (!ctx.history.length) return ''
      if (digestLoaded(ctx, 'history')) {
        return 'ЧТО МЕЖДУ ВАМИ БЫЛО:\n' + ctx.history.map((h) => `• ${h}`).join('\n')
      }
      return locale.digestStub('history', digestForgotten(ctx, 'history'))
    },
    referenceDigestsBlock(ctx) {
      const lines = [`СПРАВОЧНИКИ (до ${MAX_ACTIVE_DIGESTS} в памяти):`]
      if (ctx.activeDigests.length) lines.push(`В памяти: ${digestSummary(ctx.activeDigests, digestLabel, 'ничего')}.`)
      if (ctx.forgottenDigests.length) lines.push(`Забыл: ${digestSummary(ctx.forgottenDigests, digestLabel, 'ничего')}.`)
      if (ctx.freshDigests.length) lines.push(`Освежил: ${sufflerHint(ctx.freshDigests, digestLabel)}.`)
      const body = [locale.historyBlock(ctx), locale.worldsBlock(ctx), locale.marketBlock(ctx), locale.neighboursBlock(ctx)].filter(Boolean)
      return [...lines, '', ...body].join('\n')
    },
    lookupRulesBlock() {
      return [
        `Память: не больше ${MAX_ACTIVE_DIGESTS} справочников — старый забывается.`,
        'Нашёл — lookup=null. Нет — lookup или «не помню».',
      ].join('\n')
    },
    knowledgeDisclosureBlock(ctx) {
      const p = ctx.them.persona
      return [
        'ЗНАНИЕ',
        `В памяти: ${digestSummary(ctx.activeDigests, digestLabel, 'ничего')}.`,
        `Характер: ${disposition[p.disposition]}, ум ${p.intellect}/5.`,
        'Нет факта — не выдумывай. Неясная реплика — переспроси в характере.',
      ].join('\n')
    },
    translatorBlock(_ctx) {
      return [
        'ПЕРЕВОДЧИК И ЧУЖИЕ ПОНЯТИЯ',
        'Связь через автопереводчик — у командира могут быть слова и обычаи, которых у тебя нет.',
        '',
        '1) НЕ ПОНЯЛ поручение (метафора, модуль, место, шаги неясны):',
        '   clarify:true · intent/plan/order/transfer/learn=null · reply: попроси расклад ПО ШАГАМ простыми словами.',
        '',
        '2) Командир объяснил ВНЯТНО (по шагам, что купить/куда/что после):',
        '   clarify:false · learn: краткая мета «их фраза → что делать» (тихо, для себя) ·',
        '   если надо ДЕЛАТЬ — plan с шагами · reply: «понял/принял» в характере.',
        '',
        '3) Уже есть МЕТА в журнале и снова та же просьба — не переспрашивай, исполняй plan.',
        'Лучше уточнить, чем сделать не то. Но понял — запомни мету и делай.',
      ].join('\n')
    },
    stationBlock(ctx) {
      const s = ctx.station
      if (!s.present) return 'СТАНЦИЯ: в системе нет станции — про док не обещай.'
      return [
        'СТАНЦИЯ',
        s.stationName ? `«${s.stationName}», тех ${s.techLevel}.` : '',
        `Командир ${s.commanderDocked ? 'у причала' : 'в полёте'}; ты ${s.npcDocked ? 'у причала' : 'в полёте'}.`,
        'Модули и ремонт — только у причала. transfer — груз и кредиты по радио.',
      ]
        .filter(Boolean)
        .join('\n')
    },
    actionsCatalog(ctx) {
      const intents = ctx.allowedIntents.length
        ? ctx.allowedIntents.map((i) => `• ${intentLine(locale, ctx, i)}`).join('\n')
        : '• (intent недоступен — только разговор)'
      return [
        'КАТАЛОГ ДЕЙСТВИЙ',
        'intent:',
        intents,
        'social: insult|flatter|null',
        'transfer|null',
        'remember|null',
        'learn: «их фраза → шаги»|null — тихая мета, когда понял объяснение',
        'clarify: true|false — true = не понял перевод, только переспрос',
        'plan: [{step:"buy",module:"id-или-имя",hardpoint?:0},{step:"escort",cover:true},{step:"collect"},{step:"approach-nav"},{step:"clear-tasks"}]|null',
        'hangup',
      ].join('\n')
    },
    channelPressureHint() {
      return 'КАНАЛ ПЕРЕГРУЖЕН: попрощайся (hangup=true) — надо лететь или помехи.'
    },
    overloadGoodbye(ctx) {
      const pool = [
        'Мне пора — на борту тренька, потом договорим.',
        'Канал сдыхает — вылетаю!',
        'Связь сыпется — срываюсь.',
      ]
      if (ctx.theyObeyYou) pool.push('Командир, помехи — отваливаю.')
      const p = ctx.them.persona
      const idx = (p.temperament + p.intellect + ctx.activeDigests.length) % pool.length
      return pool[idx]!
    },
    stallLine(digest, persona) {
      const hasty = persona.temperament >= 4
      const pick = (a: string, b: string) => (persona.temperament % 2 === 0 ? a : b)
      switch (digest) {
        case 'market':
          return hasty ? pick('Ща, прайс…', 'Погоди, котировки.') : 'Секунду, цены.'
        case 'neighbours':
          return hasty ? 'Ща, карта…' : 'Секунду, соседи.'
        case 'history':
          return 'Погоди, журнал…'
        case 'worlds':
          return 'Секунду, планетарка…'
      }
    },
    systemPrompt(ctx) {
      const w = ctx.world
      const t = ctx.them
      const y = ctx.you
      const nearbyLine = ctx.nearby.length
        ? 'РЯДОМ: ' + ctx.nearby.map((s) => `${s.id}=${s.name}(${s.standing})`).join('; ')
        : ''
      const situation = ctx.docked
        ? `У ПРИЧАЛА: ${ctx.theirLocation}. Собеседник: ${y.name}.`
        : `В ПОЛЁТЕ: ${ctx.theirLocation}, ${ctx.distanceM} м.`

      return [
        locale.replyLanguage,
        `Ты — ${t.name}, корабль «${t.ship}», ${t.role}.`,
        `Характер: ${locale.personaLines(t.persona)}.`,
        `Корпус ${t.hullPct}%, щит ${t.shieldPct}%. Трюм: ${t.cargo}.`,
        '',
        locale.attitudeBlock(ctx),
        '',
        `Перед тобой ${y.name}, ${y.species}, «${y.ship}».`,
        `Твой трюм: ${cargoLine(t.cargoList, locale.cargoEmpty)}.`,
        '',
        locale.moneyBlock(ctx),
        locale.stationBlock(ctx),
        ctx.metBefore ? 'Вы уже пересекались.' : 'Видитесь впервые.',
        nearbyLine,
        `Система ${w.systemName}. ${situation}`,
        locale.referenceDigestsBlock(ctx),
        locale.knowledgeDisclosureBlock(ctx),
        locale.lookupRulesBlock(),
        locale.translatorBlock(ctx),
        'Говори коротко. Распознай intent/transfer/remember/learn/clarify/plan из каталога.',
        locale.actionsCatalog(ctx),
        locale.attitudeBlock(ctx, true),
        '',
        'Ответь СТРОГО одним JSON:',
        '{"reply":"…","intent":…|"null","social":"insult"|"flatter"|null,"transfer":…|null,"remember":…|null,"learn":…|null,"clarify":true|false,"plan":[…]|null,"lookup":"market"|"neighbours"|"history"|"worlds"|null,"hangup":true|false}',
      ]
        .filter(Boolean)
        .join('\n')
    },
  }
  return locale
}

function makeEn(): NegotiatorLocale {
  const disposition: Record<Disposition, string> = {
    brave: 'bold, stands ground',
    cowardly: 'cowardly, breaks early',
    greedy: 'greedy for loot',
    honorable: 'honorable, keeps word',
    hotheaded: 'hot-headed, snaps fast',
    calculating: 'calculating, weighs odds',
  }
  const stance: Record<Relationship, string> = {
    friendly: 'friendly',
    neutral: 'neutral',
    hostile: 'hostile',
  }
  const mood: Record<Mood, string> = {
    warm: 'warm and friendly — you are disposed toward them',
    neutral: 'even, businesslike',
    wary: 'wary, sharp and suspicious — do not trust their words',
    hostile: 'hostile and rough — through gritted teeth, no pleasantries',
  }
  const intentBase: Record<Topic, string> = {
    surrender: 'surrender — stand down: stop fighting, drop cargo',
    mercy: 'mercy — spare the player and let them go',
    escort: 'escort — hire on as escort for {fee} cr (COMMANDER pays; do not set transfer.credits)',
    plunder: 'plunder — submit to robbery: give up cargo and weapons',
    greet: 'greet — small talk, greeting, no commitment',
  }
  const digestLabel: Record<ContextDigest, string> = {
    market: 'local prices',
    neighbours: 'neighbour systems',
    history: 'meeting log',
    worlds: 'system worlds',
  }

  const level = (n: number): string => (n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium')

  const locale: NegotiatorLocale = {
    replyLanguage:
      'COMMS LANGUAGE: English. The commander writes in English — reply in English, short, like radio.',
    disposition,
    stance,
    mood,
    intentBase,
    digestLabel,
    staticNoise: [
      '…khh… link breaking up, say again.',
      '…static… can’t make you out.',
      '…channel fading… crackle… repeat.',
    ],
    level,
    personaLines(p) {
      return [
        `disposition: ${disposition[p.disposition]}`,
        `intellect ${p.intellect}/5 (${level(p.intellect)})`,
        `temperament ${p.temperament}/5 (${level(p.temperament)})`,
        `charisma ${p.charisma}/5 (${level(p.charisma)})`,
        `will ${p.willpower}/5 (${level(p.willpower)})`,
      ].join(', ')
    },
    attitudeStamp(ctx) {
      const bits = [`stance ${stance[ctx.stance]}`, `tone ${ctx.mood}`]
      if (ctx.grievanceLevel > 0) bits.push(`grievance ${ctx.grievanceLevel}`)
      if (ctx.combatEnemy) bits.push('enemy')
      bits.push(`commander credits ${ctx.economy.commanderCredits}`)
      if (ctx.economy.escortFee != null && !ctx.economy.escortHired) bits.push(`escort fee ${ctx.economy.escortFee}`)
      return `[Stance this line: ${bits.join(', ')}]`
    },
    attitudeBlock(ctx, closing = false) {
      const head = closing ? 'BEFORE YOU REPLY — CHECK STANCE' : 'STANCE TOWARD COMMANDER — MAIN RULE'
      const grievance =
        ctx.grievanceLevel > 0
          ? `Open grievance (level ${ctx.grievanceLevel}): they wronged you.`
          : 'No grievance now — if they apologized, you may soften.'
      const combat = ctx.combatEnemy ? 'Faction: ENEMY — you are in conflict.' : ''
      return [
        head,
        `Now: ${stance[ctx.stance]}. Speak ${mood[ctx.mood]}.`,
        grievance,
        combat,
        closing ? 'Read stance in THIS prompt. Grievance open — one hello does not clear it.' : 'Game decides outcomes — keep CURRENT tone above.',
      ]
        .filter(Boolean)
        .join('\n')
    },
    moneyBlock(ctx) {
      const e = ctx.economy
      const escort = e.escortHired
        ? 'You are ALREADY hired by the commander.'
        : e.escortFee != null
          ? `ESCORT: ${e.escortFee} cr — COMMANDER pays. Balance ${e.commanderCredits} cr${e.canAffordEscort ? ' — enough' : ' — NOT enough'}.`
          : 'Not offering escort now.'
      return [
        'MONEY AND DEALS',
        `Commander balance: ${e.commanderCredits} cr.`,
        escort,
        'transfer: toThem = them→you, toYou = you→them. transfer=null if no deal.',
        'intent=escort — game deducts fee; do not set transfer.credits.',
      ].join('\n')
    },
    cargoEmpty: 'empty',
    cargoBuySell: (buy, sell) => `buy ${buy}, sell ${sell}`,
    digestStub(digest, forgotten) {
      const state = forgotten ? '[dropped from comms memory]' : '[not in memory now]'
      return `${digestLabel[digest].toUpperCase()}: ${state}. lookup="${digest}" or ask again.`
    },
    worldsBlock(ctx) {
      const w = ctx.world
      if (digestLoaded(ctx, 'worlds')) {
        return [
          'INHABITED WORLDS:',
          w.worlds.length
            ? w.worlds.map((o) => `• ${o.name} (${o.type}): ${o.economy}, ${o.government}, ~${o.populationM}M`).join('\n')
            : '• none inhabited',
        ].join('\n')
      }
      return locale.digestStub('worlds', digestForgotten(ctx, 'worlds'))
    },
    marketBlock(ctx) {
      if (digestLoaded(ctx, 'market')) {
        return [
          'LOCAL PRICES:',
          ctx.localMarket.map((m) => `• ${m.name}: ${locale.cargoBuySell(m.buy, m.sell)}`).join('\n'),
        ].join('\n')
      }
      return locale.digestStub('market', digestForgotten(ctx, 'market'))
    },
    neighboursBlock(ctx) {
      if (digestLoaded(ctx, 'neighbours')) {
        return [
          'NEARBY SYSTEMS:',
          ctx.neighbours.length
            ? ctx.neighbours.map((n) => `• ${n.name}: ${n.economy}, ~${n.ly} ly`).join('\n')
            : '• little known',
        ].join('\n')
      }
      return locale.digestStub('neighbours', digestForgotten(ctx, 'neighbours'))
    },
    historyBlock(ctx) {
      if (!ctx.history.length) return ''
      if (digestLoaded(ctx, 'history')) {
        return 'BETWEEN YOU:\n' + ctx.history.map((h) => `• ${h}`).join('\n')
      }
      return locale.digestStub('history', digestForgotten(ctx, 'history'))
    },
    referenceDigestsBlock(ctx) {
      const lines = [`REFERENCES (max ${MAX_ACTIVE_DIGESTS} in memory):`]
      if (ctx.activeDigests.length) lines.push(`In memory: ${digestSummary(ctx.activeDigests, digestLabel, 'nothing')}.`)
      if (ctx.forgottenDigests.length) lines.push(`Forgotten: ${digestSummary(ctx.forgottenDigests, digestLabel, 'nothing')}.`)
      if (ctx.freshDigests.length) lines.push(`Refreshed: ${sufflerHint(ctx.freshDigests, digestLabel)}.`)
      const body = [locale.historyBlock(ctx), locale.worldsBlock(ctx), locale.marketBlock(ctx), locale.neighboursBlock(ctx)].filter(Boolean)
      return [...lines, '', ...body].join('\n')
    },
    lookupRulesBlock() {
      return [`Memory: max ${MAX_ACTIVE_DIGESTS} references — oldest drops.`, 'Found it — lookup=null. Else lookup or "don\'t remember".'].join('\n')
    },
    knowledgeDisclosureBlock(ctx) {
      const p = ctx.them.persona
      return [
        'KNOWLEDGE',
        `In memory: ${digestSummary(ctx.activeDigests, digestLabel, 'nothing')}.`,
        `Character: ${disposition[p.disposition]}, intellect ${p.intellect}/5.`,
        'No fact — do not invent. Unclear line — ask again in character.',
      ].join('\n')
    },
    translatorBlock(_ctx) {
      return [
        'TRANSLATOR & ALIEN CONCEPTS',
        'Comms go through auto-translation — the commander may use words or customs you lack.',
        '',
        '1) Order UNCLEAR (metaphor, module, place, steps vague):',
        '   clarify:true · intent/plan/order/transfer/learn=null · reply: ask for step-by-step in plain words.',
        '',
        '2) Commander explained CLEARLY (what to buy / where / what after):',
        '   clarify:false · learn: short meta "their phrase → what to do" (silent, for yourself) ·',
        '   if action needed — plan with steps · reply: "got it / on it" in character.',
        '',
        '3) META already in log and same request again — do not re-ask; execute plan.',
        'Better to ask than do wrong. Once you understand — store meta and act.',
      ].join('\n')
    },
    stationBlock(ctx) {
      const s = ctx.station
      if (!s.present) return 'STATION: none in this system — do not promise dock services.'
      return [
        'STATION',
        s.stationName ? `"${s.stationName}", tech ${s.techLevel}.` : '',
        `Commander ${s.commanderDocked ? 'docked' : 'in flight'}; you ${s.npcDocked ? 'docked' : 'in flight'}.`,
        'Modules and repair — dock only. transfer — cargo and credits over comms.',
      ]
        .filter(Boolean)
        .join('\n')
    },
    actionsCatalog(ctx) {
      const intents = ctx.allowedIntents.length
        ? ctx.allowedIntents.map((i) => `• ${intentLine(locale, ctx, i)}`).join('\n')
        : '• (no intent — talk only)'
      return [
        'ACTION CATALOG',
        'intent:',
        intents,
        'social: insult|flatter|null',
        'transfer|null',
        'remember|null',
        'learn: "their phrase → steps"|null — silent meta when you understood',
        'clarify: true|false — true = did not get translation, ask only',
        'plan: [{step:"buy",module:"id-or-name",hardpoint?:0},{step:"escort",cover:true},{step:"collect"},{step:"approach-nav"},{step:"clear-tasks"}]|null',
        'hangup',
      ].join('\n')
    },
    channelPressureHint() {
      return 'CHANNEL OVERLOAD: say goodbye (hangup=true) — must fly or interference.'
    },
    overloadGoodbye(ctx) {
      const pool = [
        'Gotta go — glitch on board, talk later.',
        'Channel dying — breaking off!',
        'Link’s trash — I’m out.',
      ]
      if (ctx.theyObeyYou) pool.push('Commander, interference — signing off.')
      const p = ctx.them.persona
      const idx = (p.temperament + p.intellect + ctx.activeDigests.length) % pool.length
      return pool[idx]!
    },
    stallLine(digest, persona) {
      const hasty = persona.temperament >= 4
      const pick = (a: string, b: string) => (persona.temperament % 2 === 0 ? a : b)
      switch (digest) {
        case 'market':
          return hasty ? pick('Hang on, prices…', 'Wait, quotes…') : 'One sec, market.'
        case 'neighbours':
          return hasty ? 'Nav chart…' : 'One sec, neighbours.'
        case 'history':
          return 'Wait, log…'
        case 'worlds':
          return 'One sec, planetary…'
      }
    },
    systemPrompt(ctx) {
      const w = ctx.world
      const t = ctx.them
      const y = ctx.you
      const nearbyLine = ctx.nearby.length ? 'NEARBY: ' + ctx.nearby.map((s) => `${s.id}=${s.name}(${s.standing})`).join('; ') : ''
      const situation = ctx.docked ? `DOCKED: ${ctx.theirLocation}. Contact: ${y.name}.` : `IN FLIGHT: ${ctx.theirLocation}, ${ctx.distanceM} m.`

      return [
        locale.replyLanguage,
        `You are ${t.name}, ship "${t.ship}", ${t.role}.`,
        `Character: ${locale.personaLines(t.persona)}.`,
        `Hull ${t.hullPct}%, shield ${t.shieldPct}%. Hold: ${t.cargo}.`,
        '',
        locale.attitudeBlock(ctx),
        '',
        `Facing ${y.name}, ${y.species}, "${y.ship}".`,
        `Your hold: ${cargoLine(t.cargoList, locale.cargoEmpty)}.`,
        '',
        locale.moneyBlock(ctx),
        locale.stationBlock(ctx),
        ctx.metBefore ? 'You met before.' : 'First contact.',
        nearbyLine,
        `System ${w.systemName}. ${situation}`,
        locale.referenceDigestsBlock(ctx),
        locale.knowledgeDisclosureBlock(ctx),
        locale.lookupRulesBlock(),
        locale.translatorBlock(ctx),
        'Speak short. Parse intent/transfer/remember/learn/clarify/plan from catalog.',
        locale.actionsCatalog(ctx),
        locale.attitudeBlock(ctx, true),
        '',
        'Reply with ONE JSON object only:',
        '{"reply":"…","intent":…|"null","social":"insult"|"flatter"|null,"transfer":…|null,"remember":…|null,"learn":…|null,"clarify":true|false,"plan":[…]|null,"lookup":"market"|"neighbours"|"history"|"worlds"|null,"hangup":true|false}',
      ]
        .filter(Boolean)
        .join('\n')
    },
  }
  return locale
}

// Промпт негоциатора — большой диегетический текст; локализован пока только для ru/en.
// Прочие языки UI (pt/fr/de/es/it) берут АНГЛИЙСКИЙ каркас промпта: сам скелет инструкций
// модели не обязан быть на языке игрока. Полноценные негоциаторские локали — отдельная работа.
const LOCALES: Partial<Record<Lang, NegotiatorLocale>> = { ru: makeRu(), en: makeEn() }

export function negotiatorLocale(lang: Lang): NegotiatorLocale {
  return LOCALES[lang] ?? LOCALES.en!
}
