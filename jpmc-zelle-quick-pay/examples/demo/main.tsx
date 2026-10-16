import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createJourneyClient,
  PaymentMethodCards,
  ZellePaymentJourney,
} from "@splitin/jpmc-zelle-quick-pay/react";
import type {
  JourneyMode,
  PaymentSession,
} from "@splitin/jpmc-zelle-quick-pay";
import "@splitin/jpmc-zelle-quick-pay/styles.css";
import "./style.css";
const request = async <T,>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-demo-token": "synthetic-ui",
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code ?? "Request failed");
  return body;
};
const client = createJourneyClient(request);
function App() {
  const [selected, setSelected] = useState("zelle"),
    [mode, setMode] = useState<JourneyMode>("bank_app"),
    [sessionId, setSessionId] = useState(""),
    [status, setStatus] = useState(""),
    [dark, setDark] = useState(false);
  const capturingClient = {
    ...client,
    create: async (id: string, journey: JourneyMode) => {
      const value = await client.create(id, journey);
      setSessionId(value.id);
      return value;
    },
  };
  return (
    <main data-theme={dark ? "dark" : "light"}>
      <div className="demo-banner">
        SYNTHETIC DEMO · No bank accounts or real payments
      </div>
      <header>
        <p>SplitIn · Payment review</p>
        <h1>Your security deposit</h1>
        <p>$1,250.00 · Demo Property Owner</p>
      </header>
      <div className="demo-controls">
        <label>
          Journey{" "}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as JourneyMode)}
          >
            <option value="bank_app">V1 · Banking app</option>
            <option value="embedded">V2 · In-app (synthetic)</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(e) => setDark(e.target.checked)}
          />
          Dark mode
        </label>
      </div>
      <PaymentMethodCards
        legend="Choose how to pay"
        selectedMethod={selected}
        options={[
          { id: "zelle", label: "Zelle Quick Pay", detail: "Direct payment" },
          { id: "link", label: "Link", detail: "Saved bank or card" },
          { id: "ach", label: "Bank ACH", detail: "Bank payment" },
          { id: "card", label: "Card", detail: "Credit or debit" },
        ]}
        onSelect={setSelected}
      />
      <p className="demo-body">
        Review your payment details before continuing. The payment goes directly
        to the authorized recipient. Opening the journey never sends money.
      </p>
      {selected === "zelle" ? (
        <ZellePaymentJourney
          client={capturingClient}
          obligationId="synthetic-deposit"
          mode={mode}
          onReceived={(_session: PaymentSession) =>
            setStatus("Synthetic bank receipt verified")
          }
        />
      ) : (
        <p>
          This demo exercises Zelle. Other methods remain in the host
          application.
        </p>
      )}
      <section className="demo-testing">
        <h2>Test controls</h2>
        <p>These controls exist only in the synthetic demo.</p>
        <button
          disabled={!sessionId}
          onClick={async () => {
            await request("/synthetic/confirm", {
              method: "POST",
              body: JSON.stringify({ sessionId }),
            });
            setStatus("Synthetic receipt delivered. Check payment status.");
          }}
        >
          Simulate verified bank receipt
        </button>
        <p role="status">{status}</p>
        <p>
          Restart the service to reset the fixture and test the other journey
          mode.
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
