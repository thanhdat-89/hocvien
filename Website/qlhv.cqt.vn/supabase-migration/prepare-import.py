"""Offline converter: validates backup and generates transactional SQL, no network."""
import sys, json, hashlib, collections, pathlib, os
root = pathlib.Path(sys.argv[1])
raw = (root / 'firestore.ndjson').read_bytes()
manifest = json.loads((root / 'manifest.json').read_text())
if hashlib.sha256(raw).hexdigest() != manifest['sha256']:
    raise ValueError('Backup checksum mismatch')
rows = [json.loads(line) for line in raw.splitlines()]
counts = collections.Counter(r['collection_path'] for r in rows)
if len({r['path'] for r in rows}) != len(rows):
    raise ValueError('Duplicate document paths')
if len(rows) != manifest['total'] or any(counts[k] != v for k,v in manifest['counts'].items()) or set(counts) - set(manifest['counts']):
    raise ValueError('Counts do not match manifest')
def q(value):
    return "'" + value.replace("'", "''") + "'"
sql = ['BEGIN;', 'SET LOCAL standard_conforming_strings = on;',
       "DO $$ BEGIN IF EXISTS (SELECT 1 FROM qlhv_migration.documents) THEN RAISE EXCEPTION 'Target staging table is not empty'; END IF; END $$;"]
for r in rows:
    if r['path'] != r['collection_path'] + '/' + r['document_id'] or not isinstance(r['data'], dict):
        raise ValueError('Invalid document structure')
    sql.append('INSERT INTO qlhv_migration.documents(path,collection_path,document_id,data) VALUES (' + ','.join(q(r[k]) for k in ['path','collection_path','document_id']) + ',' + q(json.dumps(r['data'], ensure_ascii=False)) + '::jsonb);')
sql.append('COMMIT;')
with open(root / 'import.sql', 'x', encoding='utf-8') as f:
    os.chmod(root / 'import.sql', 0o600)
    f.write('\n'.join(sql)+'\n')
print(f'Validated {len(rows)} documents. Generated import.sql; contains private data, do not commit.')
