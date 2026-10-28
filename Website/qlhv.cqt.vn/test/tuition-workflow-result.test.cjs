const {test}=require('node:test')
const assert=require('node:assert/strict')
const Module=require('node:module')

test('lost-response reconciliation reads canonical fee, payments and invoice without writes',async()=>{
 const load=Module._load
 const fee={studentId:'s1',classId:'c1',billingMonth:7,billingYear:2026,finalAmount:100000,status:'PENDING',paidAmount:0}
 const values=new Map([['tuitionRecords/f1',fee],['payments/p1',{tuitionRecordId:'f1',amount:100000}],['misaInvoices/f1',{status:'DRAFT_CREATED',refId:'ref1'}]])
 const doc=(id,data)=>({id,exists:data!==undefined,data:()=>data})
 let duplicates=false
 const db={collection(name){return {
  doc(id){return {get:async()=>doc(id,values.get(name+'/'+id)),set(){throw Error('must not write')},update(){throw Error('must not write')}}},
  where(){return this},limit(){return this},async get(){const docs=[...values].filter(([key])=>key.startsWith(name+'/')).map(([key,value])=>doc(key.split('/')[1],value));if(duplicates&&name==='tuitionRecords')docs.push(doc('f2',fee));return {docs,size:docs.length,empty:!docs.length}},
 }}}
 const path=require.resolve('../dist/services/tuitionWorkflowResult'),calc=require.resolve('../dist/services/tuitionCalculator')
 delete require.cache[path];delete require.cache[calc]
 Module._load=function(name,parent,isMain){if(name==='../lib/firebase')return {db,C:{TUITION_RECORDS:'tuitionRecords',PAYMENTS:'payments'},toObj:d=>({id:d.id,...d.data()}),toDocs:snap=>snap.docs.map(d=>({id:d.id,...d.data()}))};return load.call(this,name,parent,isMain)}
 try{
  const {getTuitionWorkflowResult}=require(path)
  const input={studentId:'s1',classId:'c1',month:7,year:2026}
  let result=await getTuitionWorkflowResult(input)
  assert.equal(result.paid,true);assert.equal(result.finalStatus.totalPaid,100000)
  assert.equal(result.invoiceDraft.status,'DRAFT_CREATED');assert.equal(result.invoiceDraft.refId,'ref1')
  values.delete('misaInvoices/f1')
  result=await getTuitionWorkflowResult(input)
  assert.equal(result.invoiceDraft.status,'SKIPPED_BEFORE_INVOICE_START')
  assert.equal(result.invoiceDraft.enabled,false)
  fee.billingMonth=10
  result=await getTuitionWorkflowResult({...input,month:10})
  assert.equal(result.invoiceDraft.status,'OUTCOME_UNKNOWN','eligible fees without metadata still need reconciliation')
  fee.billingMonth=7
  await assert.rejects(getTuitionWorkflowResult({...input,month:10,recordId:'f1'}),e=>e.status===409)
  duplicates=true;await assert.rejects(getTuitionWorkflowResult(input),e=>e.status===409)
  duplicates=false;values.delete('tuitionRecords/f1');assert.equal(await getTuitionWorkflowResult(input),null)
 }finally{Module._load=load;delete require.cache[path];delete require.cache[calc]}
})
