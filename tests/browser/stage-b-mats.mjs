// Offline Chromium regression: real VisualizerApp and SVG paint, fake persistence/auth boundaries.
// Run: BROWSER_TOOLS_PATH=/path/to/node_modules PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers node tests/browser/stage-b-mats.mjs
// Install playwright + pngjs in an external scratch directory; no app dependency changes are needed.
import assert from 'node:assert/strict'
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
const output = process.env.BROWSER_OUTPUT || '/opt/data/cache/scratch/stage-b-browser-evidence'
mkdirSync(output, { recursive: true })
const mocks = new Set(['@/lib/store', '@/lib/quotes', '@/lib/jobs', '@/lib/invoices', '@/lib/customers', '@/lib/layout', '@/lib/billingAccess', '@/lib/effectiveSupplierAccess', '@/components/PresetControls', 'html-to-image', '@/lib/supabase'])
const fixtureModule = `
import React from 'react';
import { independentFixture } from '${path.join(root, 'tests/helpers/visualizerWorkspaceFixture.ts')}';
window.independentFixture = independentFixture;
const catalog = { frames: [{id:'f',name:'Frame',faceWidthCm:2,pricePerMeter:10}],
 mats:[{id:'mat0',name:'None',pricePerSqM:0},{id:'m',name:'Green',color:'#00cc66',pricePerSqM:5},{id:'m2',name:'Blue',color:'#0000ff',pricePerSqM:6},{id:'m3',name:'Red',color:'#ff0000',pricePerSqM:7}],
 glazing:[{id:'g',name:'Glass',pricePerSqM:8}],settings:{currencyCode:'GBP',marginMultiplier:1.25,labourBase:10,taxRatePct:20}};
const customers=[{id:'c',firstName:'Test',lastName:'Customer',email:'test@example.test'}];
const capture=(kind)=>async payload=>{(window.documents ||= []).push({kind,payload}); return {ok:true,[kind]:{...payload,id:'fixture-'+kind}}};
export const useCatalog=()=>({catalog});
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
   if (id === '\0stage-b-entry') return `import React from 'react'; import {createRoot} from 'react-dom/client'; import VisualizerApp from '/src/VisualizerApp.tsx'; import '/src/index.css'; createRoot(document.getElementById('root')).render(React.createElement(VisualizerApp));` },
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
try {
 await server.listen()
 const address=server.httpServer.address(), url=`http://127.0.0.1:${address.port}/stage-b`
 if(process.env.BROWSER_PRODUCTION==='1')assert.equal((await fetch(`http://127.0.0.1:${address.port}/%2e%2e%2fpackage.json`)).status,403)
 browser=await chromium.launch({headless:true,args:['--no-sandbox']})
 for (const mode of ['basic','pro']) for (const shape of ['rect','oval','circle']) {
  const page=await browser.newPage({viewport:{width:1600,height:1200},deviceScaleFactor:1})
  const errors=[]; const external=[]
  page.on('pageerror',error=>errors.push(String(error)))
  await page.route('**/*',route=>{ const u=route.request().url(); if (u.startsWith('https://fonts.googleapis.com/')) return route.fulfill({contentType:'text/css',body:''}); if (u.startsWith('http') && !u.startsWith(`http://127.0.0.1:${address.port}/`)) {external.push(u); return route.abort()} return route.continue() })
  await page.goto(url); await page.waitForFunction(()=>!!window.applyDesign)
  const image='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="#222222"/></svg>').toString('base64')
  const opening={id:'one',shape,xCm:5,yCm:5,widthCm:30,heightCm:30,imageUrl:image}
  await page.evaluate(({mode,opening,image})=>window.applyDesign(window.independentFixture({art:{widthCm:30,heightCm:30,imageUrl:image},mats:{layoutModel:'single-board-v1',selectedMat1:'m',mode:'basic',locks:[false,false,false],openings:[opening]}})),{mode,opening,image})
  await page.getByLabel('Mat 1 Left (cm)',{exact:true}).fill('9')
  await page.getByText('+ Add second mat',{exact:true}).click()
  await page.locator('select').filter({has:page.locator('option[value="m2"]')}).nth(1).selectOption('m2')
  await page.getByText('+ Add third mat',{exact:true}).click()
  await page.locator('select').filter({has:page.locator('option[value="m3"]')}).nth(2).selectOption('m3')
  const board=page.getByTestId('mat-layers')
  assert.equal(await page.getByLabel('Mat 2 Left (mm)',{exact:true}).inputValue(),'20')
  assert.equal(await page.getByLabel('Mat 3 Left (mm)',{exact:true}).inputValue(),'10')
  if(mode==='pro'){await page.locator('select').filter({has:page.locator('option[value="pro"]')}).selectOption('pro'); await page.getByLabel('Pro mat material',{exact:true}).selectOption('m'); await page.getByRole('button',{name:'Unlock Pro mat borders',exact:true}).click(); await page.getByLabel('Pro mat Left (cm)',{exact:true}).fill('9')}
  const w=mode==='pro'?44:50,h=mode==='pro'?40:46
  assert.equal(await board.getAttribute('viewBox'),`0 0 ${w} ${h}`)
  const png=PNG.sync.read(await board.screenshot({path:path.join(output,`${mode}-${shape}.png`)}))
  const sample=(x,y)=>{ const px=Math.floor(x/w*png.width),py=Math.floor(y/h*png.height),i=(py*png.width+px)*4; return [...png.data.subarray(i,i+3)] }
  assert.deepEqual(sample(4.5,23),[0,204,102],'Mat 1 must be painted green')
  if(mode==='basic'){assert.deepEqual(sample(10,23),[0,0,255],'Mat 2 must be painted blue');assert.deepEqual(sample(11.5,23),[255,0,0],'Mat 3 must be painted red')}else{assert.equal(await board.locator('[data-mat-layer]').count(),1);assert.equal(await page.getByLabel('Mat 2 material',{exact:true}).count(),0)}
  const saved=await page.evaluate(()=>structuredClone(window.currentDesign))
  assert.deepEqual(saved.mats.openings,[opening]); assert.equal(saved.mats.geometryVersion,3)
  await page.getByText('Save fixture',{exact:true}).click()
  await page.reload(); await page.waitForFunction(()=>!!window.applyDesign)
  await page.getByText('Load fixture',{exact:true}).click()
  await page.waitForFunction(()=>window.currentDesign.visualizerDesign.basic.mats[2].materialId==='m3')
  assert.deepEqual(await page.evaluate(()=>window.currentDesign),saved)
  if(mode==='pro') {
   const target=page.getByTitle('Drag to move. Use handles to resize.',{exact:true})
   await target.hover()
   await page.getByTitle('Drag to resize (SE)',{exact:true}).waitFor({state:'visible'})
   const box=await page.getByTitle('Drag to resize (SE)',{exact:true}).boundingBox()
   await page.mouse.move(box.x+6,box.y+6); await page.mouse.down(); await page.mouse.move(box.x+14,box.y+14)
   await page.waitForTimeout(2800)
   assert.equal(await page.getByTitle('Drag to resize (SE)',{exact:true}).count(),1)
   await page.mouse.up(); await page.mouse.move(0,0)
   await page.waitForTimeout(2800)
   assert.equal(await page.getByTitle('Drag to resize (SE)',{exact:true}).count(),0)
  }
  assert.deepEqual(errors,[]); assert.deepEqual(external,[])
  results.push({mode,shape,paintedColours:mode==='pro'?1:3,persistedRoundTrip:true,openingPreserved:true,handleLifecycle:mode==='pro',pageErrors:errors.length,externalRequests:external.length})
  await page.close()
 }
 // Multi-opening paint, asymmetric sides, mode round-trips and real creation payloads.
 {
  const page=await browser.newPage({viewport:{width:1600,height:1200}})
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)))
  await page.route('**/*',route=>{const u=route.request().url(); if(u.startsWith('http')&&!u.startsWith(`http://127.0.0.1:${address.port}/`)) return route.fulfill({contentType:'text/css',body:''}); return route.continue()})
  await page.goto(url); await page.waitForFunction(()=>!!window.applyDesign)
  const increments=[{top:2,bottom:4,left:3,right:5},{top:1,bottom:2,left:1,right:2},{top:2,bottom:2,left:2,right:2}]
  const images=['#222222','#444444','#666666'].map(fill=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${fill}"/></svg>`).toString('base64'))
  const openings=['rect','oval','circle'].map((shape,i)=>({id:'multi-'+i,shape,xCm:6+18*i,yCm:5,widthCm:10,heightCm:10,imageUrl:images[i]}))
  await page.evaluate(({increments,openings})=>window.applyDesign(window.independentFixture({art:{widthCm:60,heightCm:30},mats:{layoutModel:'single-board-v1',geometryVersion:3,borders:increments,selectedMat1:'m',selectedMat2:'m2',selectedMat3:'m3',mode:'pro',proOrigin:{x:6,y:5},openings}})),{increments,openings})
  await page.waitForFunction(()=>window.currentDesign.visualizerDesign.basic.mats[2].materialId==='m3')
  assert.equal(await page.getByTestId('mat-layers').getAttribute('viewBox'),'0 0 68 36')
  assert.equal(await page.getByAltText('artwork',{exact:true}).count(),3)
  assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.openings),openings)
  const png=PNG.sync.read(await page.getByTestId('mat-layers').screenshot({path:path.join(output,'pro-multi-opening.png')}))
  const counts=new Map(['0,204,102','0,0,255','255,0,0'].map(c=>[c,0]))
  for(let i=0;i<png.data.length;i+=4){const colour=[...png.data.subarray(i,i+3)].join(',');if(counts.has(colour))counts.set(colour,counts.get(colour)+1)}
  assert.ok(counts.get('0,204,102')>100);assert.equal(counts.get('0,0,255'),0);assert.equal(counts.get('255,0,0'),0)
  const modeSelect=page.locator('select').filter({has:page.locator('option[value="pro"]')})
  await modeSelect.selectOption('basic'); await modeSelect.selectOption('pro')
  assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.openings),openings)
  await page.locator('select').filter({has:page.locator('option[value="c"]')}).selectOption('c')
  for(const name of ['Add to Quotes','Add to Jobs','Add to Invoices']) await page.getByRole('button',{name,exact:true}).click()
  await page.waitForFunction(()=>window.documents?.length===3)
  const documents=await page.evaluate(()=>JSON.parse(JSON.stringify(window.documents)))
  const quote=documents.find(d=>d.kind==='quote').payload,job=documents.find(d=>d.kind==='job').payload,invoice=documents.find(d=>d.kind==='invoice').payload
  assert.deepEqual(job.details.mats.openings,openings)
  assert.deepEqual(job.details.mats.borders[0],increments[0]); assert.deepEqual(job.details.visualizerDesign.basic.mats.map(s=>s.borders),increments)
  assert.deepEqual(job.details.dims.visible,{widthCm:68,heightCm:36})
  assert.deepEqual(job.details.dims.external,{widthCm:72,heightCm:40})
  assert.deepEqual(job.details.mats,job.mats)
  assert.deepEqual(JSON.parse(job.detailsJson),job.details)
  assert.deepEqual(quote.jobSpecification.details,job.details)
  assert.deepEqual(quote.pricingSnapshot,job.pricingSnapshot)
  assert.deepEqual(invoice.pricingSnapshot,job.pricingSnapshot)
  const snapshot=job.pricingSnapshot
  assert.equal(snapshot.items.find(i=>i.key==='frame').materialQuantity,2.08)
  for(const key of ['glazing','mat1']) assert.equal(snapshot.items.find(i=>i.key===key).materialQuantity,0.2448)
  for(const key of ['mat2','mat3'])assert.equal(snapshot.items.find(i=>i.key===key),undefined)
  assert.deepEqual(errors,[])
  results.push({mode:'pro',shape:'multi-opening',paintedColours:1,openingPreserved:true,modeRoundTrip:true,creationPayloads:3,pricingGeometry:true,pageErrors:0})
  await page.close()
 }
 console.log(JSON.stringify({passed:results.length,results},null,2))
 writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2))
} finally { await browser?.close(); await server.close() }
