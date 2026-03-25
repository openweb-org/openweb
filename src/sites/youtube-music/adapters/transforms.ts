export type Obj = Record<string, unknown>

export function runs(obj: unknown): string {
  const r = (obj as Obj)?.runs as Array<Obj> | undefined
  return r?.map((run) => String(run.text ?? '')).join('') ?? ''
}

function flexCol(item: Obj, index: number): string {
  const cols = item.flexColumns as Array<Obj> | undefined
  const col = cols?.[index] as Obj | undefined
  return runs(col?.musicResponsiveListItemFlexColumnRenderer?.text)
}

function fixedCol(item: Obj, index: number): string {
  const cols = item.fixedColumns as Array<Obj> | undefined
  const col = cols?.[index] as Obj | undefined
  return runs((col?.musicResponsiveListItemFixedColumnRenderer as Obj)?.text)
}

export function thumbUrl(item: Obj): string | null {
  const renderer = (item.thumbnail as Obj)?.musicThumbnailRenderer as Obj
  const thumbs = (renderer?.thumbnail as Obj)?.thumbnails as Array<Obj> | undefined
  return thumbs?.[0]?.url ? String(thumbs[0].url) : null
}

function overlayVideoId(item: Obj): string | null {
  const overlay = (item.overlay as Obj)?.musicItemThumbnailOverlayRenderer as Obj
  const play = (overlay?.content as Obj)?.musicPlayButtonRenderer as Obj
  const ep = play?.playNavigationEndpoint as Obj
  return ((ep?.watchEndpoint as Obj)?.videoId as string) ?? null
}

function parseMusicItem(item: Obj): Obj {
  return {
    title: flexCol(item, 0),
    subtitle: flexCol(item, 1),
    plays: flexCol(item, 2),
    duration: fixedCol(item, 0) || null,
    videoId: overlayVideoId(item),
    thumbnail: thumbUrl(item),
  }
}

export function browseContents(data: Obj): Array<Obj> {
  const single = (data.contents as Obj)?.singleColumnBrowseResultsRenderer as Obj
  const tab = ((single?.tabs as Array<Obj>)?.[0]?.tabRenderer as Obj)?.content as Obj
  return ((tab?.sectionListRenderer as Obj)?.contents as Array<Obj>) ?? []
}

export function twoColBrowse(data: Obj): { primary: Array<Obj>; secondary: Array<Obj> } {
  const twoCol = (data.contents as Obj)?.twoColumnBrowseResultsRenderer as Obj
  const primaryTab = (twoCol?.tabs as Array<Obj>)?.[0]?.tabRenderer as Obj
  const primaryContent = (primaryTab?.content as Obj)?.sectionListRenderer as Obj
  const secondaryContent = (twoCol?.secondaryContents as Obj)?.sectionListRenderer as Obj
  return {
    primary: (primaryContent?.contents as Array<Obj>) ?? [],
    secondary: (secondaryContent?.contents as Array<Obj>) ?? [],
  }
}

export function parseShelfItems(shelf: Obj): Array<Obj> {
  const contents = (shelf?.contents as Array<Obj>) ?? []
  return contents.map((c) => {
    const item = c.musicResponsiveListItemRenderer as Obj
    return item ? parseMusicItem(item) : {}
  }).filter((i) => i.title)
}

export function parseCarouselItems(shelf: Obj): Array<Obj> {
  const contents = (shelf?.contents as Array<Obj>) ?? []
  return contents.map((c) => {
    const twoRow = c.musicTwoRowItemRenderer as Obj
    if (twoRow) {
      const navEndpoint = twoRow.navigationEndpoint as Obj
      const browseEp = navEndpoint?.browseEndpoint as Obj
      const watchEp = navEndpoint?.watchEndpoint as Obj
      const thumbRenderer = (twoRow.thumbnailRenderer as Obj)?.musicThumbnailRenderer as Obj
      const thumbs = ((thumbRenderer?.thumbnail as Obj)?.thumbnails as Array<Obj>) ?? []
      return {
        title: runs(twoRow.title),
        subtitle: runs(twoRow.subtitle),
        browseId: browseEp?.browseId ?? null,
        videoId: watchEp?.videoId ?? null,
        thumbnail: thumbs[0]?.url ? String(thumbs[0].url) : null,
      }
    }
    const listItem = c.musicResponsiveListItemRenderer as Obj
    return listItem ? parseMusicItem(listItem) : {}
  }).filter((i) => i.title)
}
