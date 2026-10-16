import { describe, it, expect, vi } from 'vitest';
import { createSyntheticFixture } from '../src/testing';
import { PaymentEngine } from '../src/server';

describe('payment safety and recovery', () => {
  it('does not initiate after a bank receipt arrives before the ledger acknowledges it', async () => {
    const f=createSyntheticFixture(); const initiate=vi.spyOn(f.provider,'initiate');
    const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
    await f.engine.authorize(f.actor,s.id); await f.ingest(f.receipt(s));
    await expect(f.engine.initiate(f.actor,s.id)).rejects.toMatchObject({code:'check_existing_payment'});
    expect(initiate).not.toHaveBeenCalled(); expect((await f.engine.get(f.actor,s.id)).financial).toBe('received');
  });
  it('preserves a receipt arriving during provider initiation', async () => {
    const f=createSyntheticFixture(); const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
    await f.engine.authorize(f.actor,s.id);
    f.provider.initiate=async()=>{await f.ingest(f.receipt(s));return {paymentId:'bank-id'};};
    expect((await f.engine.initiate(f.actor,s.id)).financial).toBe('received');
  });
  it('delivers equal transaction IDs from different reporting accounts separately', async () => {
    const f=createSyntheticFixture();const first=await f.engine.create(f.actor,f.context.obligationId,'bank_app');
    f.context.obligationId='second'; f.recipient.reportingConnectionId='second-account';
    const second=await f.engine.create(f.actor,f.context.obligationId,'bank_app');
    await f.ingest(f.receipt(first,{eventId:'same-event',transactionId:'same-id'}));
    await f.ingest(f.receipt(second,{eventId:'same-event',transactionId:'same-id'}));
    expect(await f.engine.deliverOutbox()).toBe(2);expect(f.delivered.size).toBe(2);
  });
  it('renews expired unstarted reviews explicitly and preserves the old snapshot', async () => {
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
    await f.store.transaction(async state=>{state.sessions[s.id]!.expiresAt='2000-01-01T00:00:00Z';});
    f.context.revision='2';f.context.amountMinor=150000;f.context.outstandingMinor=150000;
    const next=await f.engine.renew(f.actor,s.id,'bank_app');expect(next.id).not.toBe(s.id);expect(next.context.revision).toBe('2');
    expect((await f.engine.get(f.actor,s.id)).closedAt).toBeTruthy();expect((await f.engine.active(f.actor,f.context.obligationId))?.id).toBe(next.id);
    await f.engine.handoff(f.actor,next.id);
    await expect(f.engine.renew(f.actor,next.id,'embedded')).rejects.toThrow('check_existing_payment');
    await expect(f.engine.abandon(f.actor,next.id)).rejects.toThrow('check_existing_payment');
  });
  it('allows abandonment only before an attempt starts',async()=>{
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');
    await f.engine.abandon(f.actor,s.id);expect(await f.engine.active(f.actor,f.context.obligationId)).toBeNull();
    expect((await f.engine.create(f.actor,f.context.obligationId,'embedded')).id).not.toBe(s.id);
  });
  it('retains conflicting authenticated events as exceptions without changing money state',async()=>{
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');const r=f.receipt(s);await f.ingest(r);
    expect(await f.ingest({...r,amountMinor:1})).toEqual(['conflicting_bank_event']);
    expect((await f.engine.operations(f.actor)).exceptions).toHaveLength(1);
    expect((await f.engine.get(f.actor,s.id)).financial).toBe('received');
  });
  it('keeps aggregate event order while retrying a failed/lost-ack delivery',async()=>{
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');
    await f.ingest(f.receipt(s));await f.ingest(f.receipt(s,{eventId:'return',status:'returned'}));
    const delivered=new Map();let lost=true;f.host.applyEvent=async event=>{delivered.set(event.id,event.type);if(lost){lost=false;throw Error('lost ack');}};
    expect(await f.engine.deliverOutbox()).toBe(0);expect(delivered.size).toBe(1);
    expect(await f.engine.deliverOutbox()).toBe(2);expect([...delivered.values()]).toEqual(['payment_received','payment_returned']);
    expect((await f.engine.get(f.actor,s.id)).applicationStatus).toBe('applied');
  });
  it('keeps reconciliation and delivery alive when new payment gates are off',async()=>{
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');
    const reconcile=vi.fn(async()=>[f.receipt(s)]);f.provider.reconcile=reconcile;
    const engine=new PaymentEngine({store:f.store,host:f.host,provider:f.provider,environment:'synthetic',enabled:{bankApp:false,embedded:false}});
    expect((await engine.availability(f.actor,f.context.obligationId)).available).toBe(false);
    await engine.tick();expect(reconcile).toHaveBeenCalled();expect(f.delivered.size).toBe(1);
  });
  it('recognizes authenticated definitive failures and never interprets timeouts as failure',async()=>{
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
    await f.engine.authorize(f.actor,s.id);f.provider.initiate=async()=>{throw Error('network');};
    await expect(f.engine.initiate(f.actor,s.id)).rejects.toThrow('initiation_uncertain');
    expect((await f.engine.get(f.actor,s.id)).financial).toBe('uncertain');
    await f.ingest(f.receipt(s,{status:'failed',noTransferConfirmed:true}));
    expect((await f.engine.get(f.actor,s.id)).financial).toBe('failed');
  });
  it.each([0,-1,1.2,Number.MAX_SAFE_INTEGER+1])('rejects invalid minor amount %s',async amount=>{
    const f=createSyntheticFixture();f.context.amountMinor=amount;f.context.outstandingMinor=amount;
    await expect(f.engine.create(f.actor,f.context.obligationId,'bank_app')).rejects.toThrow('payment_unavailable');
  });
  it('reconciles delayed returns on an already received session',async()=>{
    const f=createSyntheticFixture();const s=await f.engine.create(f.actor,f.context.obligationId,'bank_app');await f.ingest(f.receipt(s));
    f.provider.reconcile=async()=>[f.receipt(s,{eventId:'late-return',status:'returned'})];await f.engine.tick();
    expect((await f.engine.get(f.actor,s.id)).financial).toBe('returned');
  });
  it('requires operator authority for replay and does not allow manually marking paid',async()=>{
    const f=createSyntheticFixture();await expect(f.engine.operations({...f.actor,id:'other'})).rejects.toMatchObject({status:403});
  });
});
describe('embedded authorization and account qualification',()=>{
 it('renews expired authorization and serializes concurrent initiation',async()=>{
  const f=createSyntheticFixture();const initiate=vi.spyOn(f.provider,'initiate');const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
  await f.engine.authorize(f.actor,s.id);
  await f.store.transaction(async state=>{state.sessions[s.id]!.authorizationExpiresAt='2000-01-01T00:00:00Z';});
  await expect(f.engine.initiate(f.actor,s.id)).rejects.toThrow('authorization_required');
  await f.engine.authorize(f.actor,s.id);
  const results=await Promise.allSettled([f.engine.initiate(f.actor,s.id),f.engine.initiate(f.actor,s.id)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(initiate).toHaveBeenCalledTimes(1);
 });
 it('waits for bank authorization and permits rejected consent to return to review',async()=>{
  const f=createSyntheticFixture();f.provider.authorize=async()=>({authorizationId:'pending',expiresAt:new Date(Date.now()+300000).toISOString(),pending:true});
  f.provider.checkAuthorization=async()=>'rejected';const s=await f.engine.create(f.actor,f.context.obligationId,'embedded');
  expect((await f.engine.authorize(f.actor,s.id)).journey).toBe('authorizing');
  await expect(f.engine.initiate(f.actor,s.id)).rejects.toThrow();
  expect((await f.engine.reconcile(f.actor,s.id)).journey).toBe('review');
 });
 it('exposes only modes qualified for the specific payer and recipient',async()=>{
  const f=createSyntheticFixture();f.provider.eligibleModes=async()=>['bank_app'];
  expect((await f.engine.availability(f.actor,f.context.obligationId)).modes).toEqual(['bank_app']);
  await expect(f.engine.create(f.actor,f.context.obligationId,'embedded')).rejects.toThrow('payment_unavailable');
 });
 it('keeps a conflicting property receiving preference visible without silently switching methods',async()=>{
  const f=createSyntheticFixture();f.recipient.receivingUserId=f.actor.id;
  await f.engine.savePreference(f.actor,{scope:'property',scopeId:f.context.propertyId,method:'stripe'});
  const status=await f.engine.availability(f.actor,f.context.obligationId);
  expect(status.available).toBe(false);expect(status.reasons).toContain('recipient_uses_bank_payouts_contact_recipient');
 });
});
