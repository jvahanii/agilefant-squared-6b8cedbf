import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** What the dialog asks for. "set" also confirms the new PIN. */
export type ScramblePinMode = "set" | "enter";

/** Four digits, as check_or_set_scramble_pin() also insists. */
export const PIN_LENGTH = 4;

const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, PIN_LENGTH);

export interface ScramblePinResult {
  /** Shown in place of the PIN field — the revealed name. */
  revealed?: string;
  /** Shown under the field; the dialog stays open. */
  error?: string;
}

/**
 * Asks for the scramble PIN, and shows a revealed name when there is one.
 *
 * The PIN is checked in the database against a bcrypt hash, so a wrong one
 * comes back as an error from `onConfirm` rather than being judged here. The
 * field is a password field: the point of the whole feature is that someone
 * looking at the screen learns nothing.
 */
export function ScramblePinDialog({
  open,
  onOpenChange,
  mode,
  action,
  itemTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ScramblePinMode;
  /** The button's label, e.g. "Scramble" or "Unscramble". */
  action: string;
  /** The item being acted on, as it currently reads. */
  itemTitle: string;
  onConfirm: (pin: string) => Promise<ScramblePinResult>;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setConfirmPin("");
    setError(null);
    setRevealed(null);
    setBusy(false);
  }, [open]);

  const submit = async () => {
    if (busy) return;
    if (mode === "set" && pin !== confirmPin) {
      setError("The two PINs are different");
      return;
    }
    setBusy(true);
    const result = await onConfirm(pin);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      setPin("");
      setConfirmPin("");
      pinRef.current?.focus();
      return;
    }
    if (result.revealed !== undefined) {
      setRevealed(result.revealed);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            {revealed !== null ? "The real name" : mode === "set" ? "Choose a PIN" : `${action} this item`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {revealed !== null ? (
              <>It stays scrambled for everyone until you unscramble it.</>
            ) : mode === "set" ? (
              <>
                Scrambling hides a name from everyone, and only you can bring it back. Four digits protect
                that — kept for this organization alone, and forgotten once you have unscrambled everything
                again. There is no way to recover it.
              </>
            ) : (
              <>Your PIN for this organization.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {revealed !== null ? (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-sm">{revealed}</p>
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {/* Item titles run long — wrap and cap it, so the dialog keeps its
                width instead of being stretched by one sentence. */}
            <p className="line-clamp-2 break-words text-xs text-muted-foreground" title={itemTitle}>
              {itemTitle}
            </p>
            <div className="space-y-1">
              <Label htmlFor="scramble-pin" className="text-xs">
                PIN (four digits)
              </Label>
              <Input
                id="scramble-pin"
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={PIN_LENGTH}
                className="h-8 text-sm"
                value={pin}
                onChange={(e) => setPin(onlyDigits(e.target.value))}
              />
            </div>
            {mode === "set" && (
              <div className="space-y-1">
                <Label htmlFor="scramble-pin-confirm" className="text-xs">
                  PIN again
                </Label>
                <Input
                  id="scramble-pin-confirm"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_LENGTH}
                  className="h-8 text-sm"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(onlyDigits(e.target.value))}
                />
              </div>
            )}
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={busy || pin.length !== PIN_LENGTH || (mode === "set" && confirmPin.length !== PIN_LENGTH)}
              >
                {action}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
