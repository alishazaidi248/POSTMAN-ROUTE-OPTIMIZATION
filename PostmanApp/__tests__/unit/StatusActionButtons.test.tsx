import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { StatusActionButtons } from "../../src/components/status/StatusActionButtons";

describe("StatusActionButtons", () => {
  it("renders only the transitions allowed from OUT_FOR_DELIVERY", () => {
    render(<StatusActionButtons currentStatus="OUT_FOR_DELIVERY" onSelect={jest.fn()} />);

    expect(screen.getByLabelText("Mark Delivered")).toBeTruthy();
    expect(screen.getByLabelText("Recipient Unavailable")).toBeTruthy();
    expect(screen.queryByLabelText("Start Delivery")).toBeNull(); // ASSIGNED -> OUT_FOR_DELIVERY, not from here
  });

  it("renders nothing for a terminal status", () => {
    const { toJSON } = render(<StatusActionButtons currentStatus="DELIVERED" onSelect={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it("calls onSelect with needsReason=true for statuses that require a note", () => {
    const onSelect = jest.fn();
    render(<StatusActionButtons currentStatus="OUT_FOR_DELIVERY" onSelect={onSelect} />);

    fireEvent.press(screen.getByLabelText("Recipient Unavailable"));

    expect(onSelect).toHaveBeenCalledWith("RECIPIENT_UNAVAILABLE", true);
  });

  it("calls onSelect with needsReason=false for a direct action like Delivered", () => {
    const onSelect = jest.fn();
    render(<StatusActionButtons currentStatus="OUT_FOR_DELIVERY" onSelect={onSelect} />);

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    expect(onSelect).toHaveBeenCalledWith("DELIVERED", false);
  });
});
