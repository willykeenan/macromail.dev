import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "development";

const {
  testSmtpAuth,
  publicSmtpError,
  SmtpError,
  MAX_SMTP_RESPONSE_BYTES,
} = await import("../src/lib/email/smtp.ts");
const { resolveSmtpPasswordSource, sameSmtpTarget, SMTP_PASSWORD_REQUIRED } = await import(
  "../src/lib/smtp-settings.ts"
);

/** A local fake "SMTP server" whose behaviour the test controls. */
async function fakeServer(onConnection) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(resolve);
      }),
  };
}

const local = async () => ({ address: "127.0.0.1", family: 4, servername: "localhost" });
const cfg = (port) => ({ host: "smtp.test", port, user: "u", pass: "p" });

test("an endless multi-line greeting is cut off instead of eating memory", async () => {
  let stop = false;
  const srv = await fakeServer((socket) => {
    const line = "220-" + "x".repeat(60) + "\r\n";
    const chunk = line.repeat(1000);
    const pump = () => {
      if (stop || socket.destroyed) return;
      socket.write(chunk, () => setImmediate(pump));
    };
    pump();
  });
  const rssBefore = process.memoryUsage().rss;
  const t0 = Date.now();
  try {
    await assert.rejects(testSmtpAuth(cfg(srv.port), { resolveTarget: local, deadlineMs: 10_000 }), (e) => {
      assert.ok(e instanceof SmtpError);
      assert.match(e.message, /oversized reply/);
      return true;
    });
    assert.ok(Date.now() - t0 < 3_000, `took ${Date.now() - t0}ms`);
    assert.ok(process.memoryUsage().rss - rssBefore < 64 * 1024 * 1024);
  } finally {
    stop = true;
    await srv.close();
  }
});

test("a single oversized reply line is refused", async () => {
  const srv = await fakeServer((socket) => socket.write("220-" + "y".repeat(MAX_SMTP_RESPONSE_BYTES + 10)));
  try {
    await assert.rejects(testSmtpAuth(cfg(srv.port), { resolveTarget: local }), /oversized reply/);
  } finally {
    await srv.close();
  }
});

test("a slow drip that never goes idle still hits the hard deadline", async () => {
  const timers = [];
  const srv = await fakeServer((socket) => {
    timers.push(setInterval(() => socket.write("220-still here\r\n"), 40));
  });
  const t0 = Date.now();
  try {
    await assert.rejects(testSmtpAuth(cfg(srv.port), { resolveTarget: local, deadlineMs: 400 }), /took too long/);
    assert.ok(Date.now() - t0 < 2_000, `took ${Date.now() - t0}ms`);
  } finally {
    timers.forEach(clearInterval);
    await srv.close();
  }
});

test("a silent server hits the hard deadline", async () => {
  const srv = await fakeServer(() => {});
  try {
    await assert.rejects(testSmtpAuth(cfg(srv.port), { resolveTarget: local, deadlineMs: 300 }), /took too long/);
  } finally {
    await srv.close();
  }
});

test("server replies are never echoed back to the user", async () => {
  const srv = await fakeServer((socket) => socket.end("554 secret-banner.corp.internal ESMTP Postfix (Debian)\r\n"));
  try {
    await assert.rejects(testSmtpAuth(cfg(srv.port), { resolveTarget: local }), (e) => {
      const shown = publicSmtpError(e);
      assert.equal(shown, "The SMTP server did not accept the connection (code 554).");
      assert.doesNotMatch(shown, /secret-banner|Postfix/);
      return true;
    });
  } finally {
    await srv.close();
  }
});

test("a server that closes early fails fast", async () => {
  const srv = await fakeServer((socket) => socket.end());
  try {
    await assert.rejects(testSmtpAuth(cfg(srv.port), { resolveTarget: local, deadlineMs: 5_000 }), /closed the connection/);
  } finally {
    await srv.close();
  }
});

test("low-level errors map to generic messages", () => {
  assert.equal(publicSmtpError(Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:587"), { code: "ECONNREFUSED" })), "Could not connect to the SMTP server.");
  assert.match(
    publicSmtpError(Object.assign(new Error("Hostname/IP does not match certificate's altnames: DNS:mx.secret.corp"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })),
    /secure \(TLS\) connection/,
  );
  assert.equal(publicSmtpError(new Error("SMTP host could not be resolved.")), "SMTP host could not be resolved.");
  assert.equal(publicSmtpError(new Error("weird internal detail")), "SMTP send failed.");
});

test("the saved SMTP password is only reused for the same host, port, and username", () => {
  const saved = { smtp_host: "smtp.gmail.com", smtp_port: 465, smtp_user: "me@gmail.test", smtp_pass_enc: "v1:enc" };
  const same = { host: "SMTP.gmail.com.", port: 465, user: "me@gmail.test", pass: "" };
  assert.equal(sameSmtpTarget(saved, same), true);
  assert.deepEqual(resolveSmtpPasswordSource(saved, same), { savedEnc: "v1:enc" });
  for (const changed of [
    { ...same, host: "attacker.example" },
    { ...same, port: 587 },
    { ...same, user: "other@gmail.test" },
  ]) {
    assert.deepEqual(resolveSmtpPasswordSource(saved, changed), { error: SMTP_PASSWORD_REQUIRED });
  }
  assert.deepEqual(resolveSmtpPasswordSource(saved, { ...same, host: "attacker.example", pass: " typed " }), { typed: "typed" });
  assert.deepEqual(resolveSmtpPasswordSource(null, same), { error: "SMTP password is required." });
});
