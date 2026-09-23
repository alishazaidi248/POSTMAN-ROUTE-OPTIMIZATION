import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { Image } from "react-native";
import Svg from "react-native-svg";
import { BrandMark } from "../../src/components/common/BrandMark";

it("renders the logo image, not the fallback icon", () => {
  render(<BrandMark size={30} />);
  expect(screen.UNSAFE_getByType(Image)).toBeTruthy();
  expect(screen.UNSAFE_queryByType(Svg)).toBeNull();
});

it("falls back to the generic package icon if the image fails to load", () => {
  render(<BrandMark size={30} />);
  act(() => screen.UNSAFE_getByType(Image).props.onError());
  expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  expect(screen.UNSAFE_getByType(Svg)).toBeTruthy(); // the Icon's Svg rendered instead
});
