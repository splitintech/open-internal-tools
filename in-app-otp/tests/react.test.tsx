import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OtpCodeDisplay, OtpCountdown, OtpEntryForm, OtpStatusBanner } from "../src/react";

describe("React OTP primitives", () => {
  it("renders four display digits", () => {
    render(<OtpCodeDisplay code="1234" />);
    expect(screen.getByLabelText("Digit 1").textContent).toBe("1");
    expect(screen.getByLabelText("Digit 4").textContent).toBe("4");
  });

  it("accepts numeric entry and disables submit until complete", () => {
    const submit = vi.fn();
    const change = vi.fn();
    const { rerender } = render(<OtpEntryForm value="" onChange={change} onSubmit={submit} />);

    expect((screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Enter one-time verification code"), { target: { value: "12ab" } });
    expect(change).toHaveBeenCalledWith("12");

    rerender(<OtpEntryForm value="1234" onChange={change} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("handles paste", () => {
    const change = vi.fn();
    render(<OtpEntryForm value="" onChange={change} onSubmit={vi.fn()} />);
    fireEvent.paste(screen.getByLabelText("Enter one-time verification code"), {
      clipboardData: { getData: () => "otp: 9876" },
    });
    expect(change).toHaveBeenCalledWith("9876");
  });

  it("shows expired countdown state", () => {
    render(<OtpCountdown expiresAt={new Date("2020-01-01T00:00:00.000Z")} />);
    expect(screen.getByRole("timer").textContent).toContain("OTP expired");
  });

  it("shows locked, invalid, and server error states accessibly", () => {
    const { rerender } = render(<OtpStatusBanner resultCode="OTP_INVALID" />);
    expect(screen.getByRole("status").textContent).toContain("Invalid OTP");

    rerender(<OtpStatusBanner challenge={{ status: "locked" } as any} />);
    expect(screen.getByRole("status").textContent).toContain("OTP locked");

    rerender(<OtpStatusBanner error={new Error("Server failed")} />);
    expect(screen.getByRole("alert").textContent).toContain("Server failed");
  });
});
