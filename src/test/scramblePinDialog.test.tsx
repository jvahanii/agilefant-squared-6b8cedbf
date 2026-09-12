/**
 * The PIN dialog: setting a PIN, entering one, and showing a revealed name.
 *
 * The PIN itself is judged in the database against a bcrypt hash — a wrong one
 * comes back as an error here — so these tests pin the behaviour around it:
 * the field hides what is typed, a mistyped new PIN never reaches the server,
 * and a revealed name is shown without unscrambling anything.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScramblePinDialog } from "@/components/ScramblePinDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof ScramblePinDialog>> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn().mockResolvedValue({});
  const onOpenChange = props.onOpenChange ?? vi.fn();
  render(
    <ScramblePinDialog
      open
      onOpenChange={onOpenChange}
      mode={props.mode ?? "enter"}
      action={props.action ?? "Unscramble"}
      itemTitle={props.itemTitle ?? "Snufkin Hemulen"}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("scramble PIN dialog", () => {
  it("hides the PIN as it is typed, and sends it on submit", async () => {
    const { onConfirm, onOpenChange } = renderDialog();

    const pin = screen.getByLabelText("PIN (four digits)") as HTMLInputElement;
    expect(pin.type).toBe("password");
    fireEvent.change(pin, { target: { value: "4917" } });
    fireEvent.click(screen.getByRole("button", { name: "Unscramble" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("4917"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("takes four digits and nothing else", async () => {
    const { onConfirm } = renderDialog();
    const pin = screen.getByLabelText("PIN (four digits)") as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Unscramble" });

    // Letters never land in the field, and three digits are not yet a PIN.
    fireEvent.change(pin, { target: { value: "49a1" } });
    expect(pin.value).toBe("491");
    expect(submit).toBeDisabled();

    // A fourth digit completes it; a fifth is refused.
    fireEvent.change(pin, { target: { value: "4917" } });
    expect(submit).not.toBeDisabled();
    fireEvent.change(pin, { target: { value: "49177" } });
    expect(pin.value).toBe("4917");

    fireEvent.click(submit);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("4917"));
  });

  it("will not send a new PIN that was mistyped twice", async () => {
    const { onConfirm } = renderDialog({ mode: "set", action: "Scramble" });

    fireEvent.change(screen.getByLabelText("PIN (four digits)"), { target: { value: "4917" } });
    fireEvent.change(screen.getByLabelText("PIN again"), { target: { value: "4918" } });
    fireEvent.click(screen.getByRole("button", { name: "Scramble" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The two PINs are different");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a wrong PIN as an error and clears the field, staying open", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ error: "Wrong PIN" });
    const { onOpenChange } = renderDialog({ onConfirm });

    fireEvent.change(screen.getByLabelText("PIN (four digits)"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Unscramble" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong PIN");
    expect((screen.getByLabelText("PIN (four digits)") as HTMLInputElement).value).toBe("");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows a revealed name, and says it is still scrambled", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ revealed: "Pay the tax bill" });
    renderDialog({ onConfirm, action: "Show name" });

    fireEvent.change(screen.getByLabelText("PIN (four digits)"), { target: { value: "4917" } });
    fireEvent.click(screen.getByRole("button", { name: "Show name" }));

    expect(await screen.findByText("Pay the tax bill")).toBeTruthy();
    expect(screen.getByText(/stays scrambled for everyone/)).toBeTruthy();
    // The PIN field is gone, so the name cannot be re-submitted by accident.
    expect(screen.queryByLabelText("PIN (four digits)")).toBeNull();
  });
});
