/* eslint-disable import/first -- jest.mock calls are hoisted above these imports. */
jest.mock("../../src/storage/secureStorage", () => ({
  secureStorage: {
    getAccessToken: jest.fn().mockResolvedValue("token"),
    getRefreshToken: jest.fn().mockResolvedValue(null),
    saveTokens: jest.fn(),
    clear: jest.fn().mockResolvedValue(undefined)
  }
}));

import { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from "axios";
import { axiosClient, setUnauthorizedHandler } from "../../src/api/axiosClient";
import { ApiError } from "../../src/types/api";

/** Makes the next request fail the way axios does for an HTTP error response. */
function failWith(status: number, data: unknown) {
  axiosClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError("failed", "ERR_BAD_REQUEST", config, null, {
      status,
      statusText: "",
      data,
      headers: {},
      config: { ...config, headers: new AxiosHeaders() }
    });
  };
}

function failWithNoResponse() {
  axiosClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError("Network Error", "ERR_NETWORK", config);
  };
}

async function errorOf(url: string): Promise<ApiError> {
  try {
    await axiosClient.get(url);
  } catch (err) {
    return err as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("axiosClient error mapping — the postman sees the server's real reason", () => {
  it("reads the backend's { error: { message } } shape (e.g. an invalid status transition)", async () => {
    failWith(400, { error: { message: "Invalid delivery status transition: ASSIGNED -> DELIVERED" } });
    const err = await errorOf("/deliveries/d1/status");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Invalid delivery status transition: ASSIGNED -> DELIVERED");
    expect(err.statusCode).toBe(400);
    expect(err.isNetworkError).toBe(false);
  });

  it("still accepts the older flat { message } shape", async () => {
    failWith(409, { message: "Postman has no assigned beat" });
    expect((await errorOf("/x")).message).toBe("Postman has no assigned beat");
  });

  it("falls back to a generic message when the body has none", async () => {
    failWith(500, {});
    expect((await errorOf("/x")).message).toBe("Something went wrong. Please try again.");
  });

  it("marks a request with no response as a network error (the offline-queue trigger)", async () => {
    failWithNoResponse();
    const err = await errorOf("/x");
    expect(err.isNetworkError).toBe(true);
    expect(err.statusCode).toBe(0);
  });

  it("logs the user out when the token is expired and cannot be refreshed", async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    failWith(401, { error: { message: "Invalid or expired access token" } });

    const err = await errorOf("/me/route");

    expect(err.statusCode).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
