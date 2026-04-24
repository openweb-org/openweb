import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

type R = Record<string, unknown>
type Errors = AdapterErrorHelpers

const BASE = 'https://www.zhipin.com'

async function fetchJson(url: string, errors: Errors): Promise<R> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function trimCity(c: R, includeChildren: boolean): R {
  const result: R = { code: c.code, name: c.name }
  if (includeChildren && Array.isArray(c.subLevelModelList)) {
    result.subLevelModelList = c.subLevelModelList.map((sub: R) => trimCity(sub, false))
  }
  return result
}

function trimIndustry(ind: R): R {
  const result: R = { code: ind.code, name: ind.name }
  if (Array.isArray(ind.subLevelModelList)) {
    result.subLevelModelList = ind.subLevelModelList.map((sub: R) => ({ code: sub.code, name: sub.name }))
  }
  return result
}

async function getCities(errors: Errors): Promise<unknown> {
  const raw = await fetchJson(`${BASE}/wapi/zpCommon/data/city.json`, errors)
  const zp = raw.zpData as R | undefined
  if (!zp) throw errors.apiError('getCities', 'Missing zpData')
  const hot = (zp.hotCityList as R[] | undefined) ?? []
  const provinces = (zp.cityList as R[] | undefined) ?? []
  return {
    hotCityList: hot.map((c) => trimCity(c, false)),
    cityList: provinces.map((p) => trimCity(p, true)),
  }
}

async function getIndustries(errors: Errors): Promise<unknown> {
  const raw = await fetchJson(`${BASE}/wapi/zpCommon/data/industry.json`, errors)
  const zp = raw.zpData as R[] | undefined
  if (!Array.isArray(zp)) throw errors.apiError('getIndustries', 'Missing zpData')
  return zp.map(trimIndustry)
}

async function getFilterConditions(errors: Errors): Promise<unknown> {
  const raw = await fetchJson(`${BASE}/wapi/zpgeek/pc/all/filter/conditions.json`, errors)
  const zp = raw.zpData as R | undefined
  if (!zp) throw errors.apiError('getFilterConditions', 'Missing zpData')
  const trim = (list: unknown) =>
    Array.isArray(list) ? list.map((item: R) => ({ code: item.code, name: item.name })) : []
  return {
    salaryList: trim(zp.salaryList),
    experienceList: trim(zp.experienceList),
    degreeList: trim(zp.degreeList),
    stageList: trim(zp.stageList),
    scaleList: trim(zp.scaleList),
    jobTypeList: trim(zp.jobTypeList),
  }
}

export default {
  name: 'boss',
  description: 'Boss直聘 reference data — trims city/industry/filter responses',
  async run(ctx) {
    const { operation, helpers } = ctx
    const errors = helpers.errors
    switch (operation) {
      case 'getCities': return getCities(errors)
      case 'getIndustries': return getIndustries(errors)
      case 'getFilterConditions': return getFilterConditions(errors)
      default: throw errors.unknownOp(operation)
    }
  },
} satisfies CustomRunner
