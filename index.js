#!/usr/bin/env node

const ChildProcess = require("child_process");

const task = process.argv[2];
if (!task) {
  console.error("Param missing. Pass an argument to the script, like `node bsb-shell.js \"bsb -make-world -w\"");
  process.exit(1);
}

const bsb = ChildProcess.exec(task);

function parseErrors(bsbOutput) {
  let parsedOutput = "";

  // Syntax errors and other type of errors that skip super errors processing
  const reLevel1Errors = new RegExp(
    [
      /File "(.*)", line (\d*), characters (\d*)-(\d*):[\s\S]*?/,
      /(?:Error|Warning \d+): (?:([\s\S]*?)(?:We've found a bug for you!|File "|ninja: build stopped|\[\d\/\d] Building )|(.*?)\n\S)/
    ]
      .map(r => r.source)
      .join(""),
    "g"
  );

  let errorMatch;
  while ((errorMatch = reLevel1Errors.exec(bsbOutput))) {
    const fileUri = /* "file://" + */ errorMatch[1];
    const startLine = Number(errorMatch[2]);
    const endLine = Number(errorMatch[2]);
    const startCharacter = Number(errorMatch[3]);
    const endCharacter = Number(errorMatch[4]);
    const message = (errorMatch[5] || errorMatch[6]).trim();
    const severity = /^Warning number \d+/.exec(errorMatch[0])
      ? "warning"
      : "error";

    parsedOutput += `File "${fileUri}", lines ${startLine}-${endLine}, characters ${startCharacter}-${endCharacter}:\n`;
    parsedOutput += `${severity}: ${message.split(/\n\s*/).join(" ")}\n`;
  }

  // Super errors
  const reLevel2Errors = new RegExp(
    [
      /(?:We've found a bug for you!|Warning number \d+)\n\s*/, // Heading of the error / warning
      /(.*) (\d+):(\d+)(?:-(\d+)(?::(\d+))?)?\n  \n/, // Capturing file name and lines / indexes
      /(?:.|\n)*?\n  \n/, // Ignoring actual lines content being printed
      /((?:.|\n)*?)/, // Capturing error / warning message
      /((?=We've found a bug for you!)|(?:\[\d+\/\d+\] (?:\x1b\[[0-9;]*?m)?Building)|(?:ninja: build stopped: subcommand failed)|(?=Warning number \d+)|$)/ // Possible tails
    ]
      .map(r => r.source)
      .join(""),
    "g"
  );

  while ((errorMatch = reLevel2Errors.exec(bsbOutput))) {
    const fileUri = /*"file://" + */ errorMatch[1];
    // Suppose most complex case, path/to/file.re 10:20-15:5 message
    const startLine = Number(errorMatch[2]);
    const startCharacter = Number(errorMatch[3]);
    let endLine = Number(errorMatch[4]);
    let endCharacter = Number(errorMatch[5]) + 1; // Non inclusive originally
    const message = errorMatch[6].replace(/\n  /g, "\n");
    if (isNaN(endLine)) {
      // Format path/to/file.re 10:20 message
      endCharacter = startCharacter + 1;
      endLine = startLine;
    } else if (isNaN(endCharacter)) {
      // Format path/to/file.re 10:20-15 message
      endCharacter = endLine + 1; // Format is L:SC-EC
      endLine = startLine;
    }
    const severity = /^Warning number \d+/.exec(errorMatch[0])
      ? "warning"
      : "error";

    parsedOutput += `File "${fileUri}", lines ${startLine}-${endLine}, characters ${startCharacter}-${endCharacter}:\n`;
    parsedOutput += `${severity}: ${message.split(/\n\s*/).join(" ")}\n`;
  }

  // Only added because of the special output format of interface/implementation mismatch errors
  const reLevel3Errors = new RegExp(
    [
      /(?:We've found a bug for you!|Warning number \d+)\n\s*/, // Heading of the error / warning
      /(.*)/, // Capturing file name
      /\n  \n  ((?:.|\n)*?)/, // Capturing error / warning message
      /((?=We've found a bug for you!)|(?:\[\d+\/\d+\] (?:\x1b\[[0-9;]*?m)?Building)|(?:ninja: build stopped: subcommand failed)|(?=Warning number \d+)|$)/ // Possible tails
    ]
      .map(r => r.source)
      .join(""),
    "g"
  );

  // If nothing was detected before, try to parse interface/implementation mismatch errors
  if (parsedOutput.length === 0) {
    while ((errorMatch = reLevel3Errors.exec(bsbOutput))) {
      const fileUri = /* "file://" + */ errorMatch[1];
      // No line/char info in this case
      const startLine = 1;
      const startCharacter = 0;
      const endLine = 1;
      const endCharacter = 0;
      const message = errorMatch[2].replace(/\n  /g, "\n");
      const severity = /^Warning number \d+/.exec(errorMatch[0])
        ? "warning"
        : "error";

      parsedOutput += `File "${fileUri}", lines ${startLine}-${endLine}, characters ${startCharacter}-${endCharacter}:\n`;
      parsedOutput += `${severity}: ${message.split(/\n\s*/).join(" ")}\n`;
    }
  }

  return parsedOutput;
}

let bsbOutput = "";
bsb.stdout.on("data", function(data) {
  if (data.includes(">>>> Start compiling")) {
    // Ignore this chunk and reset accumulated output
    bsbOutput = "";
  } else if (data.includes(">>>> Finish compiling")) {
    // Indicates the task problem matcher that it has to start parsing
    process.stdout.write(">>>> Start compiling\n");
    // Prints the parsed errors in a vscode-friendly format
    const parsedOutput = parseErrors(bsbOutput);
    process.stdout.write(parsedOutput);
    process.stdout.write(
      `>>>> Finish compiling\n>>>> Start original bsb output\n${bsbOutput}\n>>>> End original bsb output\n`
    );
    bsbOutput = "";
  } else {
    bsbOutput += data;
  }
});

bsb.stderr.on("data", function(data) {
  process.stderr.write(data);
});

bsb.on("error", function(error) {
  process.exit(1);
});
