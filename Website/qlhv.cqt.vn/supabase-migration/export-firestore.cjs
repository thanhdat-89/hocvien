// Run from the backend project after installing existing npm dependencies.
require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const out = process.argv[2];
if (!out) throw new Error('Usage: node supabase-migration/export-firestore.cjs /absolute/private/backup-directory');
const root = path.resolve(out);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const exportFile = path.join(root, 'firestore.ndjson');
const fd = fs.openSync(exportFile, 'wx', 0o600);
const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
  : process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? admin.credential.applicationDefault()
  : admin.credential.cert(require(path.resolve('firebase-service-account.json')));
admin.initializeApp({credential, projectId:'hocthemtoan-7ecb8'});
const db = admin.firestore();
const counts = {};
const hash = crypto.createHash('sha256');
function encode(v) {
  if (v instanceof admin.firestore.Timestamp) return {$firestoreType:'timestamp',seconds:v.seconds,nanoseconds:v.nanoseconds};
  if (v instanceof admin.firestore.GeoPoint) return {$firestoreType:'geopoint',latitude:v.latitude,longitude:v.longitude};
  if (v instanceof admin.firestore.DocumentReference) return {$firestoreType:'reference',path:v.path};
  if (Buffer.isBuffer(v)) return {$firestoreType:'bytes',base64:v.toString('base64')};
  if (typeof v === 'number' && !Number.isFinite(v)) return {$firestoreType:'number',value:String(v)};
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));
  return v;
}
async function walk(collection) {
  counts[collection.path] = 0;
  let cursor;
  while (true) {
    let query = collection.orderBy(admin.firestore.FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const batch = await query.get();
    for (const doc of batch.docs) {
      const line = JSON.stringify({path:doc.ref.path,collection_path:collection.path,document_id:doc.id,data:encode(doc.data())})+'\n';
      fs.writeSync(fd,line); hash.update(line); counts[collection.path]++;
      for (const child of await doc.ref.listCollections()) await walk(child);
    }
    if (batch.size < 200) break;
    cursor = batch.docs.at(-1);
  }
}
(async()=>{
  const startedAt = new Date().toISOString();
  for (const collection of await db.listCollections()) await walk(collection);
  fs.closeSync(fd);
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({projectId:'hocthemtoan-7ecb8',startedAt,finishedAt:new Date().toISOString(),sha256:hash.digest('hex'),counts,total:Object.values(counts).reduce((a,b)=>a+b,0)},null,2),{flag:'wx',mode:0o600});
  console.log('Export complete. Documents:',Object.values(counts).reduce((a,b)=>a+b,0));
})().catch(()=>{fs.closeSync(fd);console.error('Export failed; incomplete backup must not be imported. Check credentials/quota.');process.exitCode=1});
