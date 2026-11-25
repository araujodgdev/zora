/**
 * Platform-native social analytics signals, beginner-friendly pt-BR guides,
 * and single-sentence post diagnoses.
 *
 * Different networks reward fundamentally different user behaviors:
 * - Instagram: sends/reach (discovery), watch time (retention), saves/reach (utility), likes/reach (community)
 * - TikTok: shares/views (virality) and engagement/views
 * - YouTube: views, early velocity, and approval ((likes + comments) / views)
 * - X: bookmarks/views (utility), amplification ((RTs + quotes) / views), conversation (replies / views)
 * - LinkedIn: conversation (comments) and reactions per post
 *
 * Client-safe so the UI, server aggregation, and MCP tools share one source of truth.
 */
import type { Channel } from './content'

export type SignalRole = 'discovery' | 'retention' | 'utility' | 'community' | 'conversation'
export type SignalUnit = 'percent' | 'seconds' | 'count'
export type SignalStrength = 'strong' | 'good' | 'baseline'

export type ChannelSignalMetric = {
  id: string
  label: string
  shortLabel: string
  value: number
  formattedValue: string
  unit: SignalUnit
  role: SignalRole
  strength: SignalStrength
  /** Plain-Portuguese explanation written for new content creators. */
  explanation: string
}

export type ChannelGuideSignal = {
  label: string
  whyItMatters: string
}

export type ChannelMetricGuide = {
  channel: Channel
  headline: string
  summary: string
  keySignals: Array<ChannelGuideSignal>
}

export type PostDiagnosis = {
  badge: string
  tone: 'positive' | 'info' | 'attention'
  summary: string
}

export type MetricPoint = {
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  avgWatchTimeMs: number | null
  engagementRate: number | null
}

// ---------------------------------------------------------------------------
// Beginner-friendly guides per network
// ---------------------------------------------------------------------------

export const CHANNEL_METRIC_GUIDES: Record<Channel, ChannelMetricGuide> = {
  instagram: {
    channel: 'instagram',
    headline: 'No Instagram, envios e salvamentos pesam mais que curtidas',
    summary:
      'O algoritmo usa envios por DM para mostrar seu conteúdo a quem ainda não te segue, salvamentos para medir utilidade e tempo assistido para manter Reels em distribuição.',
    keySignals: [
      {
        label: 'Envios por alcance',
        whyItMatters:
          'Principal sinal de descoberta: quando alguém manda seu post por DM, o Instagram entende que vale recomendar para novos públicos.',
      },
      {
        label: 'Salvos por alcance',
        whyItMatters:
          'Mostra que o conteúdo é útil ou digno de referência — muito forte em carrosséis, tutoriais e listas.',
      },
      {
        label: 'Tempo médio assistido (Reels)',
        whyItMatters:
          'Indica se o gancho inicial segurou a atenção. Retenção alta mantém o vídeo circulando por mais dias.',
      },
      {
        label: 'Curtidas por alcance',
        whyItMatters:
          'Mede o quanto o conteúdo agradou a sua base atual de seguidores em relação a quantas pessoas realmente viram.',
      },
    ],
  },
  tiktok: {
    channel: 'tiktok',
    headline: 'No TikTok, compartilhamentos e engajamento por view puxam o alcance',
    summary:
      'Como o TikTok distribui vídeos primeiro para não-seguidores no Para Você, a proporção de pessoas que compartilham ou interagem a cada visualização vale muito mais que o número de seguidores.',
    keySignals: [
      {
        label: 'Compartilhamentos por view',
        whyItMatters:
          'Sinal mais forte de potencial viral: vídeos compartilhados ganham novas ondas de entrega no Para Você.',
      },
      {
        label: 'Engajamento por view',
        whyItMatters:
          'Soma curtidas, comentários e compartilhamentos sobre views. Referência saudável no TikTok costuma ficar acima de 3%.',
      },
      {
        label: 'Conversa nos comentários',
        whyItMatters:
          'Comentários prolongam o tempo na tela enquanto o vídeo continua rodando em loop ao fundo.',
      },
    ],
  },
  youtube: {
    channel: 'youtube',
    headline: 'No YouTube, views qualificadas e conversa constroem cauda longa',
    summary:
      'Diferente de feeds rápidos, um vídeo no YouTube continua recebendo buscas por meses. Avalie o volume de views junto com a taxa de aprovação e comentários.',
    keySignals: [
      {
        label: 'Visualizações',
        whyItMatters:
          'No YouTube a view exige atenção real — acompanhar o crescimento nas primeiras 48h mostra a força do tema e da capa.',
      },
      {
        label: 'Aprovação por view',
        whyItMatters:
          'Percentual de espectadores que curtiram ou comentaram o vídeo. Acima de 3%–4% indica público bem engajado.',
      },
      {
        label: 'Comentários por 1 mil views',
        whyItMatters:
          'Mede o quanto o vídeo provocou discussão ou dúvidas — ótimo sinal de comunidade ativa.',
      },
    ],
  },
  x: {
    channel: 'x',
    headline: 'No X, bookmarks e respostas valem mais do que impressões soltas',
    summary:
      'As taxas percentuais no X são naturalmente pequenas porque impressões correm rápido no feed. Olhe para quem salvou (bookmarks), respondeu ou amplificou o post.',
    keySignals: [
      {
        label: 'Bookmarks por impressão',
        whyItMatters:
          'Mostra conteúdo denso ou prático que as pessoas querem guardar para reler depois.',
      },
      {
        label: 'Amplificação (RTs + citações)',
        whyItMatters:
          'Indica quantas pessoas colocaram seu post na própria timeline, gerando alcance orgânico extra.',
      },
      {
        label: 'Conversa (respostas)',
        whyItMatters:
          'Respostas mantêm o post ativo na timeline e têm alto peso na distribuição do X.',
      },
    ],
  },
  linkedin: {
    channel: 'linkedin',
    headline: 'No LinkedIn, comentários abrem alcance para conexões de 2º e 3º grau',
    summary:
      'Em perfis pessoais a rede prioriza conversas qualificadas. Acompanhe quantos comentários e reações cada post gera em comparação com sua própria média.',
    keySignals: [
      {
        label: 'Comentários por post',
        whyItMatters:
          'Cada comentário relevante reapresenta seu post no feed da rede de quem comentou.',
      },
      {
        label: 'Reações por post',
        whyItMatters:
          'Ajuda a comparar rapidamente quais temas e formatos (texto, imagem, carrossel em PDF) ressoam melhor.',
      },
      {
        label: 'Proporção de conversa',
        whyItMatters:
          'Relação entre comentários e reações: quanto maior, mais o post gerou debate em vez de leitura passiva.',
      },
    ],
  },
  blog: {
    channel: 'blog',
    headline: 'No Blog, consistência e ritmo editorial sustentam a busca orgânica',
    summary:
      'Como o blog não usa uma API social única, acompanhe aqui sua cadência de publicação e o tempo que cada artigo leva da ideia até ir ao ar.',
    keySignals: [
      {
        label: 'Cadência de publicação',
        whyItMatters:
          'Publicar com regularidade facilita indexação e cria hábito de leitura.',
      },
      {
        label: 'Ciclo editorial',
        whyItMatters:
          'Mostra quanto tempo seus artigos ficam entre rascunho e publicação.',
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const pctFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})

const decFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const intFmt = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

export function formatWatchTimeSeconds(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${decFmt.format(seconds)} s`
  const mins = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return `${mins}m ${String(rem).padStart(2, '0')}s`
}

function pct(numerator: number, denominator: number): number {
  return Number(((numerator / denominator) * 100).toFixed(2))
}

function strengthFrom(value: number, goodThreshold: number, strongThreshold: number): SignalStrength {
  if (value >= strongThreshold) return 'strong'
  if (value >= goodThreshold) return 'good'
  return 'baseline'
}

// ---------------------------------------------------------------------------
// Platform-native signal calculation (per post or aggregated)
// ---------------------------------------------------------------------------

/**
 * Computes the platform-native signals that matter most for one post (or an
 * aggregated sum of posts from the same channel).
 */
export function computeChannelSignalsFromTotals(
  channel: Channel,
  totals: MetricPoint,
  postCount = 1,
): Array<ChannelSignalMetric> {
  const signals: Array<ChannelSignalMetric> = []
  const exposure =
    totals.reach != null && totals.reach > 0
      ? totals.reach
      : totals.views != null && totals.views > 0
        ? totals.views
        : null
  const views = totals.views != null && totals.views > 0 ? totals.views : null

  if (channel === 'instagram') {
    if (exposure && totals.shares != null) {
      const rate = pct(totals.shares, exposure)
      signals.push({
        id: 'sends_per_reach',
        label: 'Envios por alcance',
        shortLabel: 'Envios/alcance',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'discovery',
        strength: strengthFrom(rate, 0.5, 1.5),
        explanation:
          'Percentual de pessoas alcançadas que enviaram o post por DM ou compartilharam. Principal motor para atingir não-seguidores.',
      })
    }
    if (exposure && totals.saves != null) {
      const rate = pct(totals.saves, exposure)
      signals.push({
        id: 'saves_per_reach',
        label: 'Salvos por alcance',
        shortLabel: 'Salvos/alcance',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'utility',
        strength: strengthFrom(rate, 0.8, 2.0),
        explanation:
          'Indica quantas pessoas guardaram o post para consultar depois — ótimo sinal de utilidade e valor prático.',
      })
    }
    if (totals.avgWatchTimeMs != null && totals.avgWatchTimeMs > 0) {
      const seconds = Number((totals.avgWatchTimeMs / 1000).toFixed(1))
      signals.push({
        id: 'avg_watch_time',
        label: 'Tempo médio assistido',
        shortLabel: 'Tempo médio',
        value: seconds,
        formattedValue: formatWatchTimeSeconds(totals.avgWatchTimeMs),
        unit: 'seconds',
        role: 'retention',
        strength: strengthFrom(seconds, 6, 12),
        explanation:
          'Tempo médio que o público permaneceu assistindo ao Reel. Retenção alta mantém o vídeo em distribuição.',
      })
    }
    if (exposure && totals.likes != null) {
      const rate = pct(totals.likes, exposure)
      signals.push({
        id: 'likes_per_reach',
        label: 'Curtidas por alcance',
        shortLabel: 'Curtidas/alcance',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'community',
        strength: strengthFrom(rate, 2.5, 5.0),
        explanation:
          'Mostra o quanto o conteúdo agradou a quem o viu — ajuda a medir a sintonia com seus seguidores.',
      })
    }
    return signals
  }

  if (channel === 'tiktok') {
    if (views && totals.shares != null) {
      const rate = pct(totals.shares, views)
      signals.push({
        id: 'shares_per_view',
        label: 'Compartilhamentos por view',
        shortLabel: 'Shares/views',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'discovery',
        strength: strengthFrom(rate, 0.5, 1.5),
        explanation:
          'Proporção de espectadores que enviaram o vídeo para alguém — sinal chave de potencial viral no Para Você.',
      })
    }
    if (views) {
      const inter = (totals.likes ?? 0) + (totals.comments ?? 0) + (totals.shares ?? 0)
      const rate = pct(inter, views)
      signals.push({
        id: 'engagement_per_view',
        label: 'Engajamento por view',
        shortLabel: 'Engaj./views',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'community',
        strength: strengthFrom(rate, 3.0, 6.0),
        explanation:
          'Percentual de visualizações que viraram curtida, comentário ou compartilhamento (referência saudável: acima de 3%).',
      })
    }
    if (views && totals.comments != null) {
      const rate = pct(totals.comments, views)
      signals.push({
        id: 'comments_per_view',
        label: 'Comentários por view',
        shortLabel: 'Coment./views',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'conversation',
        strength: strengthFrom(rate, 0.15, 0.4),
        explanation:
          'Mede o quanto o vídeo gerou debate e manteve as pessoas na tela.',
      })
    }
    return signals
  }

  if (channel === 'youtube') {
    if (views) {
      const approval = (totals.likes ?? 0) + (totals.comments ?? 0)
      const rate = pct(approval, views)
      signals.push({
        id: 'approval_per_view',
        label: 'Aprovação por view',
        shortLabel: 'Aprovação/views',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'community',
        strength: strengthFrom(rate, 2.5, 5.0),
        explanation:
          'Percentual de espectadores que curtiram ou comentaram o vídeo. Acima de 3%–4% indica ótima recepção.',
      })
    }
    if (views && totals.comments != null) {
      const perThousand = Number(((totals.comments / views) * 1000).toFixed(1))
      signals.push({
        id: 'comments_per_1k_views',
        label: 'Comentários por 1 mil views',
        shortLabel: 'Coment./1k views',
        value: perThousand,
        formattedValue: decFmt.format(perThousand),
        unit: 'count',
        role: 'conversation',
        strength: strengthFrom(perThousand, 2, 5),
        explanation:
          'Mostra quantos comentários o vídeo desperta a cada mil visualizações — ótimo termômetro de comunidade.',
      })
    }
    return signals
  }

  if (channel === 'x') {
    if (views && totals.saves != null) {
      const rate = pct(totals.saves, views)
      signals.push({
        id: 'bookmarks_per_view',
        label: 'Bookmarks por impressão',
        shortLabel: 'Bookmarks/imp.',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'utility',
        strength: strengthFrom(rate, 0.15, 0.5),
        explanation:
          'Percentual de impressões em que alguém salvou o post. Sinal muito forte de utilidade e autoridade no X.',
      })
    }
    if (views && totals.shares != null) {
      const rate = pct(totals.shares, views)
      signals.push({
        id: 'amplification_per_view',
        label: 'Amplificação (RTs + citações)',
        shortLabel: 'Amplificação',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'discovery',
        strength: strengthFrom(rate, 0.1, 0.4),
        explanation:
          'Proporção de quem repostou ou citou seu post para a própria audiência.',
      })
    }
    if (views && totals.comments != null) {
      const rate = pct(totals.comments, views)
      signals.push({
        id: 'conversation_per_view',
        label: 'Conversa (respostas)',
        shortLabel: 'Respostas/imp.',
        value: rate,
        formattedValue: `${pctFmt.format(rate)}%`,
        unit: 'percent',
        role: 'conversation',
        strength: strengthFrom(rate, 0.08, 0.25),
        explanation:
          'Respostas mantêm o post vivo na timeline e têm peso alto na distribuição do X.',
      })
    }
    return signals
  }

  if (channel === 'linkedin') {
    const comments = totals.comments ?? 0
    const likes = totals.likes ?? 0
    const safeCount = Math.max(postCount, 1)
    if (totals.comments != null) {
      const avgComments = Number((comments / safeCount).toFixed(1))
      signals.push({
        id: 'comments_per_post',
        label: postCount > 1 ? 'Comentários por post' : 'Comentários',
        shortLabel: postCount > 1 ? 'Coment./post' : 'Comentários',
        value: avgComments,
        formattedValue: postCount > 1 ? decFmt.format(avgComments) : intFmt.format(comments),
        unit: 'count',
        role: 'conversation',
        strength: strengthFrom(avgComments, 5, 15),
        explanation:
          'No LinkedIn, comentários são o principal gatilho para mostrar o post a conexões de 2º e 3º grau.',
      })
    }
    if (likes > 0 && totals.comments != null) {
      const ratio = pct(comments, likes)
      signals.push({
        id: 'conversation_ratio',
        label: 'Proporção de conversa',
        shortLabel: 'Coment./reações',
        value: ratio,
        formattedValue: `${pctFmt.format(ratio)}%`,
        unit: 'percent',
        role: 'conversation',
        strength: strengthFrom(ratio, 15, 30),
        explanation:
          'Relação entre comentários e reações: quanto mais alta, mais debate genuíno o post gerou.',
      })
    }
    return signals
  }

  return signals
}

/**
 * Generates a single friendly, beginner-accessible diagnosis for one post
 * based on its platform-native signals and (optionally) the workspace's own
 * channel baseline.
 */
export function diagnosePost(
  channel: Channel,
  metrics: MetricPoint,
  signals: ReadonlyArray<ChannelSignalMetric>,
  channelAvgEngagementRate: number | null,
): PostDiagnosis | null {
  if (signals.length === 0 && metrics.engagementRate == null) return null

  const byId = new Map(signals.map((s) => [s.id, s]))

  if (channel === 'instagram') {
    const sends = byId.get('sends_per_reach')
    if (sends && sends.strength === 'strong') {
      return {
        badge: 'Alto potencial de descoberta',
        tone: 'positive',
        summary: `Teve ${sends.formattedValue} de envios por alcance — ótimo sinal de que o público está indicando este post para outras pessoas.`,
      }
    }
    const saves = byId.get('saves_per_reach')
    if (saves && saves.strength === 'strong') {
      return {
        badge: 'Conteúdo de referência',
        tone: 'positive',
        summary: `Alcançou ${saves.formattedValue} de salvamentos — o público considerou este conteúdo útil para guardar.`,
      }
    }
    const watch = byId.get('avg_watch_time')
    if (watch && watch.strength === 'strong') {
      return {
        badge: 'Ótima retenção',
        tone: 'positive',
        summary: `Tempo médio assistido de ${watch.formattedValue} — o gancho segurou bem a atenção no Reel.`,
      }
    }
  }

  if (channel === 'tiktok') {
    const shares = byId.get('shares_per_view')
    if (shares && shares.strength === 'strong') {
      return {
        badge: 'Alto potencial viral',
        tone: 'positive',
        summary: `${shares.formattedValue} das visualizações viraram compartilhamentos — sinal forte para distribuição no Para Você.`,
      }
    }
  }

  if (channel === 'x') {
    const bookmarks = byId.get('bookmarks_per_view')
    if (bookmarks && bookmarks.strength === 'strong') {
      return {
        badge: 'Conteúdo de alto valor',
        tone: 'positive',
        summary: `Teve ${bookmarks.formattedValue} de bookmarks por impressão — sinal de post que as pessoas querem reler.`,
      }
    }
    const amp = byId.get('amplification_per_view')
    if (amp && amp.strength === 'strong') {
      return {
        badge: 'Boa amplificação',
        tone: 'positive',
        summary: `${amp.formattedValue} das impressões viraram reposts ou citações.`,
      }
    }
  }

  if (channel === 'youtube') {
    const approval = byId.get('approval_per_view')
    if (approval && approval.strength === 'strong') {
      return {
        badge: 'Forte aprovação',
        tone: 'positive',
        summary: `${approval.formattedValue} dos espectadores curtiram ou comentaram o vídeo.`,
      }
    }
  }

  if (channel === 'linkedin') {
    const comments = byId.get('comments_per_post')
    if (comments && comments.strength === 'strong') {
      return {
        badge: 'Gerou boa conversa',
        tone: 'positive',
        summary: `${comments.formattedValue} comentários — ótimo volume para ampliar alcance para conexões de 2º grau.`,
      }
    }
  }

  // Fallback: compare against the workspace's own average on the same channel.
  if (metrics.engagementRate != null && channelAvgEngagementRate != null && channelAvgEngagementRate > 0) {
    if (metrics.engagementRate >= channelAvgEngagementRate * 1.2) {
      return {
        badge: 'Acima da sua média',
        tone: 'positive',
        summary: `Engajamento de ${pctFmt.format(metrics.engagementRate)}% contra sua média de ${pctFmt.format(channelAvgEngagementRate)}% neste canal.`,
      }
    }
    if (metrics.engagementRate <= channelAvgEngagementRate * 0.65) {
      return {
        badge: 'Abaixo da sua média',
        tone: 'attention',
        summary: `Engajamento de ${pctFmt.format(metrics.engagementRate)}% (sua média no canal é ${pctFmt.format(channelAvgEngagementRate)}%). Vale testar outro gancho ou formato.`,
      }
    }
  }

  const best = signals.find((s) => s.strength === 'good') ?? signals[0]
  if (best) {
    return {
      badge: 'Desempenho consistente',
      tone: 'info',
      summary: `${best.label}: ${best.formattedValue} — dentro do ritmo esperado para este canal.`,
    }
  }

  return null
}

/** Aggregates raw snapshots of a single channel into combined channel-level signals. */
export function aggregateChannelSignals(
  channel: Channel,
  snapshots: ReadonlyArray<MetricPoint>,
): Array<ChannelSignalMetric> {
  if (snapshots.length === 0) return []
  let views = 0
  let hasViews = false
  let reach = 0
  let hasReach = false
  let likes = 0
  let hasLikes = false
  let comments = 0
  let hasComments = false
  let shares = 0
  let hasShares = false
  let saves = 0
  let hasSaves = false
  let watchSum = 0
  let watchCount = 0

  for (const s of snapshots) {
    if (s.views != null) {
      views += s.views
      hasViews = true
    }
    if (s.reach != null) {
      reach += s.reach
      hasReach = true
    }
    if (s.likes != null) {
      likes += s.likes
      hasLikes = true
    }
    if (s.comments != null) {
      comments += s.comments
      hasComments = true
    }
    if (s.shares != null) {
      shares += s.shares
      hasShares = true
    }
    if (s.saves != null) {
      saves += s.saves
      hasSaves = true
    }
    if (s.avgWatchTimeMs != null && s.avgWatchTimeMs > 0) {
      watchSum += s.avgWatchTimeMs
      watchCount += 1
    }
  }

  return computeChannelSignalsFromTotals(
    channel,
    {
      views: hasViews ? views : null,
      reach: hasReach ? reach : null,
      likes: hasLikes ? likes : null,
      comments: hasComments ? comments : null,
      shares: hasShares ? shares : null,
      saves: hasSaves ? saves : null,
      avgWatchTimeMs: watchCount > 0 ? Math.round(watchSum / watchCount) : null,
      engagementRate: null,
    },
    snapshots.length,
  )
}
