import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newIso, appendRun, runResult, formatLength, parseLength, validateIso, insertComponent, bom, welds, parseIsoJson, csv } from '../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/model.ts';
import { importPcf, exportPcf } from '../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/pcf.ts';
import { createDrawing, drawingSvg } from '../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/drawing.ts';
test('physical centreline measurements subtract fitting takeouts and each root gap',()=>{const d=newIso();const b=appendRun(d,null,[1000,0,0],'CS40',2,'SP-1','L-1');appendRun(d,b.id,[0,1000,0],'CS40',2,'SP-1','L-1');assert.equal(b.kind,'elbow90');assert.equal(runResult(d,d.runs[0]).cut,920.8);assert.equal(runResult(d,d.runs[1]).cut,920.8);assert.equal(welds(d).length,2);assert.deepEqual(validateIso(d),[]);});
test('rolling offset travel uses all three physical axes',()=>{const d=newIso();appendRun(d,null,[300,400,1200],'CS40',2,'SP','');assert.equal(runResult(d,d.runs[0]).cut,1300);});
test('inline valves consume their face-to-face and two gaps',()=>{const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','');const n=insertComponent(d,d.runs[0].id,'valve');n.takeout=100;assert.equal(d.runs.reduce((s,r)=>s+runResult(d,r).cut,0),794);});
test('straight butt joint is one weld and one total root gap',()=>{const d=newIso();const a=appendRun(d,null,[1000,0,0],'CS40',2,'SP','');appendRun(d,a.id,[1000,0,0],'CS40',2,'SP','');assert.equal(a.kind,'weld');assert.equal(welds(d).length,1);assert.equal(d.runs.reduce((s,r)=>s+runResult(d,r).cut,0),1997);});
test('missing fitting dimensions and negative cuts cannot pass fabrication checks',()=>{const d=newIso();appendRun(d,null,[100,0,0],'CS40',2,'SP','');const n=insertComponent(d,d.runs[0].id,'valve');assert.match(validateIso(d).join(),/takeouts/);n.takeout=200;assert.match(validateIso(d).join(),/cut length/);});
test('metric and fractional imperial input round trip accurately',()=>{assert.equal(parseLength("2' 3 1/2\"",'imperial'),698.5);assert.ok(Math.abs(parseLength('3/8"','imperial')-9.525)<1e-9);assert.equal(parseLength('1000 mm','imperial'),1000);assert.equal(formatLength(698.5,'imperial'), '2′ 3 1/2″');assert.throws(()=>parseLength('2/0"','imperial'));});
test('BOM does not merge heat lots or specs and missing fitting mass stays explicit',()=>{const d=newIso();const a=appendRun(d,null,[1000,0,0],'CS40',2,'SP','');appendRun(d,a.id,[0,1000,0],'CS40',2,'SP','');d.runs[0].heat='A';d.runs[1].heat='B';assert.equal(bom(d).filter(r=>r.unit==='m').length,2);assert.ok(bom(d).find(r=>r.unit==='ea')!.weightKg!>0);const v=insertComponent(d,d.runs[0].id,'valve');v.takeout=50;assert.equal(bom(d).find(r=>r.description==='valve')?.weightKg,null);});
test('untrusted JSON validates references and finite coordinates',()=>{const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','');assert.equal(parseIsoJson(JSON.stringify(d)).runs.length,1);d.runs[0].to='missing';assert.throws(()=>parseIsoJson(JSON.stringify(d)),/Missing connection/);});
test('SVG annotation escapes customer input and layout edits leave cut lengths unchanged',()=>{const d=newIso();const n=appendRun(d,null,[1000,0,0],'CS40',2,'SP','');d.customer='<script>alert(1)</script>';const cut=runResult(d,d.runs[0]).cut;n.labelOffset=[50,30];assert.equal(runResult(d,d.runs[0]).cut,cut);assert.ok(!drawingSvg(createDrawing(d)).includes('<script>'));});
test('CSV does not execute spreadsheet formula descriptions',()=>{assert.equal(csv([['=cmd','normal']]),'"\'=cmd","normal"');});
test('PCF endpoint lengths and connectivity preserve an imported elbow',()=>{const pcf=`ISOGEN-FILES x\nUNITS-BORE INCH\nUNITS-CO-ORDS MM\nPIPELINE-REFERENCE L-1\nPIPE\n    END-POINT 0 0 0 2\n    END-POINT 923.8 0 0 2\nELBOW\n    END-POINT 923.8 0 0 2\n    CENTRE-POINT 1000 0 0 2\n    END-POINT 1000 76.2 0 2\nPIPE\n    END-POINT 1000 76.2 0 2\n    END-POINT 1000 1000 0 2\n`;const d=importPcf(pcf).doc;assert.equal(d.runs.length,2);assert.equal(d.nodes.length,3);assert.equal(runResult(d,d.runs[0]).cut,923.8);assert.equal(runResult(d,d.runs[1]).cut,923.8);assert.equal(importPcf(exportPcf(d)).doc.runs.length,2);});
test('unsupported PCF items are rejected instead of silently missing from BOM',()=>{assert.throws(()=>importPcf('UNITS-BORE INCH\nUNITS-CO-ORDS MM\nUNSUPPORTED-FITTING\n    CO-ORDS 0 0 0 2'),/Unsupported PCF/);});

test('isometric picking inverts the display projection and snaps on the selected physical plane', async()=>{
  const {pickGridPoint}=await import('../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/grid.ts');
  const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','');
  const anchor:[number,number,number]=[1000,50,200];
  for(const north of [0,15,90,180]){
    d.north=north;const drawing=createDrawing(d);
    for(const plane of ['xy','xz','yz'] as const){
      const desired:[number,number,number]=[...anchor];
      const axes=plane==='xy'?[0,1]:plane==='xz'?[0,2]:[1,2];
      desired[axes[0]]+=241;desired[axes[1]]-=162;
      const actual=pickGridPoint(drawing,drawing.project(desired),anchor,{visible:true,snap:true,spacing:100,plane});
      const expected=[...anchor];expected[axes[0]]+=200;expected[axes[1]]-=200;
      actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-7));
    }
  }
});
test('grid preferences round-trip and the editor-only grid stays out of exports',async()=>{
  const {defaultGrid,pickGridPoint}=await import('../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/grid.ts');
  const d=newIso();d.grid={...defaultGrid(),spacing:25,plane:'xz'};
  const restored=parseIsoJson(JSON.stringify(d));assert.deepEqual(restored.grid,d.grid);
  const drawing=createDrawing(d);
  assert.ok(drawingSvg(drawing,'',true,{settings:d.grid,anchor:[0,0,0]}).includes('data-isometric-grid'));
  assert.ok(!drawingSvg(drawing).includes('data-isometric-grid'));
  assert.ok(!drawingSvg(drawing,'',true,{settings:{...d.grid,visible:false},anchor:[0,0,0]}).includes('data-isometric-grid'));
  assert.throws(()=>pickGridPoint(createDrawing(d,'','plan'),[100,200],[0,0,0],d.grid!),/edge-on/);
  d.grid.spacing=0;assert.throws(()=>parseIsoJson(JSON.stringify(d)),/grid settings/);
});
test('turning snap off retains precise picked coordinates without altering measured lengths',async()=>{
  const {defaultGrid,pickGridPoint}=await import('../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/grid.ts');
  const d=newIso();appendRun(d,null,[1234.56,0,0],'CS40',2,'SP','');const drawing=createDrawing(d);
  const point:[number,number,number]=[241.15,-162.9,0];
  const actual=pickGridPoint(drawing,drawing.project(point),[0,0,0],{...defaultGrid(),snap:false});
  actual.forEach((v,i)=>assert.ok(Math.abs(v-point[i])<1e-7));assert.equal(runResult(d,d.runs[0]).cut,1234.56);
});

test('mixed butt-weld and threaded ends apply gaps and welds only at the butt-weld end',()=>{
  const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','');
  const valve=insertComponent(d,d.runs[0].id,'valve');valve.takeout=100;
  d.runs[0].toPrep='THD';assert.equal(runResult(d,d.runs[0]).cut,400);
  assert.equal(runResult(d,d.runs[1]).cut,397);assert.equal(welds(d).length,1);
});
test('standard tee routing identifies its branch and uses manufacturer takeouts',()=>{
  const d=newIso(),junction=appendRun(d,null,[1000,0,0],'CS40',2,'SP','');
  appendRun(d,junction.id,[1000,0,0],'CS40',2,'SP','');appendRun(d,junction.id,[0,1000,0],'CS40',2,'SP','');
  assert.equal(junction.kind,'tee');assert.equal(junction.branchEdgeId,d.runs[2].id);
  assert.equal(runResult(d,d.runs[2]).cut,933.5);assert.deepEqual(validateIso(d),[]);
});
test('PCF with no material specification cannot silently inherit carbon-steel pipe weights',()=>{
 const {doc}=importPcf('UNITS-BORE INCH\nUNITS-CO-ORDS MM\nPIPE\n    END-POINT 0 0 0 2 BW\n    END-POINT 1000 0 0 2 BW\n');
 assert.match(validateIso(doc).join(),/missing/);assert.equal(bom(doc)[0].weightKg,null);assert.equal(runResult(doc,doc.runs[0]).cut,1000);
});
test('own PCF round trip preserves specs, independent root gaps and line identifiers',()=>{
 const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','LINE-A');
 const second=structuredClone(d.specs[0]);second.id='SS40';second.material='Stainless steel';second.rootGap=1;second.fittings=second.fittings.map(f=>({...f,id:'SS-'+f.id}));d.specs.push(second);
 appendRun(d,null,[0,1000,0],'SS40',3,'SP-2','LINE-B');const restored=importPcf(exportPcf(d)).doc;
 assert.equal(restored.specs.find(s=>s.id==='SS40')!.rootGap,1);assert.equal(restored.specs.find(s=>s.id==='SS40')!.material,'Stainless steel');
 assert.deepEqual(restored.runs.map(r=>r.line),['LINE-A','LINE-B']);assert.equal(restored.runs[1].specId,'SS40');
});
test('plant coordinates fit the drawing without scaling to the distant survey origin',()=>{
 const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','');d.nodes.forEach(n=>n.position=n.position.map(v=>v+1_000_000) as [number,number,number]);
 const drawing=createDrawing(d),positions=[...drawing.positions.values()];assert.ok(Math.abs(positions[1][0]-positions[0][0])>500);
});


test('alphabetic weld numbering crosses Z and retains explicit customer tags', async()=>{
 const {weldNumber}=await import('../../apps/cad-editor/packages/bidwright-cad-editor/src/piping/model.ts');
 assert.equal(weldNumber(26,'alphabetic'),'Z');assert.equal(weldNumber(27,'alphabetic'),'AA');assert.equal(weldNumber(703,'alphabetic'),'AAA');
 const d=newIso();const a=appendRun(d,null,[1000,0,0],'CS40',2,'SP','');appendRun(d,a.id,[0,1000,0],'CS40',2,'SP','');
 d.weldNumbering='alphabetic';d.weldPrefix='';d.runs[0].toTag='SITE-5';assert.deepEqual(welds(d).map(w=>w.tag),['SITE-5','A']);
 assert.equal(parseIsoJson(JSON.stringify(d)).weldNumbering,'alphabetic');
});
test('different measured fitting dimensions remain distinct BOM items with correct balloon membership',()=>{
 const d=newIso();appendRun(d,null,[2000,0,0],'CS40',2,'SP','');appendRun(d,null,[0,2000,0],'CS40',2,'SP','');
 const a=insertComponent(d,d.runs[0].id,'valve'), b=insertComponent(d,d.runs[1].id,'valve');a.takeout=50;b.takeout=100;
 const rows=bom(d,'global').filter(r=>r.unit==='ea');assert.equal(rows.length,2);assert.notEqual(rows[0].materialKey,rows[1].materialKey);
 assert.ok(rows.some(r=>r.memberIds?.includes(a.id)));assert.ok(rows.some(r=>r.memberIds?.includes(b.id)));
});

test('moved fitting geometry cannot silently produce a valid cut sheet',()=>{
 const d=newIso();const bend=appendRun(d,null,[1000,0,0],'CS40',2,'SP','');const end=appendRun(d,bend.id,[0,1000,0],'CS40',2,'SP','');
 end.position=[2000,1000,0];assert.match(validateIso(d).join(),/90 degree/);
});
test('socket weld position has no butt-weld root-gap displacement',()=>{
 const d=newIso();appendRun(d,null,[1000,0,0],'CS40',2,'SP','');const n=insertComponent(d,d.runs[0].id,'valve');n.takeout=100;
 d.runs[0].toPrep='SW';const w=welds(d).find(w=>w.runId===d.runs[0].id)!;assert.equal(w.position[0],400);
});
test('invalid pipe cuts never become negative purchased quantities or weights',()=>{
 const d=newIso();appendRun(d,null,[100,0,0],'CS40',2,'SP','');const n=insertComponent(d,d.runs[0].id,'valve');n.takeout=200;
 const pipes=bom(d).filter(r=>r.unit==='m');assert.ok(pipes.every(r=>!Number.isFinite(r.qty)&&r.weightKg===null&&r.cost===0));
});

test('PCF preserves per-pipe gap overrides and endpoint tags and preparations',()=>{
 const d=newIso();const a=appendRun(d,null,[1000,0,0],'CS40',2,'SP','LINE');appendRun(d,a.id,[0,1000,0],'CS40',2,'SP','LINE');
 d.runs[0].rootGap=5;d.runs[0].toTag='FW-1';d.runs[0].toField=true;d.runs[1].fromPrep='SW';
 const restored=importPcf(exportPcf(d)).doc;
 assert.equal(restored.runs[0].rootGap,5);assert.equal(restored.runs[0].toTag,'FW-1');assert.equal(restored.runs[0].toField,true);
 assert.equal(restored.runs[1].fromPrep,'SW');assert.equal(runResult(restored,restored.runs[0]).cut,runResult(d,d.runs[0]).cut);
});
