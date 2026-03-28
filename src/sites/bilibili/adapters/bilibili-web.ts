import type { Page } from 'playwright-core'
import type { CodeAdapter } from '../../../types/adapter.js'

const API_BASE = 'https://api.bilibili.com'

interface OpDef {
  path: string
  requiredParams?: string[]
  defaultParams?: Record<string, unknown>
}

const OPERATIONS: Record<string, OpDef> = {
  getRanking: {
    path: '/x/web-interface/ranking/v2',
    defaultParams: { rid: 0, type: 'all' },
  },
  getUserInfo: {
    path: '/x/space/wbi/acc/info',
    requiredParams: ['mid'],
    defaultParams: { platform: 'web' },
  },
  getUserVideos: {
    path: '/x/space/wbi/arc/search',
    requiredParams: ['mid'],
    defaultParams: { pn: 1, ps: 25, order: 'pubdate', tid: 0, keyword: '' },
  },
  getVideoComments: {
    path: '/x/v2/reply/wbi/main',
    requiredParams: ['oid', 'type'],
    defaultParams: { mode: 3, plat: 1, pagination_str: '{"offset":""}' },
  },
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

async function browserFetchWithWbi(
  page: Page,
  path: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // Inject the Wbi helper into the page as a global function
  await page.evaluate(`
    window.__biliWbiFetch = async function(base, apiPath, params, tab) {
      var navR = await fetch(base + '/x/web-interface/nav', { credentials: 'include' });
      var navJ = await navR.json();
      var wbi = navJ && navJ.data && navJ.data.wbi_img;
      if (!wbi || !wbi.img_url || !wbi.sub_url) return JSON.stringify({ status: 500, text: '{"code":-1}' });

      var gk = function(u) { var p = u.split('/'); return p[p.length-1].split('.')[0]; };
      var raw = gk(wbi.img_url) + gk(wbi.sub_url);
      var mixin = '';
      for (var i = 0; i < tab.length && mixin.length < 32; i++) mixin += raw[tab[i]];

      var wts = Math.floor(Date.now() / 1000);
      var ap = {};
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var v = params[keys[i]];
        if (v !== undefined && v !== null) ap[keys[i]] = String(v).replace(/[!'()*]/g, '');
      }
      ap['wts'] = String(wts);

      var sk = Object.keys(ap).sort();
      var qs = sk.map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(ap[k]); }).join('&');

      // MD5
      function safeAdd(x,y){var l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xFFFF;}
      function brl(n,c){return n<<c|n>>>32-c;}
      function cmn(q,a,b,x,s,t){return safeAdd(brl(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
      function f1(a,b,c,d,x,s,t){return cmn(b&c|~b&d,a,b,x,s,t);}
      function f2(a,b,c,d,x,s,t){return cmn(b&d|c&~d,a,b,x,s,t);}
      function f3(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
      function f4(a,b,c,d,x,s,t){return cmn(c^(b|~d),a,b,x,s,t);}
      function md5(s){
        var X=[],len=s.length*8;
        for(var j=0;j<s.length*8;j+=8)X[j>>5]|=(s.charCodeAt(j/8)&0xFF)<<j%32;
        X[len>>5]|=0x80<<len%32;X[((len+64>>>9)<<4)+14]=len;
        var a=1732584193,b=-271733879,c=-1732584194,d=271733878;
        for(var j=0;j<X.length;j+=16){
          var oa=a,ob=b,oc=c,od=d;
          a=f1(a,b,c,d,X[j]||0,7,-680876936);d=f1(d,a,b,c,X[j+1]||0,12,-389564586);c=f1(c,d,a,b,X[j+2]||0,17,606105819);b=f1(b,c,d,a,X[j+3]||0,22,-1044525330);
          a=f1(a,b,c,d,X[j+4]||0,7,-176418897);d=f1(d,a,b,c,X[j+5]||0,12,1200080426);c=f1(c,d,a,b,X[j+6]||0,17,-1473231341);b=f1(b,c,d,a,X[j+7]||0,22,-45705983);
          a=f1(a,b,c,d,X[j+8]||0,7,1770035416);d=f1(d,a,b,c,X[j+9]||0,12,-1958414417);c=f1(c,d,a,b,X[j+10]||0,17,-42063);b=f1(b,c,d,a,X[j+11]||0,22,-1990404162);
          a=f1(a,b,c,d,X[j+12]||0,7,1804603682);d=f1(d,a,b,c,X[j+13]||0,12,-40341101);c=f1(c,d,a,b,X[j+14]||0,17,-1502002290);b=f1(b,c,d,a,X[j+15]||0,22,1236535329);
          a=f2(a,b,c,d,X[j+1]||0,5,-165796510);d=f2(d,a,b,c,X[j+6]||0,9,-1069501632);c=f2(c,d,a,b,X[j+11]||0,14,643717713);b=f2(b,c,d,a,X[j]||0,20,-373897302);
          a=f2(a,b,c,d,X[j+5]||0,5,-701558691);d=f2(d,a,b,c,X[j+10]||0,9,38016083);c=f2(c,d,a,b,X[j+15]||0,14,-660478335);b=f2(b,c,d,a,X[j+4]||0,20,-405537848);
          a=f2(a,b,c,d,X[j+9]||0,5,568446438);d=f2(d,a,b,c,X[j+14]||0,9,-1019803690);c=f2(c,d,a,b,X[j+3]||0,14,-187363961);b=f2(b,c,d,a,X[j+8]||0,20,1163531501);
          a=f2(a,b,c,d,X[j+13]||0,5,-1444681467);d=f2(d,a,b,c,X[j+2]||0,9,-51403784);c=f2(c,d,a,b,X[j+7]||0,14,1735328473);b=f2(b,c,d,a,X[j+12]||0,20,-1926607734);
          a=f3(a,b,c,d,X[j+5]||0,4,-378558);d=f3(d,a,b,c,X[j+8]||0,11,-2022574463);c=f3(c,d,a,b,X[j+11]||0,16,1839030562);b=f3(b,c,d,a,X[j+14]||0,23,-35309556);
          a=f3(a,b,c,d,X[j+1]||0,4,-1530992060);d=f3(d,a,b,c,X[j+4]||0,11,1272893353);c=f3(c,d,a,b,X[j+7]||0,16,-155497632);b=f3(b,c,d,a,X[j+10]||0,23,-1094730640);
          a=f3(a,b,c,d,X[j+13]||0,4,681279174);d=f3(d,a,b,c,X[j]||0,11,-358537222);c=f3(c,d,a,b,X[j+3]||0,16,-722521979);b=f3(b,c,d,a,X[j+6]||0,23,76029189);
          a=f3(a,b,c,d,X[j+9]||0,4,-640364487);d=f3(d,a,b,c,X[j+12]||0,11,-421815835);c=f3(c,d,a,b,X[j+15]||0,16,530742520);b=f3(b,c,d,a,X[j+2]||0,23,-995338651);
          a=f4(a,b,c,d,X[j]||0,6,-198630844);d=f4(d,a,b,c,X[j+7]||0,10,1126891415);c=f4(c,d,a,b,X[j+14]||0,15,-1416354905);b=f4(b,c,d,a,X[j+5]||0,21,-57434055);
          a=f4(a,b,c,d,X[j+12]||0,6,1700485571);d=f4(d,a,b,c,X[j+3]||0,10,-1894986606);c=f4(c,d,a,b,X[j+10]||0,15,-1051523);b=f4(b,c,d,a,X[j+1]||0,21,-2054922799);
          a=f4(a,b,c,d,X[j+8]||0,6,1873313359);d=f4(d,a,b,c,X[j+15]||0,10,-30611744);c=f4(c,d,a,b,X[j+6]||0,15,-1560198380);b=f4(b,c,d,a,X[j+13]||0,21,1309151649);
          a=f4(a,b,c,d,X[j+4]||0,6,-145523070);d=f4(d,a,b,c,X[j+11]||0,10,-1120210379);c=f4(c,d,a,b,X[j+2]||0,15,718787259);b=f4(b,c,d,a,X[j+9]||0,21,-343485551);
          a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
        }
        var h=[a,b,c,d],hx='0123456789abcdef',o='';
        for(var j=0;j<h.length*32;j+=8){var v=(h[j>>5]>>>j%32)&0xFF;o+=hx.charAt(v>>>4&0x0F)+hx.charAt(v&0x0F);}
        return o;
      }

      var wRid = md5(qs + mixin);
      ap['w_rid'] = wRid;
      var fk = Object.keys(ap).sort();
      var fqs = fk.map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(ap[k]); }).join('&');
      var resp = await fetch(base + apiPath + '?' + fqs, { credentials: 'include' });
      return JSON.stringify({ status: resp.status, text: await resp.text() });
    };
  `)

  const argsJson = JSON.stringify({
    base: API_BASE,
    path,
    params,
    tab: MIXIN_KEY_ENC_TAB,
  })

  const resultJson = await page.evaluate(
    `window.__biliWbiFetch(${JSON.stringify(API_BASE)}, ${JSON.stringify(path)}, ${JSON.stringify(params)}, ${JSON.stringify(MIXIN_KEY_ENC_TAB)})`,
  )

  const result = JSON.parse(resultJson as string) as { status: number; text: string }
  if (result.status >= 400) {
    throw new Error(`HTTP ${result.status}`)
  }
  return JSON.parse(result.text)
}

const adapter: CodeAdapter = {
  name: 'bilibili-web',
  description: 'Bilibili API adapter — computes Wbi signing in browser context',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('bilibili.com')) return true
    await page.goto('https://www.bilibili.com', { waitUntil: 'domcontentloaded', timeout: 15000 })
    return true
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const def = OPERATIONS[operation]
    if (!def) throw new Error(`Unknown operation: ${operation}`)

    for (const req of def.requiredParams ?? []) {
      if (params[req] === undefined) throw new Error(`Missing required parameter: ${req}`)
    }

    const merged = { ...def.defaultParams, ...params }
    return browserFetchWithWbi(page, def.path, merged)
  },
}

export default adapter
