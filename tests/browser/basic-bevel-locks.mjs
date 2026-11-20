// Basic-only production browser regression: synthetic offline boundaries, real paint and exports.
// BROWSER_PRODUCTION=1 BROWSER_TOOLS_PATH=... PLAYWRIGHT_BROWSERS_PATH=... node tests/browser/basic-bevel-locks.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
// PDF_RENDER_PYTHON points to an external Python environment with PyMuPDF.
const pdfPython = process.env.PDF_RENDER_PYTHON || 'python3'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
const root = path.resolve(process.env.TEST_PROJECT_ROOT || fileURLToPath(new URL('../..', import.meta.url)))
const appRequire = createRequire(path.join(root, 'package.json'))
const tools = createRequire(path.join(process.env.BROWSER_TOOLS_PATH || root + '/node_modules', '_browser.cjs'))
const { chromium } = tools('playwright')
const { PNG } = tools('pngjs')
const { createServer, build } = await import(pathToFileURL(appRequire.resolve('vite')).href)
const output = process.env.BROWSER_OUTPUT || '/opt/data/cache/scratch/mat-reconstruction-evidence'
mkdirSync(output, { recursive: true })
const mocks = new Set(['@/lib/store', '@/lib/quotes', '@/lib/jobs', '@/lib/invoices', '@/lib/customers', '@/lib/layout', '@/lib/billingAccess', '@/lib/effectiveSupplierAccess', '@/components/PresetControls', '@/components/RoomMockup', '@/lib/supabase'])
const fixtureModule = `
import React from 'react';
const catalog = { frames: [{id:'f',name:'Frame',faceWidthCm:2,pricePerMeter:10}],
 mats:[{id:'mat0',name:'None',pricePerSqM:0},{id:'m',name:'Green',color:'#00cc66',pricePerSqM:5},{id:'m2',name:'Blue',color:'#0000ff',pricePerSqM:6},{id:'m3',name:'Red',color:'#ff0000',pricePerSqM:7}],
 glazing:[{id:'g',name:'Glass',pricePerSqM:8}],settings:{currencyCode:'GBP',marginMultiplier:1.25,labourBase:10,taxRatePct:20}};
const customers=[{id:'c',firstName:'Test',lastName:'Customer',email:'test@example.test'}];
const capture=(kind)=>async payload=>{(window.documents ||= []).push({kind,payload}); return {ok:true,[kind]:{...payload,id:'fixture-'+kind}}};
export const useCatalog=()=>{ const [,refresh]=React.useState(0); window.changeMaterialColour=(id,colour)=>{const mat=catalog.mats.find(m=>m.id===id);mat.colour=mat.color;mat.color=colour;refresh(v=>v+1)}; return {catalog}; };
export const useQuotes=()=>({quotes:[],add:capture('quote')});
export const useJobs=()=>({add:capture('job')});
export const useInvoices=()=>({addInvoice:capture('invoice')});
export const useCustomers=()=>({customers}); export const validateCustomer=()=>[];
export const useLayout=()=>({layoutMode:'fixed'});
export const useBillingAccess=()=>({readOnly:false,companyAccountId:'local-fixture',companyName:'Local fixture'});
export const useEffectiveCompanyCatalogue=()=>({supplierProducts:[],selectionIssue:()=>null});
export const supabase=null;
export const toPng=async()=>'';
export default function FixturePreset({currentState,onApply,saveIssue}) {
 window.currentDesign=currentState; window.applyDesign=state=>onApply({state});
 return React.createElement('div',null,
  React.createElement('button',{disabled:!!saveIssue,onClick:()=>localStorage.setItem('browser-design',JSON.stringify(currentState))},'Save fixture'),
  React.createElement('button',{onClick:()=>onApply({state:JSON.parse(localStorage.getItem('browser-design'))})},'Load fixture'));
}`
const configuration = { root, configFile: false, envFile: false, css: { postcss: root }, server: { host: '127.0.0.1', port: 0 },
 resolve: { alias: [...mocks].map(id => ({ find: id, replacement: '\0stage-b:' + id })).concat([{ find: /^react$/, replacement: appRequire.resolve('react') }, { find: /^react-dom\/client$/, replacement: appRequire.resolve('react-dom/client') }, { find: '@', replacement: path.join(root, 'src') }]) },
 plugins: [{ name: 'offline-stage-b-fixture', enforce: 'pre',
  resolveId(id) { if (id.startsWith('/src/')) return path.join(root, id); if (id.startsWith('\0stage-b:')) return id; if (mocks.has(id)) return '\0stage-b:' + id; if (id === '/stage-b-entry.jsx') return '\0stage-b-entry' },
  load(id) { if (id === '\0stage-b:@/components/RoomMockup') return `import React from 'react'; import Room from '/src/components/RoomMockup.tsx'; export default function Observer(props){window.roomProps=props;return React.createElement(Room,props)}`; if (id.startsWith('\0stage-b:')) return fixtureModule;
   if (id === '\0stage-b-entry') return `import React from 'react'; import {createRoot} from 'react-dom/client'; import VisualizerApp from '/src/VisualizerApp.tsx'; import '/src/index.css'; createRoot(document.getElementById('root')).render(React.createElement('div',{id:'basic-test-shell',className:'app-shell min-h-dvh w-full bg-neutral-50 text-neutral-900'},React.createElement(VisualizerApp)));` },
  configureServer(s) { s.middlewares.use('/stage-b', (_req,res) => { res.setHeader('Content-Type','text/html'); res.end('<html><body><div id="root"></div><script type="module" src="/stage-b-entry.jsx"></script></body></html>') }) }
 }], esbuild: { jsx: 'automatic' } }
let server
if (process.env.BROWSER_PRODUCTION === '1') {
 const fixtureRoot=path.join(output,'fixture-source'),buildDirectory=path.join(output,'production-build')
 mkdirSync(fixtureRoot,{recursive:true});writeFileSync(path.join(fixtureRoot,'index.html'),'<html><body><div id="root"></div><script type="module" src="/stage-b-entry.jsx"></script></body></html>')
 await build({...configuration,root:fixtureRoot,publicDir:path.join(root,'public'),build:{outDir:buildDirectory,emptyOutDir:true}})
 const {createServer:httpServer}=await import('node:http')
 const http=httpServer((request,response)=>{
  let file
  try {
   const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname)
   file=path.resolve(buildDirectory,pathname==='/stage-b'?'index.html':'.'+pathname)
   if(!file.startsWith(path.resolve(buildDirectory)+path.sep)){response.statusCode=403;response.end();return}
  }catch{response.statusCode=400;response.end();return}
  try{const body=readFileSync(file);response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'text/html');response.end(body)}catch{response.statusCode=404;response.end()}
 })
 server={httpServer:http,listen:()=>new Promise(resolve=>http.listen(0,'127.0.0.1',resolve)),close:()=>new Promise(resolve=>http.close(resolve))}
} else server=await createServer(configuration)

let browser
const results=[]
const colours={top:[150,135,113],right:[221,208,184],bottom:[239,227,203],left:[176,161,138]}
const distance=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])))
function pixel(png,x,y){const i=(Math.max(0,Math.min(png.height-1,Math.floor(y)))*png.width+Math.max(0,Math.min(png.width-1,Math.floor(x))))*4;return [...png.data.subarray(i,i+3)]}
const rgb=s=>s.match(/[0-9.]+/g).slice(0,3).map(Number)
function luminance(c){const a=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
async function validateRaster(page,bytes,metadata,projection,label,tolerance=24){
 let png
 if(bytes[0]===137)png=PNG.sync.read(bytes)
 else {
  const encoded=await page.evaluate(async url=>{const i=new Image();i.src=url;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL('image/png').split(',')[1]},`data:image/jpeg;base64,${bytes.toString('base64')}`)
  png=PNG.sync.read(Buffer.from(encoded,'base64'))
 }
 const loc=([x,y])=>[(projection.x+x*projection.scaleX)*png.width,(projection.y+y*projection.scaleY)*png.height]
 const readings=[]
 for(const m of metadata){
  const {x,y,w,h,depth:d}=m
  const midpoints={top:[x+w/2,y-d/2],right:[x+w+d/2,y+h/2],bottom:[x+w/2,y+h+d/2],left:[x-d/2,y+h/2]}
  const facePixels={}
  for(const [side,point] of Object.entries(midpoints)){
   const [px,py]=loc(point),actual=pixel(png,px,py);facePixels[side]=actual
   assert.ok(distance(actual,colours[side])<=tolerance,`${label} layer ${m.layer} ${side}: actual ${actual}, expected ${colours[side]}`)
  }
  assert.ok(distance(facePixels.top,facePixels.bottom)>30,`${label}: shaded faces must not be a uniform outline`)
  // Shared 45-degree mitres must be painted, not pinholes exposing the mat/artwork.
  const corners=[[x-d/2,y-d/2],[x+w+d/2,y-d/2],[x+w+d/2,y+h+d/2],[x-d/2,y+h+d/2]]
  for(const p of corners){const c=pixel(png,...loc(p));assert.ok(Object.values(colours).some(expected=>distance(c,expected)<=tolerance+18),`${label} layer ${m.layer} unjoined corner: ${c}`)}
  readings.push({layer:m.layer,facePixels})
 }
 // The original aperture remains entirely artwork, not an inset or white border.
 const [w,h]=metadata.worldSize,inner=metadata.at(-1),epsX=Math.max(.035,1.5/(projection.scaleX*png.width)),epsY=Math.max(.035,1.5/(projection.scaleY*png.height))
 // A rasteriser may antialias the first boundary pixel; it must not be a white gap.
 for(const p of [[inner.x+.035,inner.y+inner.h/2],[inner.x+inner.w-.035,inner.y+inner.h/2],[inner.x+inner.w/2,inner.y+.035],[inner.x+inner.w/2,inner.y+inner.h-.035]])assert.ok(!pixel(png,...loc(p)).every(v=>v>=250),`${label}: white artwork outline at ${p}`)
 for(const p of [[inner.x+epsX,inner.y+inner.h/2],[inner.x+inner.w-epsX,inner.y+inner.h/2],[inner.x+inner.w/2,inner.y+epsY],[inner.x+inner.w/2,inner.y+inner.h-epsY],[w/2,h/2]]){
  const c=pixel(png,...loc(p));assert.ok(distance(c,[34,34,34])<=tolerance,`${label}: artwork/aperture changed at ${p} (${loc(p)}): ${c}`)
 }
 return readings
}
async function metadataFor(page){
 const metadata=await page.locator('[data-mat-bevel]').evaluateAll(es=>es.map(e=>{
  const points=e.querySelector('[data-bevel-face="top"]').getAttribute('points').split(/\s+/).map(v=>v.split(',').map(Number));
  const bottom=e.querySelector('[data-bevel-face="bottom"]').getAttribute('points').split(/\s+/).map(v=>v.split(',').map(Number));
  return {layer:Number(e.getAttribute('data-mat-bevel')),x:points[3][0],y:points[3][1],w:points[2][0]-points[3][0],h:bottom[2][1]-points[3][1],depth:points[3][0]-points[0][0]}
 }))
 // SVG paints inner to outer. Sorting makes the innermost aperture the final entry.
 metadata.sort((a,b)=>a.layer-b.layer);metadata.worldSize=(await page.getByTestId('mat-layers').getAttribute('viewBox')).split(' ').slice(2).map(Number)
 return metadata
}
try {
 await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/stage-b`
 browser=await chromium.launch({headless:true,args:['--no-sandbox']})
 for(const theme of ['light','dark'])for(const layout of ['desktop','narrow']){
  const context=await browser.newContext({viewport:layout==='desktop'?{width:1600,height:1200}:{width:390,height:844},deviceScaleFactor:2,acceptDownloads:true})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith('https://fonts.googleapis.com/'))return route.fulfill({contentType:'text/css',body:''});if(u.startsWith('http')&&!u.startsWith(`http://127.0.0.1:${address.port}/`))return route.abort();return route.continue()})
  await page.goto(url);await page.waitForFunction(()=>!!window.currentDesign)
  const setTheme=()=>page.evaluate(theme=>document.getElementById('basic-test-shell').className=theme==='dark'?'app-shell min-h-dvh w-full app-theme-dark bg-slate-950 text-slate-100':'app-shell min-h-dvh w-full bg-neutral-50 text-neutral-900',theme)
  await setTheme()
  await page.locator('#artUpload').setInputFiles({name:'synthetic.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#222222"/></svg>')});await page.waitForFunction(()=>window.currentDesign.art.imageUrl)
  await page.getByLabel('Mat 1 material',{exact:true}).selectOption('m');await page.getByText('+ Add second mat',{exact:true}).click();await page.getByLabel('Mat 2 material',{exact:true}).selectOption('m2');await page.getByText('+ Add third mat',{exact:true}).click();await page.getByLabel('Mat 3 material',{exact:true}).selectOption('m3')
  const snapshot=()=>page.evaluate(()=>structuredClone(window.currentDesign.visualizerDesign.basic))
  const initial=await snapshot();assert.deepEqual(initial.mats.map(m=>m.locked),[true,true,true])
  const visibility=[]
  for(const n of [1,2,3]){
   const button=page.getByRole('button',{name:`Unlock Mat ${n} borders`,exact:true});await button.scrollIntoViewIfNeeded()
   assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(await button.locator('[data-mat-lock-icon="locked"]').count(),1)
   const v=await button.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {colour:s.color,background:s.backgroundColor,x:r.x,right:r.right,width:r.width,height:r.height,viewport:innerWidth}})
   assert.ok(contrast(rgb(v.colour),rgb(v.background))>=4.5);assert.ok(v.x>=0&&v.right<=v.viewport,`${layout} Mat ${n} control clipped`);assert.ok(v.height>=44)
   await page.getByLabel(`Mat ${n} material`,{exact:true}).locator('..').screenshot({animations:'disabled',path:path.join(output,`${theme}-${layout}-mat${n}-locked.png`)})
   visibility.push({mat:n,contrast:contrast(rgb(v.colour),rgb(v.background)),height:v.height})
  }
  if(layout==='desktop')for(const palette of ['light-dark-light','dark-light-dark']){
   await page.evaluate(p=>{for(const [i,id] of ['m','m2','m3'].entries())window.changeMaterialColour(id,((i%2===0)===(p==='light-dark-light'))?'#f5f0df':'#1b2838')},palette)
   await page.waitForTimeout(250)
   assert.equal(await page.locator('[data-bevel-face]').count(),12)
   const metadata=await metadataFor(page),[w,h]=metadata.worldSize,board=page.getByTestId('mat-layers')
   const screenshot=await board.screenshot({animations:'disabled',path:path.join(output,`${theme}-${palette}-preview.png`)})
   const alignment=await board.evaluate(e=>{const s=e.getScreenCTM(),r=document.querySelector('img[alt="artwork"]').getBoundingClientRect();return {matrix:[s.a,s.d,s.e,s.f],art:[r.x,r.y,r.width,r.height]}})
   const inner=metadata.at(-1),[sx,sy,ox,oy]=alignment.matrix
   for(const [i,expected] of [ox+inner.x*sx,oy+inner.y*sy,inner.w*sx,inner.h*sy].entries())assert.ok(Math.abs(alignment.art[i]-expected)<.05,'Basic artwork and aperture paint must align')
   const preview=await validateRaster(page,screenshot,metadata,{x:0,y:0,scaleX:1/w,scaleY:1/h},`${theme} ${palette} preview`)
   const rootBox=await board.evaluate(e=>{const r=e.closest('.shadow-inner').getBoundingClientRect(),s=e.getBoundingClientRect();return {x:(s.x-r.x)/r.width,y:(s.y-r.y)/r.height,scaleX:s.width/r.width,scaleY:s.height/r.height}})
   const projection={...rootBox,scaleX:rootBox.scaleX/w,scaleY:rootBox.scaleY/h}
   const exports=[]
   for(const format of ['PNG','JPG','PDF']){
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export image ▾',exact:true}).click();await page.getByRole('button',{name:format,exact:true}).click()
    const download=await event,file=path.join(output,`${theme}-${palette}.${format.toLowerCase()}`);await download.saveAs(file);assert.equal(await download.failure(),null)
    let bytes=readFileSync(file)
    if(format==='PDF'){
     assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const f=bytes.indexOf('/DCTDecode'),a=bytes.indexOf(Buffer.from([255,216]),f),b=bytes.indexOf(Buffer.from([255,217]),a)+2;assert.ok(f>0&&a>f&&b>a);bytes=bytes.subarray(a,b);writeFileSync(file+'.embedded.jpg',bytes)
    }
    const faces=await validateRaster(page,bytes,metadata,projection,`${theme} ${palette} ${format}`,format==='PNG'?28:48)
    let renderedPage
    if(format==='PDF'){
     const render=JSON.parse(execFileSync(pdfPython,['-c',[
      'import pymupdf,sys,json',
      'd=pymupdf.open(sys.argv[1]); assert len(d)==1; p=d[0]',
      'images=p.get_images(); assert len(images)==1; r=p.get_image_rects(images[0][0])[0]',
      'assert p.rect.contains(r)',
      'z=3; pix=p.get_pixmap(matrix=pymupdf.Matrix(z,z),clip=r,alpha=False); pix.save(sys.argv[1]+".rendered.png")',
      'p.get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).save(sys.argv[1]+".page.png")',
      'print(json.dumps(dict(x=(r.x0*z-pix.x)/pix.width,y=(r.y0*z-pix.y)/pix.height,sx=r.width*z/pix.width,sy=r.height*z/pix.height)))',
     ].join('\n'),file],{encoding:'utf8'}))
     const p={x:render.x+projection.x*render.sx,y:render.y+projection.y*render.sy,scaleX:projection.scaleX*render.sx,scaleY:projection.scaleY*render.sy}
     renderedPage=await validateRaster(page,readFileSync(file+'.rendered.png'),metadata,p,`${theme} ${palette} rendered PDF page`,48)
    }
    exports.push({format,faces,renderedPage})
   }
   results.push({workflow:'bevel preview and actual exports',theme,palette,preview,exports})
  }
  // Parameterise every mat and every edge, retaining other mats and independent locks.
  for(const n of [1,2,3]){
   const unit=n===1?'cm':'mm',factor=n===1?1:10
   for(const side of ['Top','Bottom','Left','Right']){
    const previous=await snapshot();await page.getByLabel(`Mat ${n} ${side} (${unit})`,{exact:true}).fill(String(6*factor))
    const next=await snapshot();assert.deepEqual(next.mats[n-1].borders,{top:6,bottom:6,left:6,right:6});assert.deepEqual(next.mats.filter((_,i)=>i!==n-1),previous.mats.filter((_,i)=>i!==n-1))
   }
   await page.getByRole('button',{name:`Unlock Mat ${n} borders`,exact:true}).click();assert.equal(await page.locator(`[aria-label="Lock Mat ${n} borders"] [data-mat-lock-icon="unlocked"]`).count(),1)
   for(const [i,side] of ['Top','Bottom','Left','Right'].entries()){
    const previous=await snapshot();await page.getByLabel(`Mat ${n} ${side} (${unit})`,{exact:true}).fill(String((i+2)*factor));const next=await snapshot()
    assert.deepEqual(next.mats[n-1].borders,{...previous.mats[n-1].borders,[side.toLowerCase()]:i+2});assert.deepEqual(next.mats.filter((_,j)=>j!==n-1),previous.mats.filter((_,j)=>j!==n-1))
   }
   const unlocked=page.getByRole('button',{name:`Lock Mat ${n} borders`,exact:true});await unlocked.scrollIntoViewIfNeeded()
   assert.equal(await unlocked.getAttribute('aria-pressed'),'false')
   const u=await unlocked.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {colour:s.color,background:s.backgroundColor,x:r.x,right:r.right,height:r.height,viewport:innerWidth}})
   assert.ok(contrast(rgb(u.colour),rgb(u.background))>=4.5);assert.ok(u.x>=0&&u.right<=u.viewport);assert.ok(u.height>=44)
   visibility.push({mat:n,state:'unlocked',contrast:contrast(rgb(u.colour),rgb(u.background)),height:u.height})
   await page.getByLabel(`Mat ${n} material`,{exact:true}).locator('..').screenshot({animations:'disabled',path:path.join(output,`${theme}-${layout}-mat${n}-unlocked.png`)})
   const before=await snapshot();await page.getByRole('button',{name:`Lock Mat ${n} borders`,exact:true}).click();assert.deepEqual((await snapshot()).mats.map(m=>m.borders),before.mats.map(m=>m.borders))
   // Keep different flags in the saved snapshot, including unequal-but-explicitly-locked mats.
   if(n===2)await page.getByRole('button',{name:'Unlock Mat 2 borders',exact:true}).click()
  }
  const saved=await snapshot();await page.getByText('Save fixture',{exact:true}).click();await page.reload();await page.waitForFunction(()=>window.currentDesign);await page.getByText('Load fixture',{exact:true}).click();await setTheme();assert.deepEqual(await snapshot(),saved)
  for(const explicit of [false,true]){
   const borders=[{top:1,bottom:2,left:3,right:4},{top:2,bottom:2,left:2,right:2},{top:1,bottom:1,left:1,right:1}]
   await page.evaluate(({borders,explicit})=>window.applyDesign({art:{widthCm:40,heightCm:30},mats:{geometryVersion:3,mode:'basic',selectedMat1:'m',selectedMat2:'m2',selectedMat3:'m3',borders,...(explicit?{locks:[true,false,true]}:{})}}),{borders,explicit})
   assert.deepEqual((await snapshot()).mats.map(m=>m.borders),borders);assert.equal((await snapshot()).mats[0].locked,explicit)
  }
  assert.deepEqual(errors,[]);results.push({workflow:'Basic locks, editing and unequal persistence',theme,layout,visibility,allMatsAllEdges:true,nativeSaveReload:true,legacyUnequalPreserved:true});await context.close()
 }
 writeFileSync(path.join(output,'results.json'),JSON.stringify({production:process.env.BROWSER_PRODUCTION==='1',results},null,2));console.log(JSON.stringify({passed:results.length,results:results.map(({workflow,theme,palette,layout})=>({workflow,theme,palette,layout}))},null,2))
}finally{await browser?.close();await server.close()}
