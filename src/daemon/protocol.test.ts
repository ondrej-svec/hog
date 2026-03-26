import { describe, expect, it } from "vitest";
import { isRpcEvent, isRpcRequest, RPC_ERRORS } from "./protocol.js";

describe("protocol", () => {
  describe("isRpcRequest", () => {
    it("returns true for valid requests", () => {
      expect(isRpcRequest({ id: 1, method: "pipeline.list", params: {} })).toBe(true);
    });

    it("returns false for events (no id)", () => {
      expect(isRpcRequest({ event: "agent:progress", data: {} })).toBe(false);
    });

    it("returns false for responses (no method)", () => {
      expect(isRpcRequest({ id: 1, result: [] })).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(isRpcRequest(null)).toBe(false);
      expect(isRpcRequest("string")).toBe(false);
      expect(isRpcRequest(42)).toBe(false);
    });
  });

  describe("isRpcEvent", () => {
    it("returns true for valid events", () => {
      expect(isRpcEvent({ event: "agent:spawned", data: {} })).toBe(true);
    });

    it("returns false for requests (has id)", () => {
      expect(isRpcEvent({ id: 1, event: "agent:spawned", data: {} })).toBe(false);
    });

    it("returns false for responses", () => {
      expect(isRpcEvent({ id: 1, result: {} })).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(isRpcEvent(null)).toBe(false);
      expect(isRpcEvent(undefined)).toBe(false);
    });
  });

  describe("RPC_ERRORS", () => {
    it("has standard error codes", () => {
      expect(RPC_ERRORS.METHOD_NOT_FOUND.code).toBe(-32601);
      expect(RPC_ERRORS.INVALID_PARAMS.code).toBe(-32602);
      expect(RPC_ERRORS.INTERNAL_ERROR.code).toBe(-32603);
      expect(RPC_ERRORS.DAEMON_NOT_RUNNING.code).toBe(-32000);
    });
  });
});
