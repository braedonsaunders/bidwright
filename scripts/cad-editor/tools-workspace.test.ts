import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';

test('Tools creates no quote, stays tenant scoped, and copies files with PDF measurement provenance',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bidwright-tools-'));process.env.DATA_DIR=root;
 const {toolsRoutes,toolsProjectId,personalToolsProjectId,toolsAccessPlugin}=await import('../../apps/api/src/routes/tools-routes.ts');
 const prisma:any={project:{upsert:async()=>null},fileNode:{findFirst:async()=>null,findUnique:async()=>null},quote:{findFirst:async()=>null},pickup:{findMany:async()=>[],createMany:async()=>({count:0}),deleteMany:async()=>({count:0})}};
 const projects=new Map<string,any>(),copies:any[]=[],pickups:any[]=[];
 let quoteCreates=0;
 const source={id:'source-pdf',projectId:toolsProjectId('org-a'),name:'field.pdf',type:'file',fileType:'pdf',size:11,metadata:{title:'Field'},storagePath:'source/field.pdf'};
 await mkdir(path.join(root,'source'));await writeFile(path.join(root,source.storagePath),'PDF-fixture');
 mock.method(prisma.project,'upsert',async(options:any)=>{const id=options.where.id;if(!projects.has(id))projects.set(id,options.create);return projects.get(id);});
 mock.method(prisma.fileNode,'findFirst',async({where}:any)=>where.id===source.id&&where.projectId.in.includes(source.projectId)?source:null);
 mock.method(prisma.quote,'findFirst',async({where}:any)=>where.projectId==='quote-project'&&where.project.organizationId==='org-a'?{id:'quote-1'}:null);
 mock.method(prisma.pickup,'findMany',async()=>[{pageNumber:1,annotationType:'linear',label:'Pipe run',color:'#0897b2',lineThickness:2,visible:true,points:[{x:0,y:0},{x:100,y:0}],measurement:{value:10,unit:'ft'},calibration:{pixelsPerUnit:10,unit:'ft'},metadata:{measuredBy:'person',canvasWidth:800},groupName:''}]);
 mock.method(prisma.pickup,'createMany',async({data}:any)=>{pickups.push(...data);return {count:data.length};});
 mock.method(prisma.pickup,'deleteMany',async()=>({count:0}));
 const app=Fastify();
 app.addHook('onRequest',async request=>{const organizationId=String(request.headers['x-test-org']??'org-a');(request as any).user={id:String(request.headers['x-test-user']??'user-1')};request.store={
  organizationId,
  getProject:async(id:string)=>organizationId==='org-a'&&id==='quote-project'?{id}:null,
  createProject:async()=>{quoteCreates++;return {project:{id:'quote-project'},quote:{id:'quote-1'}};},
  createFileNode:async(projectId:string,data:any)=>{const row={...data,projectId,id:'copy-'+copies.length};copies.push(row);return row;},
  updateFileNode:async(id:string,patch:any)=>Object.assign(copies.find(x=>x.id===id),patch),
  deleteFileNode:async()=>{},
 } as any;});
 await app.register(toolsAccessPlugin,{database:prisma});
 await app.register(toolsRoutes,{database:prisma});
 app.get('/projects/:projectId/files',async()=>[]);
 t.after(async()=>{mock.restoreAll();await app.close();await rm(root,{recursive:true,force:true});});
 const mine=await app.inject({method:'POST',url:'/tools/workspace',payload:{}});
 assert.equal(mine.json().space,'personal');assert.equal(mine.json().project.id,personalToolsProjectId('org-a','user-1'));
 const theirs=await app.inject({method:'POST',url:'/tools/workspace',payload:{},headers:{'x-test-user':'user-2'}});
 assert.notEqual(mine.json().project.id,theirs.json().project.id);
 assert.equal((await app.inject({method:'GET',url:'/projects/'+mine.json().project.id+'/files'})).statusCode,200);
 assert.equal((await app.inject({method:'GET',url:'/projects/'+mine.json().project.id+'/files',headers:{'x-test-user':'user-2'}})).statusCode,404);
 projects.clear();
 const first=await app.inject({method:'POST',url:'/tools/workspace',payload:{space:'organization'}}),second=await app.inject({method:'POST',url:'/tools/workspace',payload:{space:'organization'},headers:{'x-test-user':'user-2'}});
 assert.equal(first.statusCode,200);assert.equal(first.json().project.id,second.json().project.id);assert.equal(first.json().quote,null);assert.equal(quoteCreates,0);assert.equal(projects.size,1);
 const other=await app.inject({method:'POST',url:'/tools/workspace',payload:{space:'organization'},headers:{'x-test-org':'org-b'}});
 assert.notEqual(first.json().project.id,other.json().project.id);
 const forbidden=await app.inject({method:'POST',url:'/tools/files/source-pdf/to-quote',headers:{'x-test-org':'org-b'},payload:{projectId:'quote-project'}});
 assert.equal(forbidden.statusCode,404);assert.equal(copies.length,0);
 const badTarget=await app.inject({method:'POST',url:'/tools/files/source-pdf/to-quote',payload:{projectId:'some-other-tenant'}});
 assert.equal(badTarget.statusCode,404);assert.equal(copies.length,0);
 const result=await app.inject({method:'POST',url:'/tools/files/source-pdf/to-quote',payload:{projectId:'quote-project'}});
 assert.equal(result.statusCode,200);assert.equal(result.json().quoteId,'quote-1');assert.equal(quoteCreates,0);
 assert.equal(await readFile(path.join(root,copies[0].storagePath),'utf8'),'PDF-fixture');
 assert.equal(await readFile(path.join(root,source.storagePath),'utf8'),'PDF-fixture');
 assert.equal(pickups[0].documentId,'file-'+copies[0].id);assert.equal(pickups[0].projectId,'quote-project');
 assert.deepEqual(pickups[0].calibration,{pixelsPerUnit:10,unit:'ft'});
 const created=await app.inject({method:'POST',url:'/tools/files/source-pdf/to-quote',payload:{quoteName:'Field spool'}});
 assert.equal(created.statusCode,200);assert.equal(quoteCreates,1);
});
