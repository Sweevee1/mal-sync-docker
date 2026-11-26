import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLoginThrottle, throttleKey } from "../src/auth/throttle";

describe("throttleKey", () => {
  it("leaves IPv4 alone and unwraps IPv4-mapped IPv6", () => {
    assert.equal(throttleKey("203.0.113.9"), "203.0.113.9");
    assert.equal(throttleKey("::ffff:203.0.113.9"), "203.0.113.9");
  });

  it("buckets IPv6 by /64 regardless of notation", () => {
    const a = throttleKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    assert.equal(a, throttleKey("2001:DB8:1:2::1"));
    assert.equal(a, throttleKey("2001:0db8:0001:0002:0:0:0:ffff"));
    assert.notEqual(a, throttleKey("2001:db8:1:3::1"));
  });

  it("handles a leading :: and loopback", () => {
    assert.equal(throttleKey("::1"), "v6:0000:0000:0000:0000");
  });
});

describe("login throttle across an IPv6 /64", () => {
  it("shares one budget between addresses in the same /64", () => {
    const throttle = createLoginThrottle();
    for (let i = 0; i < 5; i++) {
      const r = throttle.attempt(`2001:db8:1:2::${i + 1}`);
      assert.equal(r.wait, 0);
    }
    assert.ok(throttle.attempt("2001:db8:1:2:ffff::9").wait > 0);
    assert.equal(throttle.attempt("2001:db8:1:3::1").wait, 0);
  });
});
