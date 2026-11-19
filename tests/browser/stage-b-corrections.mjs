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
 async function open(){
  const page=await browser.newPage({viewport:{width:1600,height:1200},acceptDownloads:true})
  const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log('BROWSER ERROR',String(e))}); page.on('console',m=>{if(m.type()==='error')console.log('BROWSER CONSOLE',m.text())})
  await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith('https://fonts.googleapis.com/'))return route.fulfill({contentType:'text/css',body:''}); if(u.startsWith('http')&&!u.startsWith(`http://127.0.0.1:${address.port}/`))return route.abort();return route.continue()})
  await page.goto(url);await page.waitForFunction(()=>!!window.currentDesign).catch(async error=>{console.log('BOOT FAILURE',await page.locator('body').innerText(),await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>({name:e.name,size:e.transferSize}))));throw error})
  return {page,errors}
 }
 const file=(colour)=>({name:'synthetic.svg',mimeType:'image/svg+xml',buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="${colour}"/></svg>`)})
 async function addMats(page){
  await page.getByLabel('Mat 1 material',{exact:true}).selectOption('m')
  await page.getByText('+ Add second mat',{exact:true}).click();await page.getByLabel('Mat 2 material',{exact:true}).selectOption('m2')
  await page.getByText('+ Add third mat',{exact:true}).click();await page.getByLabel('Mat 3 material',{exact:true}).selectOption('m3')
 }
 async function painted(page,label){
  const board=page.getByTestId('mat-layers');const png=PNG.sync.read(await board.locator('..').screenshot({path:path.join(output,label+'.png')}))
  const counts={};for(let i=0;i<png.data.length;i+=4){const k=[...png.data.subarray(i,i+3)].join(',');counts[k]=(counts[k]||0)+1}
  return {png,counts,box:(await board.getAttribute('viewBox')).split(' ').map(Number)}
 }

 // Assert physical colour order, cut edges, the untouched Pro transition and actual exports.
 const {page,errors}=await open()
 await page.locator('#artUpload').setInputFiles(file('#222222'));await page.waitForFunction(()=>window.currentDesign.art.imageUrl)
 const original=await page.evaluate(()=>window.currentDesign.art.imageUrl)
 await addMats(page)
 let picture=await painted(page,'corrected-basic')
 const pixel=(png,x,y)=>{const i=(Math.floor(y*png.height)*png.width+Math.floor(x*png.width))*4;return [...png.data.subarray(i,i+3)]}
 const near=(a,b,message,tolerance=16)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<=tolerance),message+': '+a)
 for(const [x,c] of [[0.5,[0,204,102]],[5.5,[0,0,255]],[7.5,[255,0,0]]])near(pixel(picture.png,x/picture.box[2],0.5),c,'Basic outside-to-inside order')
 const bevelX=5/picture.box[2]*picture.png.width,bevelY=Math.floor(picture.png.height/2)
 assert.ok([-1,0,1].some(dx=>picture.png.data[(bevelY*picture.png.width+Math.floor(bevelX)+dx)*4]>30),'actual Basic bevel must be painted')
 assert.equal(await page.getByTestId('mat-layers').locator('[data-mat-bevel]').count(),3)
 const retained=await page.evaluate(()=>structuredClone(window.currentDesign.visualizerDesign.mats))
 const mode=page.locator('select').filter({has:page.locator('option[value="pro"]')});await mode.selectOption('pro')
 assert.equal(await page.getByLabel('Mat 2 material',{exact:true}).count(),0)
 assert.equal(await page.getByLabel('Mat 3 material',{exact:true}).count(),0)
 assert.equal(await page.getByTestId('mat-layers').getAttribute('viewBox'),'0 0 50 40')
 assert.equal(await page.getByAltText('artwork',{exact:true}).getAttribute('src'),original)
 assert.equal(await page.getByAltText('artwork',{exact:true}).evaluate(e=>getComputedStyle(e.parentElement).inset),'0px')
 picture=await painted(page,'initial-pro-no-white-border')
 near(pixel(picture.png,5.2/50,15/40),[34,34,34],'initial seeded artwork has no white inset')
 near(pixel(picture.png,0.5/50,0.5),[0,204,102],'mat, not artwork, is the board background')
 const set=async(n,field,value)=>page.getByLabel(`Opening ${n} ${field} (cm)`,{exact:true}).fill(String(value))
 await set(1,'width',12);await set(1,'height',12);await set(1,'X',5);await set(1,'Y',5)
 const choose=async(colour)=>{const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Select image for this opening',exact:true}).click();await(await chooser).setFiles(file(colour))}
 for(const [shape,n,x,colour] of [['Oval',2,25,'#444444'],['Circle',3,45,'#666666']]){
  await page.getByRole('button',{name:'+ '+shape,exact:true}).click();await set(n,'X',x);await set(n,'Y',5);await choose(colour);await page.waitForFunction(n=>!!window.currentDesign.mats.openings[n-1].imageUrl,n)
 }
 await page.getByLabel('Width (cm)',{exact:true}).fill('70');await page.getByLabel('Width (cm)',{exact:true}).blur()
 await page.getByLabel('Height (cm)',{exact:true}).fill('40');await page.getByLabel('Height (cm)',{exact:true}).blur()
 for(const n of [1,2,3]){
  const before=await page.evaluate(()=>structuredClone(window.currentDesign.mats.openings))
  for(const axis of ['horizontally','vertically','both']){
   await page.getByRole('button',{name:`Centre opening ${n}${axis==='both'?'':' '+axis}`,exact:true}).click()
   const board=await page.getByTestId('mat-layers').boundingBox(),o=await page.getByTitle('Drag to move. Use handles to resize.',{exact:true}).nth(n-1).boundingBox()
   if(axis!=='vertically')assert.ok(Math.abs(o.x+o.width/2-board.x-board.width/2)<1.5,'horizontal rendered centring')
   if(axis!=='horizontally')assert.ok(Math.abs(o.y+o.height/2-board.y-board.height/2)<1.5,'vertical rendered centring')
  }
  assert.deepEqual(await page.evaluate(n=>window.currentDesign.mats.openings.filter((_,i)=>i!==n-1),n),before.filter((_,i)=>i!==n-1))
  await set(n,'X',before[n-1].xCm);await set(n,'Y',before[n-1].yCm)
 }
 // Replacement changes only the chosen opening, not the original Basic image.
 const chooser=page.waitForEvent('filechooser');await page.getByAltText('artwork',{exact:true}).first().dblclick();await(await chooser).setFiles(file('#333333'))
 await page.waitForFunction(original=>window.currentDesign.mats.openings[0].imageUrl!==original,original)
 assert.equal(await page.evaluate(()=>window.currentDesign.visualizerDesign.basic.imageUrl),original)
 await page.getByLabel('Mat 1 material',{exact:true}).selectOption('m2');picture=await painted(page,'pro-catalogue-change');near(pixel(picture.png,0.5/picture.box[2],0.5),[0,0,255],'catalogue material changes actual board')
 await page.getByLabel('Mat 1 material',{exact:true}).selectOption('m')
 picture=await painted(page,'pro-cut-through-shapes')
 near(pixel(picture.png,25.2/80,5.2/50),[0,204,102],'oval corner is board, not artwork')
 for(const format of ['PNG','JPG','PDF']){
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export image ▾',exact:true}).click();await page.getByRole('button',{name:format,exact:true}).click()
  const d=await event,target=path.join(output,'single-board.'+format.toLowerCase());await d.saveAs(target);assert.equal(await d.failure(),null)
  let bytes=readFileSync(target)
  if(format==='PNG'){
   const raster=PNG.sync.read(bytes);let white=0
   for(let y=Math.ceil(2.4/54*raster.height);y<Math.floor(51.6/54*raster.height);y++)for(let x=Math.ceil(2.4/84*raster.width);x<Math.floor(81.6/84*raster.width);x++){
    const i=(y*raster.width+x)*4;if([...raster.data.subarray(i,i+3)].every(v=>v>225))white++
   }
   assert.equal(white,0,'no white crescents or automatic borders around any exported opening')
  }
  if(format==='PDF'){assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const f=bytes.indexOf('/DCTDecode'),a=bytes.indexOf(Buffer.from([255,216]),f),b=bytes.indexOf(Buffer.from([255,217]),a)+2;assert.ok(f>0&&a>f&&b>a);bytes=bytes.subarray(a,b)}
  const probes=await page.evaluate(async({url})=>{const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [[2.5,25],[7.2,13],[27.2,15],[47.2,13],[27.2,7.2]].map(([x,y])=>[...ctx.getImageData(Math.floor(x/84*c.width),Math.floor(y/54*c.height),1,1).data].slice(0,3))},{url:`data:image/${format==='PNG'?'png':'jpeg'};base64,${bytes.toString('base64')}`})
  for(const [i,c] of [[0,[0,204,102]],[1,[51,51,51]],[2,[68,68,68]],[3,[102,102,102]],[4,[0,204,102]]])near(probes[i],c,format+' actual exported board/opening pixel',28)
 }
 await page.getByRole('button',{name:'Room preview',exact:true}).click();await page.waitForFunction(()=>window.roomProps?.compositeIncludesOpenings&&window.roomProps.artworkUrl?.startsWith('data:image/png'))
 const room=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();await(await room).saveAs(path.join(output,'single-board-room.png'))
 await page.getByRole('button',{name:'Build',exact:true}).click()
 const saved=await page.evaluate(()=>structuredClone(window.currentDesign));await page.getByText('Save fixture',{exact:true}).click();await page.reload();await page.waitForFunction(()=>window.currentDesign);await page.getByText('Load fixture',{exact:true}).click();await page.waitForFunction(()=>window.currentDesign.mats.mode==='pro');assert.deepEqual(await page.evaluate(()=>window.currentDesign),saved)
 await page.locator('select').filter({has:page.locator('option[value="c"]')}).selectOption('c')
 for(const name of ['Add to Quotes','Add to Jobs','Add to Invoices'])await page.getByRole('button',{name,exact:true}).click()
 await page.waitForFunction(()=>window.documents?.length===3)
 const documents=await page.evaluate(()=>window.documents)
 for(const {kind,payload} of documents){if(kind!=='invoice'){const spec=payload.jobSpecification?.details||payload.details;assert.equal(spec.mats.hasMat2,false);assert.equal(spec.mats.hasMat3,false);assert.deepEqual(spec.visualizerDesign.mats,retained)}assert.equal(payload.pricingSnapshot.items.filter(i=>/^mat\d/.test(i.key)).length,1)}
 await mode.selectOption('basic');assert.deepEqual(await page.evaluate(()=>window.currentDesign.visualizerDesign.mats),retained);assert.equal(await page.getByAltText('artwork',{exact:true}).getAttribute('src'),original)
 assert.deepEqual(errors,[]);results.push({workflow:'Basic and single-board Pro',colourOrder:true,bevelPixels:true,initialTransition:true,noArtworkInset:true,shapeCutouts:true,centringPixels:true,catalogueColour:true,actualExports:['PNG','JPG','PDF','Room PNG'],retainedBasicMats:true,snapshotReload:true,commercialMirrors:true})
 // Historical shapes remain unchanged and cannot be saved as implicitly converted designs.
 await page.evaluate(art=>window.applyDesign({art:{widthCm:40,heightCm:30,imageUrl:art},mats:{mode:'pro',layoutModel:'shared-group-v1',geometryVersion:3,selectedMat1:'m',selectedMat2:'m2',selectedMat3:'m3',borders:[5,2,1].map(n=>({top:n,bottom:n,left:n,right:n})),proOrigin:{x:8,y:8},openings:[{id:'history',shape:'oval',xCm:8,yCm:8,widthCm:10,heightCm:12,imageUrl:art}]}}),original)
 assert.equal(await page.getByLabel('Mat 2 material',{exact:true}).isDisabled(),true);assert.equal(await page.getByText('Save fixture',{exact:true}).isDisabled(),true)
 const historic=await page.evaluate(()=>structuredClone(window.currentDesign))
 await page.getByRole('button',{name:'Review and adopt single-board layout',exact:true}).click()
 assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.openings),historic.mats.openings);assert.deepEqual(await page.evaluate(()=>window.currentDesign.visualizerDesign.mats),historic.visualizerDesign.mats)
 results.push({workflow:'Historical Pro',explicitAdoption:true,imagesAndMeasurementsRetained:true})
 console.log(JSON.stringify({passed:results.length,results},null,2));writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));await page.close()
}finally{await browser?.close();await server.close()}
