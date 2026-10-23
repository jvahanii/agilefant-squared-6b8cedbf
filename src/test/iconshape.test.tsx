import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { AlertTriangle, Info } from "lucide-react";

describe("icon shape", () => {
  it("prints", () => {
    const a = render(<AlertTriangle className="text-destructive" />);
    const i = render(<Info className="text-destructive" />);
    console.log("TRIANGLE:", a.container.innerHTML.slice(0, 260));
    console.log("INFO:", i.container.innerHTML.slice(0, 260));
  });
});
