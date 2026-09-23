import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("../lib/apiClient", () => ({ apiClient: api, setTokens: vi.fn() }));

const auth = vi.hoisted(() => ({ user: { id: "u1", name: "Admin", email: "admin@x.local", role: "ADMIN", postOfficeId: "po1", mustChangePassword: true }, changePassword: vi.fn(), logout: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));

import { overlapConflict } from "../lib/friendlyError";
import { BeatRecord, isOverlapping, overlapLabel, territoryState } from "../features/beats/beatTypes";
import { AssignmentExceptionsPage } from "../pages/AssignmentExceptionsPage";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { ProofModeCard } from "../components/ProofModeCard";
import { ToastProvider } from "../components/Toast";

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

const beat = (over: Partial<BeatRecord> = {}): BeatRecord => ({
  id: "b1", postOfficeId: "po1", postOfficeName: "Bhandup West", beatNumber: "20", name: "Beat 20 - Farid Nagar", status: "ACTIVE",
  verificationStatus: "VERIFIED", verifiedAt: null, verifiedByName: null, hasTerritory: true, boundary: null, centerLatitude: null, centerLongitude: null,
  deliveryCount: 0, assignedPostmanId: null, assignedPostmanName: null, createdAt: "", updatedAt: "", ...over
});

beforeEach(() => vi.clearAllMocks());

describe("territory indicators", () => {
  it("are verified / needs verification / missing, from the territory itself", () => {
    expect(territoryState(beat())).toBe("VERIFIED");
    expect(territoryState(beat({ verificationStatus: "PENDING_VERIFICATION" }))).toBe("PENDING_VERIFICATION");
    expect(territoryState(beat({ hasTerritory: false, verificationStatus: "NEEDS_REVIEW" }))).toBe("NEEDS_REVIEW");
  });

  it("an overlap names the other beats", () => {
    const b = beat({ overlaps: [{ id: "b2", beatNumber: "21", areaSqm: 1200 }, { id: "b3", beatNumber: "22", areaSqm: 90 }] });
    expect(isOverlapping(b)).toBe(true);
    expect(overlapLabel(b)).toBe("⚠ Overlapping B21, B22");
    expect(isOverlapping(beat())).toBe(false);
  });
});

describe("overlapConflict", () => {
  const axiosError = (status: number, data: unknown) => Object.assign(new axios.AxiosError("x"), { response: { status, data } });
  it("returns the server's sentence only for a 409 that asks for acknowledgement", () => {
    expect(overlapConflict(axiosError(409, { error: { message: "Beat 30 overlaps Beat 20.", details: { requiresAcknowledgement: true } } }))).toBe("Beat 30 overlaps Beat 20.");
    expect(overlapConflict(axiosError(409, { error: { message: "Beat 30 already exists" } }))).toBeNull();
    expect(overlapConflict(axiosError(400, { error: { message: "x", details: { requiresAcknowledgement: true } } }))).toBeNull();
    expect(overlapConflict(new Error("boom"))).toBeNull();
  });
});

describe("Assignment Exceptions page", () => {
  const exception = {
    id: "e1", deliveryId: "d1", reason: "AMBIGUOUS_MATCH", details: "The address fits more than one beat (2, 5) equally well. Please choose the beat.",
    createdAt: "2026-09-21T10:00:00Z", suggestedBeat: { id: "b2", beatNumber: "2", name: "Beat 2 - Village Road" }, confidence: 92, confidenceLevel: "High",
    locationQuality: "AREA", locationQualityLabel: "Area level only", evidence: { evidence: ["Locality: VILLAGE ROAD (segment exact, +60)"], contenders: ["2", "5"] },
    delivery: { trackingId: "TRK-1", recipient: { name: "Aarav Sharma", phone: "9800000001" }, address: { addressLine1: "CHOPRA CHAWL, JANTA MARKET, Bhandup West, Mumbai", addressLine2: null, area: "JANTA MARKET", city: "Mumbai", pincode: "400078", latitude: null, longitude: null } }
  };

  it("shows the delivery, recipient, address, suggested beat, confidence, reason and location quality with the three actions", async () => {
    api.get.mockResolvedValue({ data: [exception] });
    render(wrap(<AssignmentExceptionsPage />));
    expect(await screen.findByText("B2 — Village Road")).toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText(/92% —/)).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Area level only")).toBeInTheDocument();
    expect(screen.getByText(/fits more than one beat/)).toBeInTheDocument();
    expect(screen.getByText(/Also fits beats 2, 5/)).toBeInTheDocument();
    for (const action of ["Assign", "Choose Beat", "Ignore"]) expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    // the address is written once: "JANTA MARKET" and "Mumbai" are already in the first line
    expect(screen.getAllByText(/JANTA MARKET/)).toHaveLength(1);
  });

  it("'Assign' accepts the suggested beat through the server (no local decision)", async () => {
    api.get.mockResolvedValue({ data: [exception] });
    api.post.mockResolvedValue({ data: {} });
    render(wrap(<AssignmentExceptionsPage />));
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/assignments/exceptions/e1/resolve", { beatId: "b2", reason: expect.stringContaining("Suggested beat accepted (92% confidence)") }));
  });

  it("does not offer 'Assign' when nothing is suggested, and says so when there is nothing to do", async () => {
    api.get.mockResolvedValue({ data: [{ ...exception, suggestedBeat: null, confidence: null, confidenceLevel: null }] });
    const { unmount } = render(wrap(<AssignmentExceptionsPage />));
    await screen.findByText("Aarav Sharma");
    expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose Beat" })).toBeInTheDocument();
    unmount();
    api.get.mockResolvedValue({ data: [] });
    render(wrap(<AssignmentExceptionsPage />));
    expect(await screen.findByText(/No open exceptions/)).toBeInTheDocument();
  });

  it("'Retry Geocode' shows a busy label while in flight and reports a failure as a toast, not a page crash", async () => {
    api.get.mockImplementation((url: string) => (url === "/assignments/exceptions" ? Promise.resolve({ data: [exception] }) : Promise.resolve({ data: { addressId: "a1" } })));
    let rejectRetry: (e: unknown) => void = () => {};
    api.post.mockImplementation(() => new Promise((_resolve, reject) => (rejectRetry = reject)));
    render(wrap(<AssignmentExceptionsPage />));

    const button = await screen.findByRole("button", { name: "Retry Geocode" });
    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: "Retrying…" })).toBeDisabled();

    rejectRetry(Object.assign(new axios.AxiosError("x"), { response: { status: 400, data: { error: { message: "The geocoder is unavailable." } } } }));
    expect(await screen.findByText("The geocoder is unavailable.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry Geocode" })).toBeInTheDocument(); // busy state cleared
  });

  it("'Retry Geocode All' posts to the bulk endpoint, shows a busy label, then renders the outcome summary", async () => {
    api.get.mockResolvedValue({ data: [exception] });
    api.post.mockResolvedValue({ data: { processed: 3, succeeded: 2, failed: 1, resolved: 1, stillUnresolved: 1 } });
    render(wrap(<AssignmentExceptionsPage />));

    const button = await screen.findByRole("button", { name: "Retry Geocode All" });
    await userEvent.click(button);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/assignments/exceptions/retry-geocode-all"));
    expect(await screen.findByTestId("retry-all-summary")).toHaveTextContent("Processed 3: 2 succeeded, 1 failed (1 newly assigned, 1 still need review).");
  });

  it("'Retry Geocode All' failing shows a toast, not a page crash, and clears the busy state", async () => {
    api.get.mockResolvedValue({ data: [exception] });
    api.post.mockRejectedValue(Object.assign(new axios.AxiosError("x"), { response: { status: 500, data: {} } }));
    render(wrap(<AssignmentExceptionsPage />));

    await userEvent.click(await screen.findByRole("button", { name: "Retry Geocode All" }));
    expect(await screen.findByRole("button", { name: "Retry Geocode All" })).not.toBeDisabled();
    expect(screen.queryByTestId("retry-all-summary")).toBeNull();
  });
});

describe("forced password change", () => {
  it("asks for the temporary and the new password (twice) and passes them on; the server's rules are shown as it says them", async () => {
    auth.changePassword.mockRejectedValueOnce(Object.assign(new axios.AxiosError("x"), { response: { status: 400, data: { error: { message: "The new password is not acceptable. Use at least 10 characters." } } } }));
    render(wrap(<ChangePasswordPage />));
    expect(screen.getByText(/temporary password/i, { selector: "div" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Temporary password"), "temp-Passw0rd-x1");
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("New password again"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 10 characters.");
    expect(auth.changePassword).toHaveBeenCalledWith("temp-Passw0rd-x1", "short");
  });

  it("does not send two different new passwords", async () => {
    render(wrap(<ChangePasswordPage />));
    await userEvent.type(screen.getByLabelText("Temporary password"), "temp-Passw0rd-x1");
    await userEvent.type(screen.getByLabelText("New password"), "my-own-Secret-42");
    await userEvent.type(screen.getByLabelText("New password again"), "my-own-Secret-43");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not the same");
    expect(auth.changePassword).not.toHaveBeenCalled();
  });
});

describe("proof-of-delivery setting", () => {
  it("shows what the office requires and changes it through the server", async () => {
    auth.user.mustChangePassword = false;
    api.get.mockResolvedValue({ data: [{ id: "po1", name: "Bhandup West", proofMode: "NONE" }] });
    api.put.mockResolvedValue({ data: {} });
    render(wrap(<ProofModeCard />));
    const select = await screen.findByLabelText("Required to complete a delivery");
    await userEvent.selectOptions(select, "PHOTO");
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/post-offices/po1/proof-mode", { proofMode: "PHOTO" }));
  });
});
