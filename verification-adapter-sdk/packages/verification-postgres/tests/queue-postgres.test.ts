import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {describe,it,expect} from 'vitest';
import {createPostgresStore} from '../src/store.ts';
import {createPostgresQueue} from '../src/queue.ts';
import type {JobRecord} from '@splitin/verification-engine';
// A migrated disposable database only. This test never drops a shared schema.
describe.skipIf(!process.env.TEST_DATABASE_URL)('durable queue on PostgreSQL',()=>{
 it('persists retry dates, fences stale workers, reclaims expired leases and bounds mixed claims',async()=>{
  const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  const tenant='queue-test-'+randomUUID();
  let now=new Date();
  const store=createPostgresStore(db,{hashSecret:'disposable-test-secret',now:()=>now});
  const queue=createPostgresQueue(store,{random:()=>0});
  const make=(kind:JobRecord['kind']):JobRecord=>({tenantKey:tenant,id:randomUUID(),kind,attemptId:randomUUID(),eventId:null,subjectHash:'a'.repeat(64),providerResourceId:'fixture',state:'scheduled',leaseId:null,leaseExpiresAt:null,attemptCount:0,nextAttemptAt:now.toISOString(),lastErrorCode:null,createdAt:now.toISOString()});
  const claim=(workerId:string,limit=1)=>queue.claim({tenantKey:tenant,kinds:['reconcile','redact','webhook'],limit,leaseSeconds:30,workerId,now});
  try {
   await store.ensureTenant(tenant);
   const recon=make('reconcile');await queue.enqueue(recon);
   const [first]=await claim('first');expect(first.nextAttemptAt).toMatch(/T.*Z$/);
   await queue.retry(tenant,first.id,first.leaseId!,{errorCode:'processing',retryAfterSeconds:60});
   const retried=await store.getJob(tenant,recon.id);expect(retried?.state).toBe('retryable');expect(Date.parse(retried!.nextAttemptAt)).toBeGreaterThan(now.getTime());
   expect(await claim('too-early')).toHaveLength(0);
   now=new Date(now.getTime()+120000);const [second]=await claim('second');expect(second.attemptCount).toBe(2);
   await queue.complete(tenant,recon.id,first.leaseId!);expect((await store.getJob(tenant,recon.id))?.state).toBe('processing');
   now=new Date(now.getTime()+31000);const [third]=await claim('third');expect(third.id).toBe(recon.id);expect(third.attemptCount).toBe(3);
   await queue.complete(tenant,third.id,third.leaseId!);expect((await store.getJob(tenant,recon.id))?.state).toBe('completed');
   await queue.enqueue(make('reconcile'));await queue.enqueue(make('redact'));
   expect(await claim('bounded')).toHaveLength(1);expect(await claim('remaining')).toHaveLength(1);
   const webhook=make('webhook');await queue.enqueue(webhook);const [event]=await claim('webhook');await queue.complete(tenant,event.id,event.leaseId!);expect(await store.getJob(tenant,event.id)).toBeNull();
  }finally{
   for(const table of ['reconciliation_jobs','redaction_jobs','webhook_leases','tenants'])await db.query(`DELETE FROM verification.${table} WHERE tenant_key=$1`,[tenant]);
   await db.end();
  }
 });
});
