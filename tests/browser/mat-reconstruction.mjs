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
 // Actual Basic upload / addition / units / lock / deletion / recolour / exports.
 {
  const {page,errors}=await open();await page.locator('#artUpload').setInputFiles(file('#222222'));await page.waitForFunction(()=>window.currentDesign.art.imageUrl)
  const original=await page.evaluate(()=>window.currentDesign.art.imageUrl)
  await addMats(page)
  let picture=await painted(page,'basic-three-mats')
  for(const c of ['0,204,102','0,0,255','255,0,0','34,34,34'])assert.ok(picture.counts[c]>100,c+' should be visible')
  const physical=await page.evaluate(()=>window.currentDesign.mats.borders)
  const units=page.locator('select').filter({has:page.locator('option[value="imperial"]')})
  await units.selectOption('imperial');assert.ok(Math.abs(Number(await page.getByLabel('Mat 2 Left (in)',{exact:true}).inputValue())-2/2.54)<0.000001)
  await units.selectOption('metric');assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.borders),physical)
  await page.getByLabel('Mat 1 Left (cm)',{exact:true}).fill('6');assert.equal(await page.getByLabel('Mat 1 Top (cm)',{exact:true}).inputValue(),'6')
  await page.getByRole('button',{name:'Unlock Mat 2 borders',exact:true}).click();await page.getByLabel('Mat 2 Left (mm)',{exact:true}).fill('40')
  await page.getByRole('button',{name:'Lock Mat 2 borders',exact:true}).click();assert.equal(await page.getByLabel('Mat 2 Top (mm)',{exact:true}).inputValue(),'20')
  await page.getByRole('button',{name:'Remove Mat 2',exact:true}).click()
  assert.equal(await page.getByLabel('Mat 2 material',{exact:true}).inputValue(),'m3');assert.equal(await page.getByLabel('Mat 2 Left (mm)',{exact:true}).inputValue(),'40')
  await page.getByLabel('Mat 3 material',{exact:true}).selectOption('m2');assert.equal(await page.getByLabel('Mat 3 Left (mm)',{exact:true}).inputValue(),'10')
  await page.getByRole('button',{name:'Remove Mat 1',exact:true}).click()
  assert.equal(await page.getByLabel('Mat 1 material',{exact:true}).inputValue(),'m3');assert.equal(await page.getByLabel('Mat 1 Left (cm)',{exact:true}).inputValue(),'6')
  assert.equal(await page.getByAltText('artwork',{exact:true}).getAttribute('src'),original)
  await page.getByLabel('Mat 3 material',{exact:true}).selectOption('m2')
  await page.getByLabel('Mat 2 material',{exact:true}).selectOption('m')
  picture=await painted(page,'basic-after-material-movement')
  for(const c of ['0,204,102','0,0,255','255,0,0','34,34,34'])assert.ok(picture.counts[c]>100)
  await page.getByRole('button',{name:'Room preview',exact:true}).click();await page.waitForFunction(()=>window.roomProps?.artworkUrl?.startsWith('data:image/png'))
  const beforeRoom=await page.evaluate(()=>window.roomProps.artworkUrl)
  await page.evaluate(()=>window.changeMaterialColour('m','#aa00aa'))
  await page.waitForFunction(before=>window.roomProps.artworkUrl!==before,beforeRoom)
  await page.getByRole('button',{name:'Build',exact:true}).click()
  picture=await painted(page,'basic-live-colour-change');assert.ok(picture.counts['170,0,170']>100)
  const design=await page.evaluate(()=>structuredClone(window.currentDesign))
  await page.getByText('Save fixture',{exact:true}).click();await page.reload();await page.waitForFunction(()=>!!window.currentDesign);await page.getByText('Load fixture',{exact:true}).click();await page.waitForFunction(()=>window.currentDesign.mats.selectedMat3==='m2')
  assert.deepEqual(await page.evaluate(()=>window.currentDesign),design)
  for(const format of ['PNG','JPG','PDF']){
   const download=page.waitForEvent('download',{timeout:15000}).catch(()=>null);await page.getByRole('button',{name:'Export image ▾',exact:true}).click();await page.getByRole('button',{name:format,exact:true}).click();const d=await download;if(!d){console.log('EXPORT FAILURE',format,await page.evaluate(async()=>{const {useToast}=await import('/src/lib/toast.ts');return useToast.getState().toasts}));throw new Error('Export did not download: '+format)}await d.saveAs(path.join(output,'basic.'+format.toLowerCase()));assert.equal(await d.failure(),null)
  }
  assert.deepEqual(errors,[]);results.push({workflow:'Basic',actualUpload:true,threePaintedLayers:true,unitInvariance:true,lockAndDeletion:true,liveColourAndRoomRefresh:true,reload:true,exports:['PNG','JPG','PDF']});await page.close()
 }
 // Pro is built through shape buttons and file pickers, not final-state fixtures.
 {
  const {page,errors}=await open();await page.locator('#artUpload').setInputFiles(file('#222222'));await page.waitForFunction(()=>window.currentDesign.art.imageUrl);await addMats(page)
  const basicOriginal=await page.evaluate(()=>window.currentDesign.art.imageUrl)
  const mode=page.locator('select').filter({has:page.locator('option[value="pro"]')});await mode.selectOption('pro')
  const set=async(n,field,value)=>page.getByLabel(`Opening ${n} ${field} (cm)`,{exact:true}).fill(String(value))
  await set(1,'width',12);await set(1,'height',12);await set(1,'X',0);await set(1,'Y',0)
  for(const [shape,n,x,colour] of [['Oval',2,20,'#444444'],['Circle',3,38,'#666666']]){
   await page.getByRole('button',{name:'+ '+shape,exact:true}).click();await set(n,'X',x);await set(n,'Y',0)
   const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Select image for this opening',exact:true}).click();await(await chooser).setFiles(file(colour));await page.waitForFunction(n=>!!window.currentDesign.mats.openings[n-1].imageUrl,n)
  }
  await page.getByLabel('Width (cm)',{exact:true}).fill('60');await page.getByLabel('Width (cm)',{exact:true}).blur()
  assert.equal(await page.evaluate(()=>window.currentDesign.visualizerDesign.basic.widthCm),40)
  const before=await page.evaluate(()=>structuredClone(window.currentDesign))
  let picture=await painted(page,'pro-shared-mixed-openings')
  for(const c of ['0,204,102','0,0,255','255,0,0','34,34,34','68,68,68','102,102,102'])assert.ok(picture.counts[c]>100,c)
  assert.deepEqual(await page.getByTestId('mat-layers').locator('mask').evaluateAll(ms=>ms.map(m=>m.children.length-1)),[3,1,1])
  // Between first and second artwork openings, the primary board must remain visible.
  const x=Math.floor(24/picture.box[2]*picture.png.width),y=Math.floor(14/picture.box[3]*picture.png.height),i=(y*picture.png.width+x)*4
  assert.deepEqual([...picture.png.data.subarray(i,i+3)],[0,204,102])
  const handleBox=await page.getByTitle('Drag to resize (SE)',{exact:true}).boundingBox(),rootBox=await page.getByTestId('mat-layers').locator('..').locator('..').boundingBox()
  for(const format of ['PNG','JPG','PDF']){
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export image ▾',exact:true}).click();await page.getByRole('button',{name:format,exact:true}).click();const d=await download,filePath=path.join(output,'pro.'+format.toLowerCase());await d.saveAs(filePath);assert.equal(await d.failure(),null)
   const bytes=readFileSync(filePath)
   let image=bytes,mime=format==='PNG'?'image/png':'image/jpeg'
   if(format==='PDF'){
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-')
    const filter=bytes.indexOf('/DCTDecode'),start=bytes.indexOf(Buffer.from([255,216]),filter),end=bytes.indexOf(Buffer.from([255,217]),start)+2
    assert.ok(filter>0&&start>filter&&end>start,'PDF must contain an actual JPEG scene')
    image=bytes.subarray(start,end);writeFileSync(path.join(output,'pro-pdf-embedded.jpg'),image)
   }
   const rgb=await page.evaluate(async({url,x,y})=>{
    const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(Math.floor(x*c.width),Math.floor(y*c.height),1,1).data].slice(0,3)
   },{url:`data:${mime};base64,${image.toString('base64')}`,x:(handleBox.x+handleBox.width/2-rootBox.x)/rootBox.width,y:(handleBox.y+handleBox.height/2-rootBox.y)/rootBox.height})
   assert.ok(rgb.every((v,i)=>Math.abs(v-[0,204,102][i])<=8),format+' export must omit the selected opening handle: '+rgb)

  }
  await page.getByRole('button',{name:'Room preview',exact:true}).click()
  await page.waitForFunction(()=>window.roomProps?.compositeIncludesOpenings===true&&window.roomProps?.artworkUrl?.startsWith('data:image/png'))
  assert.equal(await page.evaluate(()=>window.roomProps.openings.length),3)
  const roomDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();await(await roomDownload).saveAs(path.join(output,'pro-room.png'))
  const roomPng=PNG.sync.read(readFileSync(path.join(output,'pro-room.png')));assert.ok(roomPng.width>0&&roomPng.height>0)
  await page.getByRole('button',{name:'Build',exact:true}).click()
  for(let round=0;round<3;round++){await mode.selectOption('basic');assert.equal(await page.getByAltText('artwork',{exact:true}).getAttribute('src'),basicOriginal);assert.equal(await page.evaluate(()=>window.currentDesign.art.widthCm),40);await mode.selectOption('pro');assert.equal(await page.evaluate(()=>window.currentDesign.art.widthCm),60)}
  assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.openings),before.mats.openings)
  const target=page.getByTitle('Drag to move. Use handles to resize.',{exact:true}).first();await target.hover();let box=await target.boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+260,box.y+box.height/2+180);await page.mouse.up()
  assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.borders),before.mats.borders)
  assert.notDeepEqual(await page.evaluate(()=>window.currentDesign.mats.openings),before.mats.openings)
  await target.hover();const handle=page.getByTitle('Drag to resize (SE)',{exact:true});box=await handle.boundingBox();const oldBoard=await page.getByTestId('mat-layers').getAttribute('viewBox')
  await page.mouse.move(box.x+6,box.y+6);await page.mouse.down();await page.mouse.move(box.x+60,box.y+65);await page.waitForTimeout(2800);assert.equal(await handle.count(),1);await page.mouse.up();await page.mouse.move(0,0);await page.waitForTimeout(2750);assert.equal(await handle.count(),0)
  const resized=await page.evaluate(()=>window.currentDesign.mats.openings);assert.ok(resized[0].widthCm>before.mats.openings[0].widthCm);assert.equal(resized[1].imageUrl,before.mats.openings[1].imageUrl)
  assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.borders),before.mats.borders)
  await page.getByRole('button',{name:'Remove Mat 1',exact:true}).click();assert.equal(await page.getByAltText('artwork',{exact:true}).count(),3)
  const saved=await page.evaluate(()=>structuredClone(window.currentDesign));await page.getByText('Save fixture',{exact:true}).click();await page.reload();await page.waitForFunction(()=>!!window.currentDesign);await page.getByText('Load fixture',{exact:true}).click();await page.waitForFunction(()=>window.currentDesign.mats.mode==='pro');assert.deepEqual(await page.evaluate(()=>window.currentDesign),saved)
  await mode.selectOption('basic');await page.locator('select').filter({has:page.locator('option[value="c"]')}).selectOption('c')
  for(const name of ['Add to Quotes','Add to Jobs','Add to Invoices'])await page.getByRole('button',{name,exact:true}).click()
  await page.waitForFunction(()=>window.documents?.length===3)
  const documents=await page.evaluate(()=>JSON.parse(JSON.stringify(window.documents)))
  const job=documents.find(d=>d.kind==='job').payload,quote=documents.find(d=>d.kind==='quote').payload,invoice=documents.find(d=>d.kind==='invoice').payload
  assert.deepEqual(job.details.mats.openings,resized);assert.deepEqual(job.details.visualizerDesign.pro.openings,resized)
  assert.equal(job.details.visualizerDesign.basic.imageUrl,basicOriginal);assert.equal(job.details.visualizerDesign.mode,'basic')
  assert.deepEqual(quote.jobSpecification.details,job.details);assert.deepEqual(quote.pricingSnapshot,job.pricingSnapshot);assert.deepEqual(invoice.pricingSnapshot,job.pricingSnapshot)
  assert.deepEqual(errors,[]);results.push({workflow:'Pro',mixedShapes:true,independentFileUploads:true,sharedCutouts:true,primaryVisibleBetween:true,losslessModeSwitching:true,dragResize:true,handleLifecycle:true,matRemovalPreservesArtwork:true,reload:true,retainedModelsInDocuments:true,exports:['PNG','JPG','PDF'],handlesAbsentFromExport:true});await page.close()
 }
 {
  const {page,errors}=await open();const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#222222"/></svg>')
  await page.evaluate(art=>window.applyDesign({art:{widthCm:40,heightCm:30,imageUrl:art},mats:{mode:'pro',geometryVersion:2,selectedMat1:'m',selectedMat2:'m2',selectedMat3:'m3',borders:[5,5,5].map(n=>({top:n,bottom:n,left:n,right:n})),origin:{x:5,y:5},openings:[{id:'legacy',shape:'rect',xCm:5,yCm:5,widthCm:2,heightCm:2,imageUrl:art}]}}),art)
  assert.match(await page.getByRole('status').innerText(),/coincident/);assert.equal(await page.getByRole('button',{name:'Review and adopt shared-cut-out layout',exact:true}).isDisabled(),true)
  await page.getByLabel('Mat 2 Left (mm)',{exact:true}).fill('20');await page.getByLabel('Mat 3 Left (mm)',{exact:true}).fill('10');await page.getByRole('button',{name:'Review and adopt shared-cut-out layout',exact:true}).click()
  assert.equal(await page.getByRole('status').count(),0)
  await page.evaluate(art=>window.applyDesign({art:{widthCm:40,heightCm:30,imageUrl:art},mats:{mode:'pro',geometryVersion:3,selectedMat1:'m',selectedMat2:'m2',selectedMat3:'m3',borders:[5,2,1].map(n=>({top:n,bottom:n,left:n,right:n})),origin:{x:5,y:5},openings:[{id:'legacy',shape:'rect',xCm:0,yCm:0,widthCm:2,heightCm:2,imageUrl:art}]}}),art)
  assert.equal(await page.getByRole('button',{name:'Remove Mat 1',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Review and adopt shared-cut-out layout',exact:true}).click()
  await page.getByRole('button',{name:'Remove Mat 1',exact:true}).click();assert.equal(await page.getByAltText('artwork',{exact:true}).getAttribute('src'),art)
  const picture=await painted(page,'legacy-explicit-adoption-and-removal');assert.ok(picture.counts['34,34,34']>16,'the 2 cm historical artwork must remain painted');assert.deepEqual(errors,[]);results.push({workflow:'Historical review',coincidentBordersRequireReview:true,explicitAdoption:true,legacyCoordinatesAndArtworkRetained:true});await page.close()
 }
 {
  const {page,errors}=await open();const mode=page.locator('select').filter({has:page.locator('option[value="pro"]')});await mode.selectOption('pro');await page.getByRole('button',{name:'+ Rectangle',exact:true}).click()
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Select image for this opening',exact:true}).click();await(await chooser).setFiles(file('#222222'));await page.waitForFunction(()=>!!window.currentDesign.mats.openings[0].imageUrl)
  await addMats(page);const opening=await page.evaluate(()=>structuredClone(window.currentDesign.mats.openings[0]))
  await mode.selectOption('basic');assert.equal(await page.evaluate(()=>window.currentDesign.art.imageUrl),'');assert.equal(await page.getByText('Basic has no original artwork.',{exact:false}).count(),1)
  await page.locator('select').filter({has:page.locator('option[value="c"]')}).selectOption('c');await page.getByRole('button',{name:'Add to Jobs',exact:true}).click();await page.waitForFunction(()=>window.documents?.length===1)
  assert.deepEqual(await page.evaluate(()=>window.documents[0].payload.details.visualizerDesign.pro.openings[0]),opening)
  await page.getByText('Save fixture',{exact:true}).click();await page.reload();await page.waitForFunction(()=>!!window.currentDesign);await page.getByText('Load fixture',{exact:true}).click();await mode.selectOption('pro')
  for(let n=0;n<3;n++){await page.getByRole('button',{name:'Remove Mat 1',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.currentDesign.mats.openings[0]),opening);assert.equal(await page.getByAltText('artwork',{exact:true}).count(),1)}
  const picture=await painted(page,'pro-first-all-mats-removed');assert.ok(picture.counts['34,34,34']>100);assert.deepEqual(errors,[]);results.push({workflow:'Pro-first upload',noBasicImage:true,basicJobRetainsProImage:true,saveInBasicReloadInPro:true,removingAllMatsRetainsArtwork:true});await page.close()
 }
 console.log(JSON.stringify({passed:results.length,results},null,2));writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2))
}finally{await browser?.close();await server.close()}
