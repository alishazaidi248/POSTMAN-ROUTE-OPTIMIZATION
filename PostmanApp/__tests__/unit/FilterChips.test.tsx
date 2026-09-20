import React from "react";
import { ScrollView } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { FilterChips } from "../../src/components/delivery/FilterChips";

describe("FilterChips", () => {
  it("renders all five filters as a single horizontal row, not stacked vertically", () => {
    const { UNSAFE_getByType } = render(<FilterChips value="ALL" onChange={jest.fn()} />);

    for (const label of ["ALL", "PENDING", "COMPLETED", "FAILED", "RESCHEDULED"]) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }

    // Regression guard for the actual bug: on react-native-web, a
    // horizontal ScrollView's contentContainerStyle must explicitly set
    // flexDirection: "row" (native injects it automatically; web does not),
    // or chips stack into a tall vertical column instead of a compact row.
    const scrollView = UNSAFE_getByType(ScrollView);
    const containerStyle = scrollView.props.contentContainerStyle;
    const flatStyle = Array.isArray(containerStyle) ? Object.assign({}, ...containerStyle) : containerStyle;
    expect(flatStyle?.flexDirection).toBe("row");
    expect(scrollView.props.horizontal).toBe(true);
  });

  it("does not let the ScrollView flex-grow to fill remaining vertical space", () => {
    // Regression guard: react-native-web's ScrollView applies flexGrow: 1
    // in its own unconditional base style regardless of props passed, so
    // without an explicit override here the filter row would stretch to
    // fill all remaining space in its flex-column parent, leaving a large
    // empty area around a one-line filter strip.
    const { UNSAFE_getByType } = render(<FilterChips value="ALL" onChange={jest.fn()} />);

    const scrollView = UNSAFE_getByType(ScrollView);
    const style = scrollView.props.style;
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flatStyle?.flexGrow).toBe(0);
  });

  it("marks the active filter's accessibility state as selected", () => {
    render(<FilterChips value="COMPLETED" onChange={jest.fn()} />);

    expect(screen.getByLabelText("Filter: COMPLETED").props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("Filter: ALL").props.accessibilityState.selected).toBe(false);
  });
});
