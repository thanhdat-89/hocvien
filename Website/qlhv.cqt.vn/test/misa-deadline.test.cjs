const {test}=require('node:test')
const assert=require('node:assert/strict')
const {withMisaDeadline}=require('../dist/services/misaRequestDeadline')

test('exhausted shared budget prevents starting another provider request',async()=>{
 let calls=0
 const fetch=withMisaDeadline(async()=>{calls++;return Response.json({})},Date.now()-1)
 await assert.rejects(fetch('https://provider/invoice',{method:'POST'}),e=>e.name==='TimeoutError')
 assert.equal(calls,0)
})
test('shared deadline aborts a stalled provider request without retrying it',async()=>{
 let calls=0
 const request=withMisaDeadline(async(_,init)=>{
  calls++
  return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))
 },Date.now()+20)
 // AbortSignal's timer is unref'ed; keep this fixture process alive until it fires.
 const keepAlive=setTimeout(()=>{},1000)
 try {await assert.rejects(request('https://provider/invoice',{method:'POST'}),e=>e.name==='TimeoutError');assert.equal(calls,1)}
 finally {clearTimeout(keepAlive)}
})
test('caller cancellation and request fields survive budget composition',async()=>{
 const controller=new AbortController()
 const request=withMisaDeadline(async(_,init)=>{
  assert.equal(init.method,'POST');assert.equal(init.body,'test');assert.equal(init.headers.example,'header')
  controller.abort()
  assert(init.signal.aborted)
  throw init.signal.reason
 })
 await assert.rejects(request('https://provider/invoice',{method:'POST',body:'test',headers:{example:'header'},signal:controller.signal}),e=>e.name==='AbortError')
})
