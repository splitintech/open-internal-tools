import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
 await client.query('CREATE SCHEMA IF NOT EXISTS zelle_quick_pay; REVOKE ALL ON SCHEMA zelle_quick_pay FROM PUBLIC; CREATE TABLE IF NOT EXISTS zelle_quick_pay.schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON zelle_quick_pay.schema_migrations FROM PUBLIC');
 for(const file of ['001_initial.sql','002_active_sessions.sql']){
  await client.query('BEGIN');
  try{
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('zelle-schema-migration',0))");
   if(!(await client.query('SELECT 1 FROM zelle_quick_pay.schema_migrations WHERE version=$1',[file])).rowCount){
    const sql=(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8')).replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
    await client.query(sql);await client.query('INSERT INTO zelle_quick_pay.schema_migrations(version) VALUES($1)',[file]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
 }
 console.log('Zelle reference schema migrated');
}finally{client.release();await pool.end();}
