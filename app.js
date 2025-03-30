const express = require("express");
const ivm = require("isolated-vm");

const app = express();
const port = 3000;

// Host-side delegate function that makes an HTTPS call.
async function fetchDelegate(url) {
  try {
    console.log("Delegate: Starting fetch for URL:", url);
    const response = await fetch(url);
    console.log("Delegate: Response status:", response.status);

    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const data = await response.json();
    console.log("Delegate: Response data:", data);

    // Return a plain object that can be deep-copied.
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      data, // full data object
    };
  } catch (err) {
    console.error("Delegate: Fetch error:", err);
    throw err;
  }
}
async function myAsyncFunction() {
  return new Promise((resolve) => {
    setTimeout(() => resolve("Hello from async function in isolate!"), 10);
  });
}

app.get("/", async (req, res) => {
  let isolate, context, script;
  try {
    // Create a new isolate for this request.
    isolate = new ivm.Isolate({ memoryLimit: 128 });
    context = isolate.createContextSync();
    const jail = context.global;

    // Expose a safe global.
    jail.setSync("global", jail.derefInto());
    // Expose a log function so that the isolate can log messages.
    jail.setSync("log", (...args) => {
      console.log("Isolate log:", ...args);
    });
    // Expose the fetchDelegate function to the isolate.
    const delegateRef = new ivm.Reference(fetchDelegate);
    jail.setSync("fetchDelegate", delegateRef);
    jail.setSync("myAsyncFunction", new ivm.Reference(myAsyncFunction));

    // Compile a script that calls fetchDelegate and returns its result.
    // We call fetchDelegate.apply with options to await its promise and deep-copy its result.
    const fn = await context.eval(
      `
        (async function untrusted() { 
            let str = await fetchDelegate.apply(undefined, [
          "https://jsonplaceholder.typicode.com/todos/1"
        ], { result: { promise: true, copy: true} });
            log("str => ", str.data);
            return str.data;
        })
    `,
      { reference: true }
    );
    const value = await fn.apply(undefined, [], { result: { promise: true } });
    const plainResult = value?.copySync?.();


    console.log('plainResult => ', plainResult);

    res.json({ message: "Script executed successfully", plainResult });
  } catch (err) {
    console.error("Error during isolate execution:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (context) context.release();
    if (script) script.release();
    if (isolate) isolate.dispose();
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;
