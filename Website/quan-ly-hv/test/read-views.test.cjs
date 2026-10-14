const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('shared views avoid repeated scans, preserve private eligibility and paginate billing periods', async () => {
  const originalLoad = Module._load
  const tables = new Map([
    ['students', new Map([['s1', {fullName:'An',gradeLevel:8}],['s2',{fullName:'Bình',gradeLevel:9}],['s3',{fullName:'Chi',gradeLevel:6}]])],
    ['classEnrollments', new Map([['e1',{studentId:'s1',status:'ACTIVE'}]])],
    ['privateSchedules', new Map([['p1',{studentId:'s2',sessionDate:'2026-10-14',status:'CANCELLED'}]])],
  ])
  let reads = 0, scans = 0
  const doc = (id,data) => ({id,exists:data!==undefined,data:()=>data})
  function query(name, filters=[]) {
    const rows=()=>[...(tables.get(name)||new Map()).entries()].filter(([,data])=>filters.every(([field,op,value])=>{
      if(op==='==') return data[field]===value
      if(op==='>=') return data[field]>=value
      if(op==='<=') return data[field]<=value
      if(op==='array-contains') return data[field]?.includes(value)
      throw Error('unexpected operator')
    }))
    return {
      where(field,op,value){return query(name,[...filters,[field,op,value]])}, select(){return this},
      async get(){scans++;const docs=rows().map(([id,data])=>doc(id,data));reads+=Math.max(1,docs.length);return {docs}},
      doc(id){return {async get(){reads++;return doc(id,tables.get(name)?.get(id))},async set(data){if(!tables.has(name))tables.set(name,new Map());tables.get(name).set(id,data)}}},
    }
  }
  Module._load=function(request,parent,isMain){
    if(request==='../lib/firebase') return {db:{collection:query},C:{STUDENTS:'students',ENROLLMENTS:'classEnrollments',PRIVATE_SCHEDULES:'privateSchedules'}}
    return originalLoad.call(this,request,parent,isMain)
  }
  const path=require.resolve('../dist/services/readViews'), oldModule=require.cache[path]
  delete require.cache[path]
  try {
    const service=require(path)
    const first=await service.getMissingPrivateStudents(10,2026)
    // Cancelled sessions still count as scheduled, preserving existing behavior.
    assert.deepEqual(first.data.map(s=>s.id),['s3'])
    const before=reads, beforeScans=scans
    const unchanged=await service.getMissingPrivateStudents(10,2026,first.version)
    assert.equal(unchanged.unchanged,true)
    assert.equal(reads-before,1)
    assert.equal(scans,beforeScans)
    const newClient=await service.getMissingPrivateStudents(10,2026)
    assert.deepEqual(newClient.data,first.data)
    assert.equal(scans,beforeScans)
    tables.get('privateSchedules').clear()
    await service.invalidateReadView('privateMissing')
    const changed=await service.getMissingPrivateStudents(10,2026,first.version)
    assert.deepEqual(changed.data.map(s=>s.id),['s2','s3'])
    const middlewarePath=require.resolve('../dist/middleware/readViewInvalidation')
    delete require.cache[middlewarePath]
    const {readViewInvalidation}=require(middlewarePath)
    const previousRevision=tables.get('readViewRevisions').get('privateMissing').revision
    let response
    const delivered=new Promise(resolve=>{response={statusCode:200,json(payload){
      assert.notEqual(tables.get('readViewRevisions').get('privateMissing').revision,previousRevision)
      resolve(payload)
    }}})
    readViewInvalidation({method:'PUT',path:'/api/students/s2'},response,()=>{})
    response.json({saved:true})
    assert.deepEqual(await delivered,{saved:true})
    const afterSuccess=tables.get('readViewRevisions').get('privateMissing').revision
    const denied={statusCode:403,json(){return this}}
    readViewInvalidation({method:'PUT',path:'/api/students/s2'},denied,()=>{})
    denied.json({message:'Forbidden'})
    assert.equal(tables.get('readViewRevisions').get('privateMissing').revision,afterSuccess)
    delete require.cache[middlewarePath]

    const source=(id,month)=>({recordId:id,studentId:'s1',studentName:'An',className:'Math',month,year:2026,finalAmount:100000})
    tables.set('misaInvoices',new Map([
      ['f1',{recordIds:['f1'],source:source('f1',10),billingPeriods:['2026-10'],status:'DRAFT_CREATED',createdAt:'2026-10-12T10:00:00Z'}],
      ['f2',{recordIds:['f2','f3'],source:source('f2',10),sources:[source('f2',10),source('f3',7)],billingPeriods:['2026-10','2026-07'],status:'DRAFT_CREATED',createdAt:'2026-10-14T10:00:00Z'}],
      ['f3',{recordIds:['f2','f3'],source:source('f2',10),sources:[source('f2',10),source('f3',7)],billingPeriods:['2026-10','2026-07'],status:'DRAFT_CREATED',createdAt:'2026-10-14T10:00:00Z'}],
    ]))
    const page1=await service.getInvoiceList(10,2026,1)
    assert.equal(page1.total,2);assert.equal(page1.counts.DRAFT_CREATED,2)
    assert.equal(page1.rows[0].id,'f2')
    const scansBeforePage2=scans
    const page2=await service.getInvoiceList(10,2026,1,page1.nextCursor)
    assert.equal(page2.rows[0].id,'f1');assert.equal(page2.nextCursor,null)
    assert.equal(scans,scansBeforePage2)
    const july=await service.getInvoiceList(7,2026,30)
    assert.deepEqual(july.rows.map(row=>row.id),['f3'])
    assert.deepEqual(service.invoiceBillingPeriods(tables.get('misaInvoices').get('f2')),['2026-10','2026-07'])
    await service.invalidateReadView('invoices')
    await assert.rejects(service.getInvoiceList(10,2026,1,page1.nextCursor),error=>error.status===409)
    await assert.rejects(service.getInvoiceList(10,2026,1,'bnVsbA'),error=>error.status===400)
  } finally {
    Module._load=originalLoad
    if(oldModule)require.cache[path]=oldModule;else delete require.cache[path]
  }
})
