// Run with host playwright-cli run-code --filename against an isolated page containing the model-editor iframe.
// Uses a new unsaved verification document; never run against a live user editing session.
async (page) => {
 await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.document.querySelector('chili-editor')?.app?.activeView);
 const result = await page.evaluate(async () => {
  const w = document.querySelector('iframe').contentWindow;
  const app = w.document.querySelector('chili-editor').app;
  await app.newDocument('Native verification'); const doc = app.activeView.document;
  const call = (action,extra={}) => new Promise((resolve,reject) => {
   const requestId=crypto.randomUUID();
   const timer=setTimeout(()=>reject(new Error('Bridge timeout '+action)),15000);
   const listener=e=>{if(e.source!==w||e.data?.requestId!==requestId)return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.ok?resolve(e.data):reject(new Error(e.data.error));};
   window.addEventListener('message',listener);
   w.postMessage({source:'bidwright-host',type:'bidwright:model-design-request',requestId,action,...extra},location.origin);
  });
  const assert=(x,m)=>{if(!x)throw new Error(m)};
  const node=id=>doc.modelManager.findNode(n=>n.id===id);
  const volume=n=>n.shape.value.shapeType===4?n.shape.value.volume():(()=>{const s=n.shape.value.findSubShapes(4);try{return s.reduce((v,x)=>v+x.volume(),0)}finally{s.forEach(x=>x.dispose())}})();
  const state=await call('state');assert(state.kernelVersion==='8.0.1','Wrong kernel');
  const recipe={version:1,name:'Surgical edit verification',units:'mm',parameters:{legHeight:100},features:[{id:'plate',op:'box',size:[100,50,10]},{id:'leg',op:'tube',size:[20,20,'legHeight'],wall:2,origin:[0,0,-100]}],parts:[{id:'plate',name:'Plate',feature:'plate'},{id:'leg',name:'Leg',feature:'leg'}],assumptions:[]};
  let r=await call('apply',{recipe});assert(r.editedParts===2,'Initial count');
  const plate=node('design-plate'), oldLeg=node('design-leg');const plateVolume=volume(plate);
  recipe.parameters.legHeight=150;r=await call('apply',{recipe});
  assert(r.editedParts===1 && node('design-plate')===plate && node('design-leg')!==oldLeg,'Unrelated part replaced');
  assert(Math.abs(volume(node('design-leg'))-21600)<1e-5,'Tube geometry');
  const revised=structuredClone(recipe);revised.features.push({id:'source-plate',op:'existing',nodeId:'design-plate'},{id:'hole',op:'cylinder',origin:[50,25,-1],radius:5,height:12},{id:'drilled',op:'cut',inputs:['source-plate','hole']});revised.parts[0].feature='drilled';
  const leg=node('design-leg');r=await call('apply',{recipe:revised});
  assert(r.editedParts===1 && node('design-leg')===leg,'Surgical edit changed leg');
  assert(Math.abs(volume(node('design-plate'))-(plateVolume-Math.PI*250))<1e-4,'Through hole incorrect');
  const drilled=node('design-plate');r=await call('apply',{recipe:revised});assert(r.editedParts===0&&node('design-plate')===drilled,'Unchanged recipe rebuilt geometry');
  const incomplete=structuredClone(revised);incomplete.parts.pop();let deletionGuard=false;try{await call('apply',{recipe:incomplete})}catch(e){deletionGuard=e.message.includes('explicit removedParts')};assert(deletionGuard&&node('design-leg')===leg,'Implicit deletion accepted');
  const invalid=structuredClone(revised);invalid.parameters.legHeight=-1;let invalidGuard=false;try{await call('apply',{recipe:invalid})}catch{invalidGuard=true};assert(invalidGuard&&node('design-leg')===leg,'Invalid design mutated document');
  r=await call('export');assert(r.step.startsWith('ISO-10303-21;'),'STEP missing');
  await call('undo'); assert(Math.abs(volume(node('design-plate'))-plateVolume)<1e-6,'Undo failed');
  const imported=app.shapeFactory.converter.convertFromSTEP(doc,new w.Uint8Array(new TextEncoder().encode(r.step))); assert(imported.isOk,'STEP reimport failed');
  imported.value.dispose();
  
  const saved=doc.serialize();assert(saved.userData?.modelDesign||JSON.stringify(saved).includes('modelDesign'),'Recipe not persisted');
  return {kernel:state.kernelVersion,initialParts:2,updatedParts:1,unchangedIdentity:true,surgicalHole:true,repeatedEditStable:true,deletionGuard,invalidGuard,unsavedStepBytes:r.step.length,stepRoundTrip:true,undo:true,recipePersisted:true};
 });
 await page.evaluate(r=>window.cadNativeResults=r,result);
}
