import {describe,it,expect} from 'vitest';
import {createSyntheticFixture} from '../src/testing';
import {PaymentEngine} from '../src/server';
describe('durable authorization and source exclusion',()=>{
 it('recovers a lost authorization response without authorizing twice',async()=>{
  const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
  const real=f.provider.authorize!;let calls=0;f.provider.authorize=async session=>{calls++;await real(session);throw Error('lost response');};
  await expect(f.engine.authorize(f.actor,s.id)).rejects.toThrow('authorization_uncertain');
  const next=new PaymentEngine({store:f.store,host:f.host,provider:f.provider,environment:'synthetic',enabled:{bankApp:true,embedded:true}});
  await next.tick();expect((await next.get(f.actor,s.id)).journey).toBe('authorized');expect(calls).toBe(1);
 });
 it('releases consent proven not started and ignores a stale response',async()=>{
  const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
  let entered!:()=>void;const started=new Promise<void>(r=>entered=r);let release!:(v:any)=>void;
  f.provider.authorize=async()=>{entered();return new Promise(r=>release=r);};
  const pending=f.engine.authorize(f.actor,s.id).catch(e=>e);await started;await f.engine.tick();
  expect((await f.engine.get(f.actor,s.id)).journey).toBe('review');
  release({authorizationId:'late',expiresAt:new Date(Date.now()+300000).toISOString()});await pending;
  expect((await f.engine.get(f.actor,s.id)).journey).toBe('review');await f.engine.abandon(f.actor,s.id);
 });
 it('keeps unknown consent reserved',async()=>{
  const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
  f.provider.authorize=async()=>{throw Error('network');};f.provider.recoverAuthorization=async()=>({status:'unknown'});
  await expect(f.engine.authorize(f.actor,s.id)).rejects.toThrow();await f.engine.tick();
  expect((await f.engine.get(f.actor,s.id)).journey).toBe('authorizing');await expect(f.engine.abandon(f.actor,s.id)).rejects.toThrow('check_existing_payment');
 });
 it('clears authenticated exclusion without paying the wrongly linked obligation',async()=>{
  const f=createSyntheticFixture();const a=await f.engine.create(f.actor,f.context.obligationId,'bank_app');f.context.obligationId='other';const b=await f.engine.create(f.actor,'other','bank_app');
  const original=f.receipt(a);await f.ingest(original);await f.ingest({...original,sessionId:b.id});
  f.provider.reviewException=async(session,records)=>({canonicalReceipt:original,excludedSessionId:session.id===b.id?b.id:undefined,supersededFingerprints:records.filter(r=>r.receipt.sessionId===b.id).map(r=>r.fingerprint)});
  for(const e of (await f.engine.operations(f.actor)).exceptions)await f.engine.replay(f.actor,e.id,'Source confirms the original session only');await f.engine.deliverOutbox();
  expect((await f.engine.get(f.actor,b.id)).reviewRequired).toBe(false);expect((await f.engine.get(f.actor,b.id)).financial).toBe('unverified');
  expect([...f.delivered.values()].filter(e=>e.sessionId===b.id&&e.type==='payment_received')).toHaveLength(0);await f.ingest({...original,sessionId:b.id});expect((await f.engine.get(f.actor,b.id)).reviewRequired).toBe(false);await f.engine.abandon(f.actor,b.id);
 });
 it('coalesces different references for one canonical obligation',async()=>{
  const f=createSyntheticFixture();f.context.canonicalId='canonical-deposit';const a=await f.engine.create(f.actor,f.context.obligationId,'bank_app');f.context.obligationId='alias';
  expect((await f.engine.create(f.actor,'alias','bank_app')).id).toBe(a.id);expect((await f.engine.active(f.actor,'alias'))?.id).toBe(a.id);
 });
});

it('reports aggregate recovery metrics without exposing recipient or authorization data',async()=>{
 const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
 f.provider.authorize=async()=>{throw Error('lost response');};f.provider.recoverAuthorization=async()=>({status:'unknown'});
 await expect(f.engine.authorize(f.actor,s.id)).rejects.toThrow();
 const metrics=await f.engine.metrics();expect(metrics.sessions).toBe(1);expect(metrics.interrupted_authorizations).toBe(1);expect(metrics.awaiting_confirmation).toBe(1);expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
 expect(JSON.stringify(metrics)).not.toContain(f.recipient.identity.value);
});
