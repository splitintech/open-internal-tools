import {describe,it,expect,vi} from 'vitest';
import {createSyntheticFixture} from '../src/testing';
import {PaymentEngine} from '../src/server';
describe('audit regression contracts',()=>{
 it('holds a previously queued received event until the authenticated source resolves every conflict',async()=>{
  const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');const r=f.receipt(s);
  await f.ingest(r);await f.ingest({...r,amountMinor:1});await f.engine.deliverOutbox();
  expect([...f.delivered.values()].some(e=>e.type==='payment_received')).toBe(false);
  const queue=await f.engine.operations(f.actor);expect(queue.exceptions).toHaveLength(1);
  await expect(f.engine.replay(f.actor,queue.exceptions[0]!.id,'Rechecked source record')).rejects.toThrow('source_correction');
  f.provider.reviewException=async(_session,records)=>({canonicalReceipt:r,supersededFingerprints:records.filter(v=>v.fingerprint!==records.find(v=>v.outcome==='applied')?.fingerprint).map(v=>v.fingerprint)});
  await f.engine.replay(f.actor,queue.exceptions[0]!.id,'Rechecked source record');await f.engine.deliverOutbox();
  expect((await f.engine.get(f.actor,s.id))).toMatchObject({reviewRequired:false,applicationStatus:'applied'});
  expect(await f.ingest({...r,amountMinor:1})).toEqual(['superseded']);
 });
 it('expires pending authorization without a payment attempt and permits renewed review',async()=>{
  const f=createSyntheticFixture();f.provider.authorize=async()=>({authorizationId:'pending',expiresAt:new Date(Date.now()+10000).toISOString(),pending:true});f.provider.checkAuthorization=async()=>'pending';
  const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');await f.engine.authorize(f.actor,s.id);
  await f.store.transaction(async state=>{state.sessions[s.id]!.authorizationExpiresAt='2000-01-01';});
  expect((await f.engine.reconcile(f.actor,s.id)).journey).toBe('review');
  expect((await f.engine.renew(f.actor,s.id,'bank_app')).id).not.toBe(s.id);
 });
 it.each(['returned','refunded'] as const)('permits explicit retry after %s, retaining old transaction deduplication',async status=>{
  const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');const receipt=f.receipt(s);await f.ingest(receipt);
  const returned={...receipt,eventId:'return-1',status};await f.ingest(returned);
  expect(await f.ingest({...returned,eventId:'return-2'})).toEqual(['duplicate']);
  await f.engine.deliverOutbox();expect((await f.engine.get(f.actor,s.id)).applicationStatus).toBe('applied');
  await f.engine.abandon(f.actor,s.id);const next=await f.engine.create(f.actor,f.context.obligationId,'bank_app');expect(next.id).not.toBe(s.id);
  expect(await f.ingest(f.receipt(next,{transactionId:receipt.transactionId}))).toEqual(['transaction_already_allocated']);
 });
 it('restores provider-supplied instructions and reference without preparing a new handoff',async()=>{
  const f=createSyntheticFixture();f.provider.handoff=vi.fn(async()=>({bankUrl:'https://bank.example/pay',reference:'Bank-provided reference'}));
  const engine=new PaymentEngine({store:f.store,host:f.host,provider:f.provider,environment:'synthetic',enabled:{bankApp:true,embedded:false},handoffOrigins:['https://bank.example']});
  const s=await engine.create(f.actor,f.context.obligationId,'bank_app');await engine.handoff(f.actor,s.id);
  expect((await engine.get(f.actor,s.id)).handoff?.reference).toBe('Bank-provided reference');await engine.handoff(f.actor,s.id);expect(f.provider.handoff).toHaveBeenCalledTimes(1);
 });
 it('uses an existing default until the lease default is explicitly switched',async()=>{
  const f=createSyntheticFixture();f.host.existingDefault=async()=> 'ach';expect((await f.engine.availability(f.actor,f.context.obligationId)).defaultMethod).toBe('ach');
  await f.engine.savePreference(f.actor,{scope:'lease',scopeId:f.context.leaseId,method:'zelle'});expect((await f.engine.availability(f.actor,f.context.obligationId)).defaultMethod).toBe('zelle');
 });
 it('authorizes old receipts directly, including for the receiving owner',async()=>{
  const f=createSyntheticFixture();f.recipient.receivingUserId='owner';const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');
  await f.store.transaction(async state=>{for(let i=0;i<105;i++)state.sessions['new-'+i]={...s,id:'new-'+i,createdAt:'2099-01-01'};});
  expect((await f.engine.receipt({...f.actor,id:'owner'},s.id)).session.id).toBe(s.id);
  await expect(f.engine.receipt({...f.actor,id:'other'},s.id)).rejects.toThrow('session_not_found');
 });
});
it('holds the original session when a conflicting event changes its session identifier',async()=>{
 const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');const r=f.receipt(s);await f.ingest(r);
 await f.ingest({...r,sessionId:'unknown-changed-session'});await f.engine.deliverOutbox();
 expect((await f.engine.get(f.actor,s.id)).reviewRequired).toBe(true);
 expect([...f.delivered.values()].some(e=>e.type==='payment_received')).toBe(false);
});
it('rejects changed payment purpose even when an adapter revision is unchanged',async()=>{
 const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');f.context.purpose='monthly_rent';
 await expect(f.engine.handoff(f.actor,s.id)).rejects.toThrow('payment_context_changed');
});
it('accepts an authenticated correction of an unapplied same-ID record while retaining the original evidence',async()=>{
 const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');const correct=f.receipt(s);
 await f.ingest({...correct,amountMinor:10});await f.ingest(correct);
 f.provider.reviewException=async(_session,records)=>({canonicalReceipt:correct,supersededFingerprints:records.filter(r=>r.receipt.amountMinor===10).map(r=>r.fingerprint)});
 const q=await f.engine.operations(f.actor);await f.engine.replay(f.actor,q.exceptions[0]!.id,'Authenticated bank corrected its amount');await f.engine.deliverOutbox();
 expect((await f.engine.get(f.actor,s.id))).toMatchObject({financial:'received',reviewRequired:false,applicationStatus:'applied'});
 expect(await f.store.transaction(async state=>Object.values(state.events).some(e=>e.receipt.amountMinor===10))).toBe(true);
 expect(await f.ingest({...correct,amountMinor:10})).toEqual(["superseded"]);
});
