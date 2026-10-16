// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { PaymentMethodCards, ZellePreferencePanel } from "../src/react";
afterEach(cleanup);
describe("accessible payment controls", () => {
  it("does not select or default Zelle merely because it appears first", () => {
    const select = vi.fn();
    render(
      <PaymentMethodCards
        legend="Payment methods"
        options={[
          { id: "zelle", label: "Zelle", detail: "Bank" },
          { id: "card", label: "Card", detail: "Saved" },
        ]}
        selectedMethod="card"
        defaultMethod="card"
        onSelect={select}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Zelle" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Card" }).textContent).toContain(
      "Default",
    );
    expect(select).not.toHaveBeenCalled();
  });
  it("uses fallback artwork and explains unavailable methods", () => {
    render(
      <PaymentMethodCards
        legend="Payment"
        options={[
          {
            id: "zelle",
            label: "Zelle",
            detail: "Bank",
            imageSrc: "/missing.png",
            unavailable: "Bank verification is pending",
          },
        ]}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Zelle" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("Bank verification is pending")).toBeTruthy();
  });
  it("requires an explicit action before saving an onboarding suggestion", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ method: "zelle", confirmed: false });
    const load = vi.fn().mockResolvedValue(null);
    render(
      <ZellePreferencePanel
        scope="onboarding"
        scopeId="user"
        load={load}
        save={save}
      />,
    );
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest Zelle for later" }),
    );
    await screen.findByText("Zelle suggestion saved.");
    expect(save).toHaveBeenCalledWith("zelle");
  });
});

it('loads a non-Zelle default without switching it on an unchanged save', async()=>{
 const save=vi.fn().mockResolvedValue({method:'ach',confirmed:true});
 render(<ZellePreferencePanel scope="lease" scopeId="one" load={async()=>({method:'ach',confirmed:true} as any)} save={save}/>);
 await screen.findByText('Bank ACH is your default for this lease.');
 expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('ach');
 fireEvent.click(screen.getByRole('button',{name:'Confirm default payment method'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith('ach'));
});

it('shows a review hold instead of successful receipt/application copy',async()=>{
 const {paymentStatusLabel,ZelleReceipt}=await import('../src/react');
 const held={financial:'received',reviewRequired:true,applicationStatus:'applied',context:{purpose:'security_deposit',amountMinor:120000,currency:'USD'},recipient:{displayName:'Owner'},updatedAt:'2026-10-16',id:'held'} as any;
 expect(paymentStatusLabel(held)).toBe('Payment needs bank reconciliation');
 render(<ZelleReceipt session={held}/>);
 expect(screen.queryByText('Applied to your payment record')).toBeNull();
 expect(screen.getByText('Bank records need review before this payment can be confirmed.')).toBeTruthy();
});
