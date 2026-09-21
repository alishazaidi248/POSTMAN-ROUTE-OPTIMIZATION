import { formatAddress, formatAddressLines, formatAddressShort } from "../../src/utils/formatting";

// As the Bhandup West import stores them: the address text already carries the locality, city, state and pincode,
// and the separate fields repeat them.
const IMPORTED = {
  addressLine1: "CHOPRA CHAWL, JANTA MARKET, Bhandup West, Mumbai, Maharashtra 400078",
  addressLine2: null,
  area: "JANTA MARKET",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400078"
};

describe("address display", () => {
  it("says every part once: '21 Farid Nagar / Bhandup West / Mumbai'", () => {
    const a = { addressLine1: "21 Farid Nagar", addressLine2: null, area: "Farid Nagar, Bhandup West", city: "Mumbai", state: "Maharashtra", pincode: "400078" };
    expect(formatAddressShort(a)).toBe("21 Farid Nagar / Bhandup West / Mumbai");
    expect(formatAddressLines(a)).toEqual(["21 Farid Nagar", "Bhandup West", "Mumbai"]);
  });

  it("does not repeat what an imported address already contains (locality, city, state, pincode)", () => {
    expect(formatAddressLines(IMPORTED)).toEqual(["CHOPRA CHAWL", "JANTA MARKET", "Bhandup West", "Mumbai"]);
    expect(formatAddressShort(IMPORTED)).toBe("CHOPRA CHAWL / JANTA MARKET / Bhandup West / Mumbai");
  });

  it("the complete line for maps and confirmations keeps the state and pincode - once", () => {
    expect(formatAddress(IMPORTED)).toBe("CHOPRA CHAWL, JANTA MARKET, Bhandup West, Mumbai, Maharashtra 400078");
  });

  it("a plain address (no repeats) is unchanged", () => {
    const a = { addressLine1: "d1 Station Road", addressLine2: null, area: "Bhandup West", city: "Mumbai", state: "Maharashtra", pincode: "400078" };
    expect(formatAddress(a)).toBe("d1 Station Road, Bhandup West, Mumbai, Maharashtra, 400078");
  });

  it("a fuller part replaces a shorter one it contains, whichever comes first", () => {
    const a = { addressLine1: "Farid Nagar", addressLine2: "21 Farid Nagar", area: null, city: "Mumbai", state: "Maharashtra", pincode: "400078" };
    expect(formatAddressLines(a)).toEqual(["21 Farid Nagar", "Mumbai"]);
  });

  it("keeps different places apart (a house number matters) and ignores case and punctuation when comparing", () => {
    const a = { addressLine1: "21 Farid Nagar", addressLine2: "22 Farid Nagar", area: "FARID NAGAR.", city: "Mumbai", state: "MH", pincode: "400078" };
    expect(formatAddressLines(a)).toEqual(["21 Farid Nagar", "22 Farid Nagar", "Mumbai"]);
  });
});
