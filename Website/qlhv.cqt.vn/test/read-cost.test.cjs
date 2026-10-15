const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('tuition and dashboard reuse summaries; financial writes invalidate before success; student cursors avoid skipped reads', async () => {
  const original = Module._load
  const tables = new Map([
    ['students', new Map(Array.from({length: 45}, (_, i) => [`s${i}`, {
      fullName: `Student ${String(i).padStart(2,'0')}`, status: i === 44 ? 'INACTIVE' : 'ACTIVE', gradeLevel: i % 2 ? 8 : 9,
    }]))],
    ['classEnrollments', new Map([['e1', {classId:'c1',studentId:'s1',status:'ACTIVE'}]])],
  ])
  const scans = [], studentReads = []
  let calculations = 0
  let summaryRows = [{studentId:'s1',finalAmount:100,tuitionRecord:{remainingAmount:100}}, {studentId:'s1',finalAmount:50}, {studentId:'s2',finalAmount:50,tuitionRecord:{remainingAmount:0}}]
  const doc = (id, value) => ({ id, exists: value !== undefined, data: () => value })
  const collection = (name, filters = []) => ({
    where(field, op, value) { return collection(name, [...filters,[field,op,value]]) },
    select() { return this }, orderBy() { return this }, limit() { return this },
    offset() { throw Error('Firestore offsets must never be used') },
    async get() {
      scans.push(name)
      const docs = [...(tables.get(name) || new Map()).entries()].filter(([id,data]) => filters.every(([field,op,value]) => {
        const actual = field === '__name__' ? id : data[field]
        if (op === '==') return actual === value
        if (op === 'in') return value.includes(actual)
        if (op === '>=') return actual >= value
        if (op === '<=') return actual <= value
        if (op === '<') return actual < value
        throw Error(`unsupported operator ${op}`)
      })).map(([id,data]) => doc(id,data))
      if (name === 'students') studentReads.push(docs.map(d => d.id))
      return {docs,size:docs.length,empty:!docs.length}
    },
    doc(id) { return {
      async get() { return doc(id,tables.get(name)?.get(id)) },
      async set(value) { if (!tables.has(name)) tables.set(name,new Map()); tables.get(name).set(id,value) },
    } },
  })
  const firebase = {db:{collection},C:{STUDENTS:'students',ENROLLMENTS:'classEnrollments',STUDENT_PROMOTIONS:'studentPromotions',CLASSES:'classes',SESSIONS:'sessions',PRIVATE_SCHEDULES:'privateSchedules',PAYMENTS:'payments',TUITION_RECORDS:'tuitionRecords'},
    admin:{firestore:{FieldPath:{documentId:()=> '__name__'}}},toDocs:snap=>snap.docs.map(d=>({id:d.id,...d.data()}))}
  const loaded = []
  Module._load = function(request,parent,isMain) {
    if (request.endsWith('/lib/firebase') || (request === './firebase' && parent?.filename.endsWith('/classDisplayNames.js'))) return firebase
    if (request.endsWith('/tuitionScheduleSummary')) return {getTuitionScheduleSummary:async()=>{calculations++;return structuredClone(summaryRows)}}
    const result = original.call(this,request,parent,isMain)
    if (parent && request.startsWith('.')) { const path = Module._resolveFilename(request,parent); if(path.includes('/dist/')) loaded.push(path) }
    return result
  }
  function handler(router,path) { return router.stack.find(layer=>layer.route?.path===path && layer.route.methods.get).route.stack.at(-1).handle }
  async function request(fn, query={}) { let result, error; await fn({query},{json:data=>{result=data}},err=>{error=err}); if(error)throw error; return result }
  try {
    const {getCachedTuitionSummary}=require('../dist/services/tuitionReadView')
    const {invalidateReadView,readView}=require('../dist/services/readViews')
    const {readViewInvalidation}=require('../dist/middleware/readViewInvalidation')
    const first=await getCachedTuitionSummary(10,2026)
    assert.equal(first.unpaidStudents,1)
    assert.equal(calculations,1)
    assert.deepEqual(await getCachedTuitionSummary(10,2026),first)
    const dashboard=require('../dist/routes/dashboard').default
    const dashboardRead=handler(dashboard,'/')
    const firstDashboard = await request(dashboardRead)
    assert.equal(firstDashboard.stats.unpaidStudentsThisMonth,1)
    assert.deepEqual(firstDashboard.stats.unpaidStudentsByMonth, [
      {year:2026,month:9,count:1},
      {year:2026,month:10,count:1},
    ])
    assert.equal(calculations,2,'dashboard must reuse the current month and calculate each earlier month once')
    const beforeScans=scans.length
    await request(dashboardRead)
    assert.equal(scans.length,beforeScans,'warm dashboard must not scan business collections')

    // A payment changes the canonical data; both display views must refresh before success reaches the client.
    summaryRows=[{studentId:'s1',finalAmount:100,tuitionRecord:{remainingAmount:0}}]
    await new Promise(resolve=>{
      const response={statusCode:200,json(payload){resolve(payload)}}
      readViewInvalidation({method:'POST',path:'/api/tuition/t1/payment'},response,()=>{})
      response.json({saved:true})
    })
    assert.equal((await request(dashboardRead)).stats.unpaidStudentsThisMonth,0)
    assert.equal(calculations,4)
    assert.deepEqual((await getCachedTuitionSummary(10,2026)).rows,summaryRows)
    await getCachedTuitionSummary(10,2026,true)
    assert.equal(calculations,5,'manual refresh forces original calculation')
    let builds=0
    await readView('dashboard','expiry',async()=>++builds,undefined,false,100)
    tables.get('readViews').get('dashboard-expiry').generatedAt=Date.now()-101
    await readView('dashboard','expiry',async()=>++builds,undefined,false,100)
    assert.equal(builds,2,'expiry rebuilds a missed invalidation')

    for (const [method,path] of [['POST','/api/webhooks/sepay'],['PUT','/api/students/s1/private-schedule/p1'],['POST','/api/classes/c1/enroll'],['POST','/api/tuition/student-promotions'],['PUT','/api/sessions/session1'],['DELETE','/api/holidays/h1'],['GET','/api/schedules/cron/generate-monthly']]) {
      const previous=tables.get('readViewRevisions').get('tuition').revision
      await new Promise(resolve=>{const response={statusCode:200,json:resolve};readViewInvalidation({method,path},response,()=>{});response.json({saved:true})})
      assert.notEqual(tables.get('readViewRevisions').get('tuition').revision,previous,path)
    }
    const revision=tables.get('readViewRevisions').get('tuition').revision
    for (const [method,path,status,payload] of [['POST','/api/tuition/misa/connection/check',200,{}],['POST','/api/tuition/t1/payment',403,{}],['POST','/api/webhooks/sepay',200,{idempotent:true}]]) {
      const response={statusCode:status,json:()=>{}}
      readViewInvalidation({method,path},response,()=>{});response.json(payload)
      assert.equal(tables.get('readViewRevisions').get('tuition').revision,revision)
    }

    const students=require('../dist/routes/students').default
    const studentRead=handler(students,'/')
    const page1=await request(studentRead,{limit:'20'})
    assert.equal(page1.total,45);assert.equal(page1.totalActive,44)
    assert.equal(page1.data.length,20)
    assert.deepEqual(studentReads.at(-1),Array.from({length:20},(_,i)=>`s${i}`))
    const scansBeforePage2=scans.filter(name=>name==='students').length
    const page2=await request(studentRead,{limit:'20',page:'2',cursor:page1.nextCursor})
    assert.equal(scans.filter(name=>name==='students').length-scansBeforePage2,1,'only the selected page is read')
    assert.equal(page2.data[0].id,'s20')
    assert.equal(page2.data.at(-1).id,'s39')
    const page3=await request(studentRead,{limit:'20',page:'3'})
    assert.equal(page3.data.length,5,'numbered deep jumps are retained without offsets')
    assert.equal(studentReads.at(-1).length,5)
    const filtered=await request(studentRead,{search:'dent 0',status:'ACTIVE',gradeLevel:'8',limit:'20'})
    assert.deepEqual(filtered.data.map(s=>s.id),['s1','s3','s5','s7','s9'])
    const classPage=await request(studentRead,{classId:'c1',limit:'20'})
    assert.deepEqual(classPage.data.map(s=>s.id),['s1'])
    await assert.rejects(request(studentRead,{limit:'20',cursor:'bnVsbA'}),err=>err.status===400)
    await invalidateReadView('studentsIndex')
    await assert.rejects(request(studentRead,{limit:'20',cursor:page1.nextCursor}),err=>err.status===409)
  } finally {Module._load=original;loaded.forEach(path=>delete require.cache[path])}
})
