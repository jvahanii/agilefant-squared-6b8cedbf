/**
 * The five stars on a work item's row.
 *
 * "No stars" has to stay reachable: a rating is given by clicking a star, and
 * the only way back to unrated is clicking the one it already ends on.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StarRating } from "@/components/StarRating";

const stars = () => screen.getAllByRole("button");

describe("StarRating", () => {
  it("shows how many stars an item has, and says so for a reader who cannot see them", () => {
    render(<StarRating rating={3} label="Fortum — Analyst" />);
    expect(screen.getByRole("group", { name: "Rating for Fortum — Analyst: 3 of 5" })).toBeInTheDocument();
    expect(stars().map((s) => s.getAttribute("aria-pressed"))).toEqual(["true", "true", "true", "false", "false"]);
  });

  it("calls an unrated item unrated, rather than nought out of five", () => {
    render(<StarRating rating={undefined} label="Nordea — Quant Developer" />);
    expect(screen.getByRole("group", { name: "Rating for Nordea — Quant Developer: unrated" })).toBeInTheDocument();
    expect(stars().map((s) => s.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false", "false"]);
  });

  it("rates the item by the star clicked", () => {
    const onRate = vi.fn();
    render(<StarRating rating={undefined} label="x" onRate={onRate} />);
    fireEvent.click(stars()[3]);
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it("takes the rating away when the star it ends on is clicked again", () => {
    const onRate = vi.fn();
    render(<StarRating rating={2} label="x" onRate={onRate} />);
    fireEvent.click(stars()[1]);
    expect(onRate).toHaveBeenCalledWith(undefined);
  });

  it("lowers a rating by clicking a star below it", () => {
    const onRate = vi.fn();
    render(<StarRating rating={5} label="x" onRate={onRate} />);
    fireEvent.click(stars()[0]);
    expect(onRate).toHaveBeenCalledWith(1);
  });

  it("does not toggle the row it sits on", () => {
    const onRate = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <StarRating rating={undefined} label="x" onRate={onRate} />
      </div>,
    );
    fireEvent.click(stars()[0]);
    expect(onRate).toHaveBeenCalledWith(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("shows but does not set when there is nothing to call, or it is disabled", () => {
    const onRate = vi.fn();
    const { rerender } = render(<StarRating rating={1} label="x" />);
    fireEvent.click(stars()[4]);

    rerender(<StarRating rating={1} label="x" onRate={onRate} disabled />);
    fireEvent.click(stars()[4]);
    expect(onRate).not.toHaveBeenCalled();
  });
});
