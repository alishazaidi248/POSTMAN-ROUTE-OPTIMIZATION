/* eslint-disable import/first -- jest.mock calls are hoisted above these
   imports regardless of source order; grouping them first here is clearer. */
jest.mock("../../src/api/axiosClient", () => ({
  axiosClient: { get: jest.fn(), post: jest.fn() }
}));

import { axiosClient } from "../../src/api/axiosClient";
import { deliveryApi } from "../../src/api/deliveryApi";

describe("deliveryApi.listMine — pagination total is authoritative, never a page size/rows-length substitute", () => {
  it("passes through the backend's `total` unchanged even when it differs from the returned page's row count", () => {
    // Simulates a backend response where the page only contains 5 rows but
    // the true count across all pages is 89 — the exact shape that caused
    // the original "Total: 5" bug when a caller read the wrong field.
    (axiosClient.get as jest.Mock).mockResolvedValueOnce({
      data: { total: 89, page: 1, pageSize: 20, rows: new Array(5).fill({ id: "x" }) }
    });

    return deliveryApi.listMine().then((result) => {
      expect(result.total).toBe(89);
      expect(result.total).not.toBe(result.rows.length);
      expect(result.total).not.toBe(result.pageSize);
    });
  });

  it("always requests a pageSize large enough to render the full assigned list in one page (100)", async () => {
    (axiosClient.get as jest.Mock).mockResolvedValueOnce({ data: { total: 0, page: 1, pageSize: 100, rows: [] } });

    await deliveryApi.listMine();

    expect(axiosClient.get).toHaveBeenCalledWith("/me/deliveries", { params: { pageSize: 100 } });
  });
});
